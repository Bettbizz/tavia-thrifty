-- =====================================================================
-- Bizzfy POS — update 010: the M-Pesa till is checked against the POS.
-- Every payment that reaches the till (read from the till SIM's SMS on the
-- shop tablet) is saved here and matched with the sale that used its code:
--   open      paid into the till, not on any sale yet
--   matched   on a sale and the amounts agree
--   mismatch  on a sale but the sale total is different
--   checked   someone looked at it and wrote a note (e.g. a deposit)
-- Owners (and staff phones) get a notification when a payment stays open
-- too long, when amounts differ, or when a sale uses a code the till never got.
-- =====================================================================

create table if not exists public.till_payments (
  code         text primary key,
  amount       int not null check (amount > 0),
  sender       text,                          -- name as written in the SMS
  phone        text,                          -- as written in the SMS (Safaricom hides some digits)
  paid_at      timestamptz not null,          -- time in the SMS
  received_at  timestamptz not null default now(),
  raw          text,                          -- the SMS itself, for checking
  recorded_by  uuid references public.profiles(id) default auth.uid(),
  status       text not null default 'open' check (status in ('open','matched','mismatch','checked')),
  sale_total   int,                           -- total of the sale(s) that used this code
  note         text,
  checked_by   uuid references public.profiles(id),
  checked_at   timestamptz,
  alerted_at   timestamptz
);
create index if not exists till_payments_paid on public.till_payments (paid_at);
create index if not exists till_payments_open on public.till_payments (status) where status in ('open','mismatch');

alter table public.till_payments enable row level security;
drop policy if exists "staff read recent, owner all" on public.till_payments;
create policy "staff read recent, owner all" on public.till_payments
  for select using (is_owner() or (is_staff() and paid_at > now() - interval '3 days'));

-- The till check starts when the owner turns it on (once the shop tablet reads the till SMS).
alter table public.settings add column if not exists till_check boolean not null default false;

-- A sale that says M-Pesa but whose code never reached the till is alerted once.
alter table public.sales add column if not exists till_alerted_at timestamptz;

-- Work out a payment's status from the sales that used its code.
create or replace function public._match_till(p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_total int; v_n int; v_ok boolean;
begin
  if p_code is null then return; end if;
  -- An owner-approved sale counts as checked: the owner saw the till amount on the approval card.
  select coalesce(sum(total), 0), count(*), coalesce(bool_or(approved_by is not null), false) into v_total, v_n, v_ok
  from sales where mpesa_code = p_code and status = 'completed';
  if v_n > 0 and v_ok then v_total := (select amount from till_payments where code = p_code); end if;
  update till_payments p
     set sale_total = case when v_n = 0 then null else v_total end,
         status = case
           when p.status = 'checked' and v_n > 0 and v_total = p.amount then 'matched'
           when p.status = 'checked' then 'checked'
           when v_n = 0 then 'open'
           when v_total = p.amount then 'matched'
           else 'mismatch' end,
         alerted_at = case when v_n > 0 and v_total <> p.amount and p.status <> 'mismatch' then null else p.alerted_at end
   where p.code = p_code;
end $$;

create or replace function public._sales_till_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.mpesa_code is distinct from new.mpesa_code then perform _match_till(old.mpesa_code); end if;
  perform _match_till(new.mpesa_code);
  return null;
end $$;
drop trigger if exists sales_till_match on public.sales;
create trigger sales_till_match after insert or update of status, total, mpesa_code on public.sales
  for each row execute function public._sales_till_trigger();

-- The tablet saves each till payment (safe to send twice).
create or replace function public.record_till_payment(
  p_code text, p_amount int, p_sender text, p_phone text, p_paid_at timestamptz, p_raw text)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := upper(trim(p_code));
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if v_code !~ '^[A-Z0-9]{8,12}$' then raise exception 'Bad M-Pesa code'; end if;
  insert into till_payments (code, amount, sender, phone, paid_at, raw)
  values (v_code, p_amount, nullif(trim(p_sender), ''), nullif(trim(p_phone), ''),
          least(coalesce(p_paid_at, now()), now()), left(p_raw, 600))
  on conflict (code) do nothing;
  perform _match_till(v_code);
  return (select status from till_payments where code = v_code);
end $$;

-- Someone checked a payment (or a sale with no payment) and explains it.
create or replace function public.check_till_payment(p_code text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Write what you found'; end if;
  update till_payments set status = 'checked', note = trim(p_note), checked_by = auth.uid(), checked_at = now()
   where code = upper(trim(p_code)) and status in ('open', 'mismatch');
end $$;

-- Today's (or any day's) till check: payments with their status, and M-Pesa sales the till never received.
create or replace function public.till_report(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := (p_date::timestamp at time zone 'Africa/Nairobi');
        v_to timestamptz := v_from + interval '1 day';
        v_since timestamptz := (select min(received_at) from till_payments);
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if not is_owner() and p_date < (now() at time zone 'Africa/Nairobi')::date - 2 then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'code', p.code, 'amount', p.amount, 'sender', p.sender, 'paid_at', p.paid_at, 'status', p.status,
        'sale_total', p.sale_total, 'note', p.note, 'checked_by', pr.full_name) order by p.paid_at desc)
      from till_payments p left join profiles pr on pr.id = p.checked_by
      where p.paid_at >= v_from and p.paid_at < v_to), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object(
        'code', s.mpesa_code, 'total', s.total, 'sold_at', s.sold_at, 'seller', s.seller) order by s.sold_at desc)
      from (select mpesa_code, sum(total) total, min(sold_at) sold_at, min(pr.full_name) seller
            from sales x join profiles pr on pr.id = x.sold_by
            where x.payment_method = 'mpesa' and x.status = 'completed' and x.sold_at >= v_from and x.sold_at < v_to
              and v_since is not null and x.sold_at >= v_since
              and not exists (select 1 from till_payments t where t.code = x.mpesa_code)
            group by mpesa_code) s), '[]'::jsonb),
    'totals', jsonb_build_object(
      'till', coalesce((select sum(amount) from till_payments where paid_at >= v_from and paid_at < v_to), 0),
      'pos_mpesa', coalesce((select sum(total) from sales where payment_method = 'mpesa' and status = 'completed'
                               and sold_at >= v_from and sold_at < v_to), 0)));
end $$;

-- Called by the notification function: what needs a notification now (each thing once).
-- Open payments wait 10 minutes (the sale may still be in progress); sales wait 20 minutes for their SMS.
create or replace function public.till_alerts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_open jsonb; v_mis jsonb; v_miss jsonb; v_since timestamptz := (select min(received_at) from till_payments);
begin
  with x as (update till_payments set alerted_at = now()
             where status = 'open' and alerted_at is null and received_at < now() - interval '10 minutes'
             returning code, amount, sender, paid_at)
  select jsonb_agg(to_jsonb(x) order by paid_at) into v_open from x;
  with x as (update till_payments set alerted_at = now()
             where status = 'mismatch' and alerted_at is null
             returning code, amount, sale_total, sender, paid_at)
  select jsonb_agg(to_jsonb(x) order by paid_at) into v_mis from x;
  with x as (update sales s set till_alerted_at = now()
             where s.payment_method = 'mpesa' and s.status = 'completed' and s.till_alerted_at is null
               and v_since is not null and s.sold_at >= v_since and s.synced_at < now() - interval '20 minutes'
               and not exists (select 1 from till_payments t where t.code = s.mpesa_code)
             returning s.mpesa_code code, s.total, s.sold_at)
  select jsonb_agg(jsonb_build_object('code', code, 'total', total, 'sold_at', sold_at)) into v_miss
  from (select code, sum(total) total, min(sold_at) sold_at from x group by code) y;
  return jsonb_build_object('open', coalesce(v_open, '[]'::jsonb), 'mismatch', coalesce(v_mis, '[]'::jsonb),
                            'missing', coalesce(v_miss, '[]'::jsonb));
end $$;

revoke execute on function public._match_till(text), public._sales_till_trigger(), public.till_alerts()
  from public, anon, authenticated;
grant execute on function public.till_alerts() to service_role;
revoke execute on function public.record_till_payment(text, int, text, text, timestamptz, text),
  public.check_till_payment(text, text), public.till_report(date) from public, anon;
grant execute on function public.record_till_payment(text, int, text, text, timestamptz, text),
  public.check_till_payment(text, text), public.till_report(date) to authenticated;

-- Today's shop totals for the tablet's home screen (the sales goal dial). Totals only, no sale details,
-- so any staff member's tablet can show them.
create or replace function public.today_totals() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'sales', count(distinct coalesce(checkout_id, id)),
    'total', coalesce(sum(total), 0),
    'mpesa', coalesce(sum(total) filter (where payment_method = 'mpesa'), 0),
    'cash', coalesce(sum(total) filter (where payment_method = 'cash'), 0))
  from sales
  where status = 'completed' and is_staff()
    and sold_at >= (((now() at time zone 'Africa/Nairobi')::date)::timestamp at time zone 'Africa/Nairobi');
$$;
revoke execute on function public.today_totals() from public, anon;
grant execute on function public.today_totals() to authenticated;

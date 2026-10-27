-- =====================================================================
-- Tavia Thrifty — update 002: owner screens
-- Run once in Supabase: SQL Editor → New query → paste ALL of this → Run
--  * Several owners allowed, but never zero active owners
--  * New sign-ups wait for an owner to approve them
--  * Report functions for sales, profit and bales
-- =====================================================================

-- Staff list shows emails; new accounts start inactive until approved.
alter table public.profiles add column if not exists email text;
update public.profiles p set email = u.email
  from auth.users u where u.id = p.id and p.email is null;
alter table public.profiles alter column active set default false;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name, email, active)
  values (new.id,
          coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
          new.email, false);
  return new;
end $$;

-- The shop must always keep at least one active owner.
create or replace function public.keep_one_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where role = 'owner' and active) then
    raise exception 'There must always be at least one active owner';
  end if;
  return null;
end $$;

drop trigger if exists keep_one_owner on public.profiles;
create trigger keep_one_owner
  after update or delete on public.profiles
  for each statement execute function public.keep_one_owner();

-- ---------------------------------------------------------------------
-- Sales report for a date range (Nairobi dates, inclusive)
-- ---------------------------------------------------------------------
create or replace function public.sales_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can see reports'; end if;

  with s as (
    select *, (sold_at at time zone 'Africa/Nairobi')::date as day
    from sales
    where (sold_at at time zone 'Africa/Nairobi')::date between p_from and p_to
  ),
  ok as (select * from s where status = 'completed'),
  lines as (
    select l.id, l.grade_id, l.quantity, l.unit_price, l.below_min, ok.day,
           l.quantity * l.unit_price as revenue,
           coalesce((select sum(c.cost) from sale_line_costs c where c.sale_line_id = l.id), 0) as cost,
           coalesce((select sum(c.quantity) from sale_line_costs c
                      where c.sale_line_id = l.id and c.bale_stock_id is null), 0) as unstocked
    from sale_lines l join ok on ok.id = l.sale_id
  )
  select jsonb_build_object(
    'count',     (select count(*) from ok),
    'revenue',   (select coalesce(sum(total), 0) from ok),
    'cash',      (select coalesce(sum(total), 0) from ok where payment_method = 'cash'),
    'mpesa',     (select coalesce(sum(total), 0) from ok where payment_method = 'mpesa'),
    'cost',      (select round(coalesce(sum(cost), 0)) from lines),
    'pieces',    (select coalesce(sum(quantity), 0) from lines),
    'unstocked', (select coalesce(sum(unstocked), 0) from lines),
    'voided',    (select count(*) from s where status = 'voided'),
    'below_min', (select count(*) from lines where below_min),
    'by_item', (select coalesce(jsonb_agg(x order by (x->>'revenue')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('item', c.name || ' · ' || g.name,
                                  'pieces', sum(l.quantity),
                                  'revenue', sum(l.revenue),
                                  'profit', round(sum(l.revenue) - sum(l.cost))) as x
        from lines l join grades g on g.id = l.grade_id join categories c on c.id = g.category_id
        group by c.name, g.name) q),
    'by_staff', (select coalesce(jsonb_agg(x order by (x->>'revenue')::numeric desc), '[]'::jsonb) from (
        select jsonb_build_object('name', p.full_name, 'count', count(*), 'revenue', sum(ok.total)) as x
        from ok join profiles p on p.id = ok.sold_by
        group by p.id, p.full_name) q),
    'by_day', (select coalesce(jsonb_agg(x order by x->>'day' desc), '[]'::jsonb) from (
        select jsonb_build_object('day', d.day, 'count', d.n, 'revenue', d.revenue,
                                  'profit', round(d.revenue - coalesce(lc.cost, 0))) as x
        from (select day, count(*) n, sum(total) revenue from ok group by day) d
        left join (select day, sum(cost) cost from lines group by day) lc on lc.day = d.day) q)
  ) into result;
  return result;
end $$;

-- ---------------------------------------------------------------------
-- Bales: cost, pieces left, money made so far
-- ---------------------------------------------------------------------
create or replace function public.bale_report() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can see bales'; end if;
  select coalesce(jsonb_agg(x order by x->>'received_on' desc, x->>'created_at' desc), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'id', b.id, 'received_on', b.received_on, 'created_at', b.created_at,
      'supplier', b.supplier, 'cost', b.cost, 'notes', b.notes,
      'pieces', (select coalesce(sum(quantity), 0) from bale_stock where bale_id = b.id),
      'left',   (select coalesce(sum(remaining), 0) from bale_stock where bale_id = b.id),
      'sold_value', (select coalesce(sum(c.quantity * l.unit_price), 0)
                     from bale_stock bs
                     join sale_line_costs c on c.bale_stock_id = bs.id
                     join sale_lines l on l.id = c.sale_line_id
                     join sales s on s.id = l.sale_id
                     where bs.bale_id = b.id and s.status = 'completed'),
      'lines', (select jsonb_agg(jsonb_build_object('item', cat.name || ' · ' || g.name,
                                                    'quantity', bs.quantity, 'left', bs.remaining)
                                 order by cat.sort_order, g.sort_order)
                from bale_stock bs join grades g on g.id = bs.grade_id
                join categories cat on cat.id = g.category_id
                where bs.bale_id = b.id)
    ) as x
    from bales b
  ) q;
  return result;
end $$;

revoke execute on function public.sales_report(date, date), public.bale_report() from public, anon;
grant execute on function public.sales_report(date, date), public.bale_report() to authenticated;
revoke execute on function public.keep_one_owner() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Price approvals: an employee asks, an owner approves on their phone,
-- and the sale is recorded as the employee's sale (approved_by = owner).
-- ---------------------------------------------------------------------
alter table public.sales add column if not exists approved_by uuid references public.profiles(id);

create table if not exists public.price_requests (
  id             uuid primary key,              -- becomes the sale id if approved
  requested_by   uuid not null references public.profiles(id) default auth.uid(),
  requested_at   timestamptz not null default now(),
  payment_method text not null check (payment_method in ('cash','mpesa')),
  mpesa_code     text,
  lines          jsonb not null,
  total          int not null,
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','cancelled')),
  decided_by     uuid references public.profiles(id),
  decided_at     timestamptz
);
alter table public.price_requests enable row level security;
drop policy if exists "own requests or owner" on public.price_requests;
create policy "own requests or owner" on public.price_requests
  for select using (requested_by = auth.uid() or is_owner());

-- Internal: saves a sale and takes stock from the oldest bales.
-- Only called by the functions below, never directly by the app.
create or replace function public._save_sale(
  p_id uuid, p_seller uuid, p_approver uuid, p_at timestamptz,
  p_method text, p_code text, p_lines jsonb, p_allow_below boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_total int := 0;
  l jsonb; v_line uuid; v_grade uuid; v_qty int; v_price int; v_floor int;
  v_left int; v_take int; s record;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Sale has no items'; end if;

  insert into sales (id, sold_by, sold_at, payment_method, mpesa_code, approved_by)
  values (p_id, p_seller, p_at, p_method, nullif(upper(trim(p_code)), ''), p_approver);

  for l in select * from jsonb_array_elements(p_lines) loop
    v_grade := (l->>'grade_id')::uuid;
    v_qty   := (l->>'quantity')::int;
    v_price := (l->>'unit_price')::int;
    v_floor := price_floor(v_grade, p_at);
    if v_floor is null then raise exception 'Unknown item'; end if;
    if v_price < v_floor and not p_allow_below then
      raise exception 'Price % is below the lowest allowed (%). Ask the owner.', v_price, v_floor;
    end if;

    insert into sale_lines (sale_id, grade_id, quantity, unit_price, below_min)
    values (p_id, v_grade, v_qty, v_price, v_price < v_floor)
    returning id into v_line;
    v_total := v_total + v_qty * v_price;

    v_left := v_qty;
    for s in
      select bs.id, bs.remaining, bs.unit_cost
      from bale_stock bs join bales b on b.id = bs.bale_id
      where bs.grade_id = v_grade and bs.remaining > 0
      order by b.received_on, b.created_at
      for update of bs
    loop
      exit when v_left = 0;
      v_take := least(v_left, s.remaining);
      update bale_stock set remaining = remaining - v_take where id = s.id;
      insert into sale_line_costs (sale_line_id, bale_stock_id, quantity, cost)
      values (v_line, s.id, v_take, v_take * s.unit_cost);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      insert into sale_line_costs (sale_line_id, bale_stock_id, quantity, cost)
      values (v_line, null, v_left, 0);
    end if;
  end loop;

  update sales set total = v_total where id = p_id;
  return p_id;
end $$;

-- record_sale now uses the shared code (same behaviour as before).
create or replace function public.record_sale(
  p_id uuid, p_sold_at timestamptz, p_payment_method text, p_mpesa_code text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if exists (select 1 from sales where id = p_id) then return p_id; end if;  -- already synced
  return _save_sale(p_id, auth.uid(), null, least(coalesce(p_sold_at, now()), now()),
                    p_payment_method, p_mpesa_code, p_lines, is_owner());
end $$;

-- Employee asks for approval.
create or replace function public.request_approval(
  p_id uuid, p_payment_method text, p_mpesa_code text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_total int;
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if exists (select 1 from price_requests where id = p_id) then return p_id; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Sale has no items'; end if;
  select sum((x->>'quantity')::int * (x->>'unit_price')::int) into v_total from jsonb_array_elements(p_lines) x;
  insert into price_requests (id, requested_by, payment_method, mpesa_code, lines, total)
  values (p_id, auth.uid(), p_payment_method, nullif(upper(trim(p_mpesa_code)), ''), p_lines, v_total);
  return p_id;
end $$;

-- Employee cancels their own waiting request.
create or replace function public.cancel_request(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update price_requests set status = 'cancelled', decided_at = now()
  where id = p_id and requested_by = auth.uid() and status = 'pending';
end $$;

-- Owner approves or rejects. Approved = sale saved as the employee's sale.
create or replace function public.decide_request(p_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare r price_requests;
begin
  if not is_owner() then raise exception 'Only the owner can approve prices'; end if;
  select * into r from price_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then return r.status; end if;   -- already decided or cancelled
  if p_approve then
    perform _save_sale(r.id, r.requested_by, auth.uid(), r.requested_at,
                       r.payment_method, r.mpesa_code, r.lines, true);
  end if;
  update price_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

revoke execute on function public._save_sale(uuid, uuid, uuid, timestamptz, text, text, jsonb, boolean)
  from public, anon, authenticated;
revoke execute on function public.request_approval(uuid, text, text, jsonb), public.cancel_request(uuid),
  public.decide_request(uuid, boolean) from public, anon;
grant execute on function public.request_approval(uuid, text, text, jsonb), public.cancel_request(uuid),
  public.decide_request(uuid, boolean) to authenticated;

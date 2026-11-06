-- =====================================================================
-- Bizzfy POS — update 014: the till check only looks at money from the moment
-- it was switched on. Payments read from older messages are still kept (history),
-- but they don't send alerts and don't count as problems.
-- =====================================================================
alter table public.settings add column if not exists till_check_since timestamptz;
update public.settings set till_check_since = coalesce(till_check_since, now()) where id = 1 and till_check;

-- Older payments: mark them as already seen so no alert goes out for them.
update public.till_payments set alerted_at = coalesce(alerted_at, now())
 where paid_at < (select till_check_since from public.settings where id = 1);

create or replace function public.till_alerts() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_open jsonb; v_mis jsonb; v_miss jsonb;
        v_since timestamptz := (select till_check_since from settings where id = 1 and till_check);
begin
  if v_since is null then return jsonb_build_object('open', '[]'::jsonb, 'mismatch', '[]'::jsonb, 'missing', '[]'::jsonb); end if;
  with x as (update till_payments set alerted_at = now()
             where status = 'open' and alerted_at is null and paid_at >= v_since and received_at < now() - interval '10 minutes'
             returning code, amount, sender, paid_at)
  select jsonb_agg(to_jsonb(x) order by paid_at) into v_open from x;
  with x as (update till_payments set alerted_at = now()
             where status = 'mismatch' and alerted_at is null and paid_at >= v_since
             returning code, amount, sale_total, sender, paid_at)
  select jsonb_agg(to_jsonb(x) order by paid_at) into v_mis from x;
  with x as (update sales s set till_alerted_at = now()
             where s.payment_method = 'mpesa' and s.status = 'completed' and s.till_alerted_at is null
               and s.sold_at >= v_since and s.synced_at < now() - interval '20 minutes'
               and not exists (select 1 from till_payments t where t.code = s.mpesa_code)
             returning s.mpesa_code code, s.total, s.sold_at)
  select jsonb_agg(jsonb_build_object('code', code, 'total', total, 'sold_at', sold_at)) into v_miss
  from (select code, sum(total) total, min(sold_at) sold_at from x group by code) y;
  return jsonb_build_object('open', coalesce(v_open, '[]'::jsonb), 'mismatch', coalesce(v_mis, '[]'::jsonb),
                            'missing', coalesce(v_miss, '[]'::jsonb));
end $$;
revoke execute on function public.till_alerts() from public, anon, authenticated;
grant execute on function public.till_alerts() to service_role;

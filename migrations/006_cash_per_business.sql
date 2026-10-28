-- =====================================================================
-- Bizzfy POS — update 006: cash count per business + shared daily totals
-- Applied automatically by GitHub. Keeps existing counts (as "both").
-- =====================================================================

alter table public.cash_counts add column if not exists business_id uuid references public.businesses(id);
alter table public.cash_counts drop constraint if exists cash_counts_count_date_key;
create unique index if not exists cash_counts_day_business
  on public.cash_counts (count_date, business_id) nulls not distinct;

-- Count the cash for one business (null = both together, kept for older app versions).
create or replace function public.close_day_business(
  p_date date, p_opening_float int, p_counted int, p_notes text, p_business uuid) returns int
language plpgsql security definer set search_path = public as $$
declare v_expected int;
begin
  if not is_owner() then raise exception 'Only the owner can close the day'; end if;
  select coalesce(p_opening_float, 0) + coalesce(sum(total), 0) into v_expected
  from sales
  where status = 'completed' and payment_method = 'cash'
    and (sold_at at time zone 'Africa/Nairobi')::date = p_date
    and (p_business is null or business_id = p_business);

  insert into cash_counts (count_date, opening_float, expected_cash, counted_cash, notes, business_id)
  values (p_date, coalesce(p_opening_float, 0), v_expected, p_counted, p_notes, p_business)
  on conflict (count_date, business_id) do update
    set opening_float = excluded.opening_float, expected_cash = excluded.expected_cash,
        counted_cash = excluded.counted_cash, notes = excluded.notes,
        counted_by = auth.uid(), created_at = now();
  return p_counted - v_expected;
end $$;

-- Older app versions still call close_day(4 args): count both businesses together.
create or replace function public.close_day(
  p_date date, p_opening_float int, p_counted int, p_notes text) returns int
language sql security definer set search_path = public as $$
  select public.close_day_business(p_date, p_opening_float, p_counted, p_notes, null);
$$;

-- Shared page: money made per business on one day, and the total.
create or replace function public.day_summary(p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can see this'; end if;
  with s as (
    select business_id, payment_method, total from sales
    where status = 'completed' and (sold_at at time zone 'Africa/Nairobi')::date = p_date
  ),
  per as (
    select b.id, b.name, b.sort_order,
           (select count(*) from s where s.business_id = b.id) as sales,
           (select coalesce(sum(total), 0) from s where s.business_id = b.id and payment_method = 'cash') as cash,
           (select coalesce(sum(total), 0) from s where s.business_id = b.id and payment_method = 'mpesa') as mpesa,
           cc.counted_cash, cc.expected_cash
    from businesses b
    left join cash_counts cc on cc.business_id = b.id and cc.count_date = p_date
    where b.active
  )
  select jsonb_build_object(
    'date', p_date,
    'businesses', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'sales', sales, 'cash', cash, 'mpesa', mpesa, 'total', cash + mpesa,
        'counted', counted_cash, 'expected', expected_cash) order by sort_order) from per), '[]'::jsonb),
    'sales', (select coalesce(sum(sales), 0) from per),
    'cash',  (select coalesce(sum(cash), 0) from per),
    'mpesa', (select coalesce(sum(mpesa), 0) from per),
    'total', (select coalesce(sum(cash + mpesa), 0) from per),
    'counted', (select sum(counted_cash) from per),
    'all_counted', not exists (select 1 from per where counted_cash is null and sales > 0)
  ) into result;
  return result;
end $$;

revoke execute on function public.close_day_business(date, int, int, text, uuid), public.day_summary(date)
  from public, anon;
grant execute on function public.close_day_business(date, int, int, text, uuid), public.day_summary(date)
  to authenticated;

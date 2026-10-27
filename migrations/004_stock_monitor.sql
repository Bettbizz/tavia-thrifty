-- =====================================================================
-- Bizzfy POS — update 004: low-stock monitor
-- Applied automatically by GitHub. Adds settings and functions only.
-- =====================================================================

alter table public.settings add column if not exists low_stock_threshold int not null default 50
  check (low_stock_threshold >= 0);
alter table public.settings add column if not exists low_stock_alerted boolean not null default false;

-- Owner view of stock: total, alert level, and per-item selling pace.
create or replace function public.stock_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can see stock'; end if;
  with sold as (
    select l.grade_id,
           sum(l.quantity) filter (where s.sold_at >= now() - interval '14 days') as sold14,
           sum(l.quantity) as sold30
    from sale_lines l join sales s on s.id = l.sale_id
    where s.status = 'completed' and s.sold_at >= now() - interval '30 days'
    group by l.grade_id
  ),
  stock as (select grade_id, sum(remaining) as remaining from bale_stock group by grade_id)
  select jsonb_build_object(
    'total',     (select coalesce(sum(remaining), 0) from bale_stock),
    'has_bales', exists (select 1 from bale_stock),
    'threshold', (select low_stock_threshold from settings where id = 1),
    'sold14',    (select coalesce(sum(sold14), 0) from sold),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                 'grade_id', g.id, 'item', c.name || ' · ' || g.name,
                 'remaining', coalesce(st.remaining, 0),
                 'sold14', coalesce(so.sold14, 0), 'sold30', coalesce(so.sold30, 0))
               order by coalesce(so.sold14, 0) desc, c.sort_order, g.sort_order), '[]'::jsonb)
             from grades g join categories c on c.id = g.category_id
             left join stock st on st.grade_id = g.id
             left join sold so on so.grade_id = g.id
             where g.active and c.active)
  ) into result;
  return result;
end $$;

-- Used by the notification sender (server only): decides, atomically, whether a
-- low-stock alert should go out now. Alerts once per drop below the level and
-- re-arms when stock is back at or above it.
create or replace function public.low_stock_check() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_total int; v_has boolean; v_threshold int; v_alert boolean := false;
begin
  select coalesce(sum(remaining), 0), count(*) > 0 into v_total, v_has from bale_stock;
  select low_stock_threshold into v_threshold from settings where id = 1;
  if not v_has or v_threshold is null or v_threshold = 0 then
    return jsonb_build_object('alert', false, 'total', v_total, 'threshold', v_threshold);
  end if;
  if v_total < v_threshold then
    update settings set low_stock_alerted = true where id = 1 and not low_stock_alerted;
    v_alert := found;
  else
    update settings set low_stock_alerted = false where id = 1 and low_stock_alerted;
  end if;
  return jsonb_build_object('alert', v_alert, 'total', v_total, 'threshold', v_threshold);
end $$;

revoke execute on function public.stock_status() from public, anon;
grant execute on function public.stock_status() to authenticated;
revoke execute on function public.low_stock_check() from public, anon, authenticated;
grant execute on function public.low_stock_check() to service_role;

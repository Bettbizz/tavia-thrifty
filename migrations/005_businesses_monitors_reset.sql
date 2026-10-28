-- =====================================================================
-- Bizzfy POS — update 005
--  * Two businesses in one app (Tavia Thrifty + jewellery)
--  * Icons and stock monitors per item group
--  * M-Pesa codes can't be used on two sales
--  * ONE-OFF RESET of test data (sales, approvals, cash counts, bales/stock),
--    requested by the owner on 28 Oct 2026. Prices, staff, settings are kept.
-- Applied automatically by GitHub, exactly once.
-- =====================================================================

-- ---------- one-off reset of test data ----------
delete from public.sale_line_costs;
delete from public.sale_lines;
delete from public.sales;
delete from public.price_requests;
delete from public.cash_counts;
delete from public.bale_stock;
delete from public.bales;
update public.settings set low_stock_alerted = false;

-- ---------- businesses ----------
create table if not exists public.businesses (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  kind           text not null default 'bales' check (kind in ('bales','pieces')),
  receipt_phone  text,
  receipt_footer text,
  sort_order     int not null default 0,
  active         boolean not null default true
);
alter table public.businesses enable row level security;
drop policy if exists "staff read" on public.businesses;
drop policy if exists "owner write" on public.businesses;
create policy "staff read" on public.businesses for select using (is_staff());
create policy "owner write" on public.businesses for all using (is_owner()) with check (is_owner());

insert into public.businesses (name, kind, receipt_phone, receipt_footer, sort_order)
select coalesce(nullif(business_name, ''), 'Tavia Thrifty'), 'bales', receipt_phone, receipt_footer, 1
from public.settings where id = 1
  and not exists (select 1 from public.businesses);
insert into public.businesses (name, kind, receipt_footer, sort_order)
select 'Jewellery', 'pieces', 'Thank you! Karibu tena.', 2
where (select count(*) from public.businesses) = 1;

-- ---------- item groups: business, icon, stock monitor ----------
alter table public.categories add column if not exists business_id uuid references public.businesses(id);
update public.categories set business_id = (select id from public.businesses order by sort_order limit 1)
  where business_id is null;
alter table public.categories alter column business_id set not null;
alter table public.categories add column if not exists icon text;
alter table public.categories add column if not exists low_stock_threshold int not null default 50 check (low_stock_threshold >= 0);
alter table public.categories add column if not exists low_stock_alerted boolean not null default false;
alter table public.categories add column if not exists stock_full int;   -- pieces right after the last restock (bar's full end)
alter table public.categories drop constraint if exists categories_name_key;
create unique index if not exists categories_business_name on public.categories (business_id, name);

update public.categories set icon = case
    when name ilike '%pallazo%' or name ilike '%trouser%' or name ilike '%pant%' then '👖'
    when name ilike '%crop top%' or name ilike '%top%' then '👚'
    when name ilike '%body suit%' or name ilike '%bodysuit%' then '🩱'
    when name ilike '%jacket%' then '🧥'
    when name ilike '%dress%' then '👗'
    when name ilike '%skirt%' then '👗'
    when name ilike '%shoe%' then '👟'
    else '👕' end
  where icon is null;

alter table public.bales add column if not exists business_id uuid references public.businesses(id);
alter table public.sales add column if not exists business_id uuid references public.businesses(id);
create index if not exists sales_business on public.sales (business_id, sold_at);

-- ---------- M-Pesa: one code, one (completed) sale ----------
create unique index if not exists sales_mpesa_code_once on public.sales (mpesa_code)
  where mpesa_code is not null and status = 'completed';

-- ---------- saving a sale: one business per sale, M-Pesa code not reused ----------
create or replace function public._save_sale(
  p_id uuid, p_seller uuid, p_approver uuid, p_at timestamptz,
  p_method text, p_code text, p_lines jsonb, p_allow_below boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_total int := 0; v_biz uuid; v_bizcount int; v_code text := nullif(upper(trim(p_code)), '');
  l jsonb; v_line uuid; v_grade uuid; v_qty int; v_price int; v_floor int;
  v_left int; v_take int; s record;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Sale has no items'; end if;
  select min(c.business_id::text)::uuid, count(distinct c.business_id) into v_biz, v_bizcount
  from jsonb_array_elements(p_lines) x
  join grades g on g.id = (x->>'grade_id')::uuid join categories c on c.id = g.category_id;
  if v_bizcount <> 1 then raise exception 'A sale can only have items from one business'; end if;
  if v_code is not null and exists (select 1 from sales where mpesa_code = v_code and status = 'completed') then
    raise exception 'M-Pesa code % was already used on another sale', v_code;
  end if;

  insert into sales (id, sold_by, sold_at, payment_method, mpesa_code, approved_by, business_id)
  values (p_id, p_seller, p_at, p_method, v_code, p_approver, v_biz);

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
      insert into sale_line_costs (sale_line_id, bale_stock_id, quantity, cost) values (v_line, null, v_left, 0);
    end if;
  end loop;
  update sales set total = v_total where id = p_id;
  return p_id;
end $$;
revoke execute on function public._save_sale(uuid, uuid, uuid, timestamptz, text, text, jsonb, boolean)
  from public, anon, authenticated;

-- Employees may ask for approval only with a fresh M-Pesa code too.
create or replace function public.request_approval(
  p_id uuid, p_payment_method text, p_mpesa_code text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_total int; v_code text := nullif(upper(trim(p_mpesa_code)), '');
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if exists (select 1 from price_requests where id = p_id) then return p_id; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Sale has no items'; end if;
  if v_code is not null and exists (select 1 from sales where mpesa_code = v_code and status = 'completed') then
    raise exception 'M-Pesa code % was already used on another sale', v_code;
  end if;
  select sum((x->>'quantity')::int * (x->>'unit_price')::int) into v_total from jsonb_array_elements(p_lines) x;
  insert into price_requests (id, requested_by, payment_method, mpesa_code, lines, total)
  values (p_id, auth.uid(), p_payment_method, v_code, p_lines, v_total);
  return p_id;
end $$;

-- ---------- adding stock: per business, remembers the "full" level per group ----------
create or replace function public.add_bale(
  p_received_on date, p_supplier text, p_cost int, p_notes text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_bale uuid; v_weight numeric; v_biz uuid; v_bizcount int; l jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can add stock'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Add at least one item'; end if;
  select sum((x->>'quantity')::int * g.normal_price), min(c.business_id::text)::uuid, count(distinct c.business_id)
    into v_weight, v_biz, v_bizcount
  from jsonb_array_elements(p_lines) x
  join grades g on g.id = (x->>'grade_id')::uuid join categories c on c.id = g.category_id;
  if v_weight is null or v_weight <= 0 then raise exception 'Invalid items'; end if;
  if v_bizcount <> 1 then raise exception 'Stock can only be added for one business at a time'; end if;

  insert into bales (received_on, supplier, cost, notes, business_id)
  values (coalesce(p_received_on, (now() at time zone 'Africa/Nairobi')::date), p_supplier, p_cost, p_notes, v_biz)
  returning id into v_bale;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into bale_stock (bale_id, grade_id, quantity, remaining, unit_cost)
    select v_bale, g.id, (l->>'quantity')::int, (l->>'quantity')::int, round(p_cost * g.normal_price / v_weight, 2)
    from grades g where g.id = (l->>'grade_id')::uuid;
  end loop;
  -- The bar for each restocked group is "full" at its new total.
  update categories c set stock_full = t.remaining
  from (select g.category_id, sum(bs.remaining) remaining
        from bale_stock bs join grades g on g.id = bs.grade_id
        where g.category_id in (select g2.category_id from jsonb_array_elements(p_lines) x
                                join grades g2 on g2.id = (x->>'grade_id')::uuid)
        group by g.category_id) t
  where c.id = t.category_id;
  return v_bale;
end $$;

-- ---------- reports per business ----------
drop function if exists public.sales_report(date, date);
create or replace function public.sales_report(p_from date, p_to date, p_business uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can see reports'; end if;

  with s as (
    select *, (sold_at at time zone 'Africa/Nairobi')::date as day
    from sales
    where (sold_at at time zone 'Africa/Nairobi')::date between p_from and p_to
      and (p_business is null or business_id = p_business)
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

drop function if exists public.bale_report();
create or replace function public.bale_report(p_business uuid) returns jsonb
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
    where p_business is null or b.business_id = p_business
  ) q;
  return result;
end $$;

-- ---------- stock monitors (owner) ----------
drop function if exists public.stock_status();
create or replace function public.stock_status(p_business uuid) returns jsonb
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
  stock as (select grade_id, sum(remaining) remaining, count(*) lots from bale_stock group by grade_id),
  items as (
    select g.id grade_id, g.category_id, c.name || ' · ' || g.name item,
           coalesce(st.remaining, 0) remaining, coalesce(st.lots, 0) lots,
           coalesce(so.sold14, 0) sold14, coalesce(so.sold30, 0) sold30, c.sort_order, g.sort_order gsort
    from grades g join categories c on c.id = g.category_id
    left join stock st on st.grade_id = g.id left join sold so on so.grade_id = g.id
    where g.active and c.active and c.business_id = p_business
  )
  select jsonb_build_object(
    'groups', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'icon', c.icon, 'threshold', c.low_stock_threshold,
        'remaining', (select coalesce(sum(remaining), 0) from items i where i.category_id = c.id),
        'has_stock', exists (select 1 from items i where i.category_id = c.id and i.lots > 0),
        'full', c.stock_full,
        'sold14', (select coalesce(sum(sold14), 0) from items i where i.category_id = c.id))
      order by c.sort_order, c.name), '[]'::jsonb)
      from categories c where c.active and c.business_id = p_business),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('grade_id', grade_id, 'category_id', category_id,
        'item', item, 'remaining', remaining, 'sold14', sold14, 'sold30', sold30)
      order by sold14 desc, sort_order, gsort), '[]'::jsonb) from items)
  ) into result;
  return result;
end $$;

-- Server-only: which groups just dropped below their level (alert once per drop).
create or replace function public.low_stock_check() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with cur as (
    select c.id, c.name, c.icon, c.low_stock_threshold th, b.name business,
           coalesce(sum(bs.remaining), 0) remaining, count(bs.id) lots
    from categories c join businesses b on b.id = c.business_id
    left join grades g on g.category_id = c.id
    left join bale_stock bs on bs.grade_id = g.id
    where c.active
    group by c.id, b.name
  ),
  rearm as (
    update categories c set low_stock_alerted = false from cur
    where c.id = cur.id and c.low_stock_alerted and cur.remaining >= cur.th
    returning c.id
  ),
  fire as (
    update categories c set low_stock_alerted = true from cur
    where c.id = cur.id and not c.low_stock_alerted and cur.lots > 0 and cur.th > 0 and cur.remaining < cur.th
    returning cur.name, cur.icon, cur.remaining, cur.th, cur.business
  )
  select jsonb_build_object('alerts', coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'icon', icon, 'remaining', remaining, 'threshold', th, 'business', business)), '[]'::jsonb),
    'rearmed', (select count(*) from rearm))
  into v from fire;
  return v;
end $$;

revoke execute on function public.sales_report(date, date, uuid), public.bale_report(uuid), public.stock_status(uuid)
  from public, anon;
grant execute on function public.sales_report(date, date, uuid), public.bale_report(uuid), public.stock_status(uuid)
  to authenticated;
revoke execute on function public.low_stock_check() from public, anon, authenticated;
grant execute on function public.low_stock_check() to service_role;

-- =====================================================================
-- Bizzfy POS — update 008: owner can edit or delete a bale / stock delivery
-- Delete keeps a copy for 7 days (Undo), like a reset.
-- =====================================================================

alter table public.resets add column if not exists kind text not null default 'reset';
alter table public.resets add column if not exists label text;

-- Spread a bale's cost over its pieces (by normal price) and update what sold pieces cost.
create or replace function public._recost_bale(p_bale uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_cost int; v_weight numeric;
begin
  select cost into v_cost from bales where id = p_bale;
  select sum(bs.quantity * g.normal_price) into v_weight
  from bale_stock bs join grades g on g.id = bs.grade_id where bs.bale_id = p_bale;
  if v_weight is null or v_weight = 0 then return; end if;
  update bale_stock bs set unit_cost = round(v_cost * g.normal_price / v_weight, 2)
  from grades g where g.id = bs.grade_id and bs.bale_id = p_bale;
  update sale_line_costs c set cost = c.quantity * bs.unit_cost
  from bale_stock bs where bs.id = c.bale_stock_id and bs.bale_id = p_bale;
end $$;

-- Refresh the "full" end of each stock monitor bar for the groups in a bale.
create or replace function public._refresh_full(p_categories uuid[]) returns void
language sql security definer set search_path = public as $$
  -- "Full" = pieces received in the bales that still have stock in this group.
  update categories c set stock_full = nullif(coalesce(t.received, 0), 0)
  from (select c2.id, (select sum(bs.quantity) from bale_stock bs join grades g on g.id = bs.grade_id
                       where g.category_id = c2.id and bs.remaining > 0) received
        from categories c2 where c2.id = any(p_categories)) t
  where c.id = t.id;
$$;

-- Edit a bale. p_lines = [{"grade_id": "...", "quantity": 40}, ...] — the full new list.
create or replace function public.update_bale(
  p_id uuid, p_received_on date, p_supplier text, p_cost int, p_notes text, p_lines jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_biz uuid; l record; v_cats uuid[];
begin
  if not is_owner() then raise exception 'Only the owner can edit stock'; end if;
  select business_id into v_biz from bales where id = p_id for update;
  if not found then raise exception 'Bale not found'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'Cost must be 0 or more'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x join grades g on g.id = (x->>'grade_id')::uuid
             join categories c on c.id = g.category_id where c.business_id is distinct from v_biz) then
    raise exception 'Items must belong to the same business as the bale';
  end if;
  select array_agg(distinct g.category_id) into v_cats from grades g
  where g.id in (select grade_id from bale_stock where bale_id = p_id
                 union select (x->>'grade_id')::uuid from jsonb_array_elements(p_lines) x);

  update bales set received_on = coalesce(p_received_on, received_on), supplier = p_supplier,
                   cost = p_cost, notes = p_notes where id = p_id;

  for l in
    select coalesce(bs.grade_id, n.grade_id) grade_id, bs.id stock_id,
           coalesce(bs.quantity, 0) old_qty, coalesce(bs.quantity - bs.remaining, 0) sold, coalesce(n.quantity, 0) new_qty
    from (select grade_id, quantity, remaining, id from bale_stock where bale_id = p_id) bs
    full join (select (x->>'grade_id')::uuid grade_id, sum((x->>'quantity')::int) quantity
               from jsonb_array_elements(p_lines) x group by 1) n on n.grade_id = bs.grade_id
  loop
    if l.new_qty < l.sold then
      raise exception '% pieces of % were already sold from this bale; quantity cannot be lower',
        l.sold, (select c.name || ' · ' || g.name from grades g join categories c on c.id = g.category_id where g.id = l.grade_id);
    end if;
    if l.stock_id is null then
      if l.new_qty > 0 then
        insert into bale_stock (bale_id, grade_id, quantity, remaining, unit_cost) values (p_id, l.grade_id, l.new_qty, l.new_qty, 0);
      end if;
    elsif l.new_qty = 0 then
      delete from bale_stock where id = l.stock_id;          -- nothing sold from it (checked above)
    else
      update bale_stock set quantity = l.new_qty, remaining = remaining + (l.new_qty - l.old_qty) where id = l.stock_id;
    end if;
  end loop;
  if not exists (select 1 from bale_stock where bale_id = p_id) then raise exception 'A bale needs at least one item'; end if;
  perform _recost_bale(p_id);
  perform _refresh_full(v_cats);
end $$;

-- Delete a bale (after typing DELETE). Pieces already sold from it stay as sales but lose their cost.
create or replace function public.delete_bale(p_id uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bales; d jsonb; v_cats uuid[]; v_label text;
begin
  if not is_owner() then raise exception 'Only the owner can delete stock'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'Type DELETE to confirm'; end if;
  perform _purge_old_resets();
  select * into b from bales where id = p_id for update;
  if not found then raise exception 'Bale not found'; end if;
  select array_agg(distinct g.category_id) into v_cats from bale_stock bs join grades g on g.id = bs.grade_id where bs.bale_id = p_id;
  d := jsonb_build_object(
    'bales', jsonb_build_array(to_jsonb(b)),
    'bale_stock', (select coalesce(jsonb_agg(to_jsonb(bs)), '[]') from bale_stock bs where bs.bale_id = p_id),
    'costs_before', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'bale_stock_id', c.bale_stock_id, 'cost', c.cost)), '[]')
                     from sale_line_costs c join bale_stock bs on bs.id = c.bale_stock_id where bs.bale_id = p_id),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'stock_full', stock_full)), '[]')
                   from categories where id = any(v_cats)));
  v_label := to_char(b.received_on, 'DD Mon') || coalesce(' · ' || b.supplier, '') || ' · KES ' || b.cost;
  insert into resets (business_id, kind, label, counts, data)
  values (b.business_id, 'bale', v_label,
          jsonb_build_object('sales', 0, 'bales', 1, 'pieces', (select coalesce(sum(quantity), 0) from bale_stock where bale_id = p_id)), d);

  update sale_line_costs c set bale_stock_id = null, cost = 0
  from bale_stock bs where bs.id = c.bale_stock_id and bs.bale_id = p_id;
  delete from bale_stock where bale_id = p_id;
  delete from bales where id = p_id;
  perform _refresh_full(v_cats);
  return jsonb_build_object('label', v_label, 'expires_at', now() + interval '7 days');
end $$;

-- Undo handles both kinds: a reset and a deleted bale.
create or replace function public.undo_reset(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r resets; d jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can undo this'; end if;
  select * into r from resets where id = p_id for update;
  if not found or r.undone_at is not null then raise exception 'This can no longer be undone'; end if;
  if r.expires_at < now() then raise exception 'Undo period (7 days) has ended'; end if;
  d := r.data;

  insert into bales select * from jsonb_populate_recordset(null::bales, d->'bales') on conflict do nothing;
  insert into bale_stock select * from jsonb_populate_recordset(null::bale_stock, d->'bale_stock')
    where bale_id in (select id from bales) on conflict do nothing;
  if d ? 'sales' then
    insert into sales select * from jsonb_populate_recordset(null::sales, d->'sales') on conflict do nothing;
    insert into sale_lines select * from jsonb_populate_recordset(null::sale_lines, d->'sale_lines')
      where sale_id in (select id from sales) on conflict do nothing;
    insert into sale_line_costs select * from jsonb_populate_recordset(null::sale_line_costs, d->'sale_line_costs')
      where sale_line_id in (select id from sale_lines)
        and (bale_stock_id is null or bale_stock_id in (select id from bale_stock)) on conflict do nothing;
    insert into price_requests select * from jsonb_populate_recordset(null::price_requests, d->'price_requests') on conflict do nothing;
    insert into cash_counts select * from jsonb_populate_recordset(null::cash_counts, d->'cash_counts') on conflict do nothing;
  end if;
  if d ? 'costs_before' then         -- deleted bale: sold pieces get their cost and bale back
    update sale_line_costs c set bale_stock_id = (x->>'bale_stock_id')::uuid, cost = (x->>'cost')::numeric
    from jsonb_array_elements(d->'costs_before') x
    where c.id = (x->>'id')::uuid and (x->>'bale_stock_id')::uuid in (select id from bale_stock);
  end if;
  update categories c set stock_full = (x->>'stock_full')::int
    from jsonb_array_elements(d->'categories') x where c.id = (x->>'id')::uuid and (x->>'stock_full') is not null;

  update resets set undone_at = now(), data = '{}'::jsonb where id = p_id;   -- free the space now
  return jsonb_build_object('restored', r.counts,
    'skipped', (select count(*) from jsonb_array_elements(coalesce(d->'sales', '[]')) x
                where not exists (select 1 from sales s where s.id = (x->>'id')::uuid)));
end $$;

-- Undo list now says what each entry is.
create or replace function public.reset_preview(p_business uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can do this'; end if;
  perform _purge_old_resets();
  d := _reset_scope(p_business);
  return jsonb_build_object(
    'sales', jsonb_array_length(d->'sales'),
    'money', (select coalesce(sum((x->>'total')::int), 0) from jsonb_array_elements(d->'sales') x where x->>'status' = 'completed'),
    'bales', jsonb_array_length(d->'bales'),
    'requests', jsonb_array_length(d->'price_requests'),
    'cash_counts', jsonb_array_length(d->'cash_counts'),
    'undoable', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'label', r.label,
                  'created_at', r.created_at, 'expires_at', r.expires_at,
                  'business', coalesce(bz.name, 'ALL'), 'counts', r.counts) order by r.created_at desc), '[]')
                 from resets r left join businesses bz on bz.id = r.business_id where r.undone_at is null));
end $$;

revoke execute on function public._recost_bale(uuid), public._refresh_full(uuid[]) from public, anon, authenticated;
revoke execute on function public.update_bale(uuid, date, text, int, text, jsonb), public.delete_bale(uuid, text) from public, anon;
grant execute on function public.update_bale(uuid, date, text, int, text, jsonb), public.delete_bale(uuid, text) to authenticated;

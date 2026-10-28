-- =====================================================================
-- Bizzfy POS — update 007: owner can reset sales, with Undo for 7 days
-- A reset copies everything it deletes into public.resets first. The copy
-- is kept for 7 days (Undo), then deleted automatically to save space.
-- =====================================================================

create table if not exists public.resets (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid references public.businesses(id),     -- null = all businesses
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles(id) default auth.uid(),
  expires_at  timestamptz not null default now() + interval '7 days',
  undone_at   timestamptz,
  counts      jsonb not null,
  data        jsonb not null
);
alter table public.resets enable row level security;     -- read only through the functions below

-- Rows a reset of one business (or all, when null) would delete.
create or replace function public._reset_scope(p_business uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select * from sales where p_business is null or business_id = p_business),
       b as (select * from bales where p_business is null or business_id = p_business),
       r as (select pr.* from price_requests pr
             where p_business is null or exists (
               select 1 from jsonb_array_elements(pr.lines) x
               join grades g on g.id = (x->>'grade_id')::uuid join categories c on c.id = g.category_id
               where c.business_id = p_business)),
       cc as (select * from cash_counts where p_business is null or business_id = p_business)
  select jsonb_build_object(
    'sales',           (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from s),
    'sale_lines',      (select coalesce(jsonb_agg(to_jsonb(l)), '[]') from sale_lines l where l.sale_id in (select id from s)),
    'sale_line_costs', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from sale_line_costs c
                         join sale_lines l on l.id = c.sale_line_id where l.sale_id in (select id from s)),
    'bales',           (select coalesce(jsonb_agg(to_jsonb(b)), '[]') from b),
    'bale_stock',      (select coalesce(jsonb_agg(to_jsonb(bs)), '[]') from bale_stock bs where bs.bale_id in (select id from b)),
    'price_requests',  (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from r),
    'cash_counts',     (select coalesce(jsonb_agg(to_jsonb(cc)), '[]') from cc),
    'categories',      (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'stock_full', stock_full)), '[]')
                         from categories where p_business is null or business_id = p_business)
  );
$$;

create or replace function public._purge_old_resets() returns void
language sql security definer set search_path = public as $$
  delete from resets where expires_at < now() or undone_at < now() - interval '1 day';
$$;

-- What a reset would delete (for the warning screen) + resets that can still be undone.
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
    'undoable', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'created_at', r.created_at, 'expires_at', r.expires_at,
                  'business', coalesce(bz.name, 'ALL'), 'counts', r.counts) order by r.created_at desc), '[]')
                 from resets r left join businesses bz on bz.id = r.business_id where r.undone_at is null));
end $$;

-- Delete sales, approvals, cash counts and stock (one business or all). Prices, staff, settings stay.
create or replace function public.reset_sales(p_business uuid, p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d jsonb; v_id uuid; v_counts jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can reset sales'; end if;
  if p_confirm is distinct from 'RESET' then raise exception 'Type RESET to confirm'; end if;
  perform _purge_old_resets();
  d := _reset_scope(p_business);
  v_counts := jsonb_build_object('sales', jsonb_array_length(d->'sales'), 'bales', jsonb_array_length(d->'bales'),
    'requests', jsonb_array_length(d->'price_requests'), 'cash_counts', jsonb_array_length(d->'cash_counts'));
  insert into resets (business_id, counts, data) values (p_business, v_counts, d) returning id into v_id;

  delete from sale_line_costs where sale_line_id in (select (x->>'id')::uuid from jsonb_array_elements(d->'sale_lines') x);
  delete from sale_lines where id in (select (x->>'id')::uuid from jsonb_array_elements(d->'sale_lines') x);
  delete from sales where id in (select (x->>'id')::uuid from jsonb_array_elements(d->'sales') x);
  delete from price_requests where id in (select (x->>'id')::uuid from jsonb_array_elements(d->'price_requests') x);
  delete from cash_counts where id in (select (x->>'id')::uuid from jsonb_array_elements(d->'cash_counts') x);
  delete from sale_line_costs where bale_stock_id in (select (x->>'id')::uuid from jsonb_array_elements(d->'bale_stock') x);
  delete from bale_stock where id in (select (x->>'id')::uuid from jsonb_array_elements(d->'bale_stock') x);
  delete from bales where id in (select (x->>'id')::uuid from jsonb_array_elements(d->'bales') x);
  update categories set stock_full = null, low_stock_alerted = false
   where id in (select (x->>'id')::uuid from jsonb_array_elements(d->'categories') x);
  return jsonb_build_object('id', v_id, 'counts', v_counts, 'expires_at', now() + interval '7 days');
end $$;

-- Put a reset back (within 7 days). Anything recorded since the reset is kept as well.
create or replace function public.undo_reset(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r resets; d jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can undo a reset'; end if;
  select * into r from resets where id = p_id for update;
  if not found or r.undone_at is not null then raise exception 'This reset can no longer be undone'; end if;
  if r.expires_at < now() then raise exception 'Undo period (7 days) has ended'; end if;
  d := r.data;

  insert into bales select * from jsonb_populate_recordset(null::bales, d->'bales') on conflict do nothing;
  insert into bale_stock select * from jsonb_populate_recordset(null::bale_stock, d->'bale_stock')
    where bale_id in (select id from bales) on conflict do nothing;
  insert into sales select * from jsonb_populate_recordset(null::sales, d->'sales') on conflict do nothing;
  insert into sale_lines select * from jsonb_populate_recordset(null::sale_lines, d->'sale_lines')
    where sale_id in (select id from sales) on conflict do nothing;
  insert into sale_line_costs select * from jsonb_populate_recordset(null::sale_line_costs, d->'sale_line_costs')
    where sale_line_id in (select id from sale_lines)
      and (bale_stock_id is null or bale_stock_id in (select id from bale_stock)) on conflict do nothing;
  insert into price_requests select * from jsonb_populate_recordset(null::price_requests, d->'price_requests') on conflict do nothing;
  insert into cash_counts select * from jsonb_populate_recordset(null::cash_counts, d->'cash_counts') on conflict do nothing;
  update categories c set stock_full = (x->>'stock_full')::int
    from jsonb_array_elements(d->'categories') x where c.id = (x->>'id')::uuid and (x->>'stock_full') is not null;

  update resets set undone_at = now(), data = '{}'::jsonb where id = p_id;   -- free the space now
  -- Sales that could not come back (their M-Pesa code was used again after the reset).
  return jsonb_build_object('restored', r.counts,
    'skipped', (select count(*) from jsonb_array_elements(d->'sales') x
                where not exists (select 1 from sales s where s.id = (x->>'id')::uuid)));
end $$;

revoke execute on function public._reset_scope(uuid), public._purge_old_resets() from public, anon, authenticated;
revoke execute on function public.reset_preview(uuid), public.reset_sales(uuid, text), public.undo_reset(uuid) from public, anon;
grant execute on function public.reset_preview(uuid), public.reset_sales(uuid, text), public.undo_reset(uuid) to authenticated;

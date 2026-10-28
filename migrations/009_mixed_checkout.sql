-- =====================================================================
-- Bizzfy POS — update 009: one checkout can hold items from both businesses.
-- The checkout is saved as one sale per business (same payment, same
-- M-Pesa code), so each business keeps its own reports, stock and cash.
-- =====================================================================

alter table public.sales add column if not exists checkout_id uuid;
update public.sales set checkout_id = id where checkout_id is null;
create index if not exists sales_checkout on public.sales (checkout_id);

-- An M-Pesa code belongs to one checkout (it may cover one sale per business).
drop index if exists public.sales_mpesa_code_once;
create unique index if not exists sales_mpesa_code_once_per_business on public.sales (mpesa_code, business_id)
  where mpesa_code is not null and status = 'completed';

create or replace function public._code_taken(p_code text, p_checkout uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_code is not null and exists (
    select 1 from sales where mpesa_code = p_code and status = 'completed'
      and checkout_id is distinct from p_checkout);
$$;

-- Save one business's part of a checkout.
create or replace function public._save_sale(
  p_id uuid, p_checkout uuid, p_seller uuid, p_approver uuid, p_at timestamptz,
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
  if v_bizcount <> 1 then raise exception 'A sale part can only have items from one business'; end if;
  if _code_taken(v_code, p_checkout) then
    raise exception 'M-Pesa code % was already used on another sale', v_code;
  end if;

  insert into sales (id, checkout_id, sold_by, sold_at, payment_method, mpesa_code, approved_by, business_id)
  values (p_id, p_checkout, p_seller, p_at, p_method, v_code, p_approver, v_biz);

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

-- Split a checkout by business. The first business uses the checkout id itself,
-- others get a fixed id derived from it, so re-sending never duplicates.
create or replace function public._save_checkout(
  p_id uuid, p_seller uuid, p_approver uuid, p_at timestamptz,
  p_method text, p_code text, p_lines jsonb, p_allow_below boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare part record; v_n int := 0;
begin
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Sale has no items'; end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x left join grades g on g.id = (x->>'grade_id')::uuid where g.id is null) then
    raise exception 'Unknown item';
  end if;
  for part in
    select c.business_id, jsonb_agg(x) lines, min(b.sort_order) so
    from jsonb_array_elements(p_lines) x
    join grades g on g.id = (x->>'grade_id')::uuid join categories c on c.id = g.category_id
    join businesses b on b.id = c.business_id
    group by c.business_id order by so, c.business_id
  loop
    perform _save_sale(case when v_n = 0 then p_id else md5(p_id::text || part.business_id::text)::uuid end,
                       p_id, p_seller, p_approver, p_at, p_method, p_code, part.lines, p_allow_below);
    v_n := v_n + 1;
  end loop;
  return p_id;
end $$;

create or replace function public.record_sale(
  p_id uuid, p_sold_at timestamptz, p_payment_method text, p_mpesa_code text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if exists (select 1 from sales where id = p_id or checkout_id = p_id) then return p_id; end if;  -- already synced
  return _save_checkout(p_id, auth.uid(), null, least(coalesce(p_sold_at, now()), now()),
                        p_payment_method, p_mpesa_code, p_lines, is_owner());
end $$;

create or replace function public.request_approval(
  p_id uuid, p_payment_method text, p_mpesa_code text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_total int; v_code text := nullif(upper(trim(p_mpesa_code)), '');
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if exists (select 1 from price_requests where id = p_id) then return p_id; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Sale has no items'; end if;
  if _code_taken(v_code, p_id) then raise exception 'M-Pesa code % was already used on another sale', v_code; end if;
  select sum((x->>'quantity')::int * (x->>'unit_price')::int) into v_total from jsonb_array_elements(p_lines) x;
  insert into price_requests (id, requested_by, payment_method, mpesa_code, lines, total)
  values (p_id, auth.uid(), p_payment_method, v_code, p_lines, v_total);
  return p_id;
end $$;

create or replace function public.decide_request(p_id uuid, p_approve boolean) returns text
language plpgsql security definer set search_path = public as $$
declare r price_requests;
begin
  if not is_owner() then raise exception 'Only the owner can approve prices'; end if;
  select * into r from price_requests where id = p_id for update;
  if not found then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then return r.status; end if;
  if p_approve then
    perform _save_checkout(r.id, r.requested_by, auth.uid(), r.requested_at,
                           r.payment_method, r.mpesa_code, r.lines, true);
  end if;
  update price_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now()
   where id = p_id;
  return case when p_approve then 'approved' else 'rejected' end;
end $$;

drop function if exists public._save_sale(uuid, uuid, uuid, timestamptz, text, text, jsonb, boolean);
revoke execute on function public._save_sale(uuid, uuid, uuid, uuid, timestamptz, text, text, jsonb, boolean),
  public._save_checkout(uuid, uuid, uuid, timestamptz, text, text, jsonb, boolean),
  public._code_taken(text, uuid) from public, anon, authenticated;

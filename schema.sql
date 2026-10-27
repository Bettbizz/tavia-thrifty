-- =====================================================================
-- Tavia Thrifty POS — database schema v1
-- Run once in Supabase: SQL Editor → New query → paste all → Run
-- Money is stored in whole Kenyan shillings (KES).
-- Security rule: employees can never read costs/profit, change prices,
-- add stock, void sales or go below a lowest price. This is enforced
-- here on the server, not just hidden in the app.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  role       text not null default 'employee' check (role in ('owner','employee')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'owner' and active);
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active);
$$;

-- Every new login automatically gets a profile (employee by default).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Categories and grades (e.g. Pallazo → 1st camera / 2nd camera)
-- ---------------------------------------------------------------------
create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int not null default 0,
  active     boolean not null default true
);

create table public.grades (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references public.categories(id),
  name         text not null,
  normal_price int not null check (normal_price > 0),
  min_price    int not null check (min_price > 0),
  sort_order   int not null default 0,
  active       boolean not null default true,
  unique (category_id, name),
  check (min_price <= normal_price)
);

-- Owner-run sales: a special price for a grade between two times.
create table public.promotions (
  id          uuid primary key default gen_random_uuid(),
  grade_id    uuid not null references public.grades(id),
  promo_price int not null check (promo_price > 0),
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  check (ends_at > starts_at)
);

-- ---------------------------------------------------------------------
-- Bales (stock) — owner only
-- ---------------------------------------------------------------------
create table public.bales (
  id          uuid primary key default gen_random_uuid(),
  received_on date not null default ((now() at time zone 'Africa/Nairobi')::date),
  supplier    text,
  cost        int not null check (cost >= 0),
  notes       text,
  created_by  uuid references public.profiles(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- What was in each bale, per grade. unit_cost = the bale's cost spread
-- across its pieces in proportion to their normal selling price.
create table public.bale_stock (
  id        uuid primary key default gen_random_uuid(),
  bale_id   uuid not null references public.bales(id),
  grade_id  uuid not null references public.grades(id),
  quantity  int not null check (quantity > 0),
  remaining int not null check (remaining >= 0),
  unit_cost numeric(12,2) not null
);

-- ---------------------------------------------------------------------
-- Sales — never deleted, only voided by the owner
-- ---------------------------------------------------------------------
create table public.sales (
  id             uuid primary key,          -- created on the phone, so an offline
                                            -- sale can't be saved twice on sync
  sold_by        uuid not null references public.profiles(id),
  sold_at        timestamptz not null,
  synced_at      timestamptz not null default now(),
  payment_method text not null check (payment_method in ('cash','mpesa')),
  mpesa_code     text,
  total          int not null default 0,
  status         text not null default 'completed' check (status in ('completed','voided')),
  voided_by      uuid references public.profiles(id),
  voided_at      timestamptz,
  void_reason    text,
  check (payment_method <> 'mpesa' or mpesa_code is not null)
);

create table public.sale_lines (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references public.sales(id),
  grade_id   uuid not null references public.grades(id),
  quantity   int not null check (quantity > 0),
  unit_price int not null check (unit_price > 0),
  below_min  boolean not null default false     -- owner sold below lowest price
);

-- Costs live in their own owner-only table so employees can never see them.
create table public.sale_line_costs (
  id            uuid primary key default gen_random_uuid(),
  sale_line_id  uuid not null references public.sale_lines(id),
  bale_stock_id uuid references public.bale_stock(id),  -- null = no stock was recorded
  quantity      int not null,
  cost          numeric(12,2) not null default 0
);

-- End-of-day cash count
create table public.cash_counts (
  id            uuid primary key default gen_random_uuid(),
  count_date    date not null unique,
  opening_float int not null default 0,
  expected_cash int not null,
  counted_cash  int not null,
  notes         text,
  counted_by    uuid references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create index on public.sales (sold_at);
create index on public.sales (sold_by);
create index on public.sale_lines (sale_id);
create index on public.bale_stock (grade_id) where remaining > 0;

-- ---------------------------------------------------------------------
-- Business rules
-- ---------------------------------------------------------------------

-- Lowest price allowed for a grade at a given time (promo price if one is running).
create or replace function public.price_floor(p_grade uuid, p_at timestamptz) returns int
language sql stable security definer set search_path = public as $$
  select least(g.min_price, coalesce(
           (select min(p.promo_price) from promotions p
             where p.grade_id = g.id and p_at >= p.starts_at and p_at < p.ends_at),
           g.min_price))
  from grades g where g.id = p_grade and g.active;
$$;

-- Owner adds a bale: p_lines = [{"grade_id": "...", "quantity": 40}, ...]
create or replace function public.add_bale(
  p_received_on date, p_supplier text, p_cost int, p_notes text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_bale   uuid;
  v_weight numeric;
  l        jsonb;
begin
  if not is_owner() then raise exception 'Only the owner can add bales'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A bale needs at least one item line';
  end if;

  select sum((x->>'quantity')::int * g.normal_price) into v_weight
  from jsonb_array_elements(p_lines) x
  join grades g on g.id = (x->>'grade_id')::uuid;
  if v_weight is null or v_weight <= 0 then raise exception 'Invalid bale lines'; end if;

  insert into bales (received_on, supplier, cost, notes)
  values (coalesce(p_received_on, (now() at time zone 'Africa/Nairobi')::date), p_supplier, p_cost, p_notes)
  returning id into v_bale;

  for l in select * from jsonb_array_elements(p_lines) loop
    insert into bale_stock (bale_id, grade_id, quantity, remaining, unit_cost)
    select v_bale, g.id, (l->>'quantity')::int, (l->>'quantity')::int,
           round(p_cost * g.normal_price / v_weight, 2)
    from grades g where g.id = (l->>'grade_id')::uuid;
    if not found then raise exception 'Unknown grade in bale'; end if;
  end loop;
  return v_bale;
end $$;

-- Record a sale (used by the app, also when syncing offline sales).
-- p_lines = [{"grade_id": "...", "quantity": 1, "unit_price": 450}, ...]
create or replace function public.record_sale(
  p_id uuid, p_sold_at timestamptz, p_payment_method text, p_mpesa_code text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owner boolean := is_owner();
  v_at    timestamptz := least(coalesce(p_sold_at, now()), now());
  v_total int := 0;
  l jsonb; v_line uuid; v_grade uuid; v_qty int; v_price int; v_floor int;
  v_left int; v_take int; s record;
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  if exists (select 1 from sales where id = p_id) then return p_id; end if;  -- already synced
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Sale has no items'; end if;

  insert into sales (id, sold_by, sold_at, payment_method, mpesa_code)
  values (p_id, auth.uid(), v_at, p_payment_method, nullif(upper(trim(p_mpesa_code)), ''));

  for l in select * from jsonb_array_elements(p_lines) loop
    v_grade := (l->>'grade_id')::uuid;
    v_qty   := (l->>'quantity')::int;
    v_price := (l->>'unit_price')::int;
    v_floor := price_floor(v_grade, v_at);
    if v_floor is null then raise exception 'Unknown item'; end if;
    if v_price < v_floor and not v_owner then
      raise exception 'Price % is below the lowest allowed (%). Ask the owner.', v_price, v_floor;
    end if;

    insert into sale_lines (sale_id, grade_id, quantity, unit_price, below_min)
    values (p_id, v_grade, v_qty, v_price, v_price < v_floor)
    returning id into v_line;
    v_total := v_total + v_qty * v_price;

    -- Take pieces from the oldest bale first.
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

-- Owner voids a sale; its pieces go back into stock.
create or replace function public.void_sale(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only the owner can void sales'; end if;
  update sales set status = 'voided', voided_by = auth.uid(), voided_at = now(), void_reason = p_reason
  where id = p_id and status = 'completed';
  if not found then raise exception 'Sale not found or already voided'; end if;

  update bale_stock bs set remaining = bs.remaining + c.qty
  from (select slc.bale_stock_id, sum(slc.quantity) qty
        from sale_line_costs slc join sale_lines sl on sl.id = slc.sale_line_id
        where sl.sale_id = p_id and slc.bale_stock_id is not null
        group by slc.bale_stock_id) c
  where bs.id = c.bale_stock_id;
end $$;

-- Owner closes the day: returns counted minus expected (negative = cash missing).
create or replace function public.close_day(
  p_date date, p_opening_float int, p_counted int, p_notes text) returns int
language plpgsql security definer set search_path = public as $$
declare v_expected int;
begin
  if not is_owner() then raise exception 'Only the owner can close the day'; end if;
  select coalesce(p_opening_float, 0) + coalesce(sum(total), 0) into v_expected
  from sales
  where status = 'completed' and payment_method = 'cash'
    and (sold_at at time zone 'Africa/Nairobi')::date = p_date;

  insert into cash_counts (count_date, opening_float, expected_cash, counted_cash, notes)
  values (p_date, coalesce(p_opening_float, 0), v_expected, p_counted, p_notes)
  on conflict (count_date) do update
    set opening_float = excluded.opening_float, expected_cash = excluded.expected_cash,
        counted_cash = excluded.counted_cash, notes = excluded.notes,
        counted_by = auth.uid(), created_at = now();
  return p_counted - v_expected;
end $$;

-- ---------------------------------------------------------------------
-- Row-level security (who can read/write what)
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.grades          enable row level security;
alter table public.promotions      enable row level security;
alter table public.bales           enable row level security;
alter table public.bale_stock      enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_lines      enable row level security;
alter table public.sale_line_costs enable row level security;
alter table public.cash_counts     enable row level security;

create policy "see self or owner sees all" on public.profiles
  for select using (id = auth.uid() or is_owner());
create policy "owner manages staff" on public.profiles
  for update using (is_owner()) with check (is_owner());

create policy "staff read" on public.categories for select using (is_staff());
create policy "owner write" on public.categories for all using (is_owner()) with check (is_owner());
create policy "staff read" on public.grades     for select using (is_staff());
create policy "owner write" on public.grades     for all using (is_owner()) with check (is_owner());
create policy "staff read" on public.promotions for select using (is_staff());
create policy "owner write" on public.promotions for all using (is_owner()) with check (is_owner());

-- Owner-only reads; writes happen only through the functions above.
create policy "owner read" on public.bales           for select using (is_owner());
create policy "owner read" on public.bale_stock      for select using (is_owner());
create policy "owner read" on public.sale_line_costs for select using (is_owner());
create policy "owner read" on public.cash_counts     for select using (is_owner());

create policy "own sales or owner" on public.sales
  for select using (sold_by = auth.uid() or is_owner());
create policy "own sale lines or owner" on public.sale_lines
  for select using (exists (select 1 from public.sales s
                            where s.id = sale_id and (s.sold_by = auth.uid() or is_owner())));

-- Only logged-in users may call the functions.
revoke execute on function public.is_owner(), public.is_staff(),
  public.price_floor(uuid, timestamptz),
  public.add_bale(date, text, int, text, jsonb),
  public.record_sale(uuid, timestamptz, text, text, jsonb),
  public.void_sale(uuid, text),
  public.close_day(date, int, int, text)
  from public, anon;
grant execute on function public.is_owner(), public.is_staff(),
  public.price_floor(uuid, timestamptz),
  public.add_bale(date, text, int, text, jsonb),
  public.record_sale(uuid, timestamptz, text, text, jsonb),
  public.void_sale(uuid, text),
  public.close_day(date, int, int, text)
  to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

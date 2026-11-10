-- =====================================================================
-- Tractor Booking — database
-- Run once in a NEW Supabase project: SQL Editor → New query → paste all → Run
--
-- How it works
--   * Every date has three parts (slots): morning, afternoon, evening.
--   * Morning and afternoon are open on your working days (Settings).
--   * Evening is closed unless you open it (on chosen weekdays in Settings,
--     or on a single date from the calendar).
--   * You can close or open any single slot on any date.
--   * Clients send a request (no account needed). It waits for you.
--   * When you approve, that slot becomes "booked" (greyed for clients).
--     Other requests for the same slot are declined automatically.
--
-- Clients can never read other clients' names or phone numbers: they only
-- use the functions marked "for clients" below. Everything else is owners only.
-- All dates and times are Kenya time (Africa/Nairobi).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Owners (you, and anyone you trust to approve bookings)
-- Add yourself after creating your login in Authentication → Users:
--   insert into owners (user_id) select id from auth.users where email = 'YOUR EMAIL';
-- ---------------------------------------------------------------------
create table public.owners (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.owners enable row level security;

create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from owners where user_id = auth.uid());
$$;

create policy "owners see owners" on public.owners for select using (is_owner());

-- ---------------------------------------------------------------------
-- Settings (one row)
-- ---------------------------------------------------------------------
create table public.settings (
  id               int primary key default 1 check (id = 1),
  business_name    text not null default 'Tractor Hire',
  owner_phone      text not null default '',          -- WhatsApp number, e.g. 254712345678
  open_days        int[] not null default '{1,2,3,4,5,6}', -- 0 = Sunday … 6 = Saturday
  evening_days     int[] not null default '{}',       -- weekdays when evening is open by default
  morning_start    time not null default '07:00',
  morning_end      time not null default '12:00',
  afternoon_start  time not null default '13:00',
  afternoon_end    time not null default '17:00',
  evening_start    time not null default '17:30',
  evening_end      time not null default '20:00',
  min_notice_days  int not null default 1 check (min_notice_days between 0 and 30),  -- 1 = from tomorrow
  days_ahead       int not null default 60 check (days_ahead between 7 and 365),
  updated_at       timestamptz not null default now()
);
insert into public.settings (id) values (1);
alter table public.settings enable row level security;
create policy "owners manage settings" on public.settings for all using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------------------
-- Single-date changes: close a slot on a working day, or open one
-- (e.g. open the evening of 14 March). Overrides the weekly pattern.
-- ---------------------------------------------------------------------
create table public.slot_overrides (
  day   date not null,
  slot  text not null check (slot in ('morning','afternoon','evening')),
  open  boolean not null,
  primary key (day, slot)
);
alter table public.slot_overrides enable row level security;
create policy "owners manage overrides" on public.slot_overrides for all using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------------------
-- Bookings
-- ---------------------------------------------------------------------
create table public.bookings (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null unique,
  client_name  text not null check (length(btrim(client_name)) between 2 and 80),
  phone        text not null check (phone ~ '^[0-9]{9,15}$'),
  place        text not null default '' check (length(place) <= 120),
  service      text not null check (service in ('plough','plant','transport','other')),
  details      text not null default '' check (length(details) <= 500),
  day          date not null,
  slot         text not null check (slot in ('morning','afternoon','evening')),
  status       text not null default 'pending'
               check (status in ('pending','approved','declined','cancelled')),
  owner_note   text not null default '' check (length(owner_note) <= 300),
  added_by_owner boolean not null default false,
  created_at   timestamptz not null default now(),
  decided_at   timestamptz
);
-- The rule that makes double-booking impossible: one approved job per slot.
create unique index bookings_one_job_per_slot on public.bookings (day, slot) where status = 'approved';
create index bookings_day on public.bookings (day);
create index bookings_phone on public.bookings (phone);
alter table public.bookings enable row level security;
create policy "owners manage bookings" on public.bookings for all using (is_owner()) with check (is_owner());

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function public.kenya_today() returns date
language sql stable as $$ select (now() at time zone 'Africa/Nairobi')::date $$;

-- 0712 345 678 / +254 712 345 678 / 712345678  →  254712345678
create or replace function public.norm_phone(p text) returns text
language sql immutable as $$
  select case
    when d ~ '^0[17][0-9]{8}$' then '254' || substr(d, 2)
    when d ~ '^[17][0-9]{8}$'  then '254' || d
    else d end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- Is this slot open for work (ignoring bookings)?
create or replace function public.slot_is_open(p_day date, p_slot text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.open from slot_overrides o where o.day = p_day and o.slot = p_slot),
    case p_slot
      when 'evening' then extract(dow from p_day)::int = any (s.evening_days)
      else extract(dow from p_day)::int = any (s.open_days)
    end)
  from settings s where s.id = 1;
$$;

-- ---------------------------------------------------------------------
-- For clients: what they can see and do (no login)
-- ---------------------------------------------------------------------

-- Business name, phone and slot times for the booking screen.
create or replace function public.public_info() returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'business_name', business_name, 'owner_phone', owner_phone,
    'morning',   json_build_array(to_char(morning_start, 'HH24:MI'),   to_char(morning_end, 'HH24:MI')),
    'afternoon', json_build_array(to_char(afternoon_start, 'HH24:MI'), to_char(afternoon_end, 'HH24:MI')),
    'evening',   json_build_array(to_char(evening_start, 'HH24:MI'),   to_char(evening_end, 'HH24:MI')),
    'first_day', kenya_today() + min_notice_days,
    'last_day',  kenya_today() + days_ahead,
    'today',     kenya_today())
  from settings where id = 1;
$$;

-- One row per date and slot: open / booked / closed, and how many requests wait.
create or replace function public.public_calendar(p_from date, p_to date)
returns table (day date, slot text, state text, waiting int)
language sql stable security definer set search_path = public as $$
  with s as (select * from settings where id = 1),
  days as (
    select d::date as day
    from generate_series(greatest(p_from, kenya_today()),
                         least(p_to, greatest(p_from, kenya_today()) + 92), interval '1 day') d
  ),
  slots as (select unnest(array['morning','afternoon','evening']) as slot)
  select d.day, sl.slot,
    case
      when exists (select 1 from bookings b where b.day = d.day and b.slot = sl.slot and b.status = 'approved') then 'booked'
      when d.day < kenya_today() + s.min_notice_days or d.day > kenya_today() + s.days_ahead then 'closed'
      when slot_is_open(d.day, sl.slot) then 'open'
      else 'closed'
    end,
    (select count(*)::int from bookings b where b.day = d.day and b.slot = sl.slot and b.status = 'pending')
  from days d cross join slots sl cross join s
  order by d.day, array_position(array['morning','afternoon','evening'], sl.slot);
$$;

-- Send a booking request. Returns the booking reference (e.g. T7KQ2M).
create or replace function public.request_booking(
  p_name text, p_phone text, p_place text, p_service text, p_details text, p_day date, p_slot text)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare
  s settings;
  ph text := norm_phone(p_phone);
  r text;
  alphabet text := 'ACDEFGHJKLMNPQRTUVWXY34679';
begin
  select * into s from settings where id = 1;
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'NAME_REQUIRED'; end if;
  if ph !~ '^[0-9]{9,15}$' then raise exception 'BAD_PHONE'; end if;
  if p_slot not in ('morning','afternoon','evening') then raise exception 'BAD_SLOT'; end if;
  if p_day < kenya_today() + s.min_notice_days or p_day > kenya_today() + s.days_ahead then
    raise exception 'DATE_NOT_AVAILABLE';
  end if;
  if not slot_is_open(p_day, p_slot) then raise exception 'SLOT_CLOSED'; end if;
  if exists (select 1 from bookings where day = p_day and slot = p_slot and status = 'approved') then
    raise exception 'SLOT_TAKEN';
  end if;
  if exists (select 1 from bookings where phone = ph and day = p_day and slot = p_slot and status = 'pending') then
    raise exception 'ALREADY_REQUESTED';
  end if;
  -- stops one phone flooding the list with requests
  if (select count(*) from bookings where phone = ph and status = 'pending') >= 5 then
    raise exception 'TOO_MANY_PENDING';
  end if;

  loop
    r := 'T';
    for i in 1..5 loop
      r := r || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from bookings where ref = r);
  end loop;

  insert into bookings (ref, client_name, phone, place, service, details, day, slot)
  values (r, btrim(p_name), ph, left(btrim(coalesce(p_place, '')), 120),
          coalesce(nullif(p_service, ''), 'other'), left(btrim(coalesce(p_details, '')), 500), p_day, p_slot);
  return r;
end $$;

-- A client checks their own requests (needs both the phone number and the references).
create or replace function public.my_bookings(p_phone text, p_refs text[])
returns table (ref text, service text, details text, place text, day date, slot text, status text, owner_note text)
language sql stable security definer set search_path = public as $$
  select b.ref, b.service, b.details, b.place, b.day, b.slot, b.status, b.owner_note
  from bookings b
  where b.phone = norm_phone(p_phone) and b.ref = any (p_refs[1:50])
  order by b.day desc, b.created_at desc;
$$;

-- A client withdraws a request that is still waiting.
create or replace function public.cancel_request(p_phone text, p_ref text) returns boolean
language plpgsql volatile security definer set search_path = public as $$
begin
  update bookings set status = 'cancelled', decided_at = now(), owner_note = 'Cancelled by client'
  where ref = p_ref and phone = norm_phone(p_phone) and status = 'pending';
  return found;
end $$;

-- ---------------------------------------------------------------------
-- For owners
-- ---------------------------------------------------------------------

-- Approve: the slot becomes booked and other waiting requests for it are declined.
create or replace function public.approve_booking(p_id uuid, p_note text default '') returns void
language plpgsql volatile security definer set search_path = public as $$
declare b bookings;
begin
  if not is_owner() then raise exception 'NOT_ALLOWED'; end if;
  select * into b from bookings where id = p_id for update;
  if b.id is null then raise exception 'NOT_FOUND'; end if;
  if b.status <> 'pending' then raise exception 'NOT_PENDING'; end if;
  if exists (select 1 from bookings where day = b.day and slot = b.slot and status = 'approved') then
    raise exception 'SLOT_TAKEN';
  end if;
  update bookings set status = 'approved', decided_at = now(), owner_note = left(coalesce(p_note, ''), 300)
  where id = p_id;
  update bookings set status = 'declined', decided_at = now(),
         owner_note = 'This time was given to another client. Please choose another time.'
  where day = b.day and slot = b.slot and status = 'pending' and id <> p_id;
end $$;

create or replace function public.decline_booking(p_id uuid, p_note text default '') returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'NOT_ALLOWED'; end if;
  update bookings set status = 'declined', decided_at = now(), owner_note = left(coalesce(p_note, ''), 300)
  where id = p_id and status = 'pending';
  if not found then raise exception 'NOT_PENDING'; end if;
end $$;

-- Cancel an approved job (frees the slot again).
create or replace function public.cancel_booking(p_id uuid, p_note text default '') returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'NOT_ALLOWED'; end if;
  update bookings set status = 'cancelled', decided_at = now(), owner_note = left(coalesce(p_note, ''), 300)
  where id = p_id and status in ('approved','pending');
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;

-- Owner adds a job taken over the phone: approved straight away.
create or replace function public.owner_add_booking(
  p_name text, p_phone text, p_place text, p_service text, p_details text, p_day date, p_slot text)
returns text
language plpgsql volatile security definer set search_path = public as $$
declare r text; alphabet text := 'ACDEFGHJKLMNPQRTUVWXY34679';
begin
  if not is_owner() then raise exception 'NOT_ALLOWED'; end if;
  if exists (select 1 from bookings where day = p_day and slot = p_slot and status = 'approved') then
    raise exception 'SLOT_TAKEN';
  end if;
  loop
    r := 'T';
    for i in 1..5 loop r := r || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from bookings where ref = r);
  end loop;
  insert into bookings (ref, client_name, phone, place, service, details, day, slot, status, decided_at, added_by_owner)
  values (r, btrim(p_name), coalesce(nullif(norm_phone(p_phone), ''), '000000000'), coalesce(p_place, ''),
          coalesce(nullif(p_service, ''), 'other'), coalesce(p_details, ''), p_day, p_slot, 'approved', now(), true);
  update bookings set status = 'declined', decided_at = now(),
         owner_note = 'This time was given to another client. Please choose another time.'
  where day = p_day and slot = p_slot and status = 'pending';
  return r;
end $$;

-- Open or close one slot on one date. p_open = null removes the change (back to the weekly pattern).
create or replace function public.set_slot(p_day date, p_slot text, p_open boolean) returns void
language plpgsql volatile security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'NOT_ALLOWED'; end if;
  if p_open is null then
    delete from slot_overrides where day = p_day and slot = p_slot;
  else
    insert into slot_overrides (day, slot, open) values (p_day, p_slot, p_open)
    on conflict (day, slot) do update set open = excluded.open;
  end if;
end $$;

-- Owner calendar: every slot of every date in a range, with its open state.
create or replace function public.owner_calendar(p_from date, p_to date)
returns table (day date, slot text, open boolean, overridden boolean)
language sql stable security definer set search_path = public as $$
  select d::date, sl.slot, coalesce(slot_is_open(d::date, sl.slot), false),
         exists (select 1 from slot_overrides o where o.day = d::date and o.slot = sl.slot)
  from generate_series(p_from, least(p_to, p_from + 92), interval '1 day') d
  cross join unnest(array['morning','afternoon','evening']) as sl(slot)
  where is_owner();
$$;

-- ---------------------------------------------------------------------
-- Who may call what
-- (Supabase lets every login type call functions and use tables by default;
--  here the tables are owners-only and clients only get the client functions.)
-- ---------------------------------------------------------------------
revoke all on public.bookings, public.settings, public.slot_overrides, public.owners from anon;
revoke all on function public.request_booking(text, text, text, text, text, date, text) from public, anon, authenticated;
revoke all on function public.approve_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.decline_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.cancel_booking(uuid, text) from public, anon, authenticated;
revoke all on function public.owner_add_booking(text, text, text, text, text, date, text) from public, anon, authenticated;
revoke all on function public.set_slot(date, text, boolean) from public, anon, authenticated;
revoke all on function public.owner_calendar(date, date) from public, anon, authenticated;
revoke all on function public.cancel_request(text, text) from public, anon, authenticated;
revoke all on function public.my_bookings(text, text[]) from public, anon, authenticated;
revoke all on function public.public_calendar(date, date) from public, anon, authenticated;
revoke all on function public.public_info() from public, anon, authenticated;

grant execute on function public.public_info() to anon, authenticated;
grant execute on function public.public_calendar(date, date) to anon, authenticated;
grant execute on function public.request_booking(text, text, text, text, text, date, text) to anon, authenticated;
grant execute on function public.my_bookings(text, text[]) to anon, authenticated;
grant execute on function public.cancel_request(text, text) to anon, authenticated;
grant execute on function public.approve_booking(uuid, text) to authenticated;
grant execute on function public.decline_booking(uuid, text) to authenticated;
grant execute on function public.cancel_booking(uuid, text) to authenticated;
grant execute on function public.owner_add_booking(text, text, text, text, text, date, text) to authenticated;
grant execute on function public.set_slot(date, text, boolean) to authenticated;
grant execute on function public.owner_calendar(date, date) to authenticated;

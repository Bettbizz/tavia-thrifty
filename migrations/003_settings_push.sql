-- =====================================================================
-- Bizzfy POS — update 003: business settings + phone notifications
-- Run once in Supabase: SQL Editor → New query → paste ALL of this → Run
-- Adds tables only; nothing existing is changed or deleted.
-- =====================================================================

-- Business details shown at the top of the app and on receipts (one row).
create table if not exists public.settings (
  id             int primary key default 1 check (id = 1),
  business_name  text not null default 'My Shop',
  receipt_phone  text,
  receipt_footer text default 'Thank you! Karibu tena.'
);
insert into public.settings (id, business_name) values (1, 'Tavia Thrifty')
  on conflict (id) do nothing;

alter table public.settings enable row level security;
drop policy if exists "staff read" on public.settings;
drop policy if exists "owner write" on public.settings;
create policy "staff read" on public.settings for select using (is_staff());
create policy "owner write" on public.settings for update using (is_owner()) with check (is_owner());

-- Phones that asked for notifications.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for select using (user_id = auth.uid());

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not allowed'; end if;
  insert into push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
end $$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke execute on function public.save_push_subscription(text, text, text),
  public.remove_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text),
  public.remove_push_subscription(text) to authenticated;

-- ---------------------------------------------------------------------
-- Automatic updates: GitHub records each update file it has applied here,
-- so every file runs exactly once. Updates 002 and 003 were run by hand.
-- ---------------------------------------------------------------------
create table if not exists public.app_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table public.app_migrations enable row level security;  -- not readable from the app
insert into public.app_migrations (name) values ('002_owner.sql'), ('003_settings_push.sql')
  on conflict (name) do nothing;

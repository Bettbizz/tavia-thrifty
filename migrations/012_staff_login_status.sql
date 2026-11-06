-- =====================================================================
-- Bizzfy POS — update 012: staff logins the owner can see and fix.
-- * Setting a new password (Owner → Staff) also confirms the employee's
--   email: the owner vouches for them, so they can log in straight away
--   even if they never opened the confirmation email.
-- * Owner → Staff shows each person's login status.
-- =====================================================================

create or replace function public.set_staff_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_owner() then raise exception 'Only the owner can set staff passwords'; end if;
  if p_user = auth.uid() then raise exception 'Change your own password from your own login'; end if;
  if not exists (select 1 from profiles where id = p_user and role = 'employee') then
    raise exception 'Only employees'' passwords can be set here';
  end if;
  if length(coalesce(p_password, '')) < 6 then raise exception 'The password needs at least 6 characters'; end if;

  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
         email_confirmed_at = coalesce(email_confirmed_at, now()),
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'No login found for this person'; end if;
  delete from auth.sessions where user_id = p_user;   -- signed out everywhere: only the new password works
end $$;

-- Owner → Staff: has each person confirmed their email, and when did they last log in?
create or replace function public.staff_logins() returns table (id uuid, email_confirmed boolean, last_sign_in_at timestamptz)
language sql stable security definer set search_path = public as $$
  select u.id, u.email_confirmed_at is not null, u.last_sign_in_at
  from auth.users u join profiles p on p.id = u.id
  where is_owner();
$$;

revoke execute on function public.set_staff_password(uuid, text), public.staff_logins() from public, anon;
grant execute on function public.set_staff_password(uuid, text), public.staff_logins() to authenticated;

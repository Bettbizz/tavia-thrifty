-- =====================================================================
-- Bizzfy POS — update 011: the owner sets a new password for an employee
-- (forgotten password). Owner → Staff → "Set new password". The employee is
-- signed out of every phone and logs in again with the new password.
-- Owners can't change another owner's password this way.
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
         updated_at = now()
   where id = p_user;
  -- Sign the employee out everywhere, so only the new password works from now on.
  delete from auth.sessions where user_id = p_user;
end $$;

revoke execute on function public.set_staff_password(uuid, text) from public, anon;
grant execute on function public.set_staff_password(uuid, text) to authenticated;

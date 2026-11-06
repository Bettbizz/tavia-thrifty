-- =====================================================================
-- Bizzfy POS — update 013: switch the M-Pesa till check on.
-- The shop tablet (Tavia Home, device owner since 7 Nov 2026) now reads the
-- till SIM's payment messages. From now on an employee completes an M-Pesa
-- sale only when the till amount equals the sale total. Cash is unchanged.
-- To switch it off again: update public.settings set till_check = false;
-- =====================================================================
update public.settings set till_check = true where id = 1;

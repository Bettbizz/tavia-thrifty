// Tractor Booking — settings for connecting to your database (Supabase).
//
// Leave the key as PASTE_... to run in DEMO MODE: everything works, but the
// bookings are kept only on this phone/computer (good for trying it out).
//
// To go live: create a free Supabase project, run schema.sql in it, then paste
// the Project URL and the publishable (anon) key from
// Supabase → Project Settings → API. The publishable key is meant to be public;
// the database rules in schema.sql protect your data.
// NEVER put the secret / service_role key or your database password here.
export const SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
export const SUPABASE_KEY = 'PASTE_PUBLISHABLE_KEY_HERE';

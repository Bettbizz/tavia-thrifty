// Public app settings.
// The publishable (anon) key is designed to be public: the database rules in
// schema.sql are what protect your data. NEVER put the secret / service_role
// key or your database password in this file.
export const SUPABASE_URL = 'https://hcryrmtojabvghoxaloe.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_k-O3vsnMbRD6pnw59HLezQ_rJdSpnEL';

// Public half of the notification key (the private half lives only in Supabase/GitHub secrets).
export const VAPID_PUBLIC_KEY = 'BECjomdt9B2HL3xtAyvEe8sv34yeQXZiVbM-92kIl8tr0XVO-u5n18XUvDpDa_mtXI90mprUo4_cABmuVeo2GFc';

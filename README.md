# Tavia Thrifty POS — version 1

A phone app (installable web app) for recording sales at Thrifty.
It runs on Android, iPhone and computers, keeps working during short internet
cuts, and is in English and Kiswahili.

## What's in this folder

| File | What it is |
|---|---|
| `schema.sql` | Database tables and rules. Already run in Supabase. |
| `seed.sql` | Starting price list (categories, grades, prices). Run once. |
| `migrations/` | Database updates, run in order once each. |
| `owner.js` | The Owner tab. |
| `config.js` | Your Supabase address and publishable key. |
| `index.html`, `app.js`, `i18n.js`, `style.css` | The app itself. |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | Make it installable and work offline. |

## One-time setup

1. **Add the price list.** Supabase → SQL Editor → New query → paste all of
   `seed.sql` → Run. The lowest prices are about 80% of normal; change any of
   them in Table Editor → `grades`.
2. **Add your key.** Open `config.js` in a text editor and replace
   `PASTE_PUBLISHABLE_KEY_HERE` with the publishable (anon) key from
   Supabase → Project Settings → API. Never paste the secret / service_role key.
3. **Set names.** In SQL Editor, give yourself a display name:
   `update profiles set full_name = 'Your Name' where id = (select id from auth.users where email = 'YOUR EMAIL');`
4. **Run the owner update.** SQL Editor → New query → paste all of
   `migrations/002_owner.sql` → Run (once).
5. **Add staff.** The new person opens the app and taps
   **New staff? Create account**. You then open **Owner → Staff**, tick
   **Can use the app**, choose Employee or Owner, and Save.
   (You can still add users in Supabase → Authentication → Add user; they
   also appear in Owner → Staff waiting for approval.)
   If staff use made-up emails, turn off email confirmation in Supabase
   (Authentication → Sign In / Providers → Email → Confirm email).

## Put it online (Cloudflare, free)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** →
   **Upload assets** (drag and drop).
2. Name the project `tavia-thrifty` and upload this whole folder.
3. Cloudflare gives you an address like `tavia-thrifty.pages.dev`.

## Install on phones

- **Android (Chrome):** open the address → menu ⋮ → **Install app** or
  **Add to Home screen**.
- **iPhone (Safari):** open the address → Share → **Add to Home Screen**.

Log in once with internet. After that the app opens and records sales even
without internet; they send automatically when it returns.

## Updating the app later

The app is connected to GitHub (`Bettbizz/tavia-thrifty`); every change pushed
to `main` goes live automatically. Bump the version in `sw.js`
(`thrifty-v2` → `thrifty-v3`) with each release so phones refresh their copy.
Phones pick up the new version the next time the app is opened with internet
(sometimes it needs to be closed and opened twice).

## Who can do what

Enforced by the database, not just hidden in the app:

- **Employee:** record sales within the allowed price range, see own sales
  today. Below the lowest price they tap **Ask owner to approve**; the sale is
  saved as theirs once an owner approves it.
- **Owner (one or more):** everything — approve prices, reports and profit,
  bales and stock, prices, promotions, cash count, staff and roles, voiding.
  The app never allows the last active owner to be removed.

Owners see approval requests while the app is open (it checks every few
seconds).

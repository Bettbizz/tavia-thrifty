# Tavia Thrifty POS — version 1

A phone app (installable web app) for recording sales at Thrifty.
It runs on Android, iPhone and computers, keeps working during short internet
cuts, and is in English and Kiswahili.

## What's in this folder

| File | What it is |
|---|---|
| `schema.sql` | Database tables and rules. Already run in Supabase. |
| `seed.sql` | Starting price list (categories, grades, prices). Run once. |
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
4. **Add your employee.** Authentication → Users → Add user → Create new user.
   Use their email (or a made-up one such as `mary@thrifty.shop`), a password,
   tick Auto Confirm User. Then set their name with the same SQL as step 3.
   New users are employees automatically.

## Put it online (Cloudflare Pages, free)

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

Change the version in `sw.js` (`thrifty-v1` → `thrifty-v2`), then upload the
folder again in Cloudflare (Create new deployment). Phones pick up the new
version the next time the app is opened with internet.

## Who can do what

Enforced by the database, not just hidden in the app:

- **Employee:** record sales within the allowed price range, see own sales today.
- **Owner:** everything, including selling below the lowest price (flagged),
  voiding sales, seeing all staff's sales. Bales, promotions, profit reports,
  price editing and the cash count are coming in the next version.

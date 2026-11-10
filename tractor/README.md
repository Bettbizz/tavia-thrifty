# Tractor Booking

Two Android apps (installable web apps) for the tractor hire business:

| App | Page | Who |
|---|---|---|
| **Book a Tractor** | `index.html` | Farmers. See free days, pick a time, send a request, follow its status. No account needed. |
| **Tractor Owner** | `owner.html` | You. Approve or decline, see jobs, open or close times, put jobs in your phone calendar. Login needed. |

## How booking works

- Every date has three times: **Morning**, **Afternoon**, **Evening** (times set in Owner → Settings).
  If the morning is booked, the afternoon is still free.
- **Evening** is closed unless you open it, either every week on chosen weekdays (Settings) or
  on one date (Calendar → tap the day → tick *Open for booking* under Evening).
- You can also close any single time, e.g. close Friday afternoon for servicing.
- A farmer's request **waits for you**. Several farmers may ask for the same time.
- When you **approve**, that time turns grey for every farmer, the other requests for it are declined
  automatically, and you get buttons to:
  - **Add reminder to Google Calendar** (opens your calendar with the job filled in; tap Save), or
    **Calendar file** (a file with two alarms: the evening before and 1 hour before);
  - **Tell the client** on WhatsApp or SMS (message already written).
- Farmers see *Approved* / *Not approved* (with your reason) under **My bookings**.
- Jobs taken over the phone: Owner → Jobs → **Add a job**.
- New requests: the owner app checks every 30 seconds while open, shows a count on **Requests**,
  vibrates, and can show an alert. After sending, farmers also get a **Tell the owner on WhatsApp** button.
- Farmer screens are in English and Kiswahili.

The rules (no double booking, closed times, booking window) are enforced by the database, so they hold
even if two farmers tap at the same moment.

## Try it now (demo mode)

With no key in `config.js` the apps run in **demo mode**: everything works, but data stays on that one
phone/computer. Open `index.html` and `owner.html` in two tabs of the same browser to try the whole flow.

## Go live (about 15 minutes, free)

1. **Database.** Create a new project at supabase.com (keep it separate from the shop's).
   SQL Editor → New query → paste all of `schema.sql` → Run.
2. **Your login.** Authentication → Users → Add user (your email + a password, tick auto-confirm).
   Then SQL Editor:
   `insert into owners (user_id) select id from auth.users where email = 'YOUR EMAIL';`
3. **Turn off public sign-ups** (farmers don't need accounts): Authentication → Sign In / Providers →
   turn off *Allow new users to sign up*.
4. **Key.** Project Settings → API: copy the Project URL and the publishable (anon) key into `config.js`.
   Never paste the secret / service_role key.
5. **Put it online.** Cloudflare → Workers & Pages → Create → Pages → Upload assets → upload this
   `tractor` folder (e.g. project name `book-tractor` → `book-tractor.pages.dev`).
6. **Settings.** Open `…/owner.html`, log in, Settings: business name, your WhatsApp number,
   working days, evening days, times.

## Install on Android

- **Farmers:** open the address in Chrome → ⋮ → **Install app** / **Add to Home screen**.
  Share the link on WhatsApp, or print it as a QR code.
- **You:** open `…/owner.html` → ⋮ → **Install app**. It installs as a separate *Tractor Owner* app.

## Updating

Change `CACHE = 'tractor-v1'` in `sw.js` (v2, v3, …) whenever you upload new files.

## Possible next steps

- Phone notifications for new requests even when the owner app is closed (web push, as in the shop app).
- Automatic sync into Google Calendar without tapping Save (needs a Google account connection).
- A Play Store listing (the same app wrapped as a Trusted Web Activity).
- Prices per acre/trip and M-Pesa deposits.

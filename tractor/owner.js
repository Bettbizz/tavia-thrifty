// Owner app: approve or decline requests, see jobs, open/close mornings, afternoons and
// evenings on the calendar, and put approved jobs into the phone's calendar as reminders.
import { api, DEMO } from './api.js';
import {
  SLOTS, SERVICES, SERVICE_ICON, SLOT_ICON, errText, esc, load, save,
  monthGrid, monthStart, monthEnd, monthName, weekdayShort, niceDate, kenyaToday, addDays,
  showPhone, waLink, smsLink, telLink, toast, registerSW, setLang,
} from './common.js';

setLang('en'); // owner screens are in English; client messages follow the client's app
const root = document.getElementById('app');
const today = kenyaToday();
const S = {
  ready: false, authed: false, notOwner: false,
  tab: 'requests',
  settings: null,
  bookings: [],                 // today-31 … today+400
  cal: {},                      // day -> slot -> { open, overridden }
  y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1,
  day: null,
  modal: null,                  // { kind, ... }
  busy: false,
  seenPending: new Set(load('seenPending', [])),
};

const hm = (x) => String(x || '').slice(0, 5);
const times = (slot) => S.settings ? [hm(S.settings[slot + '_start']), hm(S.settings[slot + '_end'])] : ['', ''];
const slotName = (slot) => slot[0].toUpperCase() + slot.slice(1);
const slotLabel = (slot) => `${SLOT_ICON[slot]} ${slotName(slot)}`;
const svc = (s) => ({ plough: 'Ploughing', plant: 'Planting', transport: 'Transport', other: 'Other work' }[s] || s);
const byId = (id) => S.bookings.find((b) => b.id === id);
const pending = () => S.bookings.filter((b) => b.status === 'pending' && b.day >= today);
const approvedAt = (day, slot) => S.bookings.find((b) => b.day === day && b.slot === slot && b.status === 'approved');
const pendingAt = (day, slot) => S.bookings.filter((b) => b.day === day && b.slot === slot && b.status === 'pending');

// ---------- loading ----------
async function loadAll() {
  try {
    const [settings, bookings] = await Promise.all([api.settings(), api.bookings(addDays(today, -31), addDays(today, 400))]);
    S.settings = settings; S.bookings = bookings;
    await loadCal();
    notifyNew();
  } catch (e) { toast(errText(e), true); }
}
async function loadCal() {
  const rows = await api.ownerCalendar(monthStart(S.y, S.m), monthEnd(S.y, S.m));
  for (const r of rows) (S.cal[r.day] ||= {})[r.slot] = { open: r.open, overridden: r.overridden };
}
function notifyNew() {
  const p = pending();
  const fresh = p.filter((b) => !S.seenPending.has(b.id));
  document.title = (p.length ? `(${p.length}) ` : '') + 'Tractor owner';
  if (fresh.length && S.ready) {
    toast(`🔔 ${fresh.length} new booking request${fresh.length > 1 ? 's' : ''}`);
    try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
    if (document.visibilityState !== 'visible' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('New tractor booking request', { body: fresh.map((b) => `${b.client_name}: ${svc(b.service)}, ${niceDate(b.day)}`).join('\n'), icon: 'icon-192.png' });
    }
  }
  for (const b of p) S.seenPending.add(b.id);
  save('seenPending', [...S.seenPending].slice(-300));
}

// ---------- reminders in the phone's calendar ----------
function eventTimes(b) {
  const [st, en] = times(b.slot);
  const f = (t) => b.day.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
  return [f(st || '07:00'), f(en || '12:00')];
}
const eventTitle = (b) => `🚜 ${svc(b.service)} – ${b.client_name}`;
const eventText = (b) => [
  `${svc(b.service)}${b.details ? ': ' + b.details : ''}`,
  `Client: ${b.client_name}, ${showPhone(b.phone)}`,
  b.place ? `Place: ${b.place}` : '', `Booking ${b.ref}`,
].filter(Boolean).join('\n');
function googleCalLink(b) {
  const [s, e] = eventTimes(b);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: eventTitle(b), dates: `${s}/${e}`, ctz: 'Africa/Nairobi', details: eventText(b), location: b.place || '' });
  return 'https://calendar.google.com/calendar/render?' + q.toString();
}
function icsFile(b) {
  const [s, e] = eventTimes(b);
  const x = (v) => String(v).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Tractor Booking//EN', 'BEGIN:VEVENT',
    `UID:${b.id}@tractor-booking`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=Africa/Nairobi:${s}`, `DTEND;TZID=Africa/Nairobi:${e}`,
    `SUMMARY:${x(eventTitle(b))}`, `DESCRIPTION:${x(eventText(b))}`, `LOCATION:${x(b.place || '')}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Tractor job tomorrow', 'TRIGGER:-PT14H', 'END:VALARM',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Tractor job in 1 hour', 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  a.download = `tractor-${b.day}-${b.slot}.ics`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const clientMsg = (b) => b.status === 'approved'
  ? `Hello ${b.client_name}, your tractor booking is APPROVED ✅\n${svc(b.service)} – ${slotName(b.slot)} (${times(b.slot).join('–')}), ${niceDate(b.day)}.\nBooking ${b.ref}.${b.owner_note ? '\n' + b.owner_note : ''}\n— ${S.settings?.business_name || ''}`
  : `Hello ${b.client_name}, sorry, I cannot take your tractor booking for ${niceDate(b.day)} (${b.slot}).${b.owner_note ? '\n' + b.owner_note : ''} Please pick another time in the app. — ${S.settings?.business_name || ''}`;

// ---------- drawing ----------
function contact(b) {
  if (b.phone === '000000000') return '';
  return `<div class="contact">
    <a class="chip" href="${telLink(b.phone)}">📞 ${esc(showPhone(b.phone))}</a>
    <a class="chip" href="${waLink(b.phone, '')}" target="_blank" rel="noopener">💬 WhatsApp</a>
  </div>`;
}
function bookingCard(b, actions) {
  const others = pendingAt(b.day, b.slot).filter((x) => x.id !== b.id).length;
  return `<section class="card booking ${b.status}">
    <div class="b-top"><span class="pill ${b.status}">${b.status === 'pending' ? 'New request' : b.status[0].toUpperCase() + b.status.slice(1)}</span><span class="muted">#${esc(b.ref)}</span></div>
    <h3>${slotLabel(b.slot)} · ${esc(niceDate(b.day))}</h3>
    <p class="muted">${esc(times(b.slot).join(' – '))}</p>
    <p class="who"><b>${esc(b.client_name)}</b>${b.place ? ` · 📍 ${esc(b.place)}` : ''}</p>
    <p>${SERVICE_ICON[b.service]} ${svc(b.service)}${b.details ? ' — ' + esc(b.details) : ''}</p>
    ${b.owner_note ? `<p class="note">Note: ${esc(b.owner_note)}</p>` : ''}
    ${b.status === 'pending' && approvedAt(b.day, b.slot) ? '<p class="err">This time is already booked by another job.</p>' : ''}
    ${b.status === 'pending' && others ? `<p class="note">⏳ ${others} other request${others > 1 ? 's' : ''} for this same time (they are declined automatically when you approve this one).</p>` : ''}
    ${contact(b)}
    ${actions || ''}
  </section>`;
}

function requestsView() {
  const p = pending();
  if (!p.length) return '<p class="empty">No requests waiting. 🎉<br><small>New requests show here (the app checks every 30 seconds while open).</small></p>';
  return p.map((b) => bookingCard(b, `<div class="two">
    <button class="big ok" data-approve="${b.id}" ${approvedAt(b.day, b.slot) ? 'disabled' : ''}>✓ Approve</button>
    <button class="big ghost" data-decline="${b.id}">✕ Decline</button></div>`)).join('');
}

function jobsView() {
  const jobs = S.bookings.filter((b) => b.status === 'approved' && b.day >= today);
  const add = '<button class="big ghost" data-act="add">＋ Add a job (phone booking)</button>';
  if (!jobs.length) return '<p class="empty">No upcoming jobs.</p>' + add;
  let last = '';
  return add + jobs.map((b) => {
    const h = b.day !== last ? `<h4 class="dayhead">${b.day === today ? 'Today · ' : b.day === addDays(today, 1) ? 'Tomorrow · ' : ''}${esc(niceDate(b.day))}</h4>` : '';
    last = b.day;
    return h + bookingCard(b, `<div class="row-wrap">
      <a class="chip" href="${googleCalLink(b)}" target="_blank" rel="noopener">📅 Add to Google Calendar</a>
      <button class="chip" data-ics="${b.id}">⏰ Calendar file</button>
      <a class="chip" href="${waLink(b.phone, clientMsg(b))}" target="_blank" rel="noopener">💬 Send confirmation</a>
      <button class="chip danger" data-cancel="${b.id}">Cancel job</button></div>`);
  }).join('');
}

function calendarView() {
  const heads = [1, 2, 3, 4, 5, 6, 0].map((i) => `<div class="wd">${esc(weekdayShort(i))}</div>`).join('');
  const weeks = monthGrid(S.y, S.m).map((w) => w.map((d) => {
    if (!d) return '<div class="cell blank"></div>';
    const c = S.cal[d] || {};
    const bars = SLOTS.map((s) => {
      const st = approvedAt(d, s) ? 'booked' : pendingAt(d, s).length ? 'pending' : c[s]?.open ? 'open' : 'closed';
      return `<i class="bar ${st}"></i>`;
    }).join('');
    return `<button class="cell ${d < today ? 'past' : ''} ${d === S.day ? 'sel' : ''} ${d === today ? 'today' : ''}" data-day="${d}">
      <span class="num">${Number(d.slice(8))}</span><span class="bars">${bars}</span></button>`;
  }).join('')).join('');
  return `<section class="card">
    <div class="month">
      <button class="nav" data-act="prev" aria-label="previous month">‹</button>
      <h2>${esc(monthName(S.y, S.m))}</h2>
      <button class="nav" data-act="next" aria-label="next month">›</button>
    </div>
    <div class="grid">${heads}${weeks}</div>
    <div class="legend">
      <span><i class="bar booked"></i>Job</span><span><i class="bar pending"></i>Request</span>
      <span><i class="bar open"></i>Open</span><span><i class="bar closed"></i>Closed</span>
      <span class="muted">▮▮▮ = morning · afternoon · evening</span>
    </div>
  </section>
  ${S.day ? dayPanel(S.day) : '<p class="hint">Tap a day to see jobs, open the evening, or close a time.</p>'}`;
}

function dayPanel(d) {
  const c = S.cal[d] || {};
  const rows = SLOTS.map((s) => {
    const job = approvedAt(d, s); const reqs = pendingAt(d, s); const open = !!c[s]?.open;
    const toggle = d >= today ? `<label class="switch"><input type="checkbox" data-toggle="${s}" ${open ? 'checked' : ''}>
        <span>${open ? 'Open for booking' : 'Closed'}</span></label>
        ${c[s]?.overridden ? `<button class="link small" data-reset="${s}">back to usual</button>` : ''}` : '';
    return `<div class="dslot">
      <div class="dslot-head"><b>${slotLabel(s)}</b> <span class="muted">${esc(times(s).join(' – '))}</span></div>
      ${job ? `<div class="job">🚜 <b>${esc(job.client_name)}</b> — ${svc(job.service)}${job.details ? ', ' + esc(job.details) : ''}${job.place ? ' · 📍 ' + esc(job.place) : ''}
          ${contact(job)}
          <div class="row-wrap"><a class="chip" href="${googleCalLink(job)}" target="_blank" rel="noopener">📅 Google Calendar</a>
          <button class="chip" data-ics="${job.id}">⏰ Calendar file</button>
          <button class="chip danger" data-cancel="${job.id}">Cancel job</button></div></div>`
        : reqs.map((b) => `<div class="req">⏳ <b>${esc(b.client_name)}</b> — ${svc(b.service)}${b.details ? ', ' + esc(b.details) : ''}
          <div class="row-wrap"><button class="chip ok" data-approve="${b.id}">✓ Approve</button><button class="chip" data-decline="${b.id}">✕ Decline</button></div></div>`).join('')}
      <div class="row-wrap">${toggle}${!job && d >= today ? `<button class="chip" data-act="add" data-slot="${s}">＋ Add job</button>` : ''}</div>
    </div>`;
  }).join('');
  return `<section class="card" id="daypanel"><h3>${esc(niceDate(d))}</h3>${rows}</section>`;
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function settingsView() {
  const s = S.settings; if (!s) return '<p class="empty">…</p>';
  const days = (name, arr) => `<div class="days">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<label class="dchip"><input type="checkbox" name="${name}" value="${i}" ${arr.includes(i) ? 'checked' : ''}><span>${WD[i]}</span></label>`).join('')}</div>`;
  const tm = (slot) => `<div class="times"><span>${slotLabel(slot)}</span><input type="time" name="${slot}_start" value="${hm(s[slot + '_start'])}"> – <input type="time" name="${slot}_end" value="${hm(s[slot + '_end'])}"></div>`;
  return `<form id="settings" class="card">
    <label>Business name</label><input name="business_name" value="${esc(s.business_name)}" maxlength="60">
    <label>Your WhatsApp / phone number (clients use it to reach you)</label>
    <input name="owner_phone" type="tel" value="${esc(s.owner_phone ? showPhone(s.owner_phone) : '')}" placeholder="07XX XXX XXX">
    <h4>Working days (morning and afternoon open)</h4>${days('open_days', s.open_days)}
    <h4>Evening open every week on…</h4>
    <p class="muted small">Leave all off if you only work evenings sometimes — then open single evenings from the Calendar tab.</p>
    ${days('evening_days', s.evening_days)}
    <h4>Times</h4>${tm('morning')}${tm('afternoon')}${tm('evening')}
    <h4>Booking window</h4>
    <div class="times"><span>Earliest booking</span><select name="min_notice_days">
      ${[[0, 'Same day'], [1, 'From tomorrow'], [2, '2 days ahead'], [3, '3 days ahead']].map(([v, l]) => `<option value="${v}" ${s.min_notice_days === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="times"><span>Furthest ahead</span><select name="days_ahead">
      ${[30, 60, 90, 180].map((v) => `<option value="${v}" ${s.days_ahead === v ? 'selected' : ''}>${v} days</option>`).join('')}</select></div>
    <button class="big" type="submit">Save settings</button>
    <p class="muted small">Changes to days apply to every week. Single dates you opened or closed on the calendar keep their change.</p>
  </form>
  ${'Notification' in window && Notification.permission === 'default' ? '<button class="big ghost" data-act="notify">🔔 Allow alerts for new requests (while the app is open)</button>' : ''}
  <a class="big ghost" href="./" target="_blank" rel="noopener">👀 Open the client booking app</a>
  ${DEMO ? '<button class="big ghost" data-act="resetdemo">Reset demo data</button>' : '<button class="big ghost" data-act="logout">Log out</button>'}`;
}

function modalView() {
  const md = S.modal; if (!md) return '';
  let inner = '';
  if (md.kind === 'approved') {
    const b = byId(md.id);
    inner = `<div class="tick">✓</div><h2>Approved</h2>
      <p><b>${esc(b.client_name)}</b> · ${slotLabel(b.slot)} · ${esc(niceDate(b.day))}</p>
      <p class="muted">The time is now greyed out for other clients.</p>
      <a class="big" href="${googleCalLink(b)}" target="_blank" rel="noopener">📅 Add reminder to Google Calendar</a>
      <button class="big ghost" data-ics="${b.id}">⏰ Calendar file (with alarms)</button>
      <a class="big wa" href="${waLink(b.phone, clientMsg(b))}" target="_blank" rel="noopener">💬 Tell client on WhatsApp</a>
      <a class="big ghost" href="${smsLink(b.phone, clientMsg(b))}">✉️ Tell client by SMS</a>`;
  } else if (md.kind === 'decline' || md.kind === 'cancel') {
    const b = byId(md.id);
    inner = `<h2>${md.kind === 'decline' ? 'Decline request' : 'Cancel this job'}</h2>
      <p><b>${esc(b.client_name)}</b> · ${slotLabel(b.slot)} · ${esc(niceDate(b.day))}</p>
      <form id="reason"><label>Reason the client will see (optional)</label>
      <input name="note" maxlength="300" placeholder="${md.kind === 'decline' ? 'e.g. Tractor is in for service that day' : 'e.g. Rain — field too wet'}">
      <button class="big danger" type="submit">${md.kind === 'decline' ? 'Decline' : 'Cancel job'}</button></form>`;
  } else if (md.kind === 'declined') {
    const b = byId(md.id);
    inner = `<h2>Done</h2><p class="muted">The client sees this in their app. You can also tell them directly:</p>
      <a class="big wa" href="${waLink(b.phone, clientMsg(b))}" target="_blank" rel="noopener">💬 WhatsApp the client</a>
      <a class="big ghost" href="${smsLink(b.phone, clientMsg(b))}">✉️ SMS the client</a>`;
  } else if (md.kind === 'add') {
    inner = `<h2>Add a job</h2><p class="muted">For bookings you took by phone. It is approved straight away.</p>
      <form id="addjob">
      <label>Date</label><input type="date" name="day" required min="${today}" value="${md.day || S.day || addDays(today, 1)}">
      <label>Time</label><select name="slot">${SLOTS.map((s) => `<option value="${s}" ${md.slot === s ? 'selected' : ''}>${slotLabel(s)}</option>`).join('')}</select>
      <label>Work</label><select name="service">${SERVICES.map((s) => `<option value="${s}">${svc(s)}</option>`).join('')}</select>
      <label>Details</label><input name="details" maxlength="500" placeholder="e.g. 3 acres">
      <label>Client name</label><input name="name" required minlength="2" maxlength="80">
      <label>Client phone</label><input name="phone" type="tel" placeholder="07XX XXX XXX">
      <label>Place</label><input name="place" maxlength="120">
      <button class="big" type="submit">Save job</button></form>`;
  }
  return `<div class="modal" data-act="closemodal"><div class="sheet" role="dialog">
    <button class="x" data-act="closemodal" aria-label="close">✕</button>${inner}</div></div>`;
}

function loginView() {
  return `<main class="login"><div class="card">
    <div class="logo big-logo">🚜</div><h2>Owner login</h2>
    ${S.notOwner ? '<p class="err">This login is not an owner. Add it to the owners table (see README).</p>' : ''}
    <form id="login"><label>Email</label><input name="email" type="email" required autocomplete="username">
    <label>Password</label><input name="password" type="password" required autocomplete="current-password">
    <button class="big" type="submit" ${S.busy ? 'disabled' : ''}>Log in</button></form></div></main>`;
}

function render() {
  if (!S.ready) { root.innerHTML = '<p class="empty">Loading…</p>'; return; }
  if (!S.authed) { root.innerHTML = loginView(); return; }
  const n = pending().length;
  const tabs = [['requests', '🔔 Requests', n], ['jobs', '🚜 Jobs'], ['calendar', '📅 Calendar'], ['settings', '⚙️ Settings']];
  const body = { requests: requestsView, jobs: jobsView, calendar: calendarView, settings: settingsView }[S.tab]();
  root.innerHTML = `<header class="top"><div class="brand"><span class="logo">🚜</span><div><b>${esc(S.settings?.business_name || 'Tractor Hire')}</b><small>Owner</small></div></div>
    <button class="chip" data-act="reload" aria-label="refresh">↻</button></header>
    ${DEMO ? '<div class="demo">DEMO MODE — data is only on this device. Send test requests from the farmer app on this same device.</div>' : ''}
    <nav class="tabs four">${tabs.map(([k, l, c]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${l}${c ? ` <span class="badge">${c}</span>` : ''}</button>`).join('')}</nav>
    <main>${body}</main>${modalView()}`;
}

// ---------- actions ----------
async function run(fn, after) {
  if (S.busy) return; S.busy = true;
  try { await fn(); await loadAll(); after?.(); }
  catch (e) {
    const m = String(e.message || e);
    toast(/SLOT_TAKEN/.test(m) ? 'That time already has an approved job.' : /NOT_PENDING/.test(m) ? 'This request was already answered.' : errText(e), true);
    await loadAll();
  }
  S.busy = false; render();
}

root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-tab],[data-act],[data-day],[data-approve],[data-decline],[data-cancel],[data-ics],[data-reset]');
  if (!el) return;
  if (el.dataset.act === 'closemodal' && e.target !== el) return; // clicks inside the sheet
  if (el.dataset.tab) { S.tab = el.dataset.tab; render(); window.scrollTo(0, 0); return; }
  if (el.dataset.approve) { const id = el.dataset.approve; run(() => api.approve(id), () => { S.modal = { kind: 'approved', id }; }); return; }
  if (el.dataset.decline) { S.modal = { kind: 'decline', id: el.dataset.decline }; render(); return; }
  if (el.dataset.cancel) { S.modal = { kind: 'cancel', id: el.dataset.cancel }; render(); return; }
  if (el.dataset.ics) { icsFile(byId(el.dataset.ics)); return; }
  if (el.dataset.reset) { const s = el.dataset.reset; run(() => api.setSlot(S.day, s, null)); return; }
  if (el.dataset.day) { S.day = el.dataset.day; render(); document.getElementById('daypanel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  switch (el.dataset.act) {
    case 'closemodal': S.modal = null; render(); break;
    case 'prev': case 'next':
      S.m += el.dataset.act === 'next' ? 1 : -1;
      if (S.m < 0) { S.m = 11; S.y--; } if (S.m > 11) { S.m = 0; S.y++; }
      S.day = null; await loadCal(); render(); break;
    case 'add': S.modal = { kind: 'add', slot: el.dataset.slot, day: S.tab === 'calendar' ? S.day : null }; render(); break;
    case 'reload': await loadAll(); render(); toast('Up to date'); break;
    case 'notify': await Notification.requestPermission(); render(); break;
    case 'logout': await api.signOut(); S.authed = false; render(); break;
    case 'resetdemo':
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = 'Tap again to delete all demo data'; break; }
      try { localStorage.removeItem('tractor.demo'); } catch { /* blocked */ }
      location.reload(); break;
  }
});

root.addEventListener('change', (e) => {
  const s = e.target.dataset?.toggle;
  if (s) run(() => api.setSlot(S.day, s, e.target.checked));
});

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const id = e.target.id;
  if (id === 'login') {
    S.busy = true; render();
    try {
      await api.signIn(f.get('email'), f.get('password'));
      S.notOwner = !(await api.isOwner());
      S.authed = !S.notOwner;
      if (S.authed) await loadAll(); else await api.signOut();
    } catch (err) { toast('Wrong email or password', true); }
    S.busy = false; render(); return;
  }
  if (id === 'reason') {
    const md = S.modal; const note = String(f.get('note') || '').trim();
    run(() => (md.kind === 'decline' ? api.decline(md.id, note) : api.cancel(md.id, note)),
      () => { S.modal = { kind: 'declined', id: md.id }; });
    return;
  }
  if (id === 'addjob') {
    const b = Object.fromEntries(f.entries());
    run(() => api.addBooking(b), () => { S.modal = null; toast('Job saved'); });
    return;
  }
  if (id === 'settings') {
    const nums = (k) => f.getAll(k).map(Number);
    const s = {
      business_name: String(f.get('business_name') || '').trim() || 'Tractor Hire',
      owner_phone: String(f.get('owner_phone') || '').replace(/\D/g, '').replace(/^0(?=[17])/, '254'),
      open_days: nums('open_days'), evening_days: nums('evening_days'),
      min_notice_days: Number(f.get('min_notice_days')), days_ahead: Number(f.get('days_ahead')),
    };
    for (const sl of SLOTS) { s[sl + '_start'] = f.get(sl + '_start'); s[sl + '_end'] = f.get(sl + '_end'); }
    S.cal = {};
    run(() => api.saveSettings(s), () => toast('Settings saved'));
  }
});

// Check for new requests every 30 seconds while the app is open, and when it is reopened.
setInterval(async () => { if (S.authed && !S.modal && !S.busy) { await loadAll(); render(); } }, 30000);
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && S.authed && !S.busy) { await loadAll(); render(); }
});

(async () => {
  render();
  try {
    const session = await api.session();
    if (session) {
      S.authed = await api.isOwner();
      S.notOwner = !S.authed;
      if (S.authed) await loadAll();
    }
  } catch (e) { toast(errText(e), true); }
  S.ready = true;
  render();
  registerSW();
})();

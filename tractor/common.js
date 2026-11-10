// Shared by the client app (index.html) and the owner app (owner.html).

export const SLOTS = ['morning', 'afternoon', 'evening'];
export const SERVICES = ['plough', 'plant', 'transport', 'other'];
export const SERVICE_ICON = { plough: '🚜', plant: '🌱', transport: '🚚', other: '🛠️' };
export const SLOT_ICON = { morning: '🌅', afternoon: '☀️', evening: '🌙' };

// ---------- words (English / Kiswahili) ----------
const W = {
  en: {
    morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening',
    plough: 'Ploughing', plant: 'Planting', transport: 'Transport', other: 'Other work',
    open: 'Available', booked: 'Booked', closed: 'Not available', waiting: 'waiting',
    pending: 'Waiting for approval', approved: 'Approved', declined: 'Not approved', cancelled: 'Cancelled',
    book: 'Book', my: 'My bookings', pickDay: 'Pick a day', pickTime: 'Pick a time',
    legendOpen: 'Free', legendBooked: 'Booked', legendClosed: 'Closed',
    yourName: 'Your name', phone: 'Phone number', place: 'Farm location (village / area)',
    service: 'What do you need?', details: 'Details (acres, number of bags, distance…)',
    send: 'Send request', sending: 'Sending…', back: 'Back', close: 'Close',
    sentTitle: 'Request sent', sentBody: 'You will see here when it is approved. Your booking number is',
    whatsappOwner: 'Tell the owner on WhatsApp', callOwner: 'Call the owner',
    noBookings: 'No bookings yet. Pick a day on the Book tab.', refresh: 'Refresh',
    cancelReq: 'Cancel this request', cancelAsk: 'Tap again to cancel it',
    othersWaiting: (n) => n === 1 ? '1 other request is waiting for this time' : `${n} other requests are waiting for this time`,
    eveningNote: 'Evening work is only on some days.',
    offline: 'No internet. Connect and try again.',
    demo: 'DEMO MODE — bookings are only saved on this device',
    err_NAME_REQUIRED: 'Please write your name.', err_BAD_PHONE: 'Please check the phone number.',
    err_SLOT_TAKEN: 'Sorry, that time has just been booked. Please pick another.',
    err_SLOT_CLOSED: 'That time is not available. Please pick another.',
    err_DATE_NOT_AVAILABLE: 'That date cannot be booked. Please pick another.',
    err_ALREADY_REQUESTED: 'You already asked for this time. Check My bookings.',
    err_TOO_MANY_PENDING: 'You have many requests waiting. Please wait for the owner to answer.',
    err_other: 'Something went wrong. Please try again.',
    ownerNote: 'Note from owner', lang: 'Kiswahili',
  },
  sw: {
    morning: 'Asubuhi', afternoon: 'Mchana', evening: 'Jioni',
    plough: 'Kulima', plant: 'Kupanda', transport: 'Kusafirisha', other: 'Kazi nyingine',
    open: 'Iko wazi', booked: 'Imeshikwa', closed: 'Haipatikani', waiting: 'zinasubiri',
    pending: 'Inasubiri kukubaliwa', approved: 'Imekubaliwa', declined: 'Haikukubaliwa', cancelled: 'Imeghairiwa',
    book: 'Weka nafasi', my: 'Nafasi zangu', pickDay: 'Chagua siku', pickTime: 'Chagua wakati',
    legendOpen: 'Wazi', legendBooked: 'Imeshikwa', legendClosed: 'Imefungwa',
    yourName: 'Jina lako', phone: 'Nambari ya simu', place: 'Mahali shamba lilipo (kijiji / eneo)',
    service: 'Unahitaji nini?', details: 'Maelezo (ekari, idadi ya magunia, umbali…)',
    send: 'Tuma ombi', sending: 'Inatuma…', back: 'Rudi', close: 'Funga',
    sentTitle: 'Ombi limetumwa', sentBody: 'Utaona hapa likikubaliwa. Nambari ya ombi lako ni',
    whatsappOwner: 'Mjulishe mwenye trekta kwa WhatsApp', callOwner: 'Mpigie mwenye trekta',
    noBookings: 'Bado hakuna. Chagua siku kwenye "Weka nafasi".', refresh: 'Onyesha upya',
    cancelReq: 'Ghairi ombi hili', cancelAsk: 'Gusa tena kughairi',
    othersWaiting: (n) => `Maombi ${n} mengine yanasubiri wakati huu`,
    eveningNote: 'Kazi ya jioni ni siku chache tu.',
    offline: 'Hakuna mtandao. Unganisha kisha ujaribu tena.',
    demo: 'MAJARIBIO — maombi yanahifadhiwa kwenye simu hii tu',
    err_NAME_REQUIRED: 'Tafadhali andika jina lako.', err_BAD_PHONE: 'Tafadhali angalia nambari ya simu.',
    err_SLOT_TAKEN: 'Samahani, wakati huo umeshikwa sasa hivi. Chagua mwingine.',
    err_SLOT_CLOSED: 'Wakati huo haupatikani. Chagua mwingine.',
    err_DATE_NOT_AVAILABLE: 'Siku hiyo haipatikani. Chagua nyingine.',
    err_ALREADY_REQUESTED: 'Ulishaomba wakati huu. Angalia Nafasi zangu.',
    err_TOO_MANY_PENDING: 'Una maombi mengi yanayosubiri. Subiri mwenye trekta ajibu.',
    err_other: 'Kuna tatizo. Jaribu tena.',
    ownerNote: 'Ujumbe kutoka kwa mwenye trekta', lang: 'English',
  },
};
let lang = load('lang', (navigator.language || '').startsWith('sw') ? 'sw' : 'en');
export const getLang = () => lang;
export const setLang = (l) => { lang = l; save('lang', l); };
export const t = (k, ...a) => {
  const v = (W[lang] && W[lang][k]) ?? W.en[k] ?? k;
  return typeof v === 'function' ? v(...a) : v;
};
export const errText = (e) => {
  const m = String(e?.message || e || '');
  if (/fetch|network/i.test(m) && !navigator.onLine) return t('offline');
  const code = (m.match(/[A-Z][A-Z_]{4,}/) || [])[0];
  return code && W.en['err_' + code] ? t('err_' + code) : t('err_other');
};

// ---------- storage on this phone ----------
export function load(k, d) { try { const v = localStorage.getItem('tractor.' + k); return v ? JSON.parse(v) : d; } catch { return d; } }
export function save(k, v) { try { localStorage.setItem('tractor.' + k, JSON.stringify(v)); } catch { /* private mode */ } }

// ---------- text & dates ----------
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Dates are plain 'YYYY-MM-DD' strings in Kenya time everywhere.
export function kenyaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
}
export function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dow = (iso) => new Date(iso + 'T12:00:00Z').getUTCDay();
const locale = () => (lang === 'sw' ? 'sw-KE' : 'en-KE');
export function niceDate(iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString(locale(), { ...opts, timeZone: 'UTC' });
}
export function monthName(y, m) {
  return new Date(Date.UTC(y, m, 1, 12)).toLocaleDateString(locale(), { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function weekdayShort(i) { // 0 = Sunday
  return new Date(Date.UTC(2023, 0, 1 + i, 12)).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' });
}
export const slotTime = (info, slot) => (info?.[slot] ? `${info[slot][0]} – ${info[slot][1]}` : '');

// Weeks of a month, Monday first. Each week is 7 entries: 'YYYY-MM-DD' or null.
export function monthGrid(y, m) {
  const first = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const lead = (dow(first) + 6) % 7;
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= days; d++) cells.push(addDays(first, d - 1));
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
export const monthStart = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}-01`;
export const monthEnd = (y, m) => new Date(Date.UTC(y, m + 1, 0, 12)).toISOString().slice(0, 10);

// ---------- phone numbers ----------
export function normPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(d)) return '254' + d.slice(1);
  if (/^[17]\d{8}$/.test(d)) return '254' + d;
  return d;
}
export const showPhone = (p) => (/^254\d{9}$/.test(p) ? '0' + p.slice(3, 6) + ' ' + p.slice(6, 9) + ' ' + p.slice(9) : p);
export const waLink = (phone, text) => `https://wa.me/${normPhone(phone)}?text=${encodeURIComponent(text)}`;
export const smsLink = (phone, text) => `sms:+${normPhone(phone)}?body=${encodeURIComponent(text)}`;
export const telLink = (phone) => `tel:+${normPhone(phone)}`;

// ---------- small UI helpers ----------
let toastTimer;
export function toast(msg, bad = false) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
  el.textContent = msg; el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.className = 'toast'; }, 3500);
}

export function registerSW() {
  try { navigator.serviceWorker?.register('./sw.js').catch(() => {}); } catch { /* not allowed here */ }
}

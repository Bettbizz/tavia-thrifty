// Talks to the database. With a real Supabase key in config.js it uses Supabase
// (rules enforced on the server by schema.sql). Without one it runs in DEMO MODE:
// the same rules, with the data kept in this browser (shared between the client
// page and the owner page on the same device, so you can try the whole flow).
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { SLOTS, kenyaToday, addDays, dow, normPhone, load, save } from './common.js';

export const DEMO = !SUPABASE_KEY || SUPABASE_KEY.startsWith('PASTE');

let sb = null;
async function client() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  return sb;
}
async function rpc(name, args) {
  const { data, error } = await (await client()).rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

const hm = (t) => String(t || '').slice(0, 5);
function infoFromSettings(s, today) {
  return {
    business_name: s.business_name, owner_phone: s.owner_phone,
    morning: [hm(s.morning_start), hm(s.morning_end)],
    afternoon: [hm(s.afternoon_start), hm(s.afternoon_end)],
    evening: [hm(s.evening_start), hm(s.evening_end)],
    first_day: addDays(today, s.min_notice_days), last_day: addDays(today, s.days_ahead), today,
  };
}

// =====================================================================
// Live (Supabase)
// =====================================================================
const live = {
  info: () => rpc('public_info'),
  calendar: (from, to) => rpc('public_calendar', { p_from: from, p_to: to }),
  request: (b) => rpc('request_booking', {
    p_name: b.name, p_phone: b.phone, p_place: b.place, p_service: b.service,
    p_details: b.details, p_day: b.day, p_slot: b.slot }),
  myBookings: (phone, refs) => rpc('my_bookings', { p_phone: phone, p_refs: refs }),
  cancelRequest: (phone, ref) => rpc('cancel_request', { p_phone: phone, p_ref: ref }),

  // owner
  async session() { return (await (await client()).auth.getSession()).data.session; },
  async signIn(email, password) {
    const { error } = await (await client()).auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  },
  async signOut() { await (await client()).auth.signOut(); },
  async isOwner() { return !!(await rpc('is_owner')); },
  async bookings(from, to) {
    const { data, error } = await (await client()).from('bookings').select('*')
      .gte('day', from).lte('day', to).order('day').order('created_at');
    if (error) throw new Error(error.message);
    return data;
  },
  ownerCalendar: (from, to) => rpc('owner_calendar', { p_from: from, p_to: to }),
  approve: (id, note) => rpc('approve_booking', { p_id: id, p_note: note || '' }),
  decline: (id, note) => rpc('decline_booking', { p_id: id, p_note: note || '' }),
  cancel: (id, note) => rpc('cancel_booking', { p_id: id, p_note: note || '' }),
  addBooking: (b) => rpc('owner_add_booking', {
    p_name: b.name, p_phone: b.phone, p_place: b.place, p_service: b.service,
    p_details: b.details, p_day: b.day, p_slot: b.slot }),
  setSlot: (day, slot, open) => rpc('set_slot', { p_day: day, p_slot: slot, p_open: open }),
  async settings() {
    const { data, error } = await (await client()).from('settings').select('*').eq('id', 1).single();
    if (error) throw new Error(error.message);
    return data;
  },
  async saveSettings(s) {
    const { id, updated_at, ...rest } = s;
    const { error } = await (await client()).from('settings').update({ ...rest, updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) throw new Error(error.message);
  },
};

// =====================================================================
// Demo (this browser only) — same rules as schema.sql
// =====================================================================
const DEFAULT_SETTINGS = {
  id: 1, business_name: 'Tractor Hire (demo)', owner_phone: '254700000000',
  open_days: [1, 2, 3, 4, 5, 6], evening_days: [],
  morning_start: '07:00', morning_end: '12:00', afternoon_start: '13:00', afternoon_end: '17:00',
  evening_start: '17:30', evening_end: '20:00', min_notice_days: 1, days_ahead: 60,
};
const fail = (code) => { throw new Error(code); };
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const newRef = (db) => {
  const a = 'ACDEFGHJKLMNPQRTUVWXY34679'; let r;
  do { r = 'T' + Array.from({ length: 5 }, () => a[Math.floor(Math.random() * a.length)]).join(''); }
  while (db.bookings.some((b) => b.ref === r));
  return r;
};
function demoDb() {
  let db = load('demo', null);
  if (!db) {
    const today = kenyaToday();
    let d = addDays(today, 2); while (!DEFAULT_SETTINGS.open_days.includes(dow(d))) d = addDays(d, 1);
    let d2 = addDays(d, 1); while (!DEFAULT_SETTINGS.open_days.includes(dow(d2))) d2 = addDays(d2, 1);
    const now = new Date().toISOString();
    db = {
      settings: { ...DEFAULT_SETTINGS }, overrides: {},
      bookings: [
        { id: uid(), ref: 'TDEMO1', client_name: 'Wanjiku M.', phone: '254711000111', place: 'Kapsabet', service: 'plough',
          details: '4 acres', day: d, slot: 'morning', status: 'approved', owner_note: '', added_by_owner: false, created_at: now, decided_at: now },
        { id: uid(), ref: 'TDEMO2', client_name: 'Kiprop J.', phone: '254722000222', place: 'Nandi Hills', service: 'transport',
          details: '20 bags of maize to the depot', day: d, slot: 'afternoon', status: 'pending', owner_note: '', added_by_owner: false, created_at: now, decided_at: null },
        { id: uid(), ref: 'TDEMO3', client_name: 'Achieng O.', phone: '254733000333', place: 'Mosoriot', service: 'plant',
          details: '2 acres, beans', day: d2, slot: 'morning', status: 'pending', owner_note: '', added_by_owner: false, created_at: now, decided_at: null },
      ],
    };
    save('demo', db);
  }
  return db;
}
const demoSave = (db) => save('demo', db);
function demoOpen(db, day, slot) {
  const o = db.overrides[day + '|' + slot];
  if (o !== undefined) return o;
  return slot === 'evening' ? db.settings.evening_days.includes(dow(day)) : db.settings.open_days.includes(dow(day));
}
const taken = (db, day, slot) => db.bookings.some((b) => b.day === day && b.slot === slot && b.status === 'approved');
function demoInsert(db, b, status) {
  const ref = newRef(db); const now = new Date().toISOString();
  db.bookings.push({ id: uid(), ref, client_name: b.name.trim(), phone: normPhone(b.phone) || '000000000', place: b.place || '',
    service: b.service || 'other', details: b.details || '', day: b.day, slot: b.slot, status, owner_note: '',
    added_by_owner: status === 'approved', created_at: now, decided_at: status === 'approved' ? now : null });
  return ref;
}
function declineOthers(db, day, slot) {
  for (const o of db.bookings) if (o.day === day && o.slot === slot && o.status === 'pending') {
    o.status = 'declined'; o.decided_at = new Date().toISOString();
    o.owner_note = 'This time was given to another client. Please choose another time.';
  }
}
const pause = (v) => new Promise((r) => setTimeout(() => r(v), 120));

const demo = {
  async info() { return pause(infoFromSettings(demoDb().settings, kenyaToday())); },
  async calendar(from, to) {
    const db = demoDb(); const today = kenyaToday(); const s = db.settings;
    const first = addDays(today, s.min_notice_days), last = addDays(today, s.days_ahead);
    const out = [];
    for (let d = from < today ? today : from; d <= to; d = addDays(d, 1)) for (const slot of SLOTS) {
      const state = taken(db, d, slot) ? 'booked' : (d < first || d > last) ? 'closed' : demoOpen(db, d, slot) ? 'open' : 'closed';
      out.push({ day: d, slot, state, waiting: db.bookings.filter((b) => b.day === d && b.slot === slot && b.status === 'pending').length });
    }
    return pause(out);
  },
  async request(b) {
    const db = demoDb(); const s = db.settings; const today = kenyaToday(); const ph = normPhone(b.phone);
    if ((b.name || '').trim().length < 2) fail('NAME_REQUIRED');
    if (!/^\d{9,15}$/.test(ph)) fail('BAD_PHONE');
    if (b.day < addDays(today, s.min_notice_days) || b.day > addDays(today, s.days_ahead)) fail('DATE_NOT_AVAILABLE');
    if (!demoOpen(db, b.day, b.slot)) fail('SLOT_CLOSED');
    if (taken(db, b.day, b.slot)) fail('SLOT_TAKEN');
    if (db.bookings.some((x) => x.phone === ph && x.day === b.day && x.slot === b.slot && x.status === 'pending')) fail('ALREADY_REQUESTED');
    if (db.bookings.filter((x) => x.phone === ph && x.status === 'pending').length >= 5) fail('TOO_MANY_PENDING');
    const ref = demoInsert(db, b, 'pending'); demoSave(db); return pause(ref);
  },
  async myBookings(phone, refs) {
    const ph = normPhone(phone);
    return pause(demoDb().bookings.filter((b) => b.phone === ph && refs.includes(b.ref))
      .sort((a, b) => (a.day < b.day ? 1 : -1)));
  },
  async cancelRequest(phone, ref) {
    const db = demoDb(); const b = db.bookings.find((x) => x.ref === ref && x.phone === normPhone(phone) && x.status === 'pending');
    if (!b) return false;
    b.status = 'cancelled'; b.owner_note = 'Cancelled by client'; b.decided_at = new Date().toISOString(); demoSave(db); return true;
  },

  async session() { return { demo: true }; },
  async signIn() {}, async signOut() {}, async isOwner() { return true; },
  async bookings(from, to) {
    return pause(demoDb().bookings.filter((b) => b.day >= from && b.day <= to)
      .sort((a, b) => (a.day + a.created_at < b.day + b.created_at ? -1 : 1)));
  },
  async ownerCalendar(from, to) {
    const db = demoDb(); const out = [];
    for (let d = from; d <= to; d = addDays(d, 1)) for (const slot of SLOTS)
      out.push({ day: d, slot, open: demoOpen(db, d, slot), overridden: (d + '|' + slot) in db.overrides });
    return pause(out);
  },
  async approve(id, note) {
    const db = demoDb(); const b = db.bookings.find((x) => x.id === id);
    if (!b) fail('NOT_FOUND'); if (b.status !== 'pending') fail('NOT_PENDING');
    if (taken(db, b.day, b.slot)) fail('SLOT_TAKEN');
    b.status = 'approved'; b.owner_note = note || ''; b.decided_at = new Date().toISOString();
    declineOthers(db, b.day, b.slot); demoSave(db);
  },
  async decline(id, note) {
    const db = demoDb(); const b = db.bookings.find((x) => x.id === id && x.status === 'pending');
    if (!b) fail('NOT_PENDING');
    b.status = 'declined'; b.owner_note = note || ''; b.decided_at = new Date().toISOString(); demoSave(db);
  },
  async cancel(id, note) {
    const db = demoDb(); const b = db.bookings.find((x) => x.id === id && ['approved', 'pending'].includes(x.status));
    if (!b) fail('NOT_FOUND');
    b.status = 'cancelled'; b.owner_note = note || ''; b.decided_at = new Date().toISOString(); demoSave(db);
  },
  async addBooking(b) {
    const db = demoDb(); if (taken(db, b.day, b.slot)) fail('SLOT_TAKEN');
    const ref = demoInsert(db, b, 'approved'); declineOthers(db, b.day, b.slot); demoSave(db); return ref;
  },
  async setSlot(day, slot, open) {
    const db = demoDb(); const k = day + '|' + slot;
    if (open === null) delete db.overrides[k]; else db.overrides[k] = open;
    demoSave(db);
  },
  async settings() { return pause({ ...demoDb().settings }); },
  async saveSettings(s) { const db = demoDb(); db.settings = { ...db.settings, ...s }; demoSave(db); },
};

export const api = DEMO ? demo : live;

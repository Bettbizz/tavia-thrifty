// Client app: farmers pick a day and a time (morning / afternoon / evening) and send a request.
import { api, DEMO } from './api.js';
import {
  SLOTS, SERVICES, SERVICE_ICON, SLOT_ICON, t, getLang, setLang, errText, load, save, esc,
  monthGrid, monthStart, monthEnd, monthName, weekdayShort, niceDate, slotTime, kenyaToday,
  normPhone, showPhone, waLink, telLink, toast, registerSW,
} from './common.js';

const root = document.getElementById('app');
const S = {
  tab: 'book',
  info: null,
  cal: {},                 // day -> { morning: {state, waiting}, ... }
  y: 0, m: 0,              // month shown
  day: null, slot: null,   // what the farmer is choosing
  view: 'calendar',        // calendar | form | sent
  me: load('me', { name: '', phone: '', place: '' }),
  refs: load('refs', []),  // booking numbers sent from this phone
  mine: null,
  draft: { service: 'plough', details: '' },  // kept if sending fails
  lastRef: null,
  busy: false,
  error: '',
};

// ---------- loading ----------
async function loadInfo() {
  try {
    S.info = await api.info();
    save('info', S.info);
  } catch (e) {
    S.info = load('info', null);
    if (!S.info) S.error = errText(e);
  }
  if (S.info) {
    const [y, m] = S.info.first_day.split('-').map(Number);
    S.y = y; S.m = m - 1;
    document.title = S.info.business_name;
  }
}
async function loadMonth() {
  if (!S.info) return;
  const from = [monthStart(S.y, S.m), S.info.first_day].sort()[1];
  const to = [monthEnd(S.y, S.m), S.info.last_day].sort()[0];
  if (from > to) return;
  try {
    const rows = await api.calendar(from, to);
    for (const r of rows) (S.cal[r.day] ||= {})[r.slot] = { state: r.state, waiting: r.waiting };
    S.error = '';
  } catch (e) { S.error = errText(e); }
}
async function loadMine() {
  if (!S.refs.length || !S.me.phone) { S.mine = []; return; }
  try { S.mine = await api.myBookings(S.me.phone, S.refs); }
  catch (e) { toast(errText(e), true); S.mine ||= []; }
}

// ---------- drawing ----------
const dayState = (d) => {
  const c = S.cal[d];
  if (!c) return 'closed';
  const states = SLOTS.map((s) => c[s]?.state);
  if (states.includes('open')) return 'open';
  if (states.includes('booked')) return 'full';
  return 'closed';
};

function header() {
  return `<header class="top">
    <div class="brand"><span class="logo">🚜</span><div><b>${esc(S.info?.business_name || 'Tractor Hire')}</b></div></div>
    <button class="chip" data-act="lang">${t('lang')}</button>
  </header>
  ${DEMO ? `<div class="demo">${t('demo')}</div>` : ''}
  <nav class="tabs">
    <button class="${S.tab === 'book' ? 'on' : ''}" data-tab="book">📅 ${t('book')}</button>
    <button class="${S.tab === 'my' ? 'on' : ''}" data-tab="my">📋 ${t('my')}${pendingCount() ? ` <span class="badge">${pendingCount()}</span>` : ''}</button>
  </nav>`;
}
const pendingCount = () => (S.mine || []).filter((b) => b.status === 'pending').length;

function calendarView() {
  if (!S.info) return `<p class="empty">${esc(S.error || '…')}</p>`;
  const [fy, fm] = S.info.first_day.split('-').map(Number);
  const [ly, lm] = S.info.last_day.split('-').map(Number);
  const canPrev = S.y * 12 + S.m > fy * 12 + fm - 1;
  const canNext = S.y * 12 + S.m < ly * 12 + lm - 1;
  const heads = [1, 2, 3, 4, 5, 6, 0].map((i) => `<div class="wd">${esc(weekdayShort(i))}</div>`).join('');
  const weeks = monthGrid(S.y, S.m).map((w) => w.map((d) => {
    if (!d) return '<div class="cell blank"></div>';
    const st = dayState(d); const c = S.cal[d] || {};
    const bars = SLOTS.map((s) => `<i class="bar ${c[s]?.state || 'closed'}"></i>`).join('');
    return `<button class="cell ${st} ${d === S.day ? 'sel' : ''}" data-day="${d}" ${st === 'open' ? '' : 'disabled'}
      aria-label="${esc(niceDate(d))}"><span class="num">${Number(d.slice(8))}</span><span class="bars">${bars}</span></button>`;
  }).join('')).join('');

  return `<section class="card">
    <div class="month">
      <button class="nav" data-act="prev" ${canPrev ? '' : 'disabled'} aria-label="previous month">‹</button>
      <h2>${esc(monthName(S.y, S.m))}</h2>
      <button class="nav" data-act="next" ${canNext ? '' : 'disabled'} aria-label="next month">›</button>
    </div>
    <div class="grid">${heads}${weeks}</div>
    <div class="legend">
      <span><i class="bar open"></i>${t('legendOpen')}</span>
      <span><i class="bar booked"></i>${t('legendBooked')}</span>
      <span><i class="bar closed"></i>${t('legendClosed')}</span>
      <span class="muted">▮▮▮ = ${t('morning')} · ${t('afternoon')} · ${t('evening')}</span>
    </div>
    ${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}
  </section>
  ${S.day ? slotsPanel() : `<p class="hint">👆 ${t('pickDay')}</p>`}`;
}

function slotsPanel() {
  const c = S.cal[S.day] || {};
  const rows = SLOTS.map((s) => {
    const st = c[s]?.state || 'closed';
    if (s === 'evening' && st === 'closed') return '';
    const w = c[s]?.waiting || 0;
    return `<button class="slot ${st}" data-slot="${s}" ${st === 'open' ? '' : 'disabled'}>
      <span class="ico">${SLOT_ICON[s]}</span>
      <span class="what"><b>${t(s)}</b><small>${esc(slotTime(S.info, s))}</small></span>
      <span class="state">${t(st)}${st === 'open' && w ? `<small>${w} ${t('waiting')}</small>` : ''}</span>
    </button>`;
  }).join('');
  const eveningHidden = (c.evening?.state || 'closed') === 'closed';
  return `<section class="card" id="slots">
    <h3>${esc(niceDate(S.day))}</h3>
    <p class="muted">${t('pickTime')}</p>
    <div class="slots">${rows}</div>
    ${eveningHidden ? `<p class="muted small">🌙 ${t('eveningNote')}</p>` : ''}
  </section>`;
}

function formView() {
  const w = S.cal[S.day]?.[S.slot]?.waiting || 0;
  return `<section class="card">
    <button class="link" data-act="back">‹ ${t('back')}</button>
    <h3>${SLOT_ICON[S.slot]} ${t(S.slot)} · ${esc(niceDate(S.day))}</h3>
    <p class="muted">${esc(slotTime(S.info, S.slot))}</p>
    ${w ? `<p class="note">⏳ ${t('othersWaiting', w)}</p>` : ''}
    <form id="req" autocomplete="on">
      <label>${t('service')}</label>
      <div class="services">${SERVICES.map((s, i) => `<label class="svc"><input type="radio" name="service" value="${s}" ${s === S.draft.service ? 'checked' : ''}>
        <span>${SERVICE_ICON[s]}<b>${t(s)}</b></span></label>`).join('')}</div>
      <label for="details">${t('details')}</label>
      <textarea id="details" name="details" rows="2" maxlength="500">${esc(S.draft.details)}</textarea>
      <label for="name">${t('yourName')}</label>
      <input id="name" name="name" required minlength="2" maxlength="80" value="${esc(S.me.name)}" autocomplete="name">
      <label for="phone">${t('phone')}</label>
      <input id="phone" name="phone" required type="tel" inputmode="tel" placeholder="07XX XXX XXX" value="${esc(S.me.phone ? showPhone(S.me.phone) : '')}" autocomplete="tel">
      <label for="place">${t('place')}</label>
      <input id="place" name="place" maxlength="120" value="${esc(S.me.place)}">
      ${S.error ? `<p class="err">${esc(S.error)}</p>` : ''}
      <button class="big" type="submit" ${S.busy ? 'disabled' : ''}>${S.busy ? t('sending') : t('send')}</button>
    </form>
  </section>`;
}

function sentView() {
  const msg = `Hello, I have requested the tractor for ${t(S.slot)} on ${niceDate(S.day)}. Booking number ${S.lastRef}. — ${S.me.name}`;
  const ph = S.info?.owner_phone;
  return `<section class="card center">
    <div class="tick">✓</div>
    <h2>${t('sentTitle')}</h2>
    <p>${SLOT_ICON[S.slot]} <b>${t(S.slot)}</b> · ${esc(niceDate(S.day))}</p>
    <p class="muted">${t('sentBody')}</p>
    <p class="ref">${esc(S.lastRef)}</p>
    ${ph ? `<a class="big wa" href="${waLink(ph, msg)}" target="_blank" rel="noopener">💬 ${t('whatsappOwner')}</a>
            <a class="big ghost" href="${telLink(ph)}">📞 ${t('callOwner')}</a>` : ''}
    <button class="big ghost" data-tab="my">📋 ${t('my')}</button>
  </section>`;
}

function myView() {
  if (S.mine === null) return '<p class="empty">…</p>';
  if (!S.mine.length) return `<p class="empty">${t('noBookings')}</p>`;
  return `<div class="row-end"><button class="chip" data-act="refresh">↻ ${t('refresh')}</button></div>` +
    S.mine.map((b) => `<section class="card booking ${b.status}">
      <div class="b-top"><span class="pill ${b.status}">${t(b.status)}</span><span class="muted">#${esc(b.ref)}</span></div>
      <h3>${SLOT_ICON[b.slot]} ${t(b.slot)} · ${esc(niceDate(b.day))}</h3>
      <p>${SERVICE_ICON[b.service]} ${t(b.service)}${b.details ? ' — ' + esc(b.details) : ''}</p>
      ${b.place ? `<p class="muted">📍 ${esc(b.place)}</p>` : ''}
      ${b.owner_note ? `<p class="note">${t('ownerNote')}: ${esc(b.owner_note)}</p>` : ''}
      ${b.status === 'pending' ? `<button class="link danger" data-cancel="${esc(b.ref)}">${t('cancelReq')}</button>` : ''}
    </section>`).join('');
}

function render() {
  let body;
  if (S.tab === 'my') body = myView();
  else if (S.view === 'form') body = formView();
  else if (S.view === 'sent') body = sentView();
  else body = calendarView();
  root.innerHTML = header() + `<main>${body}</main>`;
}

// ---------- actions ----------
root.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-tab],[data-act],[data-day],[data-slot],[data-cancel]');
  if (!el) return;
  if (el.dataset.tab) {
    S.tab = el.dataset.tab;
    if (S.tab === 'book' && S.view === 'sent') { S.view = 'calendar'; S.day = null; }
    render();
    if (S.tab === 'my') { await loadMine(); render(); }
    else { await loadMonth(); render(); }
    return;
  }
  const act = el.dataset.act;
  if (act === 'lang') { setLang(getLang() === 'en' ? 'sw' : 'en'); render(); return; }
  if (act === 'prev' || act === 'next') {
    S.m += act === 'next' ? 1 : -1;
    if (S.m < 0) { S.m = 11; S.y--; } if (S.m > 11) { S.m = 0; S.y++; }
    S.day = null; render(); await loadMonth(); render(); return;
  }
  if (act === 'back') { S.view = 'calendar'; S.error = ''; render(); return; }
  if (act === 'refresh') { S.mine = null; render(); await loadMine(); render(); return; }
  if (el.dataset.day) {
    S.day = el.dataset.day; render();
    document.getElementById('slots')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
  if (el.dataset.slot) { S.slot = el.dataset.slot; S.view = 'form'; S.error = ''; render(); window.scrollTo(0, 0); return; }
  if (el.dataset.cancel) {
    // two taps instead of a pop-up question (pop-ups are blocked in some places)
    if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = t('cancelAsk'); return; }
    try { await api.cancelRequest(S.me.phone, el.dataset.cancel); await loadMine(); render(); }
    catch (err) { toast(errText(err), true); }
  }
});

root.addEventListener('submit', async (e) => {
  if (e.target.id !== 'req') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const b = {
    name: String(f.get('name') || '').trim(), phone: normPhone(f.get('phone')), place: String(f.get('place') || '').trim(),
    service: f.get('service'), details: String(f.get('details') || '').trim(), day: S.day, slot: S.slot,
  };
  S.me = { name: b.name, phone: b.phone, place: b.place }; save('me', S.me);
  S.draft = { service: b.service, details: b.details };
  S.busy = true; S.error = ''; render();
  try {
    S.lastRef = await api.request(b);
    S.refs = [S.lastRef, ...S.refs.filter((r) => r !== S.lastRef)].slice(0, 50); save('refs', S.refs);
    S.view = 'sent';
    S.draft = { service: 'plough', details: '' };
    loadMine().then(render);
    loadMonth().then(render);
  } catch (err) {
    S.error = errText(err);
    if (/SLOT_TAKEN|SLOT_CLOSED/.test(err.message)) await loadMonth();
  }
  S.busy = false; render(); window.scrollTo(0, 0);
});

// Keep the calendar fresh when the farmer comes back to the app.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (S.tab === 'my') await loadMine(); else if (S.view === 'calendar') await loadMonth();
  render();
});

(async () => {
  render();
  await loadInfo();
  render();
  await Promise.all([loadMonth(), loadMine()]);
  render();
  registerSW();
})();

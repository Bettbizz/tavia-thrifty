// Bizzfy POS — phone app
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { t, getLang, setLang } from './i18n.js';
import { createOwner } from './owner.js';
import { parseMessages, chooseCode } from './mpesa.js';
import { iconsFor, suggestIcon } from './icons.js';
import { printReceipt, getPrefs, setPrefs, connectPrinter, printerName, bluetoothSupported } from './printer.js';

const app = document.getElementById('app');

// ---------- small helpers ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kes = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE');
const online = () => navigator.onLine;
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-KE',
  { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });

const configured = SUPABASE_KEY && !SUPABASE_KEY.startsWith('PASTE');
const sb = configured ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ---------- app state ----------
const S = {
  session: null,
  profile: store.get('profile', null),
  catalog: store.get('catalog', { categories: [], grades: [], promotions: [] }),
  settings: store.get('settings', { business_name: '' }),
  businesses: store.get('businesses', []),
  biz: store.get('biz', null),            // business currently selected on this phone
  printerView: false,
  queue: store.get('queue', []),        // sales saved on this phone, not yet sent
  cart: [],
  tab: 'sell',
  screen: 'categories',                 // categories | grades | cart | done
  categoryId: null,
  pay: 'cash',
  mpesa: '',
  lastSale: null,
  today: null,
  toast: null,
  busy: false,
  loginEmail: '',
  loginError: '',
  notice: '',
  signup: false,
  approvals: null,                     // owner: price approvals waiting
  pendingReq: store.get('pendingReq', null), // employee: waiting for owner approval
};
if (S.pendingReq) S.screen = 'waiting';

const me = () => (S.profile && S.session && S.profile.id === S.session.user.id ? S.profile : null);
const isOwner = () => me()?.role === 'owner';
const saveQueue = () => store.set('queue', S.queue);

// ---------- prices ----------
const grade = (id) => S.catalog.grades.find((g) => g.id === id);
const category = (id) => S.catalog.categories.find((c) => c.id === id);
const gradeLabel = (g) => (g ? `${category(g.category_id)?.name ?? ''} · ${g.name}` : '?');
// ---------- businesses (e.g. Tavia Thrifty + jewellery) ----------
const curBiz = () => S.businesses.find((b) => b.id === S.biz) || null;
const bizById = (id) => S.businesses.find((b) => b.id === id) || null;
const inBiz = (c) => !S.biz || !c?.business_id || c.business_id === S.biz;
const bizOfLines = (lines) => category(grade(lines?.[0]?.grade_id)?.category_id)?.business_id || null;
const shopFor = (bizId) => {
  const b = bizById(bizId) || curBiz();
  return b ? { business_name: b.name, receipt_phone: b.receipt_phone, receipt_footer: b.receipt_footer } : S.settings;
};
const shopName = () => curBiz()?.name || S.settings.business_name || 'Bizzfy POS';

function activePromo(gradeId, at = new Date()) {
  return S.catalog.promotions
    .filter((p) => p.grade_id === gradeId && new Date(p.starts_at) <= at && at < new Date(p.ends_at))
    .sort((a, b) => a.promo_price - b.promo_price)[0];
}
// price = what to charge by default; floor = lowest allowed (same rule as the server)
function priceInfo(g) {
  const p = activePromo(g.id);
  return {
    price: p ? p.promo_price : g.normal_price,
    floor: Math.min(g.min_price, p ? p.promo_price : g.min_price),
    promo: !!p,
  };
}
const cartTotal = () => S.cart.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
const cartCount = () => S.cart.reduce((sum, l) => sum + l.quantity, 0);

// ---------- data loading ----------
async function loadProfile() {
  if (!online() || !S.session) return;
  const { data, error } = await sb.from('profiles')
    .select('id, full_name, role, active').eq('id', S.session.user.id).single();
  if (!error && data) { S.profile = data; store.set('profile', data); }
}

async function loadCatalog() {
  if (!online() || !S.session) return;
  const now = new Date().toISOString();
  const [c, g, p] = await Promise.all([
    sb.from('categories').select('*').eq('active', true).order('sort_order').order('name'),
    sb.from('grades').select('id, category_id, name, normal_price, min_price, sort_order')
      .eq('active', true).order('sort_order').order('name'),
    sb.from('promotions').select('grade_id, promo_price, starts_at, ends_at').gt('ends_at', now),
  ]);
  if (c.error || g.error || p.error) return;
  S.catalog = { categories: c.data, grades: g.data, promotions: p.data };
  store.set('catalog', S.catalog);
  const [st, bz] = await Promise.all([
    sb.from('settings').select('business_name, receipt_phone, receipt_footer').eq('id', 1).single(),
    sb.from('businesses').select('*').eq('active', true).order('sort_order'),
  ]);
  if (!st.error && st.data) { S.settings = st.data; store.set('settings', st.data); }
  if (!bz.error && bz.data) {
    S.businesses = bz.data; store.set('businesses', bz.data);
    if (!S.businesses.some((b) => b.id === S.biz)) { S.biz = S.businesses[0]?.id || null; store.set('biz', S.biz); }
  }
}

function nairobiDayStart() {
  const n = new Date(Date.now() + 3 * 3600e3); // Kenya is UTC+3 all year
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) - 3 * 3600e3);
}

async function loadToday() {
  if (!online() || !S.session) return;
  const { data, error } = await sb.from('sales')
    .select('*, ' +
            'seller:profiles!sales_sold_by_fkey(full_name), sale_lines(quantity, unit_price, grade_id)')
    .gte('sold_at', nairobiDayStart().toISOString())
    .order('sold_at', { ascending: false });
  if (!error) S.today = data;
}

// ---------- sending saved sales ----------
let syncing = false;
const isNetErr = (e) => !online() || /fetch|network|load failed|timeout/i.test(e?.message || '');

async function sync() {
  if (syncing || !online() || !S.session) return;
  const mine = S.queue.filter((s) => !s.error && s.user_id === S.session.user.id);
  if (!mine.length) return;
  syncing = true;
  let sent = 0;
  try {
    for (const s of mine) {
      const { error } = await sb.rpc('record_sale', {
        p_id: s.id, p_sold_at: s.sold_at, p_payment_method: s.payment_method,
        p_mpesa_code: s.mpesa_code, p_lines: s.lines,
      });
      if (error) {
        if (isNetErr(error)) break;      // try again later
        s.error = error.message;          // rejected: show it, don't retry automatically
      } else {
        S.queue = S.queue.filter((x) => x.id !== s.id);
        sent++;
      }
      saveQueue();
    }
  } finally { syncing = false; }
  if (sent) { owner.stockCheck(); owner.loadStock(); }   // low-stock alert for owners
  if (S.tab === 'today') await loadToday();
  render();
}

// ---------- actions ----------
function toast(msg, bad = false) {
  S.toast = msg; S.toastBad = bad;
  const id = (S.toastId = (S.toastId || 0) + 1);
  // Show the message without redrawing the screen, so typed values and ticks are kept.
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); app.appendChild(el); }
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  setTimeout(() => {
    if (S.toastId !== id) return;          // a newer message is showing
    S.toast = null; document.querySelector('.toast')?.remove();
  }, bad ? 3000 : 1600);
}

function addGrade(id) {
  const g = grade(id);
  if (!g) return;
  const line = S.cart.find((l) => l.grade_id === id);
  if (line) line.quantity++;
  else S.cart.push({ grade_id: id, quantity: 1, unit_price: priceInfo(g).price });
  S.screen = 'categories';
  render();
  toast(`${t('added')}: ${gradeLabel(g)}`);
}

function completeSale() {
  if (!S.cart.length || S.busy) return;
  let code = null;
  if (S.pay === 'mpesa') {
    code = S.mpesa.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,12}$/.test(code)) return toast(t('mpesaCodeMissing'), true);
  }
  if (!isOwner() && S.cart.some((l) => l.unit_price < priceInfo(grade(l.grade_id)).floor)) return;

  const sale = {
    id: crypto.randomUUID(),
    sold_at: new Date().toISOString(),
    payment_method: S.pay,
    mpesa_code: code,
    lines: S.cart.map((l) => ({ grade_id: l.grade_id, quantity: l.quantity, unit_price: l.unit_price })),
    total: cartTotal(),
    user_id: S.session.user.id,
  };
  S.queue.push(sale);
  saveQueue();
  S.lastSale = sale;
  S.cart = []; S.mpesa = ''; S.pay = 'cash';
  S.mpInfo = null; S.mpChoices = null; S.mpBuyer = ''; S.mpManual = false; S.mpText = '';
  S.screen = 'done';
  render();
  if (getPrefs().auto) doPrint(sale, me()?.full_name);
  sync();
}

async function askOwner() {
  if (!online()) return toast(t('needsInternetAsk'), true);
  let code = null;
  if (S.pay === 'mpesa') {
    code = S.mpesa.trim().toUpperCase();
    if (!/^[A-Z0-9]{8,12}$/.test(code)) return toast(t('mpesaCodeMissing'), true);
  }
  const req = {
    id: crypto.randomUUID(), payment_method: S.pay, mpesa_code: code,
    lines: S.cart.map((l) => ({ grade_id: l.grade_id, quantity: l.quantity, unit_price: l.unit_price })),
    total: cartTotal(), user_id: S.session.user.id, sold_at: new Date().toISOString(),
  };
  S.busy = true; render();
  const { error } = await sb.rpc('request_approval', {
    p_id: req.id, p_payment_method: req.payment_method, p_mpesa_code: req.mpesa_code, p_lines: req.lines });
  S.busy = false;
  if (error) { toast(isNetErr(error) ? t('needsInternetAsk') : error.message, true); return render(); }
  S.pendingReq = req; store.set('pendingReq', req);
  sb.functions.invoke('notify-owners', { body: { request_id: req.id } }).catch(() => {});  // phone notification
  S.screen = 'waiting'; render();
}

async function checkRequest() {
  const req = S.pendingReq;
  if (!req || !online() || !S.session) return;
  const { data, error } = await sb.from('price_requests').select('status').eq('id', req.id).single();
  if (error || !data || data.status === 'pending') return;
  S.pendingReq = null; store.set('pendingReq', null);
  if (data.status === 'approved') {
    S.lastSale = req; S.cart = []; S.mpesa = ''; S.pay = 'cash'; S.screen = 'done';
    if (getPrefs().auto) doPrint(req, me()?.full_name);
    if (S.tab === 'today') await loadToday();
  } else {
    S.cart = req.lines.map((l) => ({ ...l })); S.screen = 'cart';
    if (data.status === 'rejected') toast(t('ownerRejected'), true);
  }
  render();
}

async function cancelRequest() {
  const req = S.pendingReq;
  if (!req) return;
  if (online()) await sb.rpc('cancel_request', { p_id: req.id });
  await checkRequest();
  if (S.pendingReq) {          // offline or not yet cancelled: go back to the cart anyway
    S.cart = req.lines.map((l) => ({ ...l })); S.pendingReq = null; store.set('pendingReq', null);
    S.screen = 'cart'; render();
  }
}

async function doPrint(sale, seller) {
  try {
    await printReceipt({
      ...sale, seller,
      lines: (sale.lines || sale.sale_lines).map((l) => ({ ...l, label: gradeLabel(grade(l.grade_id)) })),
    }, shopFor(sale.business_id || bizOfLines(sale.lines || sale.sale_lines)));
  } catch (e) {
    if (e?.name !== 'NotFoundError') toast(`${t('printFailed')}: ${e?.message || ''}`, true);  // NotFoundError = picker closed
  }
}

async function voidSale(id) {
  const reason = prompt(t('voidReason'));
  if (!reason) return;
  const { error } = await sb.rpc('void_sale', { p_id: id, p_reason: reason });
  if (error) toast(error.message, true);
  await loadToday();
  render();
}

async function logout() {
  const pending = S.queue.some((s) => s.user_id === S.session?.user.id);
  if (!confirm(pending ? t('logoutPending') : t('logoutConfirm'))) return;
  await sb.auth.signOut();
  S.cart = []; S.today = null; S.tab = 'sell'; S.screen = 'categories';
  render();
}

// ---------- screens ----------
function render() {
  if (!configured) { app.innerHTML = `<p class="center">${t('setupNeeded')}</p>`; return; }
  if (!S.session) return renderLogin();
  const p = me();
  if (!p) { app.innerHTML = shell(`<p class="center">${online() ? t('loading') : t('offline')}</p>`); return; }
  if (!p.active) {
    app.innerHTML = shell(`<p class="center">${t('accountInactive')}</p>
      <button class="primary" data-a="recheck">${t('checkAgain')}</button>
      <button class="link logout" data-a="logout">${t('logout')}</button>`);
    return;
  }
  if (S.tab === 'owner' && p.role !== 'owner') S.tab = 'sell';
  app.innerHTML = shell(S.tab === 'sell' ? renderSell() : S.tab === 'owner' ? owner.view() : renderToday());
  armForms();
}

// ---------- save buttons: grey until something changes ----------
const formKey = (f) => (f.dataset.form || f.id) + ':' + (f.dataset.cat || f.dataset.id || '');
const formState = (f) => new URLSearchParams(new FormData(f)).toString();
function updateSaveButton(f) {
  const btn = f.querySelector('button:not([type=button])');
  if (!btn || f.dataset.initial == null) return;
  const dirty = formState(f) !== f.dataset.initial || f.id === 'newgroup' && !!S.ng?.name;
  btn.disabled = !dirty;
  btn.innerHTML = !dirty && S.justSaved === formKey(f) ? `✓ ${t('saved')}` : btn.dataset.label;
}
function armForms() {
  app.querySelectorAll('form[data-form]:not([data-noarm]), form[data-save]').forEach((f) => {
    const btn = f.querySelector('button:not([type=button])');
    if (!btn) return;
    btn.dataset.label = btn.innerHTML;
    f.dataset.initial = formState(f);
    updateSaveButton(f);
  });
}
app.addEventListener('input', (e) => { const f = e.target.closest('form[data-initial]'); if (f) updateSaveButton(f); }, true);
app.addEventListener('change', (e) => { const f = e.target.closest('form[data-initial]'); if (f) updateSaveButton(f); }, true);

// ---------- every press shows a ripple (and a tiny vibration on Android) ----------
document.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('button, .tile, .grade, .chip, summary, [data-a]');
  if (!el || el.disabled || el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  const r = el.getBoundingClientRect();
  const size = Math.max(r.width, r.height) * 1.6;
  const dot = document.createElement('span');
  dot.className = 'ripple';
  Object.assign(dot.style, { width: size + 'px', height: size + 'px',
    left: e.clientX - size / 2 + 'px', top: e.clientY - size / 2 + 'px' });
  const clip = document.createElement('span');
  clip.className = 'rippleclip';
  Object.assign(clip.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px',
    borderRadius: getComputedStyle(el).borderRadius });
  dot.style.left = e.clientX - r.left - size / 2 + 'px'; dot.style.top = e.clientY - r.top - size / 2 + 'px';
  clip.appendChild(dot); document.body.appendChild(clip);
  setTimeout(() => clip.remove(), 500);
  try { navigator.vibrate?.(8); } catch { /* not supported */ }
}, { passive: true });

function shell(body) {
  const waiting = S.queue.filter((s) => !s.error).length;
  const banner = !online()
    ? `<div class="banner off">${t('offline')}</div>`
    : waiting ? `<div class="banner wait">${waiting} · ${t('pending')}</div>` : '';
  const asks = isOwner() ? (S.approvals || []).length : 0;
  const lows = isOwner() ? owner.lowGroups() : [];
  const lowBanner = lows.length && !(S.tab === 'owner' && ['bales', 'menu'].includes(S.o.section))
    ? `<button class="banner lowb" data-a="o-gobales">⚠ ${t('lowBannerGroups').replace('{list}',
        lows.map((g) => `${esc(g.icon || g.name)} ${g.remaining}`).join(' · '))}</button>` : '';
  const askBanner = asks && !(S.tab === 'owner' && S.o.section === 'approvals')
    ? `<button class="banner ask" data-a="o-approvals">🔔 ${asks} ${t('approvalsWaiting')}</button>` : '';
  return `
    <header class="top">
      ${S.businesses.length > 1
        ? `<button class="brand bizswitch" data-a="biz">${esc(shopName())} <span>⇄</span></button>`
        : `<div class="brand">${esc(shopName())}</div>`}
      <div class="who">${esc(me()?.full_name)}${isOwner() ? ` <span class="badge">${t('owner')}</span>` : ''}</div>
      <button class="lang" data-a="lang">${getLang() === 'en' ? 'Kiswahili' : 'English'}</button>
    </header>
    ${askBanner}${lowBanner}${banner}
    <main>${body}</main>
    <nav class="tabs ${isOwner() ? 'three' : ''}">
      <button data-a="tab" data-v="sell" class="${S.tab === 'sell' ? 'on' : ''}"><span class="ic">🛍️</span>${t('sell')}</button>
      <button data-a="tab" data-v="today" class="${S.tab === 'today' ? 'on' : ''}"><span class="ic">📋</span>${t('today')}</button>
      ${isOwner() ? `<button data-a="tab" data-v="owner" class="${S.tab === 'owner' ? 'on' : ''}"><span class="ic">⭐</span>${t('owner')}${asks ? ` <span class="count">${asks}</span>` : ''}</button>` : ''}
    </nav>
    ${S.toast ? `<div class="toast${S.toastBad ? ' bad' : ''}">${esc(S.toast)}</div>` : ''}`;
}

function renderLogin() {
  app.innerHTML = `
    <div class="login">
      <button class="lang" data-a="lang">${getLang() === 'en' ? 'Kiswahili' : 'English'}</button>
      <div class="brand big">${esc(S.businesses.length > 1 ? 'Bizzfy POS' : shopName())}</div>
      ${S.businesses.length > 1 ? `<p class="product">${S.businesses.map((b) => esc(b.name)).join(' · ')}</p>`
        : S.settings.business_name ? '<p class="product">Bizzfy POS</p>' : ''}
      ${S.notice ? `<p class="note">${esc(S.notice)}</p>` : ''}
      ${S.signup ? `<form id="signup">
        <label>${t('yourName')}<input name="name" autocomplete="name" required></label>
        <label>${t('email')}<input name="email" type="email" autocomplete="username" required value="${esc(S.loginEmail)}"></label>
        <label>${t('password')} <small>(${t('passwordHint')})</small><input name="password" type="password" minlength="6" autocomplete="new-password" required></label>
        ${S.loginError ? `<p class="err">${esc(S.loginError)}</p>` : ''}
        <button class="primary" ${S.busy ? 'disabled' : ''}>${S.busy ? t('loading') : t('createAccount')}</button>
        <button type="button" class="link" data-a="signup" data-v="0">${t('haveAccount')}</button>
      </form>` : `<form id="login">
        <label>${t('email')}<input name="email" type="email" autocomplete="username" required value="${esc(S.loginEmail)}"></label>
        <label>${t('password')}<input name="password" type="password" autocomplete="current-password" required></label>
        ${S.loginError ? `<p class="err">${esc(S.loginError)}</p>` : ''}
        <button class="primary" ${S.busy ? 'disabled' : ''}>${S.busy ? t('loading') : t('login')}</button>
        <button type="button" class="link" data-a="signup" data-v="1">${t('newStaff')}</button>
      </form>`}
    </div>`;
}

function cartBar() {
  if (!S.cart.length) return '';
  return `<button class="cartbar" data-a="screen" data-v="cart">
    <span>${cartCount()} ${t('items')}</span><b>${kes(cartTotal())}</b><span>${t('pay')} →</span></button>`;
}

function renderSell() {
  if (S.screen === 'waiting' && S.pendingReq) return renderWaiting();
  if (S.screen === 'done') return renderDone();
  if (S.screen === 'cart') return renderCart();
  if (S.screen === 'grades') return renderGrades();
  if (S.screen === 'newgroup' && isOwner()) return renderNewGroup();
  const cats = S.catalog.categories.filter(inBiz);
  const edit = S.editSell && isOwner() && online();
  const head = `<div class="sellhead"><h1>${edit ? t('editItems') : t('chooseCategory')}</h1>
    ${isOwner() ? `<button class="editbtn ${edit ? 'on' : ''}" data-a="sell-edit">${edit ? '✓ ' + t('done') : '✏️'}</button>` : ''}</div>
    ${edit ? `<p class="small muted">${t('editItemsHelp')}</p>` : ''}`;
  if (!cats.length && !edit) return head + `<p class="center">${t('noCatalog')}</p>`;
  return head + `<div class="grid">${cats.map((c, i) =>
      `<div class="tilewrap"><button class="tile c${i % 6}" data-a="cat" data-v="${c.id}">${c.icon ? `<span class="ticon">${esc(c.icon)}</span>` : ''}<span>${esc(c.name)}</span></button>
      ${edit ? `<div class="mover">
        <button data-a="move-cat" data-v="${c.id}:-1" ${i === 0 ? 'disabled' : ''} aria-label="${t('moveEarlier')}">◀</button>
        <button data-a="move-cat" data-v="${c.id}:1" ${i === cats.length - 1 ? 'disabled' : ''} aria-label="${t('moveLater')}">▶</button></div>` : ''}</div>`).join('')}
      ${edit ? `<button class="tile addtile" data-a="new-group"><span class="ticon">＋</span><span>${t('addItem')}</span></button>` : ''}</div>
    ${cartBar()}`;
}

// ---------- owner: add a new item group straight from the Sell screen ----------
function newGroupDraft() {
  const pieces = curBiz()?.kind === 'pieces';
  const names = pieces ? [''] : ['1st Cam', '2nd Cam', '3rd Cam'];
  return { name: '', icon: '', picked: false, level: pieces ? 10 : 50,
    grades: names.map((n) => ({ name: n, normal: '', lowest: '' })) };
}
function iconPicker(selected, action) {
  return `<div class="iconpick">${iconsFor(curBiz()?.kind).map((ic) =>
    `<button type="button" class="${ic === selected ? 'on' : ''}" data-a="${action}" data-v="${ic}">${ic}</button>`).join('')}</div>`;
}
function renderNewGroup() {
  const d = S.ng || (S.ng = newGroupDraft());
  const icon = d.picked ? d.icon : suggestIcon(d.name, curBiz()?.kind);
  return `<button class="link" data-a="ng-cancel">← ${t('back')}</button>
    <h1>${t('addItem')}</h1>
    <form class="form" id="newgroup" data-save="1">
      <div class="nghead"><span class="ngicon">${esc(icon)}</span>
        <label>${t('name')}<input name="name" data-ng="name" required value="${esc(d.name)}" placeholder="${curBiz()?.kind === 'pieces' ? 'Earrings' : 'Dresses'}"></label></div>
      <p class="small muted">${t('iconAuto')}</p>
      ${iconPicker(icon, 'ng-icon')}
      <h2>${t('grades')}</h2>
      <div class="prow phead"><span>${t('name')}</span><span>${t('normal')}</span><span>${t('lowest')}</span><span></span></div>
      ${d.grades.map((g, i) => `<div class="prow">
        <input data-ng="g${i}.name" value="${esc(g.name)}" placeholder="${t('gradeName')}">
        <input type="number" inputmode="numeric" min="1" data-ng="g${i}.normal" value="${esc(g.normal)}">
        <input type="number" inputmode="numeric" min="1" data-ng="g${i}.lowest" value="${esc(g.lowest)}">
        <button type="button" class="link small" data-a="ng-rmgrade" data-v="${i}" ${d.grades.length < 2 ? 'disabled' : ''}>✕</button></div>`).join('')}
      <button type="button" class="link" data-a="ng-addgrade">+ ${t('anotherGrade')}</button>
      <label>${t('alertBelow')}<input type="number" inputmode="numeric" min="0" data-ng="level" value="${esc(d.level)}"></label>
      <button class="primary">${t('save')}</button>
    </form>`;
}
async function saveNewGroup() {
  const d = S.ng;
  const name = d.name.trim();
  const grades = d.grades.map((g) => ({ name: g.name.trim(), normal: Math.round(+g.normal), lowest: Math.round(+g.lowest || +g.normal) }))
    .filter((g) => g.name && g.normal > 0);
  if (!name || !grades.length) return toast(t('needNameGrade'), true);
  if (grades.some((g) => g.lowest > g.normal)) return toast(t('lowestTooHigh'), true);
  const cats = S.catalog.categories.filter(inBiz);
  const { data: cat, error } = await sb.from('categories').insert({
    name, business_id: S.biz, icon: d.picked ? d.icon : suggestIcon(name, curBiz()?.kind),
    low_stock_threshold: Math.max(0, Math.round(+d.level || 0)),
    sort_order: Math.max(0, ...cats.map((c) => c.sort_order || 0)) + 1,
  }).select('id').single();
  if (error) return toast(error.message, true);
  const { error: e2 } = await sb.from('grades').insert(grades.map((g, i) => ({
    category_id: cat.id, name: g.name, normal_price: g.normal, min_price: g.lowest, sort_order: i + 1 })));
  if (e2) return toast(e2.message, true);
  S.ng = null; S.screen = 'categories';
  await loadCatalog(); owner.loadStock();
  toast(`${t('saved')}: ${name}`);
  render();
}
async function addGradeHere(form) {
  const f = new FormData(form);
  const normal = Math.round(+f.get('normal')), lowest = Math.round(+f.get('lowest') || normal);
  if (!(normal > 0) || lowest > normal) return toast(t('lowestTooHigh'), true);
  const gs = S.catalog.grades.filter((g) => g.category_id === S.categoryId);
  const { error } = await sb.from('grades').insert({ category_id: S.categoryId, name: String(f.get('name')).trim(),
    normal_price: normal, min_price: lowest, sort_order: Math.max(0, ...gs.map((g) => g.sort_order || 0)) + 1 });
  if (error) return toast(error.message, true);
  await loadCatalog(); toast(t('saved')); render();
}
// Move a tile/grade one place earlier (-1) or later (+1) and save the new order.
async function moveItem(table, list, id, dir) {
  const i = list.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const changed = [];
  list.forEach((x, k) => { if (x.sort_order !== k + 1) { x.sort_order = k + 1; changed.push(x); } });
  const all = table === 'categories' ? S.catalog.categories : S.catalog.grades;
  all.sort((p, q) => (p.sort_order || 0) - (q.sort_order || 0) || String(p.name).localeCompare(q.name));
  store.set('catalog', S.catalog);
  render();
  const res = await Promise.all(changed.map((x) => sb.from(table).update({ sort_order: x.sort_order }).eq('id', x.id)));
  if (res.some((r) => r.error)) { toast(res.find((r) => r.error).error.message, true); await loadCatalog(); render(); }
}

function renderGrades() {
  const cat = category(S.categoryId);
  const gs = S.catalog.grades.filter((g) => g.category_id === S.categoryId);
  const edit = S.editSell && isOwner() && online();
  return `<button class="link" data-a="screen" data-v="categories">← ${t('back')}</button>
    <h1>${cat?.icon ? esc(cat.icon) + ' ' : ''}${esc(cat?.name)}</h1><p class="sub">${edit ? t('editGradesHelp') : t('chooseGrade')}</p>
    <div class="list">${gs.map((g, i) => {
      const pi = priceInfo(g);
      return `<div class="graderow"><button class="grade" data-a="add" data-v="${g.id}">
        <span>${esc(g.name)}</span>
        <b>${pi.promo ? `<s>${kes(g.normal_price)}</s> <em>${t('promo')}</em> ` : ''}${kes(pi.price)}</b></button>
        ${edit ? `<div class="mover vert">
          <button data-a="move-grade" data-v="${g.id}:-1" ${i === 0 ? 'disabled' : ''} aria-label="${t('moveEarlier')}">▲</button>
          <button data-a="move-grade" data-v="${g.id}:1" ${i === gs.length - 1 ? 'disabled' : ''} aria-label="${t('moveLater')}">▼</button></div>` : ''}</div>`;
    }).join('')}</div>
    ${edit ? `<form class="form card" id="newgrade" data-save="1">
      <h2>${t('addGrade')}</h2>
      <label>${t('name')}<input name="name" required placeholder="${curBiz()?.kind === 'pieces' ? 'Silver' : '4th Cam'}"></label>
      <div class="two"><label>${t('normal')}<input type="number" inputmode="numeric" min="1" name="normal" required></label>
      <label>${t('lowest')}<input type="number" inputmode="numeric" min="1" name="lowest"></label></div>
      <button class="primary small">${t('addGrade')}</button></form>` : ''}
    ${cartBar()}`;
}

function renderCart() {
  if (!S.cart.length) {
    return `<button class="link" data-a="screen" data-v="categories">← ${t('back')}</button>
      <p class="center">${t('emptyCart')}</p>`;
  }
  const owner = isOwner();
  let blocked = false;
  const lines = S.cart.map((l, i) => {
    const g = grade(l.grade_id);
    const pi = priceInfo(g);
    const low = l.unit_price < pi.floor;
    if (low && !owner) blocked = true;
    return `<div class="line ${low ? 'low' : ''}">
      <div class="lname">${esc(gradeLabel(g))}</div>
      <div class="lrow">
        <div class="qty">
          <button data-a="dec" data-v="${i}" aria-label="-">−</button>
          <span>${l.quantity}</span>
          <button data-a="inc" data-v="${i}" aria-label="+">+</button>
        </div>
        <label class="price">${t('price')}
          <input type="number" inputmode="numeric" min="1" step="10" data-a="price" data-v="${i}" value="${l.unit_price}">
        </label>
        <button class="rm" data-a="rm" data-v="${i}" aria-label="${t('remove')}">✕</button>
      </div>
      <div class="hint">${t('lowest')}: ${kes(pi.floor)}
        ${low ? `<b>${owner ? t('ownerBelow') : `${t('belowLowest')} ${t('askOwner')}`}</b>` : ''}</div>
    </div>`;
  }).join('');

  return `<button class="link" data-a="screen" data-v="categories">← ${t('addMore')}</button>
    ${lines}
    <div class="paytoggle">
      <button data-a="pay" data-v="cash" class="${S.pay === 'cash' ? 'on' : ''}">💵 ${t('cash')}</button>
      <button data-a="pay" data-v="mpesa" class="${S.pay === 'mpesa' ? 'on' : ''}">📱 ${t('mpesa')}</button>
    </div>
    ${S.pay === 'mpesa' ? renderMpesa() : ''}
    <div class="total"><span>${t('total')}</span><b>${kes(cartTotal())}</b></div>
    ${blocked
      ? `<button class="primary askbtn" data-a="ask" ${S.busy ? 'disabled' : ''}>🔔 ${t('askOwnerBtn')}</button>`
      : `<button class="primary" data-a="complete">${t('complete')}</button>`}`;
}

// ---------- M-Pesa: paste the confirmation message to fill the code ----------
function usedCodes() {
  return [...S.queue, ...(S.today || []), S.lastSale || {}].map((s) => s.mpesa_code).filter(Boolean);
}
async function applyMpesaText(text) {
  if (online()) await loadToday();   // fresh list of codes already used today
  const msgs = parseMessages(text);
  S.mpChoices = null; S.mpInfo = null;
  if (!msgs.length) { toast(t('mpNoMessage'), true); return render(); }
  const r = chooseCode(msgs, { total: cartTotal(), buyer: S.mpBuyer, usedCodes: usedCodes() });
  if (r.pick) { S.mpesa = r.pick.code; S.mpInfo = r.pick; S.mpManual = false; S.mpText = ''; }
  else if (r.choices.length) { S.mpChoices = r.choices; S.mpReason = r.reason; }
  else toast(t('mpNoneReceived'), true);
  render();
}
async function pasteMpesa() {
  try {
    const text = await navigator.clipboard.readText();
    if (text && text.trim()) return await applyMpesaText(text);
  } catch { /* clipboard not allowed: fall back to a box the seller pastes into */ }
  S.mpManual = true; render();
  setTimeout(() => document.querySelector('[data-a="mp-text"]')?.focus(), 50);
}
function renderMpesa() {
  const info = S.mpInfo;
  const wrongAmount = info && info.amount != null && info.amount !== cartTotal();
  return `<div class="mpbox">
    <button class="primary small mppaste" data-a="mp-paste">📋 ${t('mpPaste')}</button>
    <label class="mpesa">${t('mpBuyer')}
      <input data-a="mp-buyer" autocomplete="off" value="${esc(S.mpBuyer || '')}" placeholder="${t('mpBuyerHint')}"></label>
    ${S.mpManual ? `<label class="mpesa">${t('mpPasteHere')}
      <textarea data-a="mp-text" rows="3">${esc(S.mpText || '')}</textarea></label>
      <button class="link" data-a="mp-read">${t('mpRead')}</button>` : ''}
    ${S.mpChoices ? `<p class="warn">${t(S.mpReason === 'similar' ? 'mpSimilar' : S.mpReason === 'name' ? 'mpNoName' : 'mpNoAmount')}</p>
      ${S.mpChoices.map((m) => `<button class="mpchoice" data-a="mp-pick" data-v="${m.code}">
        <b>${esc(m.code)}</b><span>${esc(m.name || '?')}</span><span>${m.amount != null ? kes(m.amount) : ''}</span></button>`).join('')}` : ''}
    <label class="mpesa">${t('mpesaCode')}
      <input data-a="mpesa" autocapitalize="characters" autocomplete="off" spellcheck="false"
        placeholder="${t('mpesaCodeHint')}" value="${esc(S.mpesa)}"></label>
    ${info ? `<p class="${wrongAmount ? 'warn' : 'note'}">${wrongAmount ? '⚠ ' : '✓ '}${esc(info.name || '')}${info.amount != null ? ' · ' + kes(info.amount) : ''}
      ${wrongAmount ? `<br>${t('mpWrongAmount').replace('{amount}', kes(info.amount)).replace('{total}', kes(cartTotal()))}` : ''}</p>` : ''}
  </div>`;
}

function renderWaiting() {
  const r = S.pendingReq;
  return `<div class="done">
    <div class="tick waitt">⏳</div>
    <h1>${t('waitingOwner')}</h1>
    <div class="receipt">
      ${r.lines.map((l) => `<div><span>${l.quantity} × ${esc(gradeLabel(grade(l.grade_id)))}</span>
        <span>${kes(l.quantity * l.unit_price)}</span></div>`).join('')}
      <div class="rtotal"><span>${t('total')}</span><b>${kes(r.total)}</b></div>
    </div>
    <button class="link danger" data-a="cancelreq">${t('cancel')}</button>
  </div>`;
}

function renderDone() {
  const s = S.lastSale;
  if (!s) { S.screen = 'categories'; return renderSell(); }
  const unsent = S.queue.some((x) => x.id === s.id);
  return `<div class="done">
    <div class="tick">✓</div>
    <h1>${t('saleDone')}</h1>
    ${unsent && !online() ? `<p class="sub">${t('savedOffline')}</p>` : ''}
    <div class="receipt">
      ${s.lines.map((l) => `<div><span>${l.quantity} × ${esc(gradeLabel(grade(l.grade_id)))}</span>
        <span>${kes(l.quantity * l.unit_price)}</span></div>`).join('')}
      <div class="rtotal"><span>${t('total')} (${s.payment_method === 'mpesa' ? `M-Pesa ${esc(s.mpesa_code)}` : t('cash')})</span>
        <b>${kes(s.total)}</b></div>
    </div>
    <button class="primary" data-a="new">${t('newSale')}</button>
    <button class="link printbtn" data-a="print" data-v="last">🖨 ${t('printReceipt')}</button>
  </div>`;
}

function renderPrinter() {
  const p = getPrefs();
  const bt = bluetoothSupported();
  return `<button class="link" data-a="printer-close">← ${t('back')}</button>
    <h1>${t('printerSettings')}</h1>
    <form class="form card" id="printerform" data-save="1">
      <label>${t('printerMode')}<select name="mode">
        <option value="system" ${p.mode === 'system' ? 'selected' : ''}>${t('modeSystem')}</option>
        <option value="bluetooth" ${p.mode === 'bluetooth' ? 'selected' : ''} ${bt ? '' : 'disabled'}>${t('modeBluetooth')}</option>
      </select></label>
      ${bt ? '' : `<p class="small muted">${t('btUnsupported')}</p>`}
      <label>${t('paper')}<select name="paper">
        <option value="58" ${p.paper == 58 ? 'selected' : ''}>58 mm</option>
        <option value="80" ${p.paper == 80 ? 'selected' : ''}>80 mm</option></select></label>
      <label class="check"><input type="checkbox" name="auto" ${p.auto ? 'checked' : ''}> ${t('autoPrint')}</label>
      <button class="primary small">${t('save')}</button>
    </form>
    ${bt && p.mode === 'bluetooth' ? `<div class="card"><div class="srow"><span>${printerName() ? `${t('connectedTo')}: <b>${esc(printerName())}</b>` : t('notConnected')}</span></div>
      <button class="primary small" data-a="printer-connect">${t('connectPrinter')}</button></div>` : ''}
    <button class="primary small" data-a="printer-test">🖨 ${t('testPrint')}</button>`;
}

function renderToday() {
  if (S.printerView) return renderPrinter();
  const uid = S.session.user.id;
  // Today shows the business selected at the top (cash counts cover both).
  const mineBiz = (s) => !S.biz || (s.business_id || bizOfLines(s.lines || s.sale_lines)) === S.biz;
  const local = S.queue.filter((s) => (s.user_id === uid || isOwner()) && mineBiz(s));
  const server = (S.today || []).filter(mineBiz);
  const done = server.filter((s) => s.status === 'completed');
  const pendingOk = local.filter((s) => !s.error);
  const sum = (arr, m) => arr.filter((s) => !m || s.payment_method === m).reduce((a, s) => a + s.total, 0);
  const all = [...done, ...pendingOk];

  const items = (lines) => lines.map((l) =>
    `${l.quantity} × ${esc(gradeLabel(grade(l.grade_id)))} @ ${l.unit_price}`).join('<br>');

  const localRows = local.map((s) => `<div class="sale ${s.error ? 'bad' : 'wait'}">
    <div class="srow"><span>${timeOf(s.sold_at)}</span><b>${kes(s.total)}</b></div>
    <div class="sitems">${items(s.lines)}</div>
    <div class="srow small"><span>${s.error ? `${t('failed')}: ${esc(s.error)}` : t('pending')}</span>
      ${s.error ? `<button class="link" data-a="retry" data-v="${s.id}">${t('retry')}</button>` : ''}</div>
  </div>`).join('');

  const serverRows = server.map((s) => `<div class="sale ${s.status === 'voided' ? 'voided' : ''}">
    <div class="srow"><span>${timeOf(s.sold_at)}${isOwner() ? ` · ${esc(s.seller?.full_name)}` : ''}</span>
      <b>${kes(s.total)}</b></div>
    <div class="sitems">${items(s.sale_lines)}</div>
    <div class="srow small">
      <span>${s.payment_method === 'mpesa' ? `M-Pesa ${esc(s.mpesa_code)}` : t('cash')}
        ${s.status === 'voided' ? ` · <b>${t('voided')}</b>` : ''}
        ${s.approved_by ? ` · ✓ ${t('approvedPrice')}` : ''}</span>
      <span>${s.status === 'completed' ? `<button class="link" data-a="print" data-v="${s.id}">🖨</button>` : ''}
      ${isOwner() && s.status === 'completed' ? `<button class="link danger" data-a="void" data-v="${s.id}">${t('void')}</button>` : ''}</span>
    </div>
  </div>`).join('');

  return `<div class="todayhead"><h1>${t('salesToday')}</h1>
      <button class="link" data-a="refresh">↻ ${t('refresh')}</button></div>
    <div class="stats">
      <div><small>${t('count')}</small><b>${all.length}</b></div>
      <div><small>${t('cash')}</small><b>${kes(sum(all, 'cash'))}</b></div>
      <div><small>M-Pesa</small><b>${kes(sum(all, 'mpesa'))}</b></div>
      <div class="big"><small>${t('total')}</small><b>${kes(sum(all))}</b></div>
    </div>
    ${S.today === null && online() ? `<p class="center">${t('loading')}</p>` : ''}
    ${!localRows && !serverRows && S.today !== null ? `<p class="center">${t('noSales')}</p>` : ''}
    ${localRows}${serverRows}
    <button class="link logout" data-a="printer">🖨 ${t('printerSettings')}</button>
    <button class="link logout" data-a="logout">${t('logout')}</button>`;
}

// ---------- events ----------
app.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-a]');
  if (!b || b.tagName === 'INPUT') return;
  const a = b.dataset.a, v = b.dataset.v;
  switch (a) {
    case 'lang': setLang(getLang() === 'en' ? 'sw' : 'en'); render(); break;
    case 'tab':  // a bottom tab always opens the start of its section
      S.tab = v; S.printerView = false;
      if (v === 'sell' && S.screen !== 'waiting') { S.screen = 'categories'; S.ng = null; }
      if (v === 'owner') S.o.section = 'menu';
      render();
      if (v === 'today') { await loadToday(); render(); }
      if (v === 'owner') owner.go('menu');
      break;
    case 'cat': S.categoryId = v; S.screen = 'grades'; render(); break;
    case 'screen': S.screen = v; render(); break;
    case 'add': addGrade(v); break;
    case 'inc': S.cart[+v].quantity++; render(); break;
    case 'dec': if (S.cart[+v].quantity > 1) S.cart[+v].quantity--; else S.cart.splice(+v, 1); render(); break;
    case 'rm': S.cart.splice(+v, 1); render(); break;
    case 'pay': S.pay = v; render(); break;
    case 'mp-paste': await pasteMpesa(); break;
    case 'mp-read': await applyMpesaText(S.mpText); break;
    case 'mp-pick': {
      const m = (S.mpChoices || []).find((x) => x.code === v);
      if (m) { S.mpesa = m.code; S.mpInfo = m; S.mpChoices = null; S.mpManual = false; S.mpText = ''; }
      render(); break;
    }
    case 'complete': completeSale(); break;
    case 'new': S.screen = 'categories'; S.lastSale = null; render(); break;
    case 'refresh': await Promise.all([loadToday(), loadCatalog()]); render(); break;
    case 'retry': { const s = S.queue.find((x) => x.id === v); if (s) { delete s.error; saveQueue(); sync(); } break; }
    case 'void': await voidSale(v); break;
    case 'logout': await logout(); break;
    case 'ask': await askOwner(); break;
    case 'sell-edit':
      if (!online()) { toast(t('needsInternet'), true); break; }
      S.editSell = !S.editSell; S.screen = 'categories'; render(); break;
    case 'new-group': S.ng = newGroupDraft(); S.screen = 'newgroup'; render(); break;
    case 'ng-cancel': S.ng = null; S.screen = 'categories'; render(); break;
    case 'ng-icon': S.ng.icon = v; S.ng.picked = true; render(); break;
    case 'ng-addgrade': S.ng.grades.push({ name: '', normal: '', lowest: '' }); render(); break;
    case 'ng-rmgrade': S.ng.grades.splice(+v, 1); render(); break;
    case 'move-cat': {
      const [id, dir] = v.split(':');
      await moveItem('categories', S.catalog.categories.filter(inBiz), id, +dir); break;
    }
    case 'move-grade': {
      const [id, dir] = v.split(':');
      await moveItem('grades', S.catalog.grades.filter((g) => g.category_id === S.categoryId), id, +dir); break;
    }
    case 'biz': {
      if (S.cart.length || S.screen === 'waiting') { toast(t('finishSaleFirst'), true); break; }
      const i = S.businesses.findIndex((b) => b.id === S.biz);
      S.biz = S.businesses[(i + 1) % S.businesses.length]?.id || null; store.set('biz', S.biz);
      S.screen = 'categories'; S.categoryId = null;
      toast(shopName());
      if (S.tab === 'today') await loadToday();
      if (S.tab === 'owner') owner.go(S.o.section);
      owner.loadStock();
      render(); break;
    }
    case 'o-gobales': S.tab = 'owner'; owner.go('bales'); break;
    case 'print': {
      if (v === 'last') { await doPrint(S.lastSale, me()?.full_name); break; }
      const s = (S.today || []).find((x) => x.id === v) || S.queue.find((x) => x.id === v);
      if (s) await doPrint(s, s.seller?.full_name || me()?.full_name);
      break;
    }
    case 'printer': S.tab = 'today'; S.printerView = true; render(); break;
    case 'printer-close': S.printerView = false; render(); break;
    case 'printer-connect':
      try { await connectPrinter(); toast(`${t('connectedTo')}: ${printerName()}`); }
      catch (e) { if (e?.name !== 'NotFoundError') toast(e.message, true); }
      render(); break;
    case 'printer-test':
      await doPrint({ id: 'TEST0000', sold_at: new Date().toISOString(), payment_method: 'cash', total: 0,
        lines: S.catalog.grades.slice(0, 1).map((g) => ({ grade_id: g.id, quantity: 1, unit_price: 0 })) }, me()?.full_name);
      break;
    case 'cancelreq': await cancelRequest(); break;
    case 'recheck': await loadProfile(); render(); break;
    case 'signup': S.signup = v === '1'; S.loginError = ''; S.notice = ''; render(); break;
    default: await owner.onClick(a, v);
  }
});

app.addEventListener('change', (e) => {
  if (owner.onChange(e.target)) return;
  if (e.target.dataset.a !== 'price') return;
  const line = S.cart[+e.target.dataset.v];
  const n = Math.round(Number(e.target.value));
  if (line && n > 0) line.unit_price = n;
  render();
});

app.addEventListener('input', (e) => {
  if (e.target.dataset.a === 'mpesa') { S.mpesa = e.target.value; if (S.mpInfo && S.mpInfo.code !== S.mpesa.trim().toUpperCase()) S.mpInfo = null; }
  if (e.target.dataset.a === 'mp-buyer') S.mpBuyer = e.target.value;
  const ng = e.target.dataset.ng;
  if (ng && S.ng) {
    const m = ng.match(/^g(\d+)\.(\w+)$/);
    if (m) S.ng.grades[+m[1]][m[2]] = e.target.value; else S.ng[ng] = e.target.value;
    if (ng === 'name' && !S.ng.picked) {     // live icon suggestion while typing the name
      const ic = suggestIcon(e.target.value, curBiz()?.kind);
      const el = document.querySelector('.ngicon'); if (el) el.textContent = ic;
      document.querySelectorAll('.iconpick button').forEach((b) => b.classList.toggle('on', b.dataset.v === ic));
    }
  }
  if (e.target.dataset.a === 'mp-text') S.mpText = e.target.value;
});

app.addEventListener('submit', async (e) => {
  if (e.target.dataset.form) { e.preventDefault(); return owner.onSubmit(e.target); }
  if (e.target.id === 'signup') { e.preventDefault(); return signup(e.target); }
  if (e.target.id === 'newgroup') { e.preventDefault(); return saveNewGroup(); }
  if (e.target.id === 'newgrade') { e.preventDefault(); return addGradeHere(e.target); }
  if (e.target.id === 'printerform') {
    e.preventDefault();
    const f = new FormData(e.target);
    setPrefs({ mode: f.get('mode'), paper: Number(f.get('paper')), auto: f.get('auto') === 'on' });
    S.justSaved = formKey(e.target); toast(t('saved')); return;
  }
  if (e.target.id !== 'login') return;
  e.preventDefault();
  const f = new FormData(e.target);
  S.loginEmail = String(f.get('email') || '').trim();
  if (!online()) { S.loginError = t('needInternetLogin'); return render(); }
  S.busy = true; S.loginError = ''; render();
  const { error } = await sb.auth.signInWithPassword({ email: S.loginEmail, password: String(f.get('password') || '') });
  S.busy = false;
  if (error) { S.loginError = t('loginFailed'); render(); }
});

async function signup(form) {
  const f = new FormData(form);
  S.loginEmail = String(f.get('email') || '').trim();
  if (!online()) { S.loginError = t('needInternetLogin'); return render(); }
  S.busy = true; S.loginError = ''; render();
  const { data, error } = await sb.auth.signUp({
    email: S.loginEmail, password: String(f.get('password') || ''),
    options: { data: { full_name: String(f.get('name') || '').trim() } },
  });
  S.busy = false;
  if (error) S.loginError = `${t('signupFailed')}: ${error.message}`;
  else if (!data.session) { S.signup = false; S.notice = t('accountCreated'); }
  render();
}

window.addEventListener('online', () => { render(); loadCatalog(); sync(); });
window.addEventListener('offline', render);
setInterval(sync, 30000);
setInterval(() => { owner.pollApprovals(); checkRequest(); }, 6000);
setInterval(() => owner.loadStock(), 120000);

const owner = createOwner({ S, sb, t, esc, kes, render, toast, loadCatalog, loadProfile, priceInfo });

// ---------- start ----------
function start() {
  if (!configured) return render();
  app.innerHTML = `<p class="center">${t('loading')}</p>`;
  // INITIAL_SESSION fires on start with the login stored on the phone (works offline).
  // Work is deferred with setTimeout because supabase-js must not be awaited inside this callback.
  sb.auth.onAuthStateChange((event, session) => {
    S.session = session;
    setTimeout(async () => {
      render();
      if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
        await Promise.all([loadProfile(), loadCatalog()]);
        render();
        sync(); owner.pollApprovals(); checkRequest(); owner.loadStock();
        const go = new URLSearchParams(location.search).get('go');
        if ((go === 'approvals' || go === 'bales') && isOwner()) {
          history.replaceState(null, '', location.pathname);
          S.tab = 'owner'; owner.go(go);
        }
      }
    }, 0);
  });
}

start();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => {   // notification tapped while app open
    if ((e.data?.go === 'approvals' || e.data?.go === 'bales') && isOwner()) { S.tab = 'owner'; owner.go(e.data.go); }
  });
}

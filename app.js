// Bizzfy POS — phone app
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { t, getLang, setLang } from './i18n.js';
import { createOwner } from './owner.js';
import { parseMessages, chooseCode } from './mpesa.js';
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
  render();
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
}

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
  const cats = S.catalog.categories.filter(inBiz);
  if (!cats.length) return `<p class="center">${t('noCatalog')}</p>`;
  return `<h1>${t('chooseCategory')}</h1>
    <div class="grid">${cats.map((c, i) =>
      `<button class="tile c${i % 6}" data-a="cat" data-v="${c.id}">${c.icon ? `<span class="ticon">${esc(c.icon)}</span>` : ''}<span>${esc(c.name)}</span></button>`).join('')}</div>
    ${cartBar()}`;
}

function renderGrades() {
  const cat = category(S.categoryId);
  const gs = S.catalog.grades.filter((g) => g.category_id === S.categoryId);
  return `<button class="link" data-a="screen" data-v="categories">← ${t('back')}</button>
    <h1>${cat?.icon ? esc(cat.icon) + ' ' : ''}${esc(cat?.name)}</h1><p class="sub">${t('chooseGrade')}</p>
    <div class="list">${gs.map((g) => {
      const pi = priceInfo(g);
      return `<button class="grade" data-a="add" data-v="${g.id}">
        <span>${esc(g.name)}</span>
        <b>${pi.promo ? `<s>${kes(g.normal_price)}</s> <em>${t('promo')}</em> ` : ''}${kes(pi.price)}</b></button>`;
    }).join('')}</div>
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
    <form class="form card" id="printerform">
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
      if (v === 'sell' && S.screen !== 'waiting') S.screen = 'categories';
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
  if (e.target.dataset.a !== 'price') return;
  const line = S.cart[+e.target.dataset.v];
  const n = Math.round(Number(e.target.value));
  if (line && n > 0) line.unit_price = n;
  render();
});

app.addEventListener('input', (e) => {
  if (e.target.dataset.a === 'mpesa') { S.mpesa = e.target.value; if (S.mpInfo && S.mpInfo.code !== S.mpesa.trim().toUpperCase()) S.mpInfo = null; }
  if (e.target.dataset.a === 'mp-buyer') S.mpBuyer = e.target.value;
  if (e.target.dataset.a === 'mp-text') S.mpText = e.target.value;
});

app.addEventListener('submit', async (e) => {
  if (e.target.dataset.form) { e.preventDefault(); return owner.onSubmit(e.target); }
  if (e.target.id === 'signup') { e.preventDefault(); return signup(e.target); }
  if (e.target.id === 'printerform') {
    e.preventDefault();
    const f = new FormData(e.target);
    setPrefs({ mode: f.get('mode'), paper: Number(f.get('paper')), auto: f.get('auto') === 'on' });
    toast(t('saved')); return;
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

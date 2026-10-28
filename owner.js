// Owner tab: approvals, reports, bales, prices, promotions, cash count, staff, settings.
import { VAPID_PUBLIC_KEY } from './config.js';
import { iconsFor, suggestIcon } from './icons.js';
// Everything here also needs owner rights in the database; hiding it in the
// app is only for convenience.

export const nbDate = (d = new Date()) => new Date(d.getTime() + 3 * 3600e3).toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nbStart = (day) => `${day}T00:00:00+03:00`;
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', timeZone: 'Africa/Nairobi' });

const SECTIONS = [
  ['approvals', '🔔', 'approvals'], ['reports', '📊', 'reports'], ['bales', '📦', 'bales'],
  ['prices', '🏷️', 'prices'], ['promos', '🎉', 'promotions'], ['cash', '💰', 'cashCount'], ['summary', '🏪', 'allBusinesses'], ['staff', '👥', 'staff'],
  ['settings', '⚙️', 'settings'],
];
const b64ToBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const csvCell = (v) => { const x = String(v ?? ''); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };

export function createOwner(ctx) {
  const { S, sb, t, esc, kes, render, toast, loadCatalog, loadProfile, priceInfo } = ctx;
  const O = (S.o = {
    section: 'menu', period: 'today', report: null, bales: null, stock: null,
    cats: null, grades: null, promos: null, counts: null, cashToday: null, staff: null, adding: false,
  });

  // active catalogue, grouped by category in display order
  const grouped = (cats, grades) => cats.map((c) => ({ c, gs: grades.filter((g) => g.category_id === c.id) }));
  // Only the business selected at the top of the app.
  const inBiz = (c) => !S.biz || !c?.business_id || c.business_id === S.biz;
  const curBiz = () => (S.businesses || []).find((b) => b.id === S.biz) || null;
  const pieces = () => curBiz()?.kind === 'pieces';           // jewellery: stock comes per piece, not bales
  const activeGroups = () => grouped(S.catalog.categories.filter(inBiz), S.catalog.grades);
  const gLabel = (id) => {
    const g = (O.grades || S.catalog.grades).find((x) => x.id === id);
    const c = (O.cats || S.catalog.categories).find((x) => x.id === g?.category_id);
    return g ? `${c?.name ?? ''} · ${g.name}` : '?';
  };
  const fail = (e) => { toast(e?.message || t('error'), true); };

  // ---------------- approvals (polled for every owner) ----------------
  async function pollApprovals() {
    if (!navigator.onLine || !S.session || S.profile?.role !== 'owner') return;
    const { data, error } = await sb.from('price_requests')
      .select('id, requested_at, payment_method, mpesa_code, lines, total, requester:profiles!price_requests_requested_by_fkey(full_name)')
      .eq('status', 'pending').order('requested_at');
    if (error) return;
    const before = (S.approvals || []).map((r) => r.id).join();
    S.approvals = data;
    if (before !== data.map((r) => r.id).join()) render();
  }

  async function decide(id, approve) {
    const { data, error } = await sb.rpc('decide_request', { p_id: id, p_approve: approve });
    if (error) return fail(error);
    S.approvals = (S.approvals || []).filter((r) => r.id !== id);
    if (data === 'approved') { stockCheck(); loadStock(); }
    toast(data === 'approved' ? t('approve') + ' ✓' : t('reject'), data !== 'approved');
  }

  // ---------------- stock monitors (one bar per item group) ----------------
  async function loadStock() {
    if (!navigator.onLine || S.profile?.role !== 'owner' || !S.biz) return;
    const { data, error } = await sb.rpc('stock_status', { p_business: S.biz });
    if (!error && data && JSON.stringify(data) !== JSON.stringify(S.stock)) { S.stock = data; render(); }
  }
  // Ask the server to alert owners if a group just dropped below its level (once per drop).
  const stockCheck = () => sb.functions.invoke('notify-owners', { body: { stock_check: true } }).catch(() => {});
  const isLowG = (g) => g.has_stock && g.threshold > 0 && g.remaining < g.threshold;
  const lowGroups = (st) => (st?.groups || []).filter(isLowG);
  const fill = (key, v) => t(key).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');
  const gName = (g) => `${g.icon ? g.icon + ' ' : ''}${g.name}`;

  // green → orange → red: red below the alert level, orange in the lower half above it.
  function barColour(g) {
    const full = Math.max(g.full || 0, g.remaining);
    if (g.remaining < g.threshold) return 'red';
    return g.remaining < g.threshold + (full - g.threshold) / 2 ? 'orange' : 'green';
  }

  function monitors(st) {
    const groups = st?.groups || [];
    if (!groups.length) return '';
    return `<div class="card mon"><h2>${t('stockMonitors')}</h2>${groups.map((g) => {
      const full = Math.max(g.full || 0, g.remaining);
      const pct = full ? Math.max(0, Math.min(100, (g.remaining / full) * 100)) : 0;
      return `<div class="mrow" title="${esc(g.name)}">
        <span class="micon">${esc(g.icon || '•')}</span>
        ${g.has_stock
          ? `<div class="mbar ${barColour(g)}"><i style="width:${pct.toFixed(1)}%"></i><b>${g.remaining}</b><em>${full}</em></div>`
          : `<div class="mbar none"><b>—</b><em>${t('noStockYet')}</em></div>`}
      </div>`;
    }).join('')}</div>`;
  }

  function suggestions(st) {
    const out = [];
    for (const g of lowGroups(st)) {
      const rate = g.sold14 / 14;
      const buy = Math.max(g.threshold - g.remaining, Math.ceil(rate * 14) - g.remaining, 0);
      const n = Math.ceil(buy / 5) * 5;
      const start = st.items.filter((i) => i.category_id === g.id && i.sold14 > 0).slice(0, 2)
        .map((i) => fill('sugFastItem', { item: i.item.split(' · ').pop(), sold: i.sold14, left: i.remaining }));
      out.push(fill('sugGroup', { name: gName(g), n, level: g.threshold })
        + (rate > 0 ? ' ' + t('sugGroupPace') : '')
        + (start.length ? ' ' + t('sugStart') + ' ' + start.join('; ') + '.' : ''));
    }
    const slow = st.items.filter((i) => i.remaining >= 5 && i.sold30 === 0).slice(0, 3);
    if (slow.length) out.push(t('sugSlow') + ' ' + slow.map((i) =>
      fill('sugSlowItem', { item: i.item, left: i.remaining })).join('; ') + '. ' + t('sugSlowAction'));
    out.push(t('sugFirm'));
    out.push(t('sugLevelGroups'));
    return out;
  }

  function stockAdvice(st, afterRestock) {
    const low = lowGroups(st);
    if (!st?.groups?.length) return '';
    if (!st.groups.some((g) => g.has_stock)) return `<p class="small muted">${pieces() ? t('stockNoPieces') : t('stockNoBales')}</p>`;
    if (!low.length) return '';
    const list = low.map((g) => `${gName(g)} ${g.remaining}`).join(', ');
    return `<div class="card lowcard"><div class="warn">⚠ ${fill(afterRestock ? 'stillLowGroups' : 'lowNowGroups', { list })}</div>
      <h2>${t('whatToDo')}</h2><ol class="sug">${suggestions(st).map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`;
  }

  // ---------------- loading per section ----------------
  function periodRange(p) {
    const today = nbDate();
    if (p === '7') return [addDays(today, -6), today];
    if (p === '30') return [addDays(today, -29), today];
    if (p === 'month') return [today.slice(0, 8) + '01', today];
    return [today, today];
  }

  async function load() {
    try {
      switch (O.section) {
        case 'approvals': await pollApprovals(); break;
        case 'reports': {
          const [f, to] = periodRange(O.period);
          const { data, error } = await sb.rpc('sales_report', { p_from: f, p_to: to, p_business: S.biz });
          if (error) throw error;
          O.report = data; break;
        }
        case 'bales': {
          const [b, s] = await Promise.all([
            sb.rpc('bale_report', { p_business: S.biz }),
            sb.from('bale_stock').select('grade_id, remaining').gt('remaining', 0),
          ]);
          if (b.error) throw b.error;
          O.bales = b.data; O.stock = s.data || [];
          await loadStock(); break;
        }
        case 'prices': {
          const [c, g] = await Promise.all([
            S.biz ? sb.from('categories').select('*').eq('business_id', S.biz).order('sort_order').order('name')
                  : sb.from('categories').select('*').order('sort_order').order('name'),
            sb.from('grades').select('*').order('sort_order').order('name'),
          ]);
          if (c.error || g.error) throw c.error || g.error;
          O.cats = c.data; O.grades = g.data; break;
        }
        case 'promos': {
          const { data, error } = await sb.from('promotions').select('id, grade_id, promo_price, starts_at, ends_at')
            .gt('ends_at', new Date().toISOString()).order('starts_at');
          if (error) throw error;
          O.promos = data; break;
        }
        case 'cash': {
          let q = sb.from('cash_counts').select('*').order('count_date', { ascending: false }).limit(14);
          q = S.biz ? q.eq('business_id', S.biz) : q;
          const [c, r] = await Promise.all([q,
            sb.rpc('sales_report', { p_from: nbDate(), p_to: nbDate(), p_business: S.biz })]);
          if (c.error) throw c.error;
          O.counts = c.data; O.cashToday = r.data?.cash ?? 0; break;
        }
        case 'reset': {
          const { data, error } = await sb.rpc('reset_preview', { p_business: O.resetAll ? null : S.biz });
          if (error) throw error;
          O.resetInfo = data; break;
        }
        case 'summary': {
          const { data, error } = await sb.rpc('day_summary', { p_date: O.sumDate || nbDate() });
          if (error) throw error;
          O.summary = data; break;
        }
        case 'settings': await Promise.all([pushStatus(), loadStock()]); break;
        case 'staff': {
          const { data, error } = await sb.from('profiles').select('id, full_name, email, role, active')
            .order('active').order('full_name');
          if (error) throw error;
          O.staff = data; break;
        }
      }
    } catch (e) { fail(e); }
    render();
  }

  function go(section) { S.justSaved = null; O.section = section; O.adding = false; O.justRestocked = false; render(); if (section !== 'menu') load(); }

  // ---------------- views ----------------
  const head = (key) => `<button class="link" data-a="o-go" data-v="menu">← ${t('back')}</button><h1>${t(key)}</h1>`;
  const loading = `<p class="center">${t('loading')}</p>`;
  const table = (cols, rows) => rows.length
    ? `<table class="tbl"><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${rows.map((r) =>
        `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</table>` : '';
  const money = (n, colour) => `<span class="${colour ? (n < 0 ? 'neg' : 'pos') : ''}">${kes(n)}</span>`;

  function view() {
    if (!navigator.onLine) return `<p class="center">${t('needsInternet')}</p>`;
    switch (O.section) {
      case 'approvals': return viewApprovals();
      case 'reports': return viewReports();
      case 'bales': return viewBales();
      case 'prices': return viewPrices();
      case 'promos': return viewPromos();
      case 'cash': return viewCash();
      case 'staff': return viewStaff();
      case 'settings': return viewSettings();
      case 'summary': return viewSummary();
      case 'reset': return viewReset();
    }
    const n = (S.approvals || []).length;
    const nLow = lowGroups(S.stock).length;
    const sections = SECTIONS.filter(([k]) => k !== 'summary' || (S.businesses || []).length > 1);
    return monitors(S.stock) + `<div class="grid">${sections.map(([k, ic, key], i) =>
      `<button class="tile c${i % 6} otile" data-a="o-go" data-v="${k}">
        <span class="oic">${ic}</span>${k === 'bales' && pieces() ? t('stockTile') : t(key)}${k === 'approvals' && n ? ` <span class="count">${n}</span>` : ''}${k === 'bales' && nLow ? ` <span class="count">${nLow} ${t('low')}</span>` : ''}</button>`).join('')}</div>`;
  }

  function viewApprovals() {
    const list = S.approvals;
    if (!list) return head('approvals') + loading;
    if (!list.length) return head('approvals') + `<p class="center">${t('noApprovals')}</p>`;
    return head('approvals') + list.map((r) => `<div class="card">
      <div class="srow"><b>${esc(r.requester?.full_name)}</b><span class="small">${fmtDay(r.requested_at)}
        ${new Date(r.requested_at).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })}</span></div>
      ${r.lines.map((l) => {
        const g = S.catalog.grades.find((x) => x.id === l.grade_id);
        const floor = g ? priceInfo(g).floor : null;
        return `<div class="srow"><span>${l.quantity} × ${esc(gLabel(l.grade_id))}</span>
          <span><b class="${floor && l.unit_price < floor ? 'neg' : ''}">${kes(l.unit_price)}</b>
          ${floor ? `<small class="muted"> (${t('lowest')} ${kes(floor)})</small>` : ''}</span></div>`;
      }).join('')}
      <div class="srow total1"><span>${t('total')} · ${r.payment_method === 'mpesa' ? `M-Pesa ${esc(r.mpesa_code)}` : t('cash')}</span>
        <b>${kes(r.total)}</b></div>
      <div class="two">
        <button class="btn bad" data-a="o-reject" data-v="${r.id}">${t('reject')}</button>
        <button class="btn ok" data-a="o-approve" data-v="${r.id}">${t('approve')}</button>
      </div></div>`).join('');
  }

  function viewReports() {
    const chips = [['today', t('today')], ['7', t('period7')], ['30', t('period30')], ['month', t('periodMonth')]];
    let out = head('reports') + `<div class="chips">${chips.map(([k, l]) =>
      `<button class="chip ${O.period === k ? 'on' : ''}" data-a="o-period" data-v="${k}">${l}</button>`).join('')}</div>`;
    const r = O.report;
    if (!r) return out + loading;
    const profit = r.revenue - r.cost;
    out += `<div class="stats">
      <div><small>${t('count')}</small><b>${r.count}</b></div>
      <div><small>${t('cash')}</small><b>${kes(r.cash)}</b></div>
      <div><small>M-Pesa</small><b>${kes(r.mpesa)}</b></div>
      <div><small>${t('revenue')}</small><b>${kes(r.revenue)}</b></div>
      <div><small>${t('cost')}</small><b>${kes(r.cost)}</b></div>
      <div><small>${t('pieces')}</small><b>${r.pieces}</b></div>
      <div class="big"><small>${t('profit')}</small><b>${kes(profit)}</b></div>
    </div>`;
    out += `<button class="link" data-a="o-csv">⬇ ${t('downloadCsv')}</button>`;
    if (r.unstocked) out += `<p class="warn">⚠ ${r.unstocked} ${t('unstocked')}</p>`;
    if (r.below_min) out += `<p class="small">${t('belowMinCount')}: ${r.below_min}</p>`;
    if (r.voided) out += `<p class="small">${t('voidedCount')}: ${r.voided}</p>`;
    out += `<h2>${t('byItem')}</h2>` + (table([t('items'), t('pieces'), t('revenue'), t('profit')],
      r.by_item.map((x) => [esc(x.item), x.pieces, kes(x.revenue), money(x.profit, true)])) || `<p class="small">${t('noSales')}</p>`);
    if (r.by_staff.length) out += `<h2>${t('byStaff')}</h2>` + table([t('name'), t('count'), t('revenue')],
      r.by_staff.map((x) => [esc(x.name), x.count, kes(x.revenue)]));
    if (O.period !== 'today' && r.by_day.length) out += `<h2>${t('byDay')}</h2>` + table([t('date'), t('count'), t('revenue'), t('profit')],
      r.by_day.map((x) => [fmtDay(x.day), x.count, kes(x.revenue), money(x.profit, true)]));
    return out;
  }

  function viewBales() {
    if (O.adding) {
      return head(pieces() ? 'addStock' : 'addBale') + `<form class="form" data-form="bale">
        <label>${t('date')}<input type="date" name="date" value="${nbDate()}" required></label>
        <label>${t('supplier')}<input name="supplier" autocomplete="off"></label>
        <label>${pieces() ? t('stockCost') : t('baleCost')}<input name="cost" type="number" inputmode="numeric" min="0" required></label>
        <p class="sub">${t('piecesPerGrade')}</p>
        ${activeGroups().map(({ c, gs }) => `<fieldset><legend>${c.icon ? esc(c.icon) + ' ' : ''}${esc(c.name)}</legend>${gs.map((g) =>
          `<label class="qrow"><span>${esc(g.name)}</span><input type="number" inputmode="numeric" min="0" name="q_${g.id}"></label>`).join('')}</fieldset>`).join('')}
        <label>${t('notes')}<input name="notes" autocomplete="off"></label>
        <button class="primary">${t('save')}</button>
        <button type="button" class="link" data-a="o-cancel">${t('cancel')}</button>
      </form>`;
    }
    const title = pieces() ? 'stockTile' : 'bales';
    if (!O.bales) return head(title) + loading;
    const stockBy = {};
    (O.stock || []).forEach((s) => { stockBy[s.grade_id] = (stockBy[s.grade_id] || 0) + s.remaining; });
    const stockRows = S.catalog.grades.filter((g) => stockBy[g.id] && inBiz(S.catalog.categories.find((c) => c.id === g.category_id)))
      .map((g) => [esc(gLabel(g.id)), stockBy[g.id]]);
    return head(title) + monitors(S.stock) + stockAdvice(S.stock, O.justRestocked)
      + `<button class="primary" data-a="o-add">+ ${pieces() ? t('addStock') : t('addBale')}</button>
      ${stockRows.length ? `<h2>${t('inStock')}</h2>${table([t('items'), t('pieces')], stockRows)}` : ''}
      <h2>${pieces() ? t('deliveries') : t('bales')}</h2>
      ${O.bales.length ? O.bales.map((b) => {
        const bal = b.sold_value - b.cost;
        return `<div class="card">
          <div class="srow"><b>${fmtDay(b.received_on)}${b.supplier ? ` · ${esc(b.supplier)}` : ''}</b><b>${kes(b.cost)}</b></div>
          <div class="small">${b.left} / ${b.pieces} ${t('left')} · ${t('soldSoFar')}: ${kes(b.sold_value)}</div>
          <div class="small">${t('balance')}: ${money(bal, true)}${bal >= 0 ? ` ✓ ${t('paidOff')}` : ''}</div>
          <div class="small muted">${(b.lines || []).map((l) => `${esc(l.item)}: ${l.left}/${l.quantity}`).join(' · ')}</div>
        </div>`;
      }).join('') : `<p class="center">${pieces() ? t('noDeliveries') : t('noBales')}</p>`}`;
  }

  function viewPrices() {
    if (!O.cats) return head('prices') + loading;
    return head('prices') + grouped(O.cats, O.grades).map(({ c, gs }) => `<div class="card">
      <h2>${c.icon ? esc(c.icon) + ' ' : ''}${esc(c.name)}</h2>
      <form class="form grouprow" data-form="group" data-cat="${c.id}">
        <label>${t('icon')}<input type="hidden" name="icon" value="${esc(c.icon || '')}">
          <button type="button" class="iconbtn" data-a="o-togglepick" data-v="${c.id}">${esc(c.icon || '＋')}</button></label>
        <label>${t('alertBelow')}<input name="threshold" type="number" inputmode="numeric" min="0" value="${c.low_stock_threshold ?? 50}"></label>
        <button class="primary small">${t('save')}</button>
        <div class="iconpick small hide" id="pick-${c.id}">${iconsFor(curBiz()?.kind).map((ic) =>
          `<button type="button" class="${ic === c.icon ? 'on' : ''}" data-a="o-picon" data-v="${c.id}|${ic}">${ic}</button>`).join('')}</div>
      </form>
      <form class="form" data-form="grades" data-cat="${c.id}">
        <div class="prow phead"><span></span><span>${t('normal')}</span><span>${t('lowest')}</span><span></span></div>
        ${gs.map((g) => `<div class="prow ${g.active ? '' : 'hidden'}">
          <span>${esc(g.name)}${g.active ? '' : ` <small>(${t('hidden')})</small>`}</span>
          <input type="number" inputmode="numeric" min="1" name="n_${g.id}" value="${g.normal_price}">
          <input type="number" inputmode="numeric" min="1" name="l_${g.id}" value="${g.min_price}">
          <button type="button" class="link small" data-a="${g.active ? 'o-hide' : 'o-show'}" data-v="${g.id}">${g.active ? t('hide') : t('show')}</button>
        </div>`).join('')}
        <button class="primary small">${t('save')}</button>
      </form>
      <details><summary>${t('addGrade')}</summary>
        <form class="form" data-form="addgrade" data-cat="${c.id}">
          <label>${t('name')}<input name="name" required placeholder="4th Cam"></label>
          <div class="two"><label>${t('normal')}<input type="number" inputmode="numeric" min="1" name="normal" required></label>
          <label>${t('lowest')}<input type="number" inputmode="numeric" min="1" name="lowest" required></label></div>
          <button class="primary small">${t('addGrade')}</button>
        </form></details>
    </div>`).join('') + `<div class="card"><h2>${t('addCategory')}</h2>
      <form class="form" data-form="addcat"><label>${t('name')}<input name="name" required></label>
      <div class="two"><label>${t('icon')}<input name="icon" maxlength="8" class="iconin" placeholder="${t('auto')}"></label>
      <label>${t('alertBelow')}<input name="threshold" type="number" inputmode="numeric" min="0" value="${pieces() ? 10 : 50}"></label></div>
      <p class="small muted">${t('iconHelp')}</p>
      <button class="primary small">${t('addCategory')}</button></form></div>`;
  }

  function viewPromos() {
    if (!O.promos) return head('promotions') + loading;
    const now = new Date();
    const mine = O.promos.filter((p) => { const g = S.catalog.grades.find((x) => x.id === p.grade_id);
      return !g || inBiz(S.catalog.categories.find((c) => c.id === g.category_id)); });
    const list = mine.length ? mine.map((p) => {
      const g = S.catalog.grades.find((x) => x.id === p.grade_id);
      const running = new Date(p.starts_at) <= now;
      return `<div class="card"><div class="srow"><b>${esc(gLabel(p.grade_id))}</b>
          <b>${g ? `<s class="muted">${kes(g.normal_price)}</s> ` : ''}${kes(p.promo_price)}</b></div>
        <div class="srow small"><span>${running ? '🟢 ' : ''}${fmtDay(p.starts_at)} → ${fmtDay(new Date(new Date(p.ends_at) - 1))}</span>
        <button class="link danger" data-a="o-endpromo" data-v="${p.id}">${t('endNow')}</button></div></div>`;
    }).join('') : `<p class="small">${t('noPromos')}</p>`;
    return head('promotions') + list + `<div class="card"><h2>${t('newPromo')}</h2>
      <form class="form" data-form="promo">
        <p class="sub">${t('chooseItems')}</p>
        ${activeGroups().map(({ c, gs }) => `<fieldset><legend>${esc(c.name)}</legend>${gs.map((g) =>
          `<label class="check"><input type="checkbox" name="g" value="${g.id}"> ${esc(g.name)} <small class="muted">${kes(g.normal_price)}</small></label>`).join('')}</fieldset>`).join('')}
        <label>${t('promoPrice')}<input type="number" inputmode="numeric" min="1" name="price" required></label>
        <div class="two"><label>${t('from')}<input type="date" name="from" value="${nbDate()}" required></label>
        <label>${t('to')}<input type="date" name="to" value="${addDays(nbDate(), 2)}" required></label></div>
        <button class="primary">${t('save')}</button>
      </form></div>`;
  }

  function viewCash() {
    if (!O.counts) return head('cashCount') + loading;
    const many = (S.businesses || []).length > 1;
    return head('cashCount') + `<div class="card">
      ${many ? `<p class="small muted">${t('cashOneBiz').replace('{name}', esc(curBiz()?.name || ''))}</p>` : ''}
      <div class="srow"><span>${t('cashSalesToday')}</span><b>${kes(O.cashToday)}</b></div>
      <form class="form" data-form="cash">
        <label>${t('openingFloat')}<input type="number" inputmode="numeric" min="0" name="float" value="0"></label>
        <label>${t('counted')}<input type="number" inputmode="numeric" min="0" name="counted" required></label>
        <label>${t('notes')}<input name="notes" autocomplete="off"></label>
        <button class="primary">${t('closeDay')}</button>
      </form></div>
      ${table([t('date'), t('expected'), t('counted'), t('difference')], O.counts.map((c) => {
        const d = c.counted_cash - c.expected_cash;
        return [fmtDay(c.count_date), kes(c.expected_cash), kes(c.counted_cash),
          d === 0 ? '✓' : `${money(d, true)} ${d < 0 ? t('short') : t('over')}`];
      }))}
      ${many ? `<button class="link" data-a="o-go" data-v="summary">🏪 ${t('allBusinesses')} →</button>` : ''}`;
  }

  // Reset sales (hidden under Settings → Advanced). Undo possible for 7 days.
  function viewReset() {
    const d = O.resetInfo;
    const many = (S.businesses || []).length > 1;
    const scopeName = O.resetAll ? t('allBusinesses') : (curBiz()?.name || '');
    const when = (iso) => new Date(iso).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
    let out = `<button class="link" data-a="o-go" data-v="settings">← ${t('back')}</button><h1 class="dangerh">⚠ ${t('resetTitle')}</h1>`;
    if (!d) return out + loading;
    if (d.undoable.length) out += `<div class="card"><h2>↩ ${t('undoTitle')}</h2>${d.undoable.map((r) => `<div class="srow">
        <span class="small">${when(r.created_at)} · ${esc(r.business === 'ALL' ? t('allBusinesses') : r.business)} · ${r.counts.sales} ${t('salesWord')}<br>
          <span class="muted">${t('undoUntil')} ${when(r.expires_at)}</span></span>
        <button class="btn ok small" data-a="o-undo" data-v="${r.id}">${t('undo')}</button></div>`).join('')}</div>`;
    out += `<div class="card dangercard">
      ${many ? `<div class="chips"><button class="chip ${O.resetAll ? '' : 'on'}" data-a="o-rscope" data-v="one">${esc(curBiz()?.name || '')}</button>
        <button class="chip ${O.resetAll ? 'on' : ''}" data-a="o-rscope" data-v="all">${t('allBusinesses')}</button></div>` : ''}
      <p><b>${t('resetWillDelete').replace('{name}', esc(scopeName))}</b></p>
      <ul class="small">
        <li>${d.sales} ${t('salesWord')} (${kes(d.money)})</li>
        <li>${d.bales} ${t('stockDeliveries')}</li>
        <li>${d.cash_counts} ${t('cashCountsWord')}</li>
        <li>${d.requests} ${t('approvalsWord')}</li>
      </ul>
      <p class="small">${t('resetKeeps')}</p>
      <p class="warn">${t('resetWarn1')}</p>
      <p class="warn">${t('resetWarn2')}</p>
      <button class="link" data-a="o-csvall">⬇ ${t('resetBackupFirst')}</button>
      <form class="form" data-form="reset" data-noarm="1">
        <label class="check"><input type="checkbox" name="understand"> ${t('resetUnderstand')}</label>
        <label>${t('resetType')}<input name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="RESET"></label>
        <button class="btn bad wide">${t('resetButton').replace('{name}', esc(scopeName))}</button>
      </form></div>`;
    return out;
  }

  // Shared page: money made by each business on a day, and the total.
  function viewSummary() {
    const d = O.summary;
    const top = head('allBusinesses') + `<div class="chips">
      <input type="date" class="chipdate" data-a="o-sumdate" value="${O.sumDate || nbDate()}" max="${nbDate()}"></div>`;
    if (!d) return top + loading;
    const diff = (b) => (b.counted == null ? `<span class="muted">${t('notCounted')}</span>`
      : b.counted - b.expected === 0 ? '✓' : `${money(b.counted - b.expected, true)} ${b.counted < b.expected ? t('short') : t('over')}`);
    return top + d.businesses.map((b) => `<div class="card">
        <div class="srow"><b>${esc(b.name)}</b><b>${kes(b.total)}</b></div>
        <div class="srow small"><span>${t('cash')}</span><span>${kes(b.cash)}</span></div>
        <div class="srow small"><span>M-Pesa</span><span>${kes(b.mpesa)}</span></div>
        <div class="srow small"><span>${t('count')}</span><span>${b.sales}</span></div>
        <div class="srow small"><span>${t('cashCount')}</span><span>${diff(b)}</span></div>
      </div>`).join('') + `<div class="card totalcard">
        <div class="srow"><b>${t('bothTotal')}</b><b>${kes(d.total)}</b></div>
        <div class="srow small"><span>${t('cash')}</span><span>${kes(d.cash)}</span></div>
        <div class="srow small"><span>M-Pesa</span><span>${kes(d.mpesa)}</span></div>
        <div class="srow small"><span>${t('count')}</span><span>${d.sales}</span></div>
      </div>
      ${d.all_counted ? '' : `<p class="small muted">${t('countEach')}</p>`}`;
  }

  function viewStaff() {
    if (!O.staff) return head('staff') + loading;
    return head('staff') + `<p class="sub">${t('addStaffHelp')}</p>` + O.staff.map((p) => `<div class="card ${p.active ? '' : 'pendingcard'}">
      ${p.active ? '' : `<div class="warn">${t('waitingApproval')}</div>`}
      <form class="form" data-form="staff" data-id="${p.id}">
        <label>${t('name')}${p.id === S.session.user.id ? ` <small>(${t('you')})</small>` : ''}
          <input name="name" value="${esc(p.full_name)}" required></label>
        <div class="small muted">${esc(p.email || '')}</div>
        <div class="two">
          <label>${t('role')}<select name="role">
            <option value="employee" ${p.role === 'employee' ? 'selected' : ''}>${t('employee')}</option>
            <option value="owner" ${p.role === 'owner' ? 'selected' : ''}>${t('owner')}</option></select></label>
          <label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> ${t('active')}</label>
        </div>
        <button class="primary small">${t('save')}</button>
      </form></div>`).join('');
  }

  // ---------------- backup (CSV) ----------------
  async function exportCsv(from, to) {
    toast(t('loading'));
    const rows = [['business', 'date', 'time', 'receipt', 'seller', 'payment', 'mpesa_code', 'status', 'price_approved',
      'item', 'quantity', 'unit_price', 'line_total', 'below_lowest']];
    for (let i = 0; ; i += 1000) {
      const { data, error } = await sb.from('sales')
        .select('id, sold_at, payment_method, mpesa_code, status, approved_by, business_id, seller:profiles!sales_sold_by_fkey(full_name), sale_lines(quantity, unit_price, grade_id, below_min)')
        .gte('sold_at', nbStart(from)).lt('sold_at', nbStart(addDays(to, 1)))
        .order('sold_at').range(i, i + 999);
      if (error) return fail(error);
      for (const sale of data) {
        const d = new Date(sale.sold_at);
        const day = nbDate(d);
        const time = d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
        for (const l of sale.sale_lines) {
          rows.push([(S.businesses || []).find((b) => b.id === sale.business_id)?.name || '', day, time, sale.id.slice(0, 8).toUpperCase(), sale.seller?.full_name, sale.payment_method,
            sale.mpesa_code, sale.status, sale.approved_by ? 'yes' : '', gLabel(l.grade_id), l.quantity,
            l.unit_price, l.quantity * l.unit_price, l.below_min ? 'yes' : '']);
        }
      }
      if (data.length < 1000) break;
    }
    const blob = new Blob(['﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `sales_${from}_to_${to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------------- phone notifications ----------------
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // O.push: 'unsupported' | 'blocked' | 'off' | 'on'
  async function saveSub(sub) {
    const j = sub.toJSON();
    const { error } = await sb.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    return error;
  }
  async function pushStatus() {
    try {
      const r = await (await caches.open('bizzfy-pushlog')).match('./__pushlog');
      O.lastPush = r ? await r.json() : null;
    } catch { O.lastPush = null; }
    if (!pushSupported()) { O.push = 'unsupported'; return; }
    if (Notification.permission === 'denied') { O.push = 'blocked'; return; }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub || Notification.permission !== 'granted') { O.push = 'off'; return; }
    // Make sure the server still knows this phone; re-register quietly if not.
    const { data } = await sb.from('push_subscriptions').select('endpoint').eq('endpoint', sub.endpoint);
    O.push = (data && data.length) || !(await saveSub(sub)) ? 'on' : 'off';
  }
  async function enablePush() {
    if (!pushSupported()) return toast(t('pushUnsupported'), true);
    if (await Notification.requestPermission() !== 'granted') return toast(t('pushDenied'), true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) });
      const error = await saveSub(sub);
      if (error) return fail(error);
      toast(t('pushOn'));
    } catch (e) { fail(e); }
    await pushStatus(); render();
  }
  async function disablePush() {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await sb.rpc('remove_push_subscription', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
    await pushStatus(); render();
  }

  function viewPush() {
    const result = O.testResult
      ? `<p class="${O.testResult.kind === 'ok' ? 'note' : O.testResult.kind === 'bad' ? 'warn' : 'small'}">${esc(O.testResult.text)}</p>` : '';
    const last = `<p class="small muted">${t('lastReceived')}: ${O.lastPush
      ? `${new Date(O.lastPush.at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' })}${O.lastPush.shown ? '' : ' (' + t('notShown') + ': ' + esc(O.lastPush.error) + ')'}`
      : t('never')} <button class="link small" data-a="o-push-recheck">↻</button></p>`;
    const test = `<button class="primary small" data-a="o-push-test">🔔 ${t('sendTest')}</button>`;
    let top;
    switch (O.push) {
      case 'on': top = `<div class="status on">🔔 ${t('pushOnThisPhone')}</div>
        <div class="two">${test}<button class="btn plain" data-a="o-push-off">${t('turnOff')}</button></div>`; break;
      case 'blocked': top = `<div class="status bad">🔕 ${t('pushBlockedTitle')}</div>
        <p class="small">${t('pushDenied')}</p>
        <div class="two">${test}<button class="btn plain" data-a="o-push-recheck">↻ ${t('checkAgain')}</button></div>`; break;
      case 'unsupported': top = `<div class="status bad">🔕 ${t('pushUnsupported')}</div>
        <p class="small muted">${t('pushIphone')}</p>${test}`; break;
      case 'off': top = `<div class="status off">🔕 ${t('pushOffShort')}</div>
        <p class="small">${t('pushOff')}</p><p class="small muted">${t('pushIphone')}</p>
        <div class="two"><button class="primary small" data-a="o-push-on">🔔 ${t('turnOn')}</button>
        <button class="btn plain okc" data-a="o-push-test">${t('sendTest')}</button></div>`; break;
      default: top = `<p class="small muted">${t('loading')}</p>${test}`;
    }
    return top + result + last;
  }

  // Sends a test to this owner's own phones and explains any failure in plain words.
  async function sendTest() {
    // Not registered on this phone yet (or the phone dropped it): register first.
    if (O.push === 'off') { await enablePush(); if (O.push !== 'on') return; }
    O.testResult = { kind: 'busy', text: t('loading') }; render();
    const { data, error } = await sb.functions.invoke('notify-owners', { body: { test: true } });
    let r;
    if (error) {
      const status = error.context?.status;
      let detail = '';
      try { detail = (await error.context.json())?.error || ''; } catch { /* no body */ }
      if (status === 404) r = { kind: 'bad', text: t('diagNoFunction') };
      else if (status === 401) r = { kind: 'bad', text: t('diagLogin') };
      else if (/VAPID/i.test(detail)) r = { kind: 'bad', text: t('diagNoKeys') };
      else if (!status) r = { kind: 'bad', text: t('diagNoFunction') + ' (' + (error.message || 'network') + ')' };
      else r = { kind: 'bad', text: `${t('diagServer')} ${status}: ${detail || error.message}` };
    } else if (!data?.phones) {
      await pushStatus();
      r = { kind: 'bad', text: t('diagNoPhone') };
    } else if (!data.sent) {
      r = { kind: 'bad', text: `${t('diagRefused')} ${(data.failed || []).join(' | ')}` };
    } else {
      r = { kind: 'ok', text: t('diagSent') };
    }
    O.testResult = r; render();
  }

  function viewSettings() {
    const b = curBiz();
    const st = b ? { business_name: b.name, receipt_phone: b.receipt_phone, receipt_footer: b.receipt_footer } : (S.settings || {});
    return head('settings') + `<div class="card"><h2>${t('shopDetails')}${b && (S.businesses || []).length > 1 ? ' · ' + esc(b.name) : ''}</h2>
      ${(S.businesses || []).length > 1 ? `<p class="small muted">${t('switchHint')}</p>` : ''}
      <form class="form" data-form="shop">
        <label>${t('businessName')}<input name="business_name" value="${esc(st.business_name)}" required></label>
        <label>${t('receiptPhone')}<input name="receipt_phone" value="${esc(st.receipt_phone)}" inputmode="tel"></label>
        <label>${t('receiptFooter')}<input name="receipt_footer" value="${esc(st.receipt_footer)}"></label>
        <button class="primary small">${t('save')}</button>
      </form></div>
      <div class="card"><h2>${t('notifications')}</h2>${viewPush()}</div>
      <div class="card"><h2>${t('printer')}</h2>
        <button class="primary small" data-a="printer">🖨 ${t('printerSettings')}</button></div>
      <div class="card"><h2>${t('backup')}</h2>
        <p class="small muted">${t('backupHelp')}</p>
        <button class="primary small" data-a="o-csvall">⬇ ${t('downloadAll')}</button></div>
      <details class="advanced"><summary>${t('advanced')}</summary>
        <p class="small muted">${t('advancedHelp')}</p>
        <button class="link danger" data-a="o-go" data-v="reset">⚠ ${t('resetTitle')}…</button></details>`;
  }

  // ---------------- clicks ----------------
  function onChange(el) {
    if (el.dataset.a === 'o-sumdate') { O.sumDate = el.value || nbDate(); O.summary = null; render(); load(); return true; }
    return false;
  }

  async function onClick(a, v) {
    switch (a) {
      case 'o-go': go(v); return true;
      case 'o-approvals': S.tab = 'owner'; go('approvals'); return true;
      case 'o-period': O.period = v; O.report = null; render(); load(); return true;
      case 'o-togglepick': document.getElementById('pick-' + v)?.classList.toggle('hide'); return true;
      case 'o-picon': {
        const [id, ic] = v.split('|');
        const form = document.querySelector(`form[data-form="group"][data-cat="${id}"]`);
        const input = form?.querySelector('input[name=icon]');
        if (input) { input.value = ic; input.dispatchEvent(new Event('input', { bubbles: true })); }
        const shown = form?.querySelector('.iconbtn'); if (shown) shown.textContent = ic;
        form?.querySelectorAll('.iconpick button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
        return true;
      }
      case 'o-rscope': O.resetAll = v === 'all'; O.resetInfo = null; render(); load(); return true;
      case 'o-undo': {
        if (!confirm(t('undoConfirm'))) return true;
        const { data, error } = await sb.rpc('undo_reset', { p_id: v });
        if (error) { fail(error); return true; }
        toast(t('undoDone') + (data?.skipped ? ' ' + t('undoSkipped').replace('{n}', data.skipped) : ''), !!data?.skipped);
        await loadCatalog(); await loadStock(); stockCheck(); await load(); return true;
      }
      case 'o-add': O.adding = true; O.justRestocked = false; render(); return true;
      case 'o-csv': { const [f, to] = periodRange(O.period); await exportCsv(f, to); return true; }
      case 'o-csvall': await exportCsv('2020-01-01', nbDate()); return true;
      case 'o-push-on': await enablePush(); return true;
      case 'o-push-off': await disablePush(); toast(t('pushOffShort')); return true;
      case 'o-push-test': await sendTest(); return true;
      case 'o-push-recheck': await pushStatus(); render(); return true;
      case 'o-cancel': O.adding = false; render(); return true;
      case 'o-approve': await decide(v, true); render(); return true;
      case 'o-reject': if (confirm(t('reject') + '?')) { await decide(v, false); render(); } return true;
      case 'o-hide': case 'o-show': {
        const { error } = await sb.from('grades').update({ active: a === 'o-show' }).eq('id', v);
        if (error) fail(error);
        await loadCatalog(); await load(); return true;
      }
      case 'o-endpromo': {
        const p = O.promos.find((x) => x.id === v);
        if (!p || !confirm(t('endNow') + '?')) return true;
        const q = new Date(p.starts_at) > new Date()
          ? sb.from('promotions').delete().eq('id', v)
          : sb.from('promotions').update({ ends_at: new Date().toISOString() }).eq('id', v);
        const { error } = await q;
        if (error) fail(error);
        await loadCatalog(); await load(); return true;
      }
    }
    return false;
  }

  // ---------------- forms ----------------
  async function onSubmit(form) {
    const f = new FormData(form);
    const num = (k) => Math.round(Number(f.get(k)));
    let error;
    switch (form.dataset.form) {
      case 'bale': {
        const lines = S.catalog.grades.map((g) => ({ grade_id: g.id, quantity: num('q_' + g.id) || 0 }))
          .filter((l) => l.quantity > 0);
        if (!lines.length) return toast(t('piecesPerGrade'), true);
        ({ error } = await sb.rpc('add_bale', {
          p_received_on: f.get('date'), p_supplier: f.get('supplier') || null,
          p_cost: num('cost'), p_notes: f.get('notes') || null, p_lines: lines,
        }));
        if (!error) {
          O.adding = false;
          await loadStock();
          stockCheck();                       // re-arms the alert when back above the level
          if (lowGroups(S.stock).length) O.justRestocked = true;
        }
        break;
      }
      case 'grades': {
        const gs = O.grades.filter((g) => g.category_id === form.dataset.cat);
        const changes = gs.map((g) => ({ g, n: num('n_' + g.id), l: num('l_' + g.id) }))
          .filter(({ g, n, l }) => n !== g.normal_price || l !== g.min_price);
        if (changes.some(({ n, l }) => !(n > 0 && l > 0 && l <= n))) return toast(t('lowestTooHigh'), true);
        for (const { g, n, l } of changes) {
          ({ error } = await sb.from('grades').update({ normal_price: n, min_price: l }).eq('id', g.id));
          if (error) break;
        }
        break;
      }
      case 'addgrade': {
        const n = num('normal'), l = num('lowest');
        if (!(n > 0 && l > 0 && l <= n)) return toast(t('lowestTooHigh'), true);
        const order = O.grades.filter((g) => g.category_id === form.dataset.cat).length + 1;
        ({ error } = await sb.from('grades').insert({ category_id: form.dataset.cat, name: String(f.get('name')).trim(),
          normal_price: n, min_price: l, sort_order: order }));
        break;
      }
      case 'addcat': {
        ({ error } = await sb.from('categories').insert({
          name: String(f.get('name')).trim(), sort_order: O.cats.length + 1, business_id: S.biz,
          icon: String(f.get('icon') || '').trim() || suggestIcon(String(f.get('name')), curBiz()?.kind),
          low_stock_threshold: Math.max(0, num('threshold') || 0) }));
        break;
      }
      case 'group': {
        ({ error } = await sb.from('categories').update({
          icon: String(f.get('icon') || '').trim() || null,
          low_stock_threshold: Math.max(0, num('threshold') || 0) }).eq('id', form.dataset.cat));
        if (!error) { await loadStock(); stockCheck(); }
        break;
      }
      case 'promo': {
        const ids = f.getAll('g');
        const price = num('price');
        const from = String(f.get('from')), to = String(f.get('to'));
        if (!ids.length) return toast(t('chooseItems'), true);
        if (to < from) return toast(t('from') + ' / ' + t('to'), true);
        ({ error } = await sb.from('promotions').insert(ids.map((id) => ({
          grade_id: id, promo_price: price, starts_at: nbStart(from), ends_at: nbStart(addDays(to, 1)) }))));
        break;
      }
      case 'cash': {
        const { data, error: e } = await sb.rpc('close_day_business', {
          p_date: nbDate(), p_opening_float: num('float') || 0, p_counted: num('counted'), p_notes: f.get('notes') || null,
          p_business: S.biz });
        error = e;
        if (!e) toast(`${t('difference')}: ${kes(data)}${data < 0 ? ' ' + t('short') : data > 0 ? ' ' + t('over') : ' ✓'}`, data < 0);
        break;
      }
      case 'reset': {
        if (f.get('understand') !== 'on') return toast(t('resetTick'), true);
        if (String(f.get('confirm') || '').trim() !== 'RESET') return toast(t('resetTypeExact'), true);
        const name = O.resetAll ? t('allBusinesses') : (curBiz()?.name || '');
        if (!confirm(t('resetFinal').replace('{name}', name))) return true;
        const { data, error: e } = await sb.rpc('reset_sales', { p_business: O.resetAll ? null : S.biz, p_confirm: 'RESET' });
        if (e) { fail(e); return true; }
        toast(t('resetDone').replace('{n}', data.counts.sales));
        S.today = null; await loadStock(); await load(); return true;
      }
      case 'shop': {     // details of the business selected at the top
        const row = {
          name: String(f.get('business_name')).trim(),
          receipt_phone: String(f.get('receipt_phone') || '').trim() || null,
          receipt_footer: String(f.get('receipt_footer') || '').trim() || null,
        };
        ({ error } = S.biz
          ? await sb.from('businesses').update(row).eq('id', S.biz)
          : await sb.from('settings').update({ business_name: row.name, receipt_phone: row.receipt_phone,
              receipt_footer: row.receipt_footer }).eq('id', 1));
        if (!error) await loadCatalog();
        break;
      }
      case 'staff': {
        ({ error } = await sb.from('profiles').update({
          full_name: String(f.get('name')).trim(), role: f.get('role'), active: f.get('active') === 'on',
        }).eq('id', form.dataset.id));
        if (!error && form.dataset.id === S.session.user.id) await loadProfile();
        break;
      }
      default: return false;
    }
    if (error) fail(error);
    else {
      S.justSaved = (form.dataset.form || form.id) + ':' + (form.dataset.cat || form.dataset.id || '');
      if (form.dataset.form !== 'cash') toast(t('saved'));
    }
    if (['grades', 'addgrade', 'addcat', 'promo'].includes(form.dataset.form)) await loadCatalog();
    await load();
    return true;
  }

  return { view, onClick, onChange, onSubmit, go, pollApprovals, loadStock, stockCheck, lowGroups: () => lowGroups(S.stock), load };
}

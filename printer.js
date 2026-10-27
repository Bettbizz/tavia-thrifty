// Receipt printing.
//  * "bluetooth": prints straight to a Bluetooth thermal printer (ESC/POS).
//    Works in Chrome on Android. iPhones cannot do this from a web app.
//  * "system": opens the phone's normal print menu (any printer the phone
//    supports, including AirPrint, or a printer app such as RawBT on Android).
// Settings are kept per phone.

const prefsKey = 'printPrefs';
export function getPrefs() {
  try { return { mode: 'system', paper: 58, auto: false, ...JSON.parse(localStorage.getItem(prefsKey) || '{}') }; }
  catch { return { mode: 'system', paper: 58, auto: false }; }
}
export function setPrefs(p) { try { localStorage.setItem(prefsKey, JSON.stringify({ ...getPrefs(), ...p })); } catch {} }
export const bluetoothSupported = () => !!navigator.bluetooth;

// Common services used by cheap Bluetooth receipt printers.
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', '49535343-fe7d-4ae5-8fa9-9fafd205e455',
];
let device = null;
let channel = null;

export const printerName = () => device?.name || null;

// Must be called from a button tap (the phone shows a list of printers).
export async function connectPrinter() {
  device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  return attach();
}

async function attach() {
  const server = device.gatt.connected ? device.gatt : await device.gatt.connect();
  for (const service of await server.getPrimaryServices()) {
    for (const c of await service.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) { channel = c; return device.name || 'Printer'; }
    }
  }
  throw new Error('This Bluetooth device does not accept print data');
}

async function sendBytes(bytes) {
  if (!device) await connectPrinter();
  if (!device.gatt.connected || !channel) await attach();
  const size = 20; // small pieces work on every printer
  for (let i = 0; i < bytes.length; i += size) {
    const part = bytes.slice(i, i + size);
    if (channel.properties.writeWithoutResponse) await channel.writeValueWithoutResponse(part);
    else await channel.writeValue(part);
    await new Promise((r) => setTimeout(r, 15));
  }
}

// ---------- receipt layout ----------
const ascii = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[·•]/g, '-').replace(/×/g, 'x').replace(/[^\x20-\x7E]/g, '');
const money = (n) => Number(n || 0).toLocaleString('en-KE');
const pad = (left, right, w) => {
  left = ascii(left); right = ascii(right);
  const space = w - left.length - right.length;
  return space >= 1 ? left + ' '.repeat(space) + right : left.slice(0, w - right.length - 1) + ' ' + right;
};

/** sale: {id, sold_at, payment_method, mpesa_code, lines:[{label, quantity, unit_price}], total, seller} */
export function receiptModel(sale, shop) {
  const when = new Date(sale.sold_at).toLocaleString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Nairobi' });
  return {
    shop: shop.business_name || 'Bizzfy POS', phone: shop.receipt_phone || '', footer: shop.receipt_footer || '',
    when, no: String(sale.id).slice(0, 8).toUpperCase(), seller: sale.seller || '',
    lines: sale.lines, total: sale.total,
    paid: sale.payment_method === 'mpesa' ? `M-Pesa ${sale.mpesa_code || ''}` : 'Cash',
  };
}

function escposBytes(m, width) {
  const out = [];
  const raw = (...b) => out.push(...b);
  const text = (s) => out.push(...new TextEncoder().encode(ascii(s) + '\n'));
  const line = '-'.repeat(width);
  raw(0x1b, 0x40);                       // reset
  raw(0x1b, 0x61, 0x01);                 // centre
  raw(0x1d, 0x21, 0x11); text(m.shop);   // big
  raw(0x1d, 0x21, 0x00);
  if (m.phone) text(m.phone);
  text(m.when);
  text(`Receipt ${m.no}${m.seller ? ' - ' + m.seller : ''}`);
  raw(0x1b, 0x61, 0x00);                 // left
  text(line);
  for (const l of m.lines) {
    text(`${l.quantity} x ${l.label}`);
    text(pad(`   @ ${money(l.unit_price)}`, money(l.quantity * l.unit_price), width));
  }
  text(line);
  raw(0x1b, 0x45, 0x01); text(pad('TOTAL KES', money(m.total), width)); raw(0x1b, 0x45, 0x00);
  text(pad('Paid', m.paid, width));
  raw(0x1b, 0x61, 0x01);
  if (m.footer) { text(''); text(m.footer); }
  text('Bizzfy POS');
  raw(0x1b, 0x64, 0x04);                 // feed 4 lines
  raw(0x1d, 0x56, 0x42, 0x00);           // cut (ignored by printers without a cutter)
  return new Uint8Array(out);
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function systemPrint(m, paper) {
  let area = document.getElementById('print-area');
  if (!area) { area = document.createElement('div'); area.id = 'print-area'; document.body.appendChild(area); }
  area.style.setProperty('--paper', paper + 'mm');
  area.innerHTML = `<div class="r-c"><b class="r-shop">${esc(m.shop)}</b>${m.phone ? `<div>${esc(m.phone)}</div>` : ''}
    <div>${esc(m.when)}</div><div>Receipt ${esc(m.no)}${m.seller ? ' · ' + esc(m.seller) : ''}</div></div><hr>
    ${m.lines.map((l) => `<div>${l.quantity} × ${esc(l.label)}</div>
      <div class="r-row"><span>&nbsp;&nbsp;@ ${money(l.unit_price)}</span><span>${money(l.quantity * l.unit_price)}</span></div>`).join('')}
    <hr><div class="r-row"><b>TOTAL KES</b><b>${money(m.total)}</b></div>
    <div class="r-row"><span>Paid</span><span>${esc(m.paid)}</span></div>
    <div class="r-c">${m.footer ? `<p>${esc(m.footer)}</p>` : ''}<small>Bizzfy POS</small></div>`;
  window.print();
}

export async function printReceipt(sale, shop) {
  const prefs = getPrefs();
  const m = receiptModel(sale, shop);
  if (prefs.mode === 'bluetooth' && bluetoothSupported()) {
    await sendBytes(escposBytes(m, prefs.paper >= 80 ? 48 : 32));
  } else {
    systemPrint(m, prefs.paper);
  }
}

// Reads M-Pesa confirmation messages and picks the right code for a sale.
// Two layouts are understood:
//   Phone (Send Money): "QJK7XYZ12A Confirmed. You have received Ksh500.00 from JANE WANJIRU 0712345678
//                        on 28/10/26 at 10:15 AM. New M-PESA balance is Ksh..."
//   Till (Lipa na M-PESA): "QJK7XYZ12A Confirmed.on 6/11/26 at 6:55 PMKSH150.00 received from 2547****678
//                        jane wanjiru . New Account balance is KSH..."

const CODE_RE = /\b([A-Z0-9]{10})\b[\s.,]*Confirmed/gi;

// "on 6/11/26 at 6:55 PM" -> Date (Kenya time)
function paidAt(msg) {
  const m = msg.match(/\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)/i);
  if (!m) return null;
  let [, d, mo, y, h, mi, ap] = m;
  y = +y < 100 ? 2000 + +y : +y;
  h = (+h % 12) + (/p/i.test(ap) ? 12 : 0);
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:${mi}:00+03:00`;
  const t = new Date(iso);
  return isNaN(t) ? null : t.toISOString();
}

const tidy = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();

/** Split text into messages and read code, amount, sender, phone and time from each. */
export function parseMessages(text) {
  const src = String(text || '').replace(/\r/g, '');
  const starts = [...src.matchAll(CODE_RE)].map((m) => m.index);
  const out = [];
  starts.forEach((start, k) => {
    const msg = src.slice(start, starts[k + 1] ?? src.length).trim();
    const code = msg.match(/^([A-Z0-9]{10})/i)?.[1].toUpperCase();
    const received = /received/i.test(msg);
    const amt = msg.match(/(?:Ksh|KES)\s?([\d,]+(?:\.\d{1,2})?)/i);
    const amount = amt ? Math.round(Number(amt[1].replace(/,/g, ''))) : null;
    let name = '', phone = '';
    const till = msg.match(/received\s+from\s+([+\d*]{6,15})\s+(.+?)\s*\.\s*New\b/i);   // till: phone then name
    if (till) { phone = till[1]; name = tidy(till[2]); }
    else {
      const p = msg.match(/\bfrom\s+(.+?)\s*((?:\+?254|0)[\d*]{8,9})\b/i);                // phone: name then phone
      if (p) { name = tidy(p[1]); phone = p[2]; }
      else name = tidy(msg.match(/\bfrom\s+([A-Za-z][A-Za-z .'-]{1,60}?)\s+(?:on\s+\d|\d{1,2}\/)/i)?.[1]);
    }
    if (code) out.push({ code, amount, name, phone, paid_at: paidAt(msg), received, text: msg.slice(0, 160) });
  });
  return out;
}

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(Boolean);
/** True when every word typed by the seller appears in the sender's name (any order). */
export function nameMatches(sender, typed) {
  const want = norm(typed);
  if (!want.length) return true;
  const have = norm(sender);
  return want.every((w) => have.some((h) => h.startsWith(w)));
}

/** "JANE WANJIRU" -> "Jane W." (enough to recognise a customer without showing the full name). */
export function shortName(s) {
  const w = norm(s);
  if (!w.length) return '';
  const cap = (x) => x[0] + x.slice(1).toLowerCase();
  return w.length === 1 ? cap(w[0]) : `${cap(w[0])} ${w[w.length - 1][0]}.`;
}

/**
 * Choose the code for this sale from the latest messages only.
 * Returns { pick } when exactly one message fits, or { choices } when the seller must confirm.
 */
export function chooseCode(messages, { total, buyer = '', usedCodes = [] } = {}) {
  const latest = messages.filter((m) => m.received && !usedCodes.includes(m.code)).slice(-5);
  if (!latest.length) return { choices: [], reason: 'none' };
  const byName = latest.filter((m) => nameMatches(m.name, buyer));
  const byAmount = byName.filter((m) => total == null || m.amount === total);
  if (byAmount.length === 1) return { pick: byAmount[0] };
  if (byAmount.length > 1) return { choices: byAmount.reverse(), reason: 'similar' };   // two alike: confirm
  return { choices: (byName.length ? byName : latest).reverse(), reason: byName.length ? 'amount' : 'name' };
}

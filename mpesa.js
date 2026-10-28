// Reads pasted M-Pesa confirmation messages and picks the right code for a sale.
// Example message:
//   "QJK7XYZ12A Confirmed. You have received Ksh500.00 from JANE WANJIRU 0712345678
//    on 28/10/26 at 10:15 AM. New M-PESA balance is Ksh..."

const CODE_RE = /\b([A-Z0-9]{10})\b[\s.,]*Confirmed/gi;

/** Split pasted text into messages and read code, amount and sender from each. */
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
    const name = (msg.match(/\bfrom\s+(.+?)\s*(?:\+?254|0)\d{8,9}\b/i)?.[1]
      || msg.match(/\bfrom\s+([A-Za-z][A-Za-z .'-]{1,60}?)\s+(?:on\s+\d|\d{1,2}\/)/i)?.[1]
      || '').replace(/[.\s]+$/, '').trim();
    if (code) out.push({ code, amount, name, received, text: msg.slice(0, 160) });
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

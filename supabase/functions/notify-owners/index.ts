// Bizzfy POS — sends a phone notification to every active owner when an
// employee asks for a price approval.
// Deploy: Supabase → Edge Functions → Deploy a new function → Via editor,
// name it  notify-owners , paste this file, Deploy.
// Needs secrets (Edge Functions → Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT (e.g. mailto:you@example.com). No other keys are needed.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function adminKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}');
    const first = Object.values(keys)[0];
    if (typeof first === 'string' && first) return first;
  } catch { /* fall through */ }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

type Sub = { endpoint: string; p256dh: string; auth: string };
// deno-lint-ignore no-explicit-any
async function sendAll(admin: any, subs: Sub[], payload: string) {
  let sent = 0;
  const failed: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { TTL: 600, urgency: 'high' });
      sent++;
    } catch (e) {
      const host = new URL(s.endpoint).host;
      failed.push(`${host} ${e?.statusCode ?? ''} ${String(e?.body ?? e?.message ?? e).slice(0, 120)}`.trim());
      // Phone unsubscribed or app removed: forget it.
      if (e?.statusCode === 404 || e?.statusCode === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }));
  return { sent, phones: subs.length, failed };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, adminKey(), { auth: { persistSession: false } });

    // Who is calling? Must be a logged-in staff member.
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: 'not logged in' }, 401);

    const body = await req.json();
    if (!Deno.env.get('VAPID_PUBLIC_KEY') || !Deno.env.get('VAPID_PRIVATE_KEY')) {
      return json({ error: 'VAPID keys are missing in Supabase secrets' }, 500);
    }
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
      Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

    // "Send test notification" from Owner → Settings: only to the caller's own phones.
    if (body.test) {
      const { data: mine } = await admin.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', user.id);
      return json(await sendAll(admin, mine ?? [], JSON.stringify({
        title: 'Bizzfy POS', body: 'Notifications are working on this phone. ✓', url: './', tag: 'test' })));
    }

    // Low-stock check: any staff phone asks after sales sync; alerts owners once per drop.
    if (body.stock_check) {
      const { data: chk, error } = await admin.rpc('low_stock_check');
      if (error) return json({ error: error.message }, 500);
      if (!chk?.alert) return json({ sent: 0, phones: 0, failed: [], ...chk });
      const [{ data: shop }, { data: owners }] = await Promise.all([
        admin.from('settings').select('business_name').eq('id', 1).single(),
        admin.from('profiles').select('id').eq('role', 'owner').eq('active', true),
      ]);
      const ids = (owners ?? []).map((o) => o.id);
      const { data: subs } = ids.length
        ? await admin.from('push_subscriptions').select('endpoint, p256dh, auth').in('user_id', ids)
        : { data: [] };
      return json({ ...chk, ...(await sendAll(admin, subs ?? [], JSON.stringify({
        title: `${shop?.business_name ?? 'Bizzfy POS'}: low stock`,
        body: `Only ${chk.total} pieces left (alert level ${chk.threshold}). Tap to see what to restock.`,
        url: './?go=bales', tag: 'low-stock',
      }))) });
    }

    const request_id = body.request_id;
    const { data: r } = await admin.from('price_requests')
      .select('id, total, status, requested_by').eq('id', request_id).single();
    if (!r || r.requested_by !== user.id || r.status !== 'pending') return json({ error: 'no such request' }, 400);

    const [{ data: who }, { data: shop }, { data: owners }] = await Promise.all([
      admin.from('profiles').select('full_name').eq('id', user.id).single(),
      admin.from('settings').select('business_name').eq('id', 1).single(),
      admin.from('profiles').select('id').eq('role', 'owner').eq('active', true),
    ]);
    const ownerIds = (owners ?? []).map((o) => o.id);
    if (!ownerIds.length) return json({ sent: 0, phones: 0, failed: [] });
    const { data: subs } = await admin.from('push_subscriptions')
      .select('endpoint, p256dh, auth').in('user_id', ownerIds);

    const payload = JSON.stringify({
      title: `${shop?.business_name ?? 'Bizzfy POS'}: price approval`,
      body: `${who?.full_name ?? 'Staff'} is asking to sell for KES ${Number(r.total).toLocaleString('en-KE')}. Tap to review.`,
      url: './?go=approvals',
      tag: 'approval-' + r.id,
    });

    return json(await sendAll(admin, subs ?? [], payload));
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

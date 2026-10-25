// Supabase Edge Function: giriş yapan kişinin ailesindeki diğer üyelerin telefonlarına bildirim gönderir.
// Gerekli Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (SUPABASE_* değerleri otomatik gelir).
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

// deno-lint-ignore no-explicit-any
type Admin = any;

async function sendTo(admin: Admin, userIds: string[], title: string, body: string) {
  if (!userIds.length) return 0;
  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', userIds);
  const payload = JSON.stringify({ title: title.slice(0, 80), body: body.slice(0, 200) });
  let sent = 0;
  await Promise.all((subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (err) {
      // Telefon aboneliği bitmişse kaydı temizle
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
    }
  }));
  return sent;
}

/** Zamanlanmış hatırlatmalar (pg_cron her ayın 1, 3 ve 5'inde çağırır) */
async function monthly(admin: Admin) {
  const tr = new Date(Date.now() + 3 * 3600_000); // Türkiye saati
  const day = tr.getUTCDate();
  const month = `${tr.getUTCFullYear()}-${String(tr.getUTCMonth() + 1).padStart(2, '0')}`;
  const { data: members } = await admin.from('members').select('user_id, notify_prefs');
  // Tercihinde kapatmış olanlara gönderme (boş tercih = açık)
  const wants = (type: string): string[] => (members ?? [])
    .filter((m: { notify_prefs?: Record<string, boolean> }) => (m.notify_prefs ?? {})[type] !== false)
    .map((m: { user_id: string }) => m.user_id);
  let sent = 0;
  if (day <= 3) {
    const { data: done } = await admin.from('card_payments').select('owner_id').eq('month', month);
    const doneIds = new Set((done ?? []).map((d: { owner_id: string }) => d.owner_id));
    sent += await sendTo(admin, wants('card').filter((id: string) => !doneIds.has(id)),
      '💳 Kredi kartı ödemesi', 'Bu ay kartına ne kadar ödediğini girmeyi unutma 🐷');
  }
  if (day === 5) {
    sent += await sendTo(admin, wants('payday'), '💸 Hesaplaşma günü', 'Geçen ayın ortak harcamalarına göre kimin kime ne atacağı hazır 🐻');
  }
  return { day, sent };
}

/** Her akşam 22:00 (cron 19:00 UTC): bugün harcama girmeyen üyelere hatırlatma */
async function daily(admin: Admin) {
  const tr = new Date(Date.now() + 3 * 3600_000);
  const today = tr.toISOString().slice(0, 10);
  const { data: members } = await admin.from('members').select('user_id, notify_prefs');
  const { data: todays } = await admin.from('expenses').select('owner_id').eq('date', today);
  const done = new Set((todays ?? []).map((e: { owner_id: string }) => e.owner_id));
  const ids: string[] = (members ?? [])
    .filter((m: { user_id: string; notify_prefs?: Record<string, boolean> }) => (m.notify_prefs ?? {}).daily !== false && !done.has(m.user_id))
    .map((m: { user_id: string }) => m.user_id);
  return { today, sent: await sendTo(admin, ids, '🧾 Bugünkü harcamalar', 'Bugün bir harcama girdin mi? Girmeyi unutma 🐶') };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret && req.headers.get('x-cron-secret') === cronSecret) {
    const job = (await req.json().catch(() => ({})) as { job?: string }).job;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    return json(job === 'daily' ? await daily(admin) : await monthly(admin));
  }
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'giriş gerekli' }, 401);

  const { title, body, test, type } = await req.json().catch(() => ({}));
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Kurulum testi: bildirimi sadece isteyen kişinin kendi telefonlarına gönder
  if (test) return json({ sent: await sendTo(admin, [user.id], '🐶 Test bildirimi', 'Bildirimler çalışıyor, hav hav!') });

  const { data: me } = await admin.from('members').select('household_id').eq('user_id', user.id).maybeSingle();
  if (!me) return json({ sent: 0 });
  const { data: others } = await admin.from('members').select('user_id, notify_prefs')
    .eq('household_id', me.household_id).neq('user_id', user.id);
  const ids = (others ?? [])
    .filter((o: { notify_prefs?: Record<string, boolean> }) => !type || (o.notify_prefs ?? {})[type] !== false)
    .map((o: { user_id: string }) => o.user_id);
  if (!ids.length) return json({ sent: 0 });

  return json({ sent: await sendTo(admin, ids, String(title ?? 'Aile Bütçesi'), String(body ?? '')) });
});

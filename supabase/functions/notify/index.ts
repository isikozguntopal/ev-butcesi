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

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return json({ error: 'giriş gerekli' }, 401);

  const { title, body } = await req.json().catch(() => ({}));
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: me } = await admin.from('members').select('household_id').eq('user_id', user.id).maybeSingle();
  if (!me) return json({ sent: 0 });
  const { data: others } = await admin.from('members').select('user_id')
    .eq('household_id', me.household_id).neq('user_id', user.id);
  const ids = (others ?? []).map(o => o.user_id);
  if (!ids.length) return json({ sent: 0 });

  const { data: subs } = await admin.from('push_subscriptions').select('*').in('user_id', ids);
  const payload = JSON.stringify({ title: String(title ?? 'Aile Bütçesi').slice(0, 80), body: String(body ?? '').slice(0, 200) });

  let sent = 0;
  await Promise.all((subs ?? []).map(async s => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      sent++;
    } catch (err) {
      // Telefon aboneliği bitmişse kaydı temizle
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
    }
  }));
  return json({ sent });
});

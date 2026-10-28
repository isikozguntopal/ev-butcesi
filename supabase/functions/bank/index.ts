// Supabase Edge Function: Gmail'deki betikten gelen banka olaylarını kaydeder.
// İstek: POST { token, events: [{ kind, amount, merchant?, occurred_at?, msg_id, subject? }] }
// token, uygulamada Ayarlar > Banka bağlantısı'ndaki kişisel anahtardır (bank_links tablosu).
// Yeni kart harcamasında sahibine bildirim gider. Gerekli Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:noreply@example.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const KINDS = ['card', 'balance', 'in', 'out'];
const tl = (v: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(v);

type Event = { kind: string; amount: number; merchant?: string; occurred_at?: string; msg_id: string; subject?: string };

Deno.serve(async req => {
  if (req.method !== 'POST') return json({ error: 'POST bekleniyor' }, 405);
  let body: { token?: string; events?: Event[] };
  try { body = await req.json(); } catch { return json({ error: 'Geçersiz istek' }, 400); }
  const token = String(body.token ?? '');
  if (token.length < 32) return json({ error: 'Anahtar yok' }, 401);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: link } = await admin.from('bank_links').select('user_id').eq('token', token).maybeSingle();
  if (!link) return json({ error: 'Anahtar geçersiz' }, 401);
  const uid = link.user_id as string;
  const { data: member } = await admin.from('members').select('household_id, notify_prefs').eq('user_id', uid).maybeSingle();
  if (!member) return json({ error: 'Aile bulunamadı' }, 404);

  const events = (body.events ?? []).filter(e =>
    KINDS.includes(e.kind) && Number.isFinite(Number(e.amount)) && typeof e.msg_id === 'string' && e.msg_id);
  const rows = events.map(e => ({
    household_id: member.household_id,
    owner_id: uid,
    kind: e.kind,
    amount: Math.round(Number(e.amount) * 100) / 100,
    merchant: e.merchant ? String(e.merchant).slice(0, 80) : null,
    occurred_at: e.occurred_at && !Number.isNaN(Date.parse(e.occurred_at)) ? e.occurred_at : new Date().toISOString(),
    msg_id: e.msg_id.slice(0, 200),
    subject: e.subject ? String(e.subject).slice(0, 200) : null,
    // Bakiye bilgisi onay beklemez; doğrudan "Bankadaki bakiye" olur
    status: e.kind === 'balance' ? 'added' : 'pending',
  }));
  if (!rows.length) return json({ ok: true, inserted: 0 });

  // Aynı e-posta ikinci kez gelirse yok sayılır (owner_id + msg_id tekil)
  const { data: inserted, error } = await admin.from('bank_events')
    .upsert(rows, { onConflict: 'owner_id,msg_id', ignoreDuplicates: true }).select();
  if (error) return json({ error: error.message }, 500);
  const fresh = inserted ?? [];

  // En yeni bakiye bilgisini kaydet
  const balances = fresh.filter(r => r.kind === 'balance').sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  if (balances.length) {
    const latest = balances[0];
    const { data: fin } = await admin.from('finances').select('bank_balance_at').eq('user_id', uid).maybeSingle();
    if (!fin) await admin.from('finances').insert({ user_id: uid, bank_balance: latest.amount, bank_balance_at: latest.occurred_at });
    else if (!fin.bank_balance_at || fin.bank_balance_at < latest.occurred_at) {
      await admin.from('finances').update({ bank_balance: latest.amount, bank_balance_at: latest.occurred_at }).eq('user_id', uid);
    }
  }

  // Yeni kart harcamalarını telefona bildir (tercihinde kapatmadıysa)
  const cards = fresh.filter(r => r.kind === 'card');
  if (cards.length && (member.notify_prefs ?? {}).bank !== false) {
    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', uid);
    const one = cards[0];
    const payload = JSON.stringify({
      title: '🔔 Yeni kart harcaması',
      body: cards.length === 1 ? `${tl(one.amount)}${one.merchant ? ` · ${one.merchant}` : ''} · uygulamada onayla`
        : `${cards.length} yeni harcama · uygulamada onayla`,
    });
    await Promise.all((subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('id', s.id);
      }
    }));
  }
  return json({ ok: true, inserted: fresh.length });
});

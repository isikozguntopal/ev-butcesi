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

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const tlFmt = (v: number) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 2 }).format(v);
const mk = (d: string | null) => (d ? String(d).slice(0, 7) : '');
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

/** Uygulamadaki settlementFor'un sunucu kopyası: m ayının 5'inde kim kime ne kadar gönderecek.
 *  Yarı yarıya ortak kalemlerin yarısı karşı tarafa borç yazılır; ay içinde "gönderdim" denen harcamalar düşülür. */
function settlementOf(rows: { expenses: Row[]; installments: Row[]; fixed: Row[]; settled: boolean }, A: string, B: string, m: string) {
  const owe: Record<string, number> = { [A]: 0, [B]: 0 };
  const add = (it: Row, amount: number, isExpense: boolean) => {
    if (!it.shared || it.split !== 'half' || !(it.payer_id in owe) || !amount) return;
    if (isExpense) {
      const debtorKey = `${mk(it.date)}:${it.payer_id === A ? B : A}`;
      const p: string[] = it.paid_months || [];
      const legacy = p.includes(debtorKey) && !p.includes(`${debtorKey}:settled`) && !rows.settled;
      if (p.includes(`${debtorKey}:sent`) || legacy) return;
    }
    owe[it.payer_id === A ? B : A] += amount / 2;
  };
  rows.expenses.filter(e => mk(e.pay_date || e.date) === m).forEach(e => add(e, Number(e.amount), true));
  rows.installments.filter(i => m >= mk(i.first_month) && m <= mk(i.last_month)).forEach(i => add(i, Number(i.monthly_amount), false));
  rows.fixed.forEach(f => add(f, Number(f.amount), false));
  const net = owe[A] - owe[B];
  return { from: net > 0 ? A : B, to: net > 0 ? B : A, amount: Math.round(Math.abs(net) * 100) / 100 };
}

/** Ayın 3'ü: hesaplaşması bekleyen ailelerde gönderecek ve alacak kişiye tutarla hatırlatma */
async function settleReminder(admin: Admin, month: string, wants: (t: string) => string[]) {
  const { data: members } = await admin.from('members').select('user_id, household_id, display_name').order('created_at');
  const homes = new Map<string, Row[]>();
  for (const m of members ?? []) homes.set(m.household_id, [...(homes.get(m.household_id) ?? []), m]);
  const ok = new Set(wants('payday'));
  const day = `5 ${AYLAR[Number(month.slice(5, 7)) - 1]}`;
  let sent = 0;
  for (const [hid, list] of homes) {
    if (list.length < 2) continue;
    const [A, B] = list.map(x => x.user_id);
    const { data: rec } = await admin.from('settlements').select('sent_at, received_at').eq('household_id', hid).eq('month', month).maybeSingle();
    if (rec?.sent_at || rec?.received_at) continue;
    const pick = (t: string) => admin.from(t).select('*').eq('household_id', hid).eq('shared', true);
    const [{ data: expenses }, { data: installments }, { data: fixed }] = await Promise.all([pick('expenses'), pick('installments'), pick('fixed_payments')]);
    const s = settlementOf({ expenses: expenses ?? [], installments: installments ?? [], fixed: fixed ?? [], settled: false }, A, B, month);
    if (s.amount < 1) continue;
    const name = (id: string) => list.find(x => x.user_id === id)?.display_name || 'eşin';
    if (ok.has(s.from)) sent += await sendTo(admin, [s.from], '💸 Hesaplaşma yaklaşıyor', `${day} günü ${name(s.to)} için ${tlFmt(s.amount)} göndereceksin 🐻`);
    if (ok.has(s.to)) sent += await sendTo(admin, [s.to], '💸 Hesaplaşma yaklaşıyor', `${day} günü ${name(s.from)} sana ${tlFmt(s.amount)} gönderecek 🐻`);
  }
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
  if (day === 3) sent += await settleReminder(admin, month, wants);
  if (day === 5) {
    sent += await sendTo(admin, wants('payday'), '💸 Hesaplaşma günü', 'Bu ayın ortak harcamalarına göre kimin kime ne atacağı hazır 🐻');
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
  let sent = await sendTo(admin, ids, '🧾 Bugünkü harcamalar', 'Bugün bir harcama girdin mi? Girmeyi unutma 🐶');
  // Kart hesap kesim günü: ekstreyi indirip kontrol ettirme hatırlatması (Ayarlar > Kredi kartı)
  const day = tr.getUTCDate();
  const cut: string[] = (members ?? [])
    .filter((m: { notify_prefs?: Record<string, unknown> }) => Number((m.notify_prefs ?? {}).cut_day) === day && (m.notify_prefs ?? {}).statement !== false)
    .map((m: { user_id: string }) => m.user_id);
  sent += await sendTo(admin, cut, '🧾 Kart ekstren kesildi', 'Ekstre PDF\'ini indir ve kontrol için gönder; ödemeyi yapınca kart ödemesini gir 💳');
  return { today, sent };
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

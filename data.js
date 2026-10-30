import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { DEFAULT_SHOPPING } from './defaults.js';

const CONFIGURED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
const SHOW_FLAG = 'aile-butcesi-show';
const SHOW_EMAIL = 'aile-butcesi-show-email';
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* depolama kapalı */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* depolama kapalı */ } },
};

/** Gösterim modu: gerçek hesap açıkken başkalarına sadece örnek verileri göstermek için */
export const SHOW = CONFIGURED && store.get(SHOW_FLAG) === '1';
/** Supabase yoksa ya da gösterim modundaysa veriler sadece bu cihazda, örnek veridir */
export const DEMO = !CONFIGURED || SHOW;
export const TABLES = ['installments', 'fixed_payments', 'expenses', 'shopping_items', 'wishlist', 'card_payments', 'settlements', 'goals', 'carryovers', 'shopping_trips', 'bank_events', 'bank_links'];

// --- Supabase ---

let sb = null;
async function client() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return sb;
}

function check({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

const remote = {
  async session() {
    return (await (await client()).auth.getSession()).data.session;
  },
  async signIn(email, password) {
    return check(await (await client()).auth.signInWithPassword({ email, password })).session;
  },
  async signUp(email, password) {
    return check(await (await client()).auth.signUp({ email, password })).session;
  },
  async signOut() {
    await (await client()).auth.signOut();
  },
  async rpc(fn, args) {
    return check(await (await client()).rpc(fn, args));
  },
  async select(table) {
    return check(await (await client()).from(table).select('*').order('created_at'));
  },
  async insert(table, rows) {
    return check(await (await client()).from(table).insert(rows).select());
  },
  async update(table, id, patch) {
    check(await (await client()).from(table).update(patch).eq('id', id));
  },
  async remove(table, id) {
    check(await (await client()).from(table).delete().eq('id', id));
  },
  async finance(uid) {
    return check(await (await client()).from('finances').select('*').eq('user_id', uid).maybeSingle());
  },
  async saveFinance(row) {
    check(await (await client()).from('finances').upsert(row));
  },
  async savePush(sub) {
    const row = { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth };
    check(await (await client()).from('push_subscriptions').upsert(row, { onConflict: 'endpoint' }));
  },
  async notify(msg) {
    return check(await (await client()).functions.invoke('notify', { body: msg }));
  },
  async saveNotifyPrefs(uid, prefs) {
    check(await (await client()).from('members').update({ notify_prefs: prefs }).eq('user_id', uid));
  },
  /** Fiş fotoğrafı: gizli "receipts" deposuna (yol: <aile>/<dosya>.jpg) */
  async uploadReceipt(path, blob) {
    check(await (await client()).storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg', upsert: true }));
  },
  async receiptUrl(path) {
    return check(await (await client()).storage.from('receipts').createSignedUrl(path, 3600)).signedUrl;
  },
  async removeReceipt(path) {
    check(await (await client()).storage.from('receipts').remove([path]));
  },
};

// --- Deneme modu: her şey bu cihazın localStorage'ında ---

const DEMO_UID = 'demo-user';
const KEY = SHOW ? 'aile-butcesi-show-data' : 'aile-butcesi-demo';
const empty = () => ({ households: [], members: [], finances: [], ...Object.fromEntries(TABLES.map(t => [t, []])) });

function readDb() {
  try { return JSON.parse(localStorage.getItem(KEY)) || empty(); } catch { return empty(); }
}
function writeDb(db, key = KEY) {
  store.set(key, JSON.stringify(db));
}
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
const OWNED = ['installments', 'fixed_payments', 'expenses'];

const demo = {
  async session() { return { user: { id: DEMO_UID, email: 'deneme' } }; },
  async signIn() { return this.session(); },
  async signUp() { return this.session(); },
  async signOut() { localStorage.removeItem(KEY); },
  async rpc(fn, { p_name, p_display_name }) {
    if (fn === 'join_household') throw new Error('Deneme modunda davet koduyla katılınamaz');
    const db = readDb();
    const h = { id: uuid(), name: p_name || 'Örnek Aile', invite_code: 'DENEME', created_at: new Date().toISOString() };
    db.households.push(h);
    db.members.push({ user_id: DEMO_UID, household_id: h.id, display_name: p_display_name, created_at: h.created_at });
    writeDb(db);
    return h;
  },
  async select(table) { return readDb()[table] || []; },
  async insert(table, rows) {
    const db = readDb();
    const added = [].concat(rows).map(r => ({
      id: uuid(),
      created_at: new Date().toISOString(),
      ...(OWNED.includes(table) ? { owner_id: DEMO_UID, payer_id: DEMO_UID, paid_months: [] } : {}),
      ...r,
    }));
    (db[table] ||= []).push(...added);
    writeDb(db);
    return added;
  },
  async update(table, id, patch) {
    const db = readDb();
    db[table] = (db[table] || []).map(r => (r.id === id ? { ...r, ...patch } : r));
    writeDb(db);
  },
  async remove(table, id) {
    const db = readDb();
    db[table] = (db[table] || []).filter(r => r.id !== id);
    writeDb(db);
  },
  async finance() { return readDb().finances[0] || null; },
  async saveFinance(row) {
    const db = readDb();
    db.finances = [{ ...(db.finances?.[0] || {}), ...row }];
    writeDb(db);
  },
  async savePush() {},
  async saveNotifyPrefs(uid, prefs) {
    const db = readDb();
    db.members = db.members.map(m => (m.user_id === uid ? { ...m, notify_prefs: prefs } : m));
    writeDb(db);
  },
  async notify() {},
  // Deneme modunda fiş fotoğrafları bu cihazda (küçültülmüş jpeg)
  async uploadReceipt(path, blob) {
    const url = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    const all = JSON.parse(store.get('aile-butcesi-receipts') || '{}');
    store.set('aile-butcesi-receipts', JSON.stringify({ ...all, [path]: url }));
  },
  async receiptUrl(path) { return JSON.parse(store.get('aile-butcesi-receipts') || '{}')[path] || null; },
  async removeReceipt(path) {
    const all = JSON.parse(store.get('aile-butcesi-receipts') || '{}');
    delete all[path];
    store.set('aile-butcesi-receipts', JSON.stringify(all));
  },
};

export const api = DEMO ? demo : remote;

// --- Örnek veri ve gösterim modu ---

const pad = n => String(n).padStart(2, '0');
function monthKey(offset) {
  const d = new Date();
  const t = d.getFullYear() * 12 + d.getMonth() + offset;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}

/** Tamamen uydurma isim ve tutarlarla dolu bir aile */
function sampleData() {
  const U = DEMO_UID, P = 'demo-partner', H = 'sample-household', now = new Date().toISOString(), m = monthKey(0), prev = monthKey(-1);
  let n = 0;
  const id = () => `s${++n}`;
  const own = { owner_id: U, payer_id: U, household_id: H, created_at: now };
  const his = { owner_id: P, payer_id: P, household_id: H, created_at: now };
  const day = d => `${m}-${pad(Math.min(d, new Date().getDate()))}`;
  const today = day(31);
  const at = (date, hm = '12:00') => new Date(`${date}T${hm}:00+03:00`).toISOString();
  const ids = { netflix: 'f-netflix', spor: 'f-spor', spotify: 'f-spotify' };
  // Banka SMS'lerinden gelmiş gibi hareketler: abonelikler iki ayda tekrar eder, biri bekliyor
  const ev = (kind, amount, merchant, date, extra = {}) => ({
    id: id(), household_id: H, owner_id: U, kind, amount, merchant, occurred_at: at(date, extra.hm || '12:00'),
    msg_id: `m${n}`, subject: null, status: 'added', matched_table: null, matched_id: null, created_at: at(date, extra.hm || '12:00'), ...extra,
  });
  const listed = ['Domates', 'Maydanoz', 'Süt', 'Yumurta', 'Çamaşır deterjanı', 'Tuvalet kağıdı', 'Ekmek', 'Muz'];
  return {
    households: [{ id: H, name: 'Örnek Aile', invite_code: 'ORNEK', created_at: now }],
    members: [
      { user_id: U, household_id: H, display_name: 'Ayşe', created_at: now, notify_prefs: { cut_day: 25, bank_source: 'sms' } },
      { user_id: P, household_id: H, display_name: 'Mehmet', created_at: now, notify_prefs: { cut_day: 20 } },
    ],
    finances: [{
      user_id: U, income: 70000, savings_tl: 45000, usd_amount: 1200, usd_rate: 41.5, eur_amount: 300, gold_grams: 10,
      card_limit: 60000, card_used: 23450, card_debt: 18000, card_used_at: today,
      bank_balance: 49830, bank_balance_at: at(today, '09:00'),
    }],
    card_payments: [{ id: id(), household_id: H, owner_id: U, month: m, amount: 8400, includes_installments: true, created_at: now }],
    settlements: [{ id: id(), household_id: H, month: prev, from_id: P, to_id: U, amount: 6150, sent_at: at(`${m}-05`), sent_by: P, received_at: at(`${m}-05`, '18:00'), received_by: U, log: [], created_at: now }],
    goals: [
      { id: id(), household_id: H, owner_id: U, name: 'Tatil fonu', target: 30000, saved: 12500, shared: true, created_at: now },
      { id: id(), household_id: H, owner_id: P, name: 'Yeni koltuk', target: 18000, saved: 15200, shared: true, created_at: now },
      { id: id(), household_id: H, owner_id: U, name: 'Yeni telefon', target: 25000, saved: 8000, shared: false, created_at: now },
    ],
    shopping_trips: [
      { id: id(), household_id: H, owner_id: U, date: day(20), total: 2340, items: ['Domates', 'Peynir', 'Zeytin', 'Makarna', 'Deterjan'], created_at: at(day(20)) },
      { id: id(), household_id: H, owner_id: P, date: `${prev}-24`, total: 1875.5, items: ['Süt', 'Ekmek', 'Yumurta', 'Elma'], created_at: at(`${prev}-24`) },
    ],
    bank_events: [
      ev('card', 229.99, 'NETFLIX.COM', `${prev}-12`, { status: 'matched', matched_table: 'fixed_payments', matched_id: ids.netflix }),
      ev('card', 229.99, 'NETFLIX.COM', day(12), { status: 'matched', matched_table: 'fixed_payments', matched_id: ids.netflix }),
      ev('card', 1200, 'MACFIT ISTANBUL', `${prev}-03`, { status: 'matched', matched_table: 'fixed_payments', matched_id: ids.spor }),
      ev('card', 1350, 'MACFIT ISTANBUL', day(3), { status: 'matched', matched_table: 'fixed_payments', matched_id: ids.spor }),
      ev('card', 79.99, 'SPOTIFY P1234', day(8), { status: 'matched', matched_table: 'fixed_payments', matched_id: ids.spotify }),
      ev('card', 59.99, 'YOUTUBE PREMIUM', day(9), { status: 'ignored' }),
      ev('card', 1500, 'SHELL ATASEHIR', day(14)),
      ev('out', 6150, 'Mehmet', `${m}-05`, { kind: 'in', status: 'matched', matched_table: 'settlements' }),
      ev('balance', 49830, null, today, { hm: '09:00' }),
      ev('card', 845.5, 'MIGROS ATASEHIR', today, { hm: '13:40', status: 'pending' }),
    ],
    installments: [
      { id: id(), ...own, name: 'Telefon', monthly_amount: 2250, first_month: `${monthKey(-2)}-01`, last_month: `${monthKey(9)}-01`, shared: false, split: 'half', paid_months: [`${m}:${U}`] },
      { id: id(), ...his, name: 'Koltuk takımı', monthly_amount: 2400, first_month: `${monthKey(-3)}-01`, last_month: `${monthKey(2)}-01`, shared: true, split: 'half', paid_months: [] },
      { id: id(), ...own, name: 'Bulaşık makinesi', monthly_amount: 1800, first_month: `${monthKey(-1)}-01`, last_month: `${monthKey(4)}-01`, shared: true, split: 'half', paid_months: [] },
      { id: id(), ...own, name: 'Laptop', monthly_amount: 3100, first_month: `${monthKey(-4)}-01`, last_month: `${monthKey(7)}-01`, shared: false, split: 'half', paid_months: [] },
    ],
    fixed_payments: [
      { id: id(), ...own, name: 'Kira', amount: 18000, shared: true, split: 'half', paid_months: [`${m}:${U}`] },
      { id: id(), ...own, name: 'Elektrik', amount: 900, shared: true, split: 'half', paid_months: [] },
      { id: id(), ...own, name: 'İnternet', amount: 450, shared: false, split: 'half', paid_months: [`${m}:${U}`] },
      { id: ids.spor, ...own, name: 'Spor salonu', amount: 1200, shared: false, split: 'half', on_card: true, paid_months: [`${m}:${U}`] },
      { id: ids.netflix, ...own, name: 'Netflix', amount: 229.99, shared: false, split: 'half', on_card: true, paid_months: [`${m}:${U}`] },
      { id: ids.spotify, ...own, name: 'Spotify', amount: 79.99, shared: false, split: 'half', on_card: true, paid_months: [`${m}:${U}`] },
      { id: id(), ...own, name: 'Telefon faturası', amount: 650, shared: false, split: 'half', on_card: true, paid_months: [] },
      { id: id(), ...his, name: 'Su faturası', amount: 600, shared: true, split: 'half', paid_months: [`${m}:${P}`] },
    ],
    expenses: [
      { id: id(), ...own, name: 'Market', amount: 2340, date: day(20), shared: true, split: 'half', paid_months: [`${m}:${U}`] },
      { id: id(), ...own, name: 'Benzin', amount: 1500, date: day(14), shared: false, split: 'half', on_card: true, paid_months: [`${m}:${U}`] },
      { id: id(), ...his, name: 'Restoran', amount: 1640, date: day(18), shared: true, split: 'half', paid_months: [`${m}:${P}`] },
      { id: id(), ...own, name: 'Kahve', amount: 180, date: day(22), shared: false, split: 'half', paid_months: [`${m}:${U}`] },
    ],
    shopping_items: Object.entries(DEFAULT_SHOPPING).flatMap(([category, names]) => names.map(name => ({
      id: id(), household_id: H, name, category, in_list: listed.includes(name), checked: ['Süt', 'Ekmek'].includes(name), created_at: now,
    }))),
    wishlist: [
      { id: id(), household_id: H, name: 'Kitaplık', price: 6500, target_month: `${monthKey(2)}-01`, note: 'Beyaz, 5 raflı', bought: false, created_at: now },
      { id: id(), household_id: H, name: 'Halı', price: 9000, target_month: `${monthKey(3)}-01`, note: null, bought: false, created_at: now },
      { id: id(), household_id: H, name: 'Kahve makinesi', price: 4200, target_month: null, note: null, bought: false, created_at: now },
    ],
  };
}

/** Deneme modunda örnek verileri yükler */
export function loadSample() {
  writeDb(sampleData());
}

/** Gerçek verileri gizleyip örnek verilere geçer */
export async function enterShowMode() {
  const s = await remote.session();
  store.set(SHOW_EMAIL, s.user.email);
  writeDb(sampleData(), 'aile-butcesi-show-data');
  store.set(SHOW_FLAG, '1');
}

/** Gerçek verilere dönmek için hesabın şifresi gerekir */
export async function exitShowMode(password) {
  await remote.signIn(store.get(SHOW_EMAIL), password);
  store.del(SHOW_FLAG);
  store.del(SHOW_EMAIL);
  store.del('aile-butcesi-show-data');
}

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
export const TABLES = ['installments', 'fixed_payments', 'expenses', 'shopping_items', 'wishlist', 'card_payments', 'settlements', 'goals', 'carryovers'];

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
    db.finances = [row];
    writeDb(db);
  },
  async savePush() {},
  async saveNotifyPrefs(uid, prefs) {
    const db = readDb();
    db.members = db.members.map(m => (m.user_id === uid ? { ...m, notify_prefs: prefs } : m));
    writeDb(db);
  },
  async notify() {},
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
  const U = DEMO_UID, H = 'sample-household', now = new Date().toISOString(), m = monthKey(0);
  let n = 0;
  const id = () => `s${++n}`;
  const own = { owner_id: U, payer_id: U, household_id: H, created_at: now };
  const day = d => `${m}-${pad(Math.min(d, new Date().getDate()))}`;
  const listed = ['Domates', 'Maydanoz', 'Süt', 'Yumurta', 'Çamaşır deterjanı', 'Tuvalet kağıdı', 'Ekmek', 'Muz'];
  return {
    households: [{ id: H, name: 'Örnek Aile', invite_code: 'ORNEK', created_at: now }],
    members: [{ user_id: U, household_id: H, display_name: 'Ayşe', created_at: now }],
    finances: [{ user_id: U, income: 70000, savings_tl: 45000, usd_amount: 1200, usd_rate: 41.5, eur_amount: 300, gold_grams: 10 }],
    card_payments: [{ id: id(), household_id: H, owner_id: U, month: m, amount: 8400, includes_installments: true, created_at: now }],
    settlements: [],
    installments: [
      { id: id(), ...own, name: 'Telefon', monthly_amount: 2250, first_month: `${monthKey(-2)}-01`, last_month: `${monthKey(9)}-01`, shared: false, split: 'half', paid_months: [`${m}:${U}`] },
      { id: id(), ...own, name: 'Bulaşık makinesi', monthly_amount: 1800, first_month: `${monthKey(-1)}-01`, last_month: `${monthKey(4)}-01`, shared: true, split: 'half', paid_months: [] },
      { id: id(), ...own, name: 'Laptop', monthly_amount: 3100, first_month: `${monthKey(-4)}-01`, last_month: `${monthKey(7)}-01`, shared: false, split: 'half', paid_months: [] },
    ],
    fixed_payments: [
      { id: id(), ...own, name: 'Kira', amount: 18000, shared: true, split: 'half', paid_months: [`${m}:${U}`] },
      { id: id(), ...own, name: 'Elektrik', amount: 900, shared: true, split: 'half', paid_months: [] },
      { id: id(), ...own, name: 'İnternet', amount: 450, shared: false, split: 'half', paid_months: [`${m}:${U}`] },
      { id: id(), ...own, name: 'Spor salonu', amount: 1200, shared: false, split: 'half', paid_months: [] },
    ],
    expenses: [
      { id: id(), ...own, name: 'Market', amount: 2340, date: day(20), shared: true, split: 'half', paid_months: [`${m}:${U}`] },
      { id: id(), ...own, name: 'Benzin', amount: 1500, date: day(14), shared: false, split: 'half', paid_months: [`${m}:${U}`] },
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

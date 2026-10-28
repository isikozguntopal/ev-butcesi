import { html, render, useState, useEffect, useRef } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import { api, DEMO, SHOW, TABLES, enterShowMode, exitShowMode, loadSample } from './data.js';
import { DEFAULT_SHOPPING, CATEGORIES } from './defaults.js';
import { Buddy, Walker, Party, celebrate, dailyFace, faceFor } from './animals.js';
import { VAPID_PUBLIC_KEY, APP_NAME, SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// ---------- Yardımcılar ----------

const tlFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const usdFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const tlFmt2 = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Tam sayıysa kuruşsuz (₺1.200), değilse iki hane (₺245,90) */
const tl = v => { const n = Number(v) || 0; return (Math.round(n * 100) % 100 ? tlFmt2 : tlFmt).format(n); };
/** Ekranın sol kenarından başlayan dokunuş: geri gitme hareketi için ayrılır */
const EDGE_PX = 24;
/** Bakiye satırı: 0 ise işaretsiz, değilse + (yeşil) ya da − (kırmızı) */
const signed = (v, plus = Number(v) > 0) => {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  if (!n) return { text: tl(0), tone: '' };
  return plus ? { text: `+ ${tl(Math.abs(n))}`, tone: 'pos' } : { text: `− ${tl(Math.abs(n))}`, tone: 'neg' };
};
const usd = v => usdFmt.format(Number(v) || 0);
const eurFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const eur = v => eurFmt.format(Number(v) || 0);

/** "1.250,50", "1250,5", "4.900" (binlik), "₺2.500 TL" ve "1250.5" girişlerini okur */
function parseAmount(s) {
  let t = String(s || '').replace(/[^\d.,]/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return isNaN(n) ? 0 : n;
}
const plain = v => (Number(v) ? Number(v).toLocaleString('tr-TR', { useGrouping: false, maximumFractionDigits: 2 }) : '');

const CATS = ['Market', 'Yeme-içme', 'Ulaşım', 'Ev ve faturalar', 'Kira', 'Giyim', 'Sağlık', 'Eğlence', 'Eğitim', 'Teknoloji', 'Diğer'];
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const pad = n => String(n).padStart(2, '0');
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const today = () => { const d = new Date(); return `${thisMonth()}-${pad(d.getDate())}`; };
const mk = d => (d ? String(d).slice(0, 7) : null);
function addM(k, n) {
  const [y, m] = k.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
}
function diffM(a, b) {
  const [y1, m1] = a.split('-').map(Number);
  const [y2, m2] = b.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}
const monthName = k => { const [y, m] = k.split('-').map(Number); return `${AYLAR[m - 1]} ${y}`; };
const shortMonth = k => { const [y, m] = k.split('-').map(Number); return k.slice(0, 4) === thisMonth().slice(0, 4) ? AYLAR[m - 1] : `${AYLAR[m - 1]} ${y}`; };

/** Giriş yapan kişi; tikler kişiye özel tutulur ("YYYY-MM:kullanıcı") */
let ME = null;
const paidKey = (m, who) => `${m}:${who}`;
/** Harcamanın ödeneceği ay (hesaplaşma bu aya göre); ödeme tarihi yoksa harcama tarihi */
const payMonth = e => mk(e.pay_date || e.date);
/** Kartı ödeyenin hesap kesim günü (Ayarlar > Kredi kartı). Kişinin kendi girdiği esas; girmediyse eşinin onun için girdiği. */
const cutDayOf = (members, uid) => {
  const own = Number((members || []).find(m => m.user_id === uid)?.notify_prefs?.cut_day);
  if (own) return own;
  for (const m of members || []) { const v = Number(m.notify_prefs?.cut_days?.[uid]); if (v) return v; }
  return null;
};
/** Hesaplaşma günü: kart ekstresinin ödendiği ayın 5'i. Kesim gününden sonraki harcama bir sonraki ekstreye girer
 *  (kesim 25: 20 Ekim → 5 Kasım, 28 Ekim → 5 Aralık). Kesim günü bilinmiyorsa harcamadan sonraki ayın 5'i. */
const settleDay = (date, cut) => `${addM(mk(date), cut && Number(String(date).slice(8, 10)) > cut ? 2 : 1)}-05`;
/** O ay bu kişi ödedi mi? (Eski, kişisiz "YYYY-MM" tikleri de sayılır) */
const isPaid = (item, m, who = ME) => {
  const p = item.paid_months || [];
  return p.includes(paidKey(m, who)) || p.includes(m);
};

const inst = {
  first: i => mk(i.first_month),
  last: i => mk(i.last_month),
  total: i => diffM(mk(i.first_month), mk(i.last_month)) + 1,
  active: (i, m) => m >= mk(i.first_month) && m <= mk(i.last_month),
  /** Bu ay dahil (ödenmediyse) kalan taksit sayısı */
  remaining(i, m) {
    const f = mk(i.first_month), l = mk(i.last_month);
    if (m > l) return 0;
    if (m < f) return inst.total(i);
    return diffM(m, l) + 1 - (isPaid(i, m) ? 1 : 0);
  },
};

/** Ortak kayıtta bana düşen pay */
function share(item, amount, uid) {
  if (!item.shared) return amount;
  if (item.split === 'half') return amount / 2;
  return item.payer_id === uid ? amount : 0;
}

function sharedLabel(item, ctx) {
  if (!item.shared) return null;
  const payer = item.payer_id === ctx.uid ? 'senin kartın' : `${ctx.names[item.payer_id] || 'eşin'} kartı`;
  if (item.split === 'half') return `Ortak · yarı yarıya · ${payer}`;
  return `Ortak · tamamı ${payer}`;
}

const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

/** O ay için kendi kredi kartı ödeme kaydım */
const cardFor = (rows, uid, m) => rows.card_payments.find(c => c.owner_id === uid && c.month === m);
/** O aya devredilen nakit bakiye (manuel karar; 0 = devretme) */
const carryFor = (rows, uid, m) => (rows.carryovers || []).find(c => c.owner_id === uid && c.month === m);
/** Bir ayın nakit bakiyesi (devir dahil). Ekim 2026 öncesi veriler güvenilir değil, hesaba katılmaz. */
function nakitLeftFor(rows, uid, m, income, members) {
  return nakitBreakdown(rows, uid, m, income, members).left;
}
/** O ay kart ödemesi girildiyse, benim kartımdan ödenen taksit ödemenin içindedir; ayrıca sayılmaz.
 *  Eşin kartındaki taksitler sayılmaya devam eder (payı ayın 5'inde eşe gönderilir). */
/** Kayıt kartla mı ödeniyor? Taksitlerde varsayılan kart, harcama ve "her ay"da varsayılan nakit. */
const onCardItem = (it, table = 'installments') => (table === 'installments' ? it.on_card !== false : it.on_card === true);
const coveredByCard = (it, uid, card, table = 'installments') => it.payer_id === uid && onCardItem(it, table);
/** O ay kart ödememe dahil olan kayıtlar (kendi kartım) */
function cardItems(rows, uid, m) {
  return [
    ...rows.installments.filter(i => inst.active(i, m) && i.payer_id === uid && onCardItem(i, 'installments')).map(it => ({ it, table: 'installments', kind: 'Taksit', amount: Number(it.monthly_amount) })),
    ...rows.fixed_payments.filter(f => f.payer_id === uid && onCardItem(f, 'fixed_payments')).map(it => ({ it, table: 'fixed_payments', kind: 'Her ay', amount: Number(it.amount) })),
    ...rows.expenses.filter(e => mk(e.date) === m && e.payer_id === uid && onCardItem(e, 'expenses')).map(it => ({ it, table: 'expenses', kind: 'Harcama', amount: Number(it.amount) })),
  ];
}

/** Ortak "yarı yarıya" kalemlerden m ayı için kimin kime ne kadar göndereceği (mahsuplaşmış).
 *  Kartı kim ödediyse diğeri yarısını borçlanır. */
function settlementFor(rows, members, m) {
  if (members.length < 2) return null;
  const [A, B] = members.map(x => x.user_id);
  const owe = { [A]: 0, [B]: 0 };
  const lines = [];
  const sentDirect = [];
  const settled = (rows.settlements || []).some(x => x.month === m && (x.sent_at || x.received_at));
  const add = (it, amount, kind, when) => {
    if (!it.shared || it.split !== 'half' || !(it.payer_id in owe) || !amount) return;
    // Borçlu ortak harcamayı ay içinde "gönderdim" diye tiklediyse ayın 5'ine girmez.
    // ":sent" açık işarettir; işaretsiz eski tikler, o ayın hesaplaşması henüz işaretlenmediyse gönderilmiş sayılır.
    if (kind === 'Harcama') {
      const debtorKey = paidKey(mk(it.date), it.payer_id === A ? B : A);
      const p = it.paid_months || [];
      const legacy = p.includes(debtorKey) && !p.includes(`${debtorKey}:settled`) && !settled;
      if (p.includes(`${debtorKey}:sent`) || legacy) {
        sentDirect.push({ id: it.id, name: it.name, amount, debt: amount / 2, payer: it.payer_id, when });
        return;
      }
    }
    const full = false;
    const debt = amount / 2;
    owe[it.payer_id === A ? B : A] += debt;
    lines.push({ id: it.id, name: it.name, kind, table: KIND_TABLE[{ Harcama: 'expense', Taksit: 'installment', 'Her ay': 'fixed' }[kind]], amount, debt, full, payer: it.payer_id, when });
  };
  rows.expenses.filter(e => payMonth(e) === m)
    .forEach(e => add(e, Number(e.amount), 'Harcama', `${Number(e.date.slice(8, 10))} ${AYLAR[Number(e.date.slice(5, 7)) - 1]}`));
  rows.installments.filter(i => inst.active(i, m))
    .forEach(i => add(i, Number(i.monthly_amount), 'Taksit', `${diffM(inst.first(i), m) + 1}/${inst.total(i)}. taksit`));
  rows.fixed_payments.forEach(f => add(f, Number(f.amount), 'Her ay', 'her ay tekrar eder'));
  const net = owe[A] - owe[B];
  return { lines, sentDirect, owe, A, B, from: net > 0 ? A : B, to: net > 0 ? B : A, amount: Math.round(Math.abs(net) * 100) / 100 };
}
const pick = a => a[Math.floor(Math.random() * a.length)];

/** Hesaplaşmada açılacak ay: bir ayın hesaplaşması o ayın 5'inde yapılır.
 *  Gönderildi/alındı işaretlenmiş en son hesaplaşmanın sonraki ayı; hiç yoksa bu ay. */
function defaultSettleMonth(rows) {
  const done = (rows.settlements || []).filter(x => x.sent_at || x.received_at).map(x => x.month).sort();
  return done.length ? addM(done[done.length - 1], 1) : thisMonth();
}

// ---------- Ortak bileşenler ----------

// Açık pencere varken arkadaki sayfa kaymasın (iPhone'da body'yi sabitleyerek)
let sheetLocks = 0;
let lockedY = 0;
function lockScroll() {
  if (sheetLocks++ > 0) return;
  lockedY = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${lockedY}px`, left: '0', right: '0', overflow: 'hidden' });
}
function unlockScroll() {
  if (--sheetLocks > 0) return;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', overflow: '' });
  window.scrollTo(0, lockedY);
}

function Sheet({ title, onClose, right, children, full }) {
  useEffect(() => { lockScroll(); return unlockScroll; }, []);
  return html`
    <div class=${'backdrop' + (full ? ' full' : '')} onClick=${onClose}>
      <div class=${'sheet' + (full ? ' full' : '')} onClick=${e => e.stopPropagation()}>
        <div class="sheet-head">
          <button class="link" onClick=${onClose}>${full ? '‹ Geri' : 'Vazgeç'}</button>
          <b>${title}</b>
          ${right || html`<span class="spacer"></span>`}
        </div>
        <div class="sheet-body">${children}</div>
      </div>
    </div>`;
}

function MoneyInput({ value, onInput, suffix = '₺', placeholder = '0' }) {
  const [text, setText] = useState(plain(value));
  useEffect(() => { if (parseAmount(text) !== Number(value || 0)) setText(plain(value)); }, [value]);
  const update = e => { setText(e.target.value); onInput(parseAmount(e.target.value)); };
  return html`
    <span class="money">
      <input inputmode="decimal" placeholder=${placeholder} value=${text} data-amount
        onInput=${update} onChange=${update} onBlur=${update} />
      <span class="muted">${suffix}</span>
    </span>`;
}

const Seg = ({ value, options, onChange }) => html`
  <div class="seg">
    ${options.map(([v, label]) => html`<button type="button" class=${v === value ? 'on' : ''} onClick=${() => onChange(v)}>${label}</button>`)}
  </div>`;

const Group = ({ title, total, children, action }) => html`
  <div class="group">
    <div class="group-head">
      <span>${title}</span>
      ${action || (total != null && html`<span>${tl(total)}</span>`)}
    </div>
    <div class="card">${children}</div>
  </div>`;

/** Başlığına dokununca açılıp kapanan grup; durumu cihazda hatırlanır */
function FoldGroup({ id, title, count, total, children }) {
  const key = `tf-fold-${id}`;
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== '0'; } catch { return true; } });
  const toggle = () => {
    setOpen(!open);
    try { localStorage.setItem(key, open ? '0' : '1'); } catch { /* yok say */ }
  };
  return html`
    <div class="group">
      <button class="group-head fold" onClick=${toggle} aria-expanded=${open}>
        <span><span class=${'chev' + (open ? ' open' : '')}>›</span>${title}${count != null ? ` (${count})` : ''}</span>
        ${total != null && html`<span>${tl(total)}</span>`}
      </button>
      ${open && html`<div class="card">${children}</div>`}
    </div>`;
}

const Empty = ({ children }) => html`<div class="empty"><span class="mini">${faceFor(children)}</span>${children}</div>`;

function PayRow({ title, sub, amount, full, paid, onToggle, onOpen }) {
  return html`
    <div class="item">
      ${onToggle
        ? html`<button class=${'check' + (paid ? ' on' : '')} onClick=${onToggle} aria-label="Ödendi">${paid ? '✓' : ''}</button>`
        : html`<span class="bullet"></span>`}
      <div class="grow" onClick=${onOpen}>
        <div class=${'title' + (paid ? ' done' : '')}>${title}</div>
        ${sub && html`<div class="sub">${sub}</div>`}
      </div>
      <div class="amt" onClick=${onOpen}>
        <div class=${paid ? 'done' : ''}>${tl(amount)}</div>
        ${full != null && full !== amount && html`<div class="sub">toplam ${tl(full)}</div>`}
      </div>
    </div>`;
}

// ---------- Ekle / düzenle formu (harcama, taksit, aylık ödeme) ----------

const KIND_TABLE = { expense: 'expenses', installment: 'installments', fixed: 'fixed_payments' };

function ItemForm({ ctx, kind: initialKind, item, preset, month, onClose, onSaved }) {
  const { uid, members, actions } = ctx;
  const src = item || preset || {};
  const base = month || thisMonth();
  const [kind, setKind] = useState(initialKind);
  const [name, setName] = useState(src.name || '');
  const [amount, setAmount] = useState(Math.abs(Number(src.monthly_amount ?? src.amount ?? 0)));
  const [date, setDate] = useState(src.date || (base === thisMonth() ? today() : `${base}-01`));
  const [first, setFirst] = useState(mk(src.first_month) || base);
  const [last, setLast] = useState(mk(src.last_month) || addM(base, 2));
  const [shared, setShared] = useState(!!src.shared);
  const [split, setSplit] = useState(src.split || 'half');
  const [payer, setPayer] = useState(src.payer_id || uid);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [methodPick, setMethod] = useState(null);
  const [category, setCategory] = useState(src.category || 'Diğer');
  const [payPick, setPayPick] = useState(null);
  const formRef = useRef(null);
  const partnerId = members.find(x => x.user_id !== uid)?.user_id;

  // Son taksit ilk taksitten önceye düşerse (ör. Ocak seçilip yıl değişmemişse) bir sonraki yıla al
  const pickLast = e => {
    let v = e.target.value || last;
    while (v < first && diffM(v, first) < 24) v = addM(v, 12);
    setLast(v);
    setErr('');
  };
  const count = diffM(first, last) + 1;
  const left = last < thisMonth() ? 0 : diffM(first > thisMonth() ? first : thisMonth(), last) + 1;
  const table = KIND_TABLE[kind];
  // Ödeme şekli: kart (kart ödemesine dahil) / nakit / henüz ödenmedi (sadece harcama)
  const initialMethod = item
    ? (onCardItem(item, table) ? 'card' : kind === 'expense' && !isPaid(item, mk(item.date)) ? 'unpaid' : 'cash')
    : kind === 'fixed' || src.on_card === false ? 'cash' : 'card';
  let method = methodPick || initialMethod;
  if (method === 'unpaid' && kind !== 'expense') method = 'cash';
  const showMethod = !shared || payer === uid;
  // Ortak yarı yarıya harcamada payın ne zaman ödeneceği: hesaplaşma günü (sonraki ayın 5'i) ya da harcama günü (doğrudan)
  const showPay = kind === 'expense' && shared && split === 'half' && !!partnerId;
  const debtor = payer === uid ? partnerId : uid;
  const sentKey = `${paidKey(mk(date), debtor)}:sent`;
  const cut = cutDayOf(members, payer);
  const payDay = settleDay(date, cut);
  const initialPay = item
    ? (item.pay_date ? (item.pay_date === item.date ? 'now' : 'settle') : (item.paid_months || []).includes(sentKey) ? 'now' : 'legacy')
    : payer === uid && method !== 'card' ? 'now' : 'settle';
  const payMode = payPick || initialPay;

  async function save() {
    if (busy) return;
    // iPhone'da bazı girişler state'e geç düşebiliyor; son hali ekrandan oku
    const el = formRef.current;
    const nm = (el?.querySelector('[data-name]')?.value ?? name).trim();
    const amt = parseAmount(el?.querySelector('[data-amount]')?.value ?? '') || amount;
    if (!nm) return setErr('Ne aldığını yaz');
    if (!(amt > 0)) return setErr(kind === 'installment' ? 'Aylık taksit tutarını yaz' : 'Tutarı yaz');
    if (kind === 'installment' && count < 1) return setErr('Son taksit, ilk taksitten önce olamaz');
    setErr('');
    setBusy(true);
    // Eksi tutarlı düzeltmeler (bakiye eşitleme) düzenlenirken işaret korunur
    const amount_ = item && Number(item.amount ?? item.monthly_amount) < 0 ? -amt : amt;
    const row = { name: nm, shared, split: shared ? split : 'half', payer_id: shared ? payer : uid, category };
    if (kind === 'expense') Object.assign(row, { amount: amount_, date });
    if (kind === 'fixed') Object.assign(row, { amount: amount_ });
    if (kind === 'installment') Object.assign(row, { monthly_amount: amount_, first_month: `${first}-01`, last_month: `${last}-01` });
    row.on_card = showMethod && method === 'card';
    if (kind === 'expense' && !item) row.paid_months = showMethod && method === 'cash' ? [paidKey(mk(date), uid)] : [];
    if (kind === 'expense' && !showPay) row.pay_date = null;
    if (showPay && payMode !== 'legacy') {
      row.pay_date = payMode === 'settle' ? payDay : date;
      // Doğrudan ödenen payı "gönderildi" işaretle; hesaplaşmaya alınırsa işaret kalkar (hesaplaşmada kapandıysa dokunma)
      const k = paidKey(mk(date), debtor);
      const p = row.paid_months || item?.paid_months || [];
      if (!p.includes(`${k}:settled`)) {
        const rest = p.filter(x => x !== k && x !== `${k}:sent`);
        row.paid_months = payMode === 'now' ? [...rest, k, `${k}:sent`] : rest;
      }
    }
    const ok = item ? await actions.patch(table, item.id, row) : await actions.add(table, row);
    if (ok !== false) {
      if (onSaved) await onSaved();
      onClose();
    }
    setBusy(false);
  }

  async function remove() {
    if (!confirm(`"${item.name}" silinsin mi?`)) return;
    await actions.del(table, item.id);
    onClose();
  }

  const titles = { expense: 'Harcama', installment: 'Taksit', fixed: 'Aylık Ödeme' };
  return html`
    <${Sheet} title=${(item ? '' : 'Yeni ') + titles[kind]} onClose=${onClose}
      right=${html`<button class="link strong" disabled=${busy} onClick=${save}>Kaydet</button>`}>
      ${err && html`<p class="error">${err}</p>`}
      ${!item && html`<${Seg} value=${kind} onChange=${setKind}
        options=${[['expense', 'Peşin'], ['installment', 'Taksitli'], ['fixed', 'Her ay']]} />`}
      <div class="card form" ref=${formRef}>
        <label class="field"><input data-name placeholder=${kind === 'fixed' ? 'Ne için? (ör. Kira)' : 'Ne aldın?'} value=${name}
          onInput=${e => { setName(e.target.value); setErr(''); }} onChange=${e => setName(e.target.value)} /></label>
        <label class="field"><span>${kind === 'installment' ? 'Aylık taksit' : 'Tutar'}</span><${MoneyInput} value=${amount} onInput=${v => { setAmount(v); setErr(''); }} /></label>
        <label class="field"><span>Kategori</span><select value=${category} onChange=${e => setCategory(e.target.value)}>${CATS.map(c => html`<option value=${c}>${c}</option>`)}</select></label>
        ${kind === 'expense' && html`
          <label class="field"><span>Harcama tarihi<small>Alışverişi yaptığın gün. Hangi aya yazılacağını bu belirler.</small></span><input type="date" value=${date} onInput=${e => setDate(e.target.value || date)} onChange=${e => setDate(e.target.value || date)} /></label>`}
        ${kind === 'installment' && html`
          <label class="field"><span>İlk taksit</span><input type="month" value=${first} onInput=${e => setFirst(e.target.value || first)} onChange=${e => setFirst(e.target.value || first)} /></label>
          <label class="field"><span>Son taksit</span><input type="month" value=${last} onInput=${pickLast} onChange=${pickLast} /></label>`}
      </div>
      ${showMethod && html`
        <div class="field col method">
          <span>${kind === 'expense' ? 'Parayı şimdi ödediniz mi?' : 'Nasıl ödeniyor?'}</span>
          ${kind === 'expense' && html`
            <${Seg} value=${method === 'unpaid' ? 'no' : 'yes'}
              onChange=${v => { setMethod(v === 'no' ? 'unpaid' : (method === 'unpaid' ? 'cash' : method)); setErr(''); }}
              options=${[['yes', 'Evet, ödedim'], ['no', 'Henüz değil']]} />`}
          ${method !== 'unpaid' && html`
            <${Seg} value=${method} onChange=${v => { setMethod(v); setErr(''); }}
              options=${[['card', '💳 Kredi kartıyla'], ['cash', kind === 'expense' ? '💵 Nakit / havale' : '💵 Nakit / havale']]} />`}
          <small class="muted">${{
            card: 'Bakiyenden hemen düşer. Ay başında kart ödemesini girince kart ödemesinin içine geçer ve otomatik ödendi olur.',
            cash: kind === 'expense' ? 'Bakiyenden hemen düşer ve ödendi olarak işaretlenir.' : 'Her ay bakiyenden düşer; ödediğinde tikini sen atarsın.',
            unpaid: 'Bakiyenden düşer ama "henüz ödenmedi" olarak kalır. Ödediğinde tikle.',
          }[method]}</small>
        </div>`}
      ${kind === 'installment' && html`
        <p class="hint">${count < 1 ? 'Son taksit, ilk taksitten önce olamaz.'
          : `${count} taksit · toplam ${tl(amount * count)}${left !== count ? ` · bu ay dahil ${left} kaldı` : ''}`}</p>`}

      <div class="card form">
        <label class="field toggle">
          <span>Ortak alım<small>İkinizin ekranında da görünür</small></span>
          <input type="checkbox" checked=${shared} onChange=${e => setShared(e.target.checked)} />
        </label>
        ${shared && html`
          <label class="field"><span>Kimin kartı?</span>
            <select value=${payer} onChange=${e => setPayer(e.target.value)}>
              ${members.map(m => html`<option value=${m.user_id}>${m.user_id === uid ? `${m.display_name} (sen)` : m.display_name}</option>`)}
            </select>
          </label>
          <div class="field col">
            <span>Bütçelere nasıl yansısın?</span>
            <${Seg} value=${split} onChange=${setSplit} options=${[['half', 'Yarı yarıya'], ['payer', 'Tamamı kart sahibine']]} />
          </div>`}
        ${showPay && html`
          <div class="field col">
            <span>${payer === uid ? 'Eşinin payı ne zaman ödenecek?' : 'Payını ne zaman ödeyeceksin?'}</span>
            <${Seg} value=${payMode === 'legacy' ? '' : payMode} onChange=${v => { setPayPick(v); setErr(''); }}
              options=${[['settle', `Hesaplaşmada · ${fmtDate(payDay)}`], ['now', 'Harcama günü']]} />
            <small class="muted">${{
              settle: `Ödeme tarihi ${fmtDate(payDay)}: ${monthName(mk(payDay))} hesaplaşmasına girer, o ayın nakdinden düşer.${cut ? ` Kartın hesap kesim günü ${cut}; ${cut}'inden sonraki harcamalar bir sonraki ekstreye girer.` : ' Kartın hesap kesim günü girilmemiş (Ben > Ayarlar > Kredi kartı).'}`,
              now: 'Pay aynı gün gönderilir: hesaplaşmaya girmez, harcama ayının nakdinden düşer.',
              legacy: `Şu an ${monthName(mk(date))} hesaplaşmasında. Değiştirmek için birini seç.`,
            }[payMode]}</small>
          </div>`}
      </div>
      ${item && item.owner_id === uid && html`<button class="danger" onClick=${remove}>Sil</button>`}
    <//>`;
}

// ---------- Bu Ay ----------

/** Bir kaydın o ay için ödendi tikini açar/kapatır (eşin kartındaki ortak harcamada tik = payımı gönderdim) */
function makeToggle(ctx, m) {
  const { uid, actions } = ctx;
  return (table, it) => {
    const p = it.paid_months || [];
    const key = paidKey(m, uid);
    const was = isPaid(it, m);
    if (was && (it.paid_months || []).includes(`${key}:settled`)) {
      alert('Bu ödeme hesaplaşmada gönderildi, işareti kaldırılamaz.');
      return;
    }
    // Eşin kartından ödenen ortak harcamada tik = payımı ona gönderdim (ayın 5'ine girmez)
    if (!was && table === 'expenses' && it.shared && it.split === 'half' && it.payer_id !== uid) {
      const payerName = ctx.names[it.payer_id] || 'eşin';
      if (!confirm(`"${it.name}" harcamasında payın ${tl(Number(it.amount) / 2)}. Kartı ödeyen: ${payerName}.\n\nBu parayı gönderdin mi?\n\nTamam: gönderdim, hesaplaşmaya eklenmez.\nVazgeç: tiklenmez, hesaplaşmada kalır.`)) return;
    }
    if (!was) celebrate(pick(['Ödendi!', 'Bir tane daha bitti!', 'Aferin bize!', 'Tıkır tıkır!']));
    const partnerPaid = table === 'expenses' && it.shared && it.split === 'half' && it.payer_id !== uid;
    const sentToPartner = !was && partnerPaid;
    actions.patch(table, it.id, {
      paid_months: was
        ? p.filter(x => ![key, m, `${key}:settled`, `${key}:sent`].includes(x))
        : [...p, key, ...(sentToPartner ? [`${key}:sent`] : [])],
      // Gönderdim: ödeme günü harcama günü olur; geri alınırsa hesaplaşma gününe döner
      ...(partnerPaid ? { pay_date: was ? settleDay(it.date, cutDayOf(ctx.members, it.payer_id)) : it.date } : {}),
    });
  };
}

function MonthScreen({ ctx }) {
  const { rows, uid, actions, fin } = ctx;
  const [m, setM] = useState(thisMonth());
  const [form, setForm] = useState(null);


  const card = cardFor(rows, uid, m);
  const cardAmt = card ? Number(card.amount) || 0 : 0;
  const [cardOpen, setCardOpen] = useState(false);
  const [balOpen, setBalOpen] = useState(false);
  const [taksitOpen, setTaksitOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [page, setPage] = useState(0);
  const touchX = useRef(null);
  const onTouchStart = e => { touchX.current = e.touches[0].clientX < EDGE_PX ? null : e.touches[0].clientX; };
  const onTouchEnd = e => {
    if (touchX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    touchX.current = null;
    if (dx < -50) setPage(1);
    if (dx > 50) setPage(0);
  };
  // Kart harcaması: kartta bu ay yapılan tüm harcamalar (tam tutar). Nakit bakiyeden düşmez; kart ödemesiyle borçtan düşer.
  const cardSpend = sumBy(cardItems(rows, uid, m), x => x.amount);
  const [limitOpen, setLimitOpen] = useState(false);
  const cardLimit = Number(fin.card_limit) || 0;
  // Kullanılan limit: bankadan girilen tutar + bilgi tarihinden sonra girilen kart harcamaları − bilgi tarihinden sonra girilen kart ödemeleri
  const usedAt = fin.card_used_at ? String(fin.card_used_at).slice(0, 10) : null;
  const newSpend = usedAt ? sumBy(rows.expenses.filter(e => e.payer_id === uid && onCardItem(e, 'expenses') && String(e.date).slice(0, 10) > usedAt), e => Number(e.amount) || 0) : 0;
  const paidSince = usedAt ? sumBy((rows.card_payments || []).filter(c => c.owner_id === uid && c.created_at && new Date(c.created_at).toLocaleDateString('sv-SE') > usedAt), c => Number(c.amount) || 0) : 0;
  const cardUsed = (Number(fin.card_used) || 0) + newSpend - paidSince;
  const cardRemain = Math.max(0, (Number(fin.card_debt) || 0) - cardAmt);
  const inCard = card ? cardItems(rows, uid, m).length : 0;
  const cardTag = it => (it.payer_id === uid && onCardItem(it, it.monthly_amount != null ? 'installments' : it.date ? 'expenses' : 'fixed_payments')
    ? (card ? '💳 karta dahil, toplama eklenmez' : '💳 kartla') : null);

  // Ayın ilk 10 günü: bu ayın hesaplaşması (ayın 5'i) bekliyorsa hatırlat
  const settle = m === thisMonth() && new Date().getDate() <= 10 ? settlementFor(rows, ctx.members, m) : null;
  const settleDue = settle && settle.amount >= 1 && !rows.settlements.some(x => x.month === m && (x.sent_at || x.received_at));
  const income = Number(fin.income) || 0;
  const carry = carryFor(rows, uid, m);
  const carryAmt = carry ? Number(carry.amount) || 0 : 0;
  const b = nakitBreakdown(rows, uid, m, income, ctx.members);
  const left = b.left;
  // Bankanın e-postayla bildirdiği son bakiye (sadece bu ay ekranında); fark = banka − uygulamaya göre şu an olması gereken
  const bank = m === thisMonth() && fin.bank_balance != null ? Number(fin.bank_balance) : null;
  const bankDiff = bank != null ? Math.round((bank - (b.left + b.unpaid)) * 100) / 100 : 0;

  const toggle = makeToggle(ctx, m);
  const partner = ctx.members.find(x => x.user_id !== uid);
  /** Ortak kalemde eşin o ay kendi tikini attı mı */
  const partnerTag = it => (it.shared && partner
    ? `${partner.display_name} ${isPaid(it, m, partner.user_id) ? 'ödedi ✓' : 'ödemedi'}` : null);
  const allPaid = b.out > 0 && b.unpaid < 1;
  const debtNow = sumBy(rows.installments, i => share(i, Number(i.monthly_amount), uid) * inst.remaining(i, thisMonth()));
  const say = !income ? 'Merhaba! Önce Ben → Birikimim bölümüne gelirini yazalım mı? 🥕'
    : allPaid ? 'Bu ayın bütün ödemeleri tamam, harikasınız! 🎉'
    : left >= 0 ? `Bu ay ${tl(left)} artıyor, süpersiniz! ✨`
    : `Eyvah, ${tl(-left)} eksideyiz 🙈`;
  const settledTag = it => ((it.paid_months || []).includes(`${paidKey(m, uid)}:settled`) ? 'hesaplaşmada gönderildi 🔒' : null);
  const subOf = (extra, it) => [extra, sharedLabel(it, ctx), partnerTag(it), settledTag(it)].filter(Boolean).join(' · ');

  return html`
    <header class="top">
      <div class="month-nav">
        <button class="icon" onClick=${() => setM(addM(m, -1))} aria-label="Önceki ay">‹</button>
        <h1>${monthName(m)}</h1>
        <button class="icon" onClick=${() => setM(addM(m, 1))} aria-label="Sonraki ay">›</button>
      </div>
      ${m !== thisMonth() && html`<button class="link small" onClick=${() => setM(thisMonth())}>Bu aya dön</button>`}
    </header>
    <${Buddy} face=${dailyFace(0)} say=${say} />

    ${settleDue && html`
      <button class="banner" onClick=${ctx.goSettle}>
        <span class="banner-icon">💸</span>
        <span class="grow"><b>Hesaplaşma zamanı</b><span class="sub">${ctx.names[settle.from] || 'Eşin'} → ${ctx.names[settle.to] || 'Eşin'} · ${tl(settle.amount)}</span></span>
        <span class="pill on">Gör</span>
      </button>`}

    <div class="carousel" onTouchStart=${onTouchStart} onTouchEnd=${onTouchEnd}>
      <div class="track" style=${`transform: translateX(${page === 0 ? 0 : -50}%)`}>
        <section class="page">
      <div class="card hero">
        <div class="muted">Ay sonunda kalan (nakit bakiye)</div>
        <div class=${'big ' + (left < 0 ? 'neg' : 'pos')}>${tl(left)}</div>
        ${!income && html`<div class="sub">Ben → Birikimim bölümüne aylık gelirini yaz</div>`}
        <div class="rows">
          <div class="row"><span>Gelir</span><b>${tl(income)}</b></div>
          ${carryAmt !== 0 && html`<div class="row"><span>Önceki aydan devir</span><b>${tl(carryAmt)}</b></div>`}
          ${bank != null && html`
            <div class="row"><span>Bankadaki bakiye<small class="muted"> · ${whenShort(fin.bank_balance_at)}</small></span><b>${tl(bank)}</b></div>
            ${Math.abs(bankDiff) >= 1 && html`<div class="row"><span>Uygulamayla fark</span>
              <span class="flow-right"><b class=${bankDiff < 0 ? 'neg' : 'pos'}>${signed(bankDiff).text}</b><button class="flow-btn" aria-label="Bakiyeyi eşitle" onClick=${() => setBalOpen(true)}>›</button></span></div>`}`}
        </div>
      </div>
          <${OzetGroups} ctx=${ctx} m=${m} view="nakit" />
          ${m === thisMonth() && html`<button class="item link-row" onClick=${() => setBalOpen(true)}>⚖️ Bakiye eşitle<span class="sub">Bankadaki bakiyenle aynı olsun</span></button>`}
        </section>
        <section class="page">
          <${CardPanel} ctx=${ctx} m=${m} onLimit=${() => setLimitOpen(true)} onCard=${() => setCardOpen(true)} />
          <${OzetGroups} ctx=${ctx} m=${m} view="kart" />
        </section>
      </div>
      <div class="dots page-dots">
        <i class=${page === 0 ? 'on' : ''} onClick=${() => setPage(0)}></i>
        <i class=${page === 1 ? 'on' : ''} onClick=${() => setPage(1)}></i>
      </div>
    </div>
    <div class="row pad"><button class="link small" onClick=${() => setTaksitOpen(true)}>Tüm taksitler ve bitenler ›</button></div>


    ${form && html`<${ItemForm} ctx=${ctx} ...${form} month=${m} onClose=${() => setForm(null)} />`}
    ${cardOpen && html`<${CardSheet} ctx=${ctx} month=${m} onClose=${() => setCardOpen(false)} />`}
    ${limitOpen && html`<${CardLimitSheet} ctx=${ctx} onClose=${() => setLimitOpen(false)} />`}
    ${detail && html`<${RecordDetail} ctx=${ctx} m=${m} rec=${detail} onClose=${() => setDetail(null)} onEdit=${() => { setForm({ kind: detail.kind, item: detail.it }); setDetail(null); }} />`}
    ${taksitOpen && html`<${TaksitSheet} ctx=${ctx} onAdd=${() => setForm({ kind: 'installment' })} onClose=${() => setTaksitOpen(false)} />`}
    ${balOpen && html`<${BalanceSheet} ctx=${ctx} expected=${b.left + b.unpaid} initial=${bank ?? undefined} onClose=${() => setBalOpen(false)} />`}`;
}

// ---------- Bakiye eşitleme ----------

/** Bankadaki gerçek bakiyeyi girince farkı tek bir "Diğer" harcamasıyla kapatır */
function BalanceSheet({ ctx, expected, initial, onClose }) {
  const { uid, actions } = ctx;
  const [real, setReal] = useState(initial ?? 0);
  const [touched, setTouched] = useState(initial != null);
  const [busy, setBusy] = useState(false);
  const diff = Math.round((expected - real) * 100) / 100;

  async function save() {
    if (!touched || busy || !diff) return;
    setBusy(true);
    const ok = await actions.add('expenses', {
      name: 'Diğer (bakiye eşitleme)', amount: diff, date: today(), shared: false, split: 'half',
      payer_id: uid, paid_months: [paidKey(thisMonth(), uid)],
    });
    if (ok !== false) { celebrate('Bakiye eşitlendi!'); onClose(); }
    setBusy(false);
  }

  return html`
    <${Sheet} title="⚖️ Bakiye eşitle" onClose=${onClose}>
      <div class="card rows">
        <div class="row"><span>Uygulamaya göre hesabında olması gereken<small class="muted"> (gelir − bu ay ödenenler)</small></span><b>${tl(expected)}</b></div>
      </div>
      <div class="card form">
        <label class="field"><span>Bankadaki gerçek bakiye</span><${MoneyInput} value=${real} onInput=${v => { setReal(v); setTouched(true); }} /></label>
      </div>
      ${touched && html`
        <div class="card hero center-text">
          ${!diff ? html`<div class="big">🎉</div><div class="muted">Zaten eşit, eklenecek bir şey yok</div>`
            : diff > 0 ? html`<div class="muted">Takip edilmemiş harcama</div><div class="big neg">${tl(diff)}</div>
                <div class="sub">"Diğer (bakiye eşitleme)" adıyla ödenmiş harcama olarak eklenecek</div>`
            : html`<div class="muted">Bankada beklenenden fazla para var</div><div class="big pos">${tl(-diff)}</div>
                <div class="sub">Eksi tutarlı bir düzeltme olarak eklenecek; kalan paran artacak</div>`}
          ${!!diff && html`<button class="primary" disabled=${busy} onClick=${save}>Eşitle</button>`}
        </div>`}
      <p class="hint">Sadece sen görürsün. Yanlış eklersen Harcamalar'dan dokunup silebilirsin.</p>
    <//>`;
}

// ---------- Kart limiti ----------

/** Bankanın uygulamasındaki limit bilgisi: limit ve kullanılan tutar. Ayda bir (ör. 5'inde) girmek yeterli. */
function CardLimitSheet({ ctx, onClose }) {
  const { fin, saveFin, rows, uid } = ctx;
  const [limit, setLimit] = useState(Number(fin.card_limit) || 0);
  // Bankadaki kullanılabilir limit yazılır; kullanılan = limit − kullanılabilir (bugünün bilgisi)
  const [avail, setAvail] = useState(Math.max(0, (Number(fin.card_limit) || 0) - cardUsedNowFor(fin, rows, uid)));
  const [debt, setDebt] = useState(Number(fin.card_debt) || 0);
  const [at, setAt] = useState(today());
  const [busy, setBusy] = useState(false);
  const used = Math.max(0, limit - avail);
  async function save() {
    if (busy || !(limit > 0)) return;
    setBusy(true);
    await saveFin({ ...fin, card_limit: limit, card_used: used, card_debt: debt, card_used_at: at });
    onClose();
  }
  return html`
    <${Sheet} title="💳 Kart bilgileri" onClose=${onClose}
      right=${html`<button class="link strong" disabled=${busy || !(limit > 0)} onClick=${save}>Kaydet</button>`}>
      <div class="card form">
        <label class="field"><span>Kart limiti</span><${MoneyInput} value=${limit} onInput=${setLimit} /></label>
        <label class="field"><span>Kullanılabilir limit<small>Bankada şu an görünen</small></span><${MoneyInput} value=${avail} onInput=${v => { setAvail(v); setAt(today()); }} /></label>
        <label class="field"><span>Borcun tamamı<small>Bu ayki kart borcu</small></span><${MoneyInput} value=${debt} onInput=${setDebt} /></label>
        <label class="field"><span>Bu bilgi tarihi</span><input type="date" value=${at} onInput=${e => setAt(e.target.value || at)} onChange=${e => setAt(e.target.value || at)} /></label>
      </div>
      <div class="card rows">
        <div class="row"><span>Kullanılan limit</span><b class="warn">${tl(used)}</b></div>
        <div class="row"><span>Kullanılabilir limit</span><b class="pos">${tl(Math.min(avail, limit))}</b></div>
      </div>
      <p class="hint">Bankadaki kullanılabilir limiti yazman yeterli; kullanılanı uygulama hesaplar. Bu tarihten sonra girdiğin kart harcamaları limitten otomatik düşer. Sadece sen görürsün.</p>
    <//>`;
}

// ---------- Kredi kartı ödemesi ----------

/** O ayın kart ödemesini kaydeder; ödeme varsa o ay kartımdan ödenen her şey (taksit, her ay, harcama) ödenmiş olur.
 *  Kullanılabilir limit ve kalan borç bu ödemeye göre kendiliğinden güncellenir. */
async function saveCardPayment(ctx, month, paid) {
  const { rows, uid, actions } = ctx;
  const card = cardFor(rows, uid, month);
  const row = { amount: paid, includes_installments: true };
  const ok = card ? await actions.patch('card_payments', card.id, row)
    : await actions.add('card_payments', { ...row, month, owner_id: uid });
  if (ok !== false && paid > 0) {
    const key = paidKey(month, uid);
    for (const { it, table } of cardItems(rows, uid, month)) {
      if (!(it.paid_months || []).includes(key)) await actions.patch(table, it.id, { paid_months: [...(it.paid_months || []), key] });
    }
    if (!card) celebrate('Kart ödemesi girildi!');
  }
  return ok;
}

function CardSheet({ ctx, month, prompt, onClose }) {
  const { rows, uid, actions } = ctx;
  const card = cardFor(rows, uid, month);
  const [amount, setAmount] = useState(Number(card?.amount || 0));
  const included = cardItems(rows, uid, month);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(value) {
    if (busy) return;
    if (value == null && !(amount > 0)) return setErr('Ödediğin tutarı yaz (ödeme yoksa aşağıdan seç)');
    setBusy(true);
    const ok = await saveCardPayment(ctx, month, value ?? amount);
    if (ok !== false) onClose();
    setBusy(false);
  }
  async function remove() {
    if (!confirm('Bu ayın kart ödemesi silinsin mi?')) return;
    await actions.del('card_payments', card.id);
    onClose();
  }

  return html`
    <${Sheet} title="💳 Kart ödemesi" onClose=${onClose}
      right=${html`<button class="link strong" disabled=${busy} onClick=${() => save()}>Kaydet</button>`}>
      ${prompt && html`<p class="lead">Yeni ay başladı! Bu ay kredi kartına ne kadar ödedin?</p>`}
      ${err && html`<p class="error">${err}</p>`}
      <div class="card form">
        <label class="field"><span>Bu ay ödediğin</span><${MoneyInput} value=${amount} onInput=${v => { setAmount(v); setErr(''); }} /></label>
      </div>
      <p class="hint">Bu tutar bu ayın nakit bakiyesinden düşer.</p>
      <${Group} title="Bu ay tiklenecek kartlı kayıtlar" total=${sumBy(included, x => x.amount)}>
        ${included.map(({ it, kind, amount: a }) => html`<div class="row pad" key=${it.id}><span>${it.name}<small class="muted"> · ${kind}${it.shared ? ' · ortak, yarısı eşinden gelir' : ''}</small></span>
          <b>${tl(a)}</b></div>`)}
        ${!included.length && html`<${Empty}>Bu ay kartla ödenen kayıt yok<//>`}
      <//>
      ${!card && html`<button class="primary ghost" disabled=${busy} onClick=${() => save(0)}>Bu ay kart ödemem yok</button>`}
      ${prompt && !card && html`<button class="link small" onClick=${onClose}>Sonra gireceğim</button>`}
      ${card && html`<button class="danger" onClick=${remove}>Sil</button>`}
    <//>`;
}

// ---------- Hesaplaşma (ayın 5'i) ----------

const LOG_LABEL = { sent: 'Gönderdim', unsent: '"Gönderdim" işaretini kaldırdı', received: 'Parayı aldım', unreceived: '"Aldım" işaretini kaldırdı' };

/** Hesaplaşmaya "Gönderdim" / "Parayı aldım" işaretini koyar ya da kaldırır; her adım log'a yazılır.
 *  İşaret konunca o ayın ortak kalemlerinde borçlu "ödedi" olur. Banka hareketinden eşleştirmede de kullanılır. */
async function settleMark(ctx, m, kind, on) {
  const { rows, members, names, uid, actions } = ctx;
  const s = settlementFor(rows, members, m);
  if (!s) return false;
  const rec = rows.settlements.find(x => x.month === m);
  const now = new Date().toISOString();
  const entry = { at: now, by: uid, action: on ? kind : `un${kind}`, amount: s.amount };
  const patch = kind === 'sent'
    ? { sent_at: on ? now : null, sent_by: on ? uid : null }
    : { received_at: on ? now : null, received_by: on ? uid : null };
  const base = { amount: s.amount, from_id: s.from, to_id: s.to };
  const ok = rec
    ? await actions.patch('settlements', rec.id, { ...base, ...patch, log: [...(rec.log || []), entry] })
    : await actions.add('settlements', { month: m, ...base, ...patch, log: [entry] });
  if (ok !== false && on) {
    for (const l of s.lines) {
      const debtor = l.payer === s.A ? s.B : s.A;
      const it = rows[l.table].find(x => x.id === l.id);
      const key = paidKey(l.table === 'expenses' && it?.date ? mk(it.date) : m, debtor);
      const p = it?.paid_months || [];
      if (it && !p.includes(`${key}:settled`)) {
        await actions.patch(l.table, l.id, { paid_months: [...p.filter(x => x !== key), key, `${key}:settled`] });
      }
    }
    celebrate(kind === 'sent' ? 'Gönderildi!' : 'Hesaplar kapandı!');
    const me = names[uid] || 'Eşin';
    api.notify({
      type: 'settle',
      title: '💸 Hesaplaşma',
      body: kind === 'sent' ? `${me}: ${monthName(m)} için ${tl(s.amount)} gönderdim` : `${me}: ${tl(s.amount)} geldi, aldım ✓`,
    }).catch(() => {});
  }
  return ok;
}

function SettleView({ ctx }) {
  const { rows, members, names, uid, actions } = ctx;
  const [m, setM] = useState(() => defaultSettleMonth(rows));
  const [review, setReview] = useState(false);
  const s = settlementFor(rows, members, m);
  const rec = rows.settlements.find(x => x.month === m);
  const who = id => (id === uid ? 'Sen' : names[id] || 'Eşin');
  const when = t => new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /** Gönderdim / Aldım işaretini koyar ya da kaldırır */
  async function mark(kind, on) {
    const question = {
      sent: `${who(s.to)} kişisine ${tl(s.amount)} gönderdin mi?`,
      received: `${who(s.from)} kişisinden ${tl(s.amount)} aldın mı?`,
    }[kind];
    if (!confirm(on ? question : 'İşaret kaldırılsın mı?')) return;
    await settleMark(ctx, m, kind, on);
  }

  const status = (label, at, by) => html`
    <div class="row"><span>${label}</span>
      ${at ? html`<b class="pos">✓ ${when(at)}${by ? ` · ${who(by)}` : ''}</b>` : html`<b class="warn">Bekliyor</b>`}</div>`;

  return html`
    <div class="group" id="settle">
      <div class="group-head"><span>💸 Hesaplaşma · ayın 5'i</span></div>
      <div class="card hero center-text">
        <div class="month-nav small">
          <button class="icon" onClick=${() => setM(addM(m, -1))} aria-label="Önceki ay">‹</button>
          <h2>${monthName(m)}</h2>
          <button class="icon" onClick=${() => setM(addM(m, 1))} aria-label="Sonraki ay">›</button>
        </div>
        <div class="sub">Ödeme günü: 5 ${AYLAR[Number(m.slice(5, 7)) - 1]} · ${monthName(m)} nakit bakiyesinden düşer</div>
        ${!s ? html`<${Empty}>Eşin aileye katılınca burada hesaplanır<//>`
          : s.amount < 1 ? html`<div class="big">🎉</div><div class="muted">Bu ay kimsenin kimseye borcu yok</div>`
          : html`
            <div class="transfer"><span>${who(s.from)}</span><span class="arrow">→</span><span>${who(s.to)}</span></div>
            <div class=${'big ' + (rec?.received_at ? 'muted' : 'pos')}>${tl(s.amount)}</div>
            <div class="rows">
              <div class="row"><span>${who(s.B)} → ${who(s.A)}</span><b>${tl(s.owe[s.B])}</b></div>
              <div class="row"><span>${who(s.A)} → ${who(s.B)}</span><b>${tl(s.owe[s.A])}</b></div>
              <div class="row"><span>Mahsuplaşınca</span><b>${tl(s.amount)}</b></div>
              ${status('Gönderildi', rec?.sent_at, rec?.sent_by)}
              ${status('Alındı', rec?.received_at, rec?.received_by)}
            </div>
            ${rec && Number(rec.amount) !== s.amount && html`<p class="error">İşaretlendikten sonra tutar değişti: ${tl(rec.amount)} → ${tl(s.amount)}</p>`}
            <button class="primary" onClick=${() => setReview(true)}>Kalem kalem kontrol et</button>`}
      </div>
    </div>
    ${s && html`
      ${rec?.log?.length > 0 && html`
        <${FoldGroup} id="settle-log" title="Kayıt geçmişi" count=${rec.log.length}>
          ${[...rec.log].reverse().map((e, k) => html`
            <div class="item" key=${k}>
              <div class="grow"><div class="title">${who(e.by)}: ${LOG_LABEL[e.action] || e.action}</div>
                <div class="sub">${when(e.at)}</div></div>
              <div class="amt">${tl(e.amount)}</div>
            </div>`)}
        <//>`}`}
    <p class="hint">Sadece "Ortak alım · yarı yarıya" kalemler hesaba girer; karşılıklı borçlar birbirinden düşülür. Gönderdim/Aldım işaretleri bütçeni etkilemez, sadece takip için kaydedilir.</p>
    ${review && s && html`<${SettleSummary} ctx=${ctx} s=${s} rec=${rec} month=${m} who=${who} uid=${uid}
      onMark=${async (kind, on) => { await mark(kind, on); }} onClose=${() => setReview(false)} />`}`;
}

/** Gönderimden önce kontrol: her yöndeki borç kalem kalem, ara toplamlar ve net tutar */
function SettleSummary({ ctx, s, rec, month, who, uid, onMark, onClose }) {
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  const KIND_OF = { expenses: 'expense', installments: 'installment', fixed_payments: 'fixed' };
  /** Kaleme dokununca kaydın detayı (harcamada tik ayı harcama ayıdır) */
  const open = (table, id, amount) => {
    const it = (ctx.rows[table] || []).find(x => x.id === id);
    if (it) setDetail({ rec: { it, table, kind: KIND_OF[table], amt: amount }, m: table === 'expenses' ? mk(it.date) : month });
  };
  const side = (debtor, creditor) => {
    const lines = s.lines.filter(l => l.payer === creditor);
    return html`
      <div class="group">
        <div class="group-head"><span>${who(debtor)} → ${who(creditor)}</span><span>${tl(s.owe[debtor])}</span></div>
        <div class="card">
          ${lines.map(l => html`
            <div class="item tappable" key=${l.id} onClick=${() => open(l.table, l.id, l.amount)}>
              <div class="grow"><div class="title">${l.name} <span class="chev-r">›</span></div>
                <div class="sub">${l.kind} · ${l.when} · ${creditor === uid ? 'sen ödedin' : `${who(creditor)} ödedi`} · toplam ${tl(l.amount)}</div></div>
              <div class="amt"><b>${tl(l.debt)}</b><div class="sub">${l.full ? 'tamamı' : 'yarısı'}</div></div>
            </div>`)}
          ${!lines.length && html`<${Empty}>Bu yönde borç yok<//>`}
          <div class="row pad total-row"><span>Ara toplam</span><b>${tl(s.owe[debtor])}</b></div>
        </div>
      </div>`;
  };

  return html`
    <${Sheet} full title=${`💸 ${monthName(month)} özeti`} onClose=${onClose}
      right=${html`<span class="spacer"></span>`}>
      <p class="hint">${monthName(month)} ayının "yarı yarıya" ortak kalemleri. Kartı kim ödediyse diğeri yarısını borçlanır.</p>
      ${side(s.B, s.A)}
      ${side(s.A, s.B)}
      ${s.sentDirect.length > 0 && html`
        <div class="group">
          <div class="group-head"><span>Ay içinde gönderilenler (hesaba girmedi)</span></div>
          <div class="card">
            ${s.sentDirect.map(l => html`
              <div class="item tappable" key=${l.id} onClick=${() => open('expenses', l.id, l.amount)}>
                <div class="grow"><div class="title done">${l.name} <span class="chev-r">›</span></div>
                  <div class="sub">Harcama · ${l.when} · ${l.payer === uid ? 'sen ödedin' : `${who(l.payer)} ödedi`} · payı ay içinde gönderildi ✓</div></div>
                <div class="amt muted">${tl(l.debt)}</div>
              </div>`)}
          </div>
        </div>`}
      <div class="card hero center-text">
        <div class="rows">
          <div class="row"><span>${who(s.B)} → ${who(s.A)}</span><b>${tl(s.owe[s.B])}</b></div>
          <div class="row"><span>${who(s.A)} → ${who(s.B)}</span><b>− ${tl(s.owe[s.A])}</b></div>
        </div>
        <div class="muted">Mahsuplaşınca gönderilecek</div>
        <div class="transfer"><span>${who(s.from)}</span><span class="arrow">→</span><span>${who(s.to)}</span></div>
        <div class="big pos">${tl(s.amount)}</div>
        ${s.amount >= 1 && uid === s.from && (rec?.sent_at
          ? html`<button class="link small" onClick=${() => onMark('sent', false)}>"Gönderdim" işaretini kaldır</button>`
          : html`<button class="primary" onClick=${() => onMark('sent', true)}>Kontrol ettim, gönderdim</button>`)}
        ${s.amount >= 1 && uid === s.to && (rec?.received_at
          ? html`<button class="link small" onClick=${() => onMark('received', false)}>"Aldım" işaretini kaldır</button>`
          : html`<button class="primary" onClick=${() => onMark('received', true)}>Kontrol ettim, parayı aldım</button>`)}
      </div>
      ${detail && html`<${RecordDetail} ctx=${ctx} m=${detail.m} rec=${detail.rec} onClose=${() => setDetail(null)}
        onEdit=${() => { setForm({ kind: detail.rec.kind, item: detail.rec.it, month: detail.m }); setDetail(null); }} />`}
      ${form && html`<${ItemForm} ctx=${ctx} kind=${form.kind} item=${form.item} month=${form.month} onClose=${() => setForm(null)} />`}
    <//>`;
}

// ---------- Rapor ----------

/** Etiketli yatay çubuklar; renk kimlik taşımaz, isim ve tutar her satırda yazılı */
function Bars({ items, total }) {
  const max = Math.max(...items.map(i => i.value), 1);
  return items.map(i => html`
    <div class="bar-row" key=${i.label}>
      <div class="line"><span class="title">${i.label}</span><b>${tl(Math.round(i.value))}</b></div>
      <div class="hbar"><div style=${`width:${Math.max(2, (i.value / max) * 100)}%`}></div></div>
      ${(i.sub || total) && html`<div class="sub">${[total ? `%${Math.round((i.value / total) * 100)}` : '', i.sub].filter(Boolean).join(' · ')}</div>`}
    </div>`);
}

function ReportView({ ctx }) {
  const { rows, uid } = ctx;
  const [span, setSpan] = useState(3);
  const now = thisMonth();
  const months = Array.from({ length: span }, (_, k) => addM(now, k - span + 1));
  const mine = (x, a) => share(x, Number(a), uid);

  const perMonth = months.map(m => {
    const card = cardFor(rows, uid, m);
    const c = card ? Number(card.amount) || 0 : 0;
    const ins = sumBy(rows.installments.filter(i => inst.active(i, m) && !coveredByCard(i, uid, card)), i => mine(i, i.monthly_amount));
    const fx = sumBy(rows.fixed_payments.filter(f => !coveredByCard(f, uid, card, 'fixed_payments')), f => mine(f, f.amount));
    const ex = sumBy(rows.expenses.filter(e => mk(e.date) === m && !coveredByCard(e, uid, card, 'expenses')), e => mine(e, e.amount));
    return { m, card: c, inst: ins, fixed: fx, exp: ex, total: c + ins + fx + ex };
  });
  const grand = sumBy(perMonth, x => x.total);
  const kinds = [['card', 'Kredi kartı'], ['inst', 'Taksitler'], ['fixed', 'Her ay olanlar'], ['exp', 'Harcamalar']]
    .map(([k, label]) => ({ label, value: sumBy(perMonth, x => x[k]) })).filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value);

  const topInst = rows.installments.filter(i => inst.remaining(i, now) > 0)
    .map(i => ({ label: i.name, value: mine(i, i.monthly_amount), sub: `${inst.remaining(i, now)} taksit · kalan ${tl(mine(i, i.monthly_amount) * inst.remaining(i, now))}` }))
    .sort((a, b) => b.value - a.value).slice(0, 6);

  const byName = {};
  rows.expenses.filter(e => months.includes(mk(e.date))).forEach(e => {
    const key = e.name.trim().toLocaleLowerCase('tr');
    const g = (byName[key] ||= { label: e.name.trim(), value: 0, n: 0 });
    g.value += mine(e, e.amount);
    g.n++;
  });
  const topExp = Object.values(byName).sort((a, b) => b.value - a.value).slice(0, 6)
    .map(x => ({ ...x, sub: x.n > 1 ? `${x.n} kez` : '' }));

  const byCat = {};
  months.forEach(m => {
    rows.expenses.filter(e => mk(e.date) === m).forEach(e => { const k = e.category || 'Diğer'; byCat[k] = (byCat[k] || 0) + mine(e, e.amount); });
    rows.installments.filter(i => inst.active(i, m)).forEach(i => { const k = i.category || 'Diğer'; byCat[k] = (byCat[k] || 0) + mine(i, i.monthly_amount); });
  });
  rows.fixed_payments.forEach(f => { const k = f.category || 'Diğer'; byCat[k] = (byCat[k] || 0) + mine(f, f.amount) * months.length; });
  const catItems = Object.entries(byCat).map(([label, value]) => ({ label, value })).filter(x => x.value > 0).sort((a, b) => b.value - a.value);

  const sharedT = sumBy(months, m => sumBy(rows.expenses.filter(e => e.shared && mk(e.date) === m), e => mine(e, e.amount))
    + sumBy(rows.installments.filter(i => i.shared && inst.active(i, m)), i => mine(i, i.monthly_amount))
    + sumBy(rows.fixed_payments.filter(f => f.shared), f => mine(f, f.amount)));

  return html`
    <div class="group" id="report"><div class="group-head"><span>📊 Rapor</span></div></div>
    <${Seg} value=${span} onChange=${setSpan} options=${[[1, 'Bu ay'], [3, 'Son 3 ay'], [12, 'Son 12 ay']]} />
    <div class="card hero">
      <div class="muted">${span === 1 ? monthName(now) : `Son ${span} ay`} toplam ödeme</div>
      <div class="big">${tl(Math.round(grand))}</div>
      ${span > 1 && html`<div class="sub">Aylık ortalama ${tl(Math.round(grand / span))}</div>`}
      ${kinds[0] && html`<div class="sub">En büyük kalem: <b>${kinds[0].label}</b> (%${Math.round((kinds[0].value / (grand || 1)) * 100)})</div>`}
    </div>
    <${FoldGroup} id="rep-kinds" title="Para nereye gidiyor">
      ${kinds.length ? html`<${Bars} items=${kinds} total=${grand} />` : html`<${Empty}>Henüz kayıt yok<//>`}
    <//>
    ${grand > 0 && html`
      <${FoldGroup} id="rep-shared" title="Ortak / Şahsi">
        <${Bars} items=${[{ label: 'Ortak kalemlerdeki payın', value: sharedT }, { label: 'Şahsi (kart ödemesi dahil)', value: grand - sharedT }]} total=${grand} />
      <//>`}
    ${span > 1 && html`
      <${FoldGroup} id="rep-cat" title="Kategoriye göre">
      ${catItems.length ? html`<${Bars} items=${catItems} total=${sumBy(catItems, x => x.value)} />` : html`<${Empty}>Henüz kategorili kayıt yok<//>`}
    <//>
    <${FoldGroup} id="rep-months" title="Aylara göre">
        <${Bars} items=${perMonth.map(x => ({ label: monthName(x.m), value: x.total }))} />
      <//>`}
    <${FoldGroup} id="rep-inst" title="En büyük taksitler (aylık)">
      ${topInst.length ? html`<${Bars} items=${topInst} />` : html`<${Empty}>Devam eden taksit yok<//>`}
    <//>
    <${FoldGroup} id="rep-exp" title="En çok harcanan">
      ${topExp.length ? html`<${Bars} items=${topExp} />` : html`<${Empty}>Bu dönemde harcama yok<//>`}
    <//>
    <p class="hint">Rakamlar senin payına göre: ortak kalemlerin yarısı, kart ödemen ve şahsi kayıtların. Aynı isimli harcamalar (ör. "Market") toplanır.</p>`;
}

// ---------- Taksit satırı ----------

function InstRow({ i, ctx, onOpen }) {
  const now = thisMonth();
  const total = inst.total(i);
  const rem = inst.remaining(i, now);
  const mineAmt = share(i, Number(i.monthly_amount), ctx.uid);
  return html`
    <div class="item tall" onClick=${onOpen}>
      <div class="grow">
        <div class="line"><span class="title">${i.name}</span><span>${tl(Number(i.monthly_amount))}</span></div>
        <div class="bar"><div style=${`width:${((total - rem) / total) * 100}%`} class=${rem ? '' : 'full'}></div></div>
        <div class="line sub">
          <span>${rem ? `${rem}/${total} taksit kaldı · son ${shortMonth(inst.last(i))}` : 'Bitti 🎉'}</span>
          ${rem > 0 && html`<span>Kalan ${tl(mineAmt * rem)}</span>`}
        </div>
        ${i.shared && html`<div class="sub tag">${sharedLabel(i, ctx)}${mineAmt !== Number(i.monthly_amount) ? ` · sana düşen ${tl(mineAmt)}` : ''}</div>`}
        ${i.shared && rem > 0 && html`<div class="sub">${ctx.members.filter(x => x.user_id !== ctx.uid).map(x =>
          html`<span class=${'who ' + (isPaid(i, now, x.user_id) ? 'ok' : 'no')}>${x.display_name} bu ay ${isPaid(i, now, x.user_id) ? 'ödedi ✓' : 'ödemedi'}</span>`)}
          <span class=${'who ' + (isPaid(i, now) ? 'ok' : 'no')}>Sen ${isPaid(i, now) ? 'ödedin ✓' : 'ödemedin'}</span></div>`}
      </div>
    </div>`;
}

/** Bu Ay'daki "Taksitler" başlığından açılan tam sayfa: kalan borç, bitiş tarihleri, bitenler */
function TaksitSheet({ ctx, onAdd, onClose }) {
  const { rows, uid } = ctx;
  const now = thisMonth();
  const all = rows.installments;
  const live = all.filter(i => inst.remaining(i, now) > 0).sort((a, b) => (a.last_month > b.last_month ? 1 : -1));
  const done = all.filter(i => inst.remaining(i, now) === 0);
  const monthly = sumBy(all.filter(i => inst.active(i, now)), i => share(i, Number(i.monthly_amount), uid));
  const debt = sumBy(all, i => share(i, Number(i.monthly_amount), uid) * inst.remaining(i, now));
  return html`
    <${Sheet} full title="Taksitlerim" onClose=${onClose}
      right=${html`<button class="link strong" onClick=${onAdd}>+ Yeni</button>`}>
      <div class="card rows">
        <div class="row"><span>Bu ayki taksitlerin</span><b>${tl(monthly)}</b></div>
        <div class="row"><span>Kalan toplam taksit borcun</span><b class="warn">${tl(debt)}</b></div>
      </div>
      <${FoldGroup} id="inst-own" title="Şahsi" count=${live.filter(i => !i.shared).length}>
        ${live.filter(i => !i.shared).map(i => html`<${InstRow} key=${i.id} i=${i} ctx=${ctx} />`)}
        ${!live.some(i => !i.shared) && html`<${Empty}>Şahsi taksit yok<//>`}
      <//>
      <${FoldGroup} id="inst-shared" title="Ortak" count=${live.filter(i => i.shared).length}>
        ${live.filter(i => i.shared).map(i => html`<${InstRow} key=${i.id} i=${i} ctx=${ctx} />`)}
        ${!live.some(i => i.shared) && html`<${Empty}>Ortak taksit yok<//>`}
      <//>
      ${done.length > 0 && html`<${FoldGroup} id="inst-done" title="Bitenler" count=${done.length}>
        ${done.map(i => html`<${InstRow} key=${i.id} i=${i} ctx=${ctx} />`)}
      <//>`}
      <p class="hint">Bir taksidi düzenlemek için Bu Ay'daki taksit satırına dokun.</p>
    <//>`;
}

// ---------- Alışveriş ----------

const catOrder = c => { const i = CATEGORIES.indexOf(c); return i < 0 ? 999 : i; };
function byCategory(items) {
  const map = {};
  items.forEach(i => { (map[i.category] ||= []).push(i); });
  return Object.entries(map).sort((a, b) => catOrder(a[0]) - catOrder(b[0]) || a[0].localeCompare(b[0], 'tr'));
}
const lower = s => s.toLocaleLowerCase('tr');

/** Sola kaydırınca "Sil" düğmesi çıkar */
function SwipeRow({ onDelete, children }) {
  const [dx, setDx] = useState(0);
  const [moving, setMoving] = useState(false);
  const startX = useRef(null);
  const onStart = e => { startX.current = e.touches[0].clientX; setMoving(true); };
  const onMove = e => {
    if (startX.current == null) return;
    setDx(Math.min(0, Math.max(-96, e.touches[0].clientX - startX.current)));
  };
  const onEnd = () => {
    startX.current = null;
    setMoving(false);
    setDx(v => (v < -48 ? -96 : 0));
  };
  return html`
    <div class="swipe-row">
      <button class="swipe-del" onClick=${onDelete}>Sil</button>
      <div class="swipe-body" style=${`transform: translateX(${dx}px); transition: ${moving ? 'none' : 'transform .2s ease'}`}
        onTouchStart=${onStart} onTouchMove=${onMove} onTouchEnd=${onEnd}>${children}</div>
    </div>`;
}

/** Market listesi ortak; kişisel liste (owner_id = ben) sadece bana görünür */
function ShoppingScreen({ ctx, embedded, personal }) {
  const { rows, actions, uid, names } = ctx;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('Diğer');
  const [tripOpen, setTripOpen] = useState(false);
  const [openTrip, setOpenTrip] = useState(null);
  const items = personal ? rows.shopping_items.filter(i => i.owner_id === uid) : rows.shopping_items.filter(i => !i.owner_id);
  // Kişisel listede ortak ürün kataloğundan da seçilebilir; seçilince kişisel kopyası oluşur
  const pool = personal
    ? [...items, ...rows.shopping_items.filter(i => !i.owner_id && !items.some(p => lower(p.name) === lower(i.name)))]
    : items;
  const inList = items.filter(i => i.in_list);
  const checked = inList.filter(i => i.checked);
  const term = lower(q.trim());
  const matches = term ? pool.filter(i => lower(i.name).includes(term)).slice(0, 15) : [];
  const trips = personal ? [] : (rows.shopping_trips || []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const last = trips[0];
  const who = id => (id === uid ? 'Sen' : names[id] || 'Eşin');

  async function addOne(it) {
    if (personal && !it.owner_id) await actions.add('shopping_items', { name: it.name, category: it.category, in_list: true, owner_id: uid });
    else await actions.patch('shopping_items', it.id, { in_list: true, checked: false });
    setQ('');
  }
  async function createAndAdd() {
    const name = q.trim();
    if (!name) return;
    const ok = await actions.add('shopping_items', { name, category: cat, in_list: true, ...(personal ? { owner_id: uid } : {}) });
    if (ok !== false) { setQ(''); setCat('Diğer'); }
  }
  async function clearChecked() {
    for (const i of checked) await actions.patch('shopping_items', i.id, { in_list: false, checked: false });
    celebrate('Alındı!');
  }

  return html`<div>
    ${last && html`<div class="card hero">
      <div class="muted">Son alışveriş</div>
      <div class="big">${tl(last.total)}</div>
      <div class="sub">${who(last.owner_id)} · ${fmtDate(last.date)} · ${(last.items || []).length} ürün</div>
    </div>`}
    <div class="card search"><input placeholder="Ürün ara veya ekle" value=${q} onInput=${e => setQ(e.target.value)} /></div>
    ${term && html`<div class="card">
      ${matches.map(it => html`<button class="item" key=${it.id} onClick=${() => !it.in_list && addOne(it)}>
        <span class="grow title">${it.name}</span>
        <span class=${'pill' + (it.in_list ? ' on' : '')}>${it.in_list ? '✓ listede' : '+ listeye'}</span></button>`)}
      ${!matches.length && html`<div class="item add-new">
        <span class="grow"><span class="title">Sonuç bulunamadı</span><span class="sub">"${q.trim()}" için yeni ürün ekle</span></span>
        <select value=${cat} onChange=${e => setCat(e.target.value)}>${CATS.map(c => html`<option value=${c}>${c}</option>`)}</select>
        <button class="pill on" onClick=${createAndAdd}>Ekle</button></div>`}
    </div>`}
    ${byCategory(inList).map(([c, list]) => html`
      <div class="group" key=${c}>
        <div class="group-head"><span>${c}</span></div>
        <div class="card">
          ${list.map(i => html`<${SwipeRow} key=${i.id} onDelete=${() => actions.patch('shopping_items', i.id, { in_list: false, checked: false })}>
            <button class="item" onClick=${() => actions.patch('shopping_items', i.id, { checked: !i.checked })}>
              <span class=${'check' + (i.checked ? ' on' : '')}>${i.checked ? '✓' : ''}</span>
              <span class=${'grow title' + (i.checked ? ' done' : '')}>${i.name}</span></button><//>`)}
        </div>
      </div>`)}
    ${!inList.length && html`<div class="card"><${Empty}>${personal ? 'Kişisel listen boş. Sadece sen görürsün; yukarıdan ürün ekle.' : 'Liste boş. Yukarıdan ürün arayıp ekle.'}<//></div>`}
    ${checked.length > 0 && (personal
      ? html`<button class="primary" onClick=${clearChecked}>✓ Alınanları listeden çıkar (${checked.length})</button>`
      : html`<button class="primary" onClick=${() => setTripOpen(true)}>🧾 Alışverişi tamamla (${checked.length} ürün)</button>
        <button class="link small center-block" onClick=${clearChecked}>Harcama girmeden sadece alındı say</button>`)}

    ${!personal && html`<div class="group">
      <div class="group-head"><span>Geçmiş alışverişler</span></div>
      <div class="card">
        ${trips.map(t => html`
          <button class="item" key=${t.id} onClick=${() => setOpenTrip(t)}>
            <span class="grow"><span class="title">${fmtDate(t.date)} · ${who(t.owner_id)}</span><span class="sub">${(t.items || []).length} ürün${(t.items || []).length ? ` · ${(t.items || []).slice(0, 3).join(', ')}${(t.items || []).length > 3 ? '…' : ''}` : ''}</span></span>
            <span class="amt">${tl(t.total)}</span><span class="chev-r">›</span></button>`)}
        ${!trips.length && html`<${Empty}>Henüz kayıtlı alışveriş yok<//>`}
      </div>
    </div>`}
    ${tripOpen && html`<${TripSheet} ctx=${ctx} checked=${checked} onClose=${() => setTripOpen(false)} />`}
    ${openTrip && html`<${TripEditSheet} ctx=${ctx} trip=${openTrip} onClose=${() => setOpenTrip(null)} />`}
  </div>`;
}

/** Geçmiş alışverişi düzenle: tarih, tutar, ürünler; sil. Bağlı ortak market harcaması varsa onu da günceller. */
function TripEditSheet({ ctx, trip, onClose }) {
  const { rows, actions } = ctx;
  const [date, setDate] = useState(String(trip.date).slice(0, 10));
  const [total, setTotal] = useState(Number(trip.total) || 0);
  const [items, setItems] = useState(trip.items || []);
  const [newItem, setNewItem] = useState('');
  const [busy, setBusy] = useState(false);
  // Alışveriş tamamlanırken "ortak harcama" olarak eklenen kayıt: aynı gün, aynı tutar, "Market alışverişi" adıyla
  const linked = rows.expenses.find(e => e.date === trip.date && String(e.name).startsWith('Market alışverişi') && Number(e.amount) === Number(trip.total));
  const addItem = () => { const n = newItem.trim(); if (n) { setItems([...items, n]); setNewItem(''); } };

  async function save() {
    if (busy || !(total > 0)) return;
    setBusy(true);
    const ok = await actions.patch('shopping_trips', trip.id, { date, total, items });
    if (ok !== false && linked && (Number(linked.amount) !== total || linked.date !== date || items.length !== (trip.items || []).length)
      && confirm(`Bu alışverişin "${linked.name}" harcaması da güncellensin mi?\n\n${tl(linked.amount)} → ${tl(total)}`)) {
      await actions.patch('expenses', linked.id, {
        amount: total, date, name: `Market alışverişi (${items.length} ürün)`,
        ...(linked.pay_date ? { pay_date: linked.pay_date === linked.date ? date : settleDay(date, cutDayOf(ctx.members, linked.payer_id)) } : {}),
      });
    }
    setBusy(false);
    if (ok !== false) onClose();
  }
  async function remove() {
    if (!confirm('Bu alışveriş geçmişten silinsin mi?' + (linked ? `\n\nBağlı "${linked.name}" harcaması silinmez; gerekirse Kayıtlar'dan sil.` : ''))) return;
    await actions.del('shopping_trips', trip.id);
    onClose();
  }

  return html`
    <${Sheet} title="🧾 Alışverişi düzenle" onClose=${onClose}
      right=${html`<button class="link strong" disabled=${busy || !(total > 0)} onClick=${save}>Kaydet</button>`}>
      <div class="card form">
        <label class="field"><span>Tarih</span><input type="date" value=${date} onInput=${e => setDate(e.target.value || date)} onChange=${e => setDate(e.target.value || date)} /></label>
        <label class="field"><span>Ödenen toplam</span><${MoneyInput} value=${total} onInput=${setTotal} /></label>
      </div>
      ${linked && html`<p class="hint">Bağlı harcama: ${linked.name} · ${tl(linked.amount)}. Kaydedince istersen o da güncellenir.</p>`}
      <${Group} title=${`Ürünler (${items.length})`}>
        ${items.map((n, k) => html`<${SwipeRow} key=${n + k} onDelete=${() => setItems(items.filter((_, j) => j !== k))}>
          <div class="row pad"><span>${n}</span><button class="link small" onClick=${() => setItems(items.filter((_, j) => j !== k))}>Çıkar</button></div><//>`)}
        <div class="row pad"><input placeholder="Ürün ekle" value=${newItem} onInput=${e => setNewItem(e.target.value)} onKeyDown=${e => e.key === 'Enter' && addItem()} />
          <button class="pill on" onClick=${addItem}>Ekle</button></div>
      <//>
      <button class="danger" onClick=${remove}>Alışverişi sil</button>
    <//>`;
}

/** Alışverişi tamamla: toplam tutar, geçmişe kayıt; istenirse ortak harcama olarak yarı yarıya */
function TripSheet({ ctx, checked, onClose }) {
  const { uid, actions } = ctx;
  const [total, setTotal] = useState(0);
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);
  async function save() {
    if (busy || !(total > 0)) return;
    setBusy(true);
    const d = today();
    const ok = await actions.add('shopping_trips', { date: d, total, items: checked.map(i => i.name) });
    if (ok === false) { setBusy(false); return; }
    if (shared) {
      await actions.add('expenses', {
        name: `Market alışverişi (${checked.length} ürün)`, amount: total, date: d, shared: true, split: 'half',
        payer_id: uid, category: 'Market', paid_months: [paidKey(mk(d), uid)],
      });
    }
    for (const i of checked) await actions.patch('shopping_items', i.id, { in_list: false, checked: false });
    celebrate('Alışveriş kaydedildi!');
    onClose();
  }
  return html`
    <${Sheet} title="🧾 Alışverişi tamamla" onClose=${onClose}
      right=${html`<button class="link strong" disabled=${busy || !(total > 0)} onClick=${save}>Kaydet</button>`}>
      <div class="card form">
        <label class="field"><span>Ödenen toplam</span><${MoneyInput} value=${total} onInput=${setTotal} /></label>
        <label class="field toggle"><span>Ortak harcama olarak kaydet<small>Yarı yarıya ikinizin bütçesine de yansır</small></span>
          <input type="checkbox" checked=${shared} onChange=${e => setShared(e.target.checked)} /></label>
      </div>
      <div class="card rows">${checked.map(i => html`<div class="row pad" key=${i.id}><span>${i.name}</span></div>`)}</div>
      <p class="hint">Kaydedince alışveriş geçmişe yazılır ve bu ürünler listeden çıkar.</p>
    <//>`;
}

// ---------- Alacaklar (gelecekte alınacak ev eşyaları) ----------

function WishForm({ ctx, item, onClose }) {
  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(Number(item?.price || 0));
  const [month, setMonth] = useState(mk(item?.target_month) || '');
  const [note, setNote] = useState(item?.note || '');

  const [err, setErr] = useState('');
  async function save() {
    if (!name.trim()) return setErr('Ne alacağınızı yazın');
    const row = { name: name.trim(), price, target_month: month ? `${month}-01` : null, note: note.trim() || null };
    const ok = item ? await ctx.actions.patch('wishlist', item.id, row) : await ctx.actions.add('wishlist', row);
    if (ok !== false) onClose();
  }
  async function remove() {
    if (!confirm(`"${item.name}" silinsin mi?`)) return;
    await ctx.actions.del('wishlist', item.id);
    onClose();
  }

  return html`
    <${Sheet} title=${item ? 'Düzenle' : 'Alacağımız Şey'} onClose=${onClose}
      right=${html`<button class="link strong" onClick=${save}>Kaydet</button>`}>
      ${err && html`<p class="error">${err}</p>`}
      <div class="card form">
        <label class="field"><input placeholder="Ne? (ör. Kitaplık, Halı)" value=${name} onInput=${e => { setName(e.target.value); setErr(''); }} onChange=${e => setName(e.target.value)} /></label>
        <label class="field"><span>Tahmini fiyat</span><${MoneyInput} value=${price} onInput=${setPrice} /></label>
        <label class="field"><span>Ne zaman?</span><input type="month" value=${month} onInput=${e => setMonth(e.target.value)} onChange=${e => setMonth(e.target.value)} /></label>
        <label class="field"><input placeholder="Not (renk, ölçü, link…)" value=${note} onInput=${e => setNote(e.target.value)} /></label>
      </div>
      ${month && html`<button class="link small" onClick=${() => setMonth('')}>Tarihi kaldır</button>`}
      ${item && html`<button class="danger" onClick=${remove}>Sil</button>`}
    <//>`;
}

function WishScreen({ ctx, embedded }) {
  const { rows, actions } = ctx;
  const [form, setForm] = useState(null);
  const [buying, setBuying] = useState(null);
  const [showBought, setShowBought] = useState(false);
  const open = rows.wishlist.filter(w => !w.bought);
  const bought = rows.wishlist.filter(w => w.bought);

  const groups = {};
  open.forEach(w => { (groups[mk(w.target_month) || ''] ||= []).push(w); });
  const keys = Object.keys(groups).sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a < b ? -1 : 1));

  return html`
    ${!embedded && html`<header class="top"><h1>Alacaklarımız</h1></header>`}
    <${Buddy} face=${dailyFace(3)} say=${open.length
      ? `Yuvamız için ${open.length} hayalimiz var 🏡`
      : 'Hayal listesi boş. Ne alsak? ✨'} />
    <div class="card rows">
      <div class="row"><span>Alınacak ${open.length} şey</span><b>${tl(sumBy(open, w => Number(w.price)))}</b></div>
    </div>
    <button class="add-row" onClick=${() => setForm({})}>+ Yeni alacak ekle</button>
    ${!open.length && html`<div class="card"><${Empty}>Çekyat, dresuar, kahvelik… yukarıdan ekleyin<//></div>`}
    ${keys.map(k => html`
      <${Group} key=${k} title=${k ? monthName(k) : 'Zamanı belli değil'} total=${sumBy(groups[k], w => Number(w.price))}>
        ${groups[k].map(w => html`
          <div class="item" key=${w.id}>
            <div class="grow" onClick=${() => setForm({ item: w })}>
              <div class="title">${w.name}</div>
              ${w.note && html`<div class="sub">${w.note}</div>`}
            </div>
            <div class="amt" onClick=${() => setForm({ item: w })}>${Number(w.price) ? tl(w.price) : '—'}</div>
            <button class="pill on" onClick=${() => setBuying(w)}>Aldık</button>
          </div>`)}
      <//>`)}
    ${bought.length > 0 && html`
      <button class="link small" onClick=${() => setShowBought(!showBought)}>${showBought ? 'Alınanları gizle' : `Alınanları göster (${bought.length})`}</button>
      ${showBought && html`<${Group} title="Alındı">
        ${bought.map(w => {
          // Alınırken girilen harcama: aynı isimli en son harcama; yoksa tahmini fiyat
          const paid = rows.expenses.filter(e => lower(e.name) === lower(w.name)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
          return html`
          <div class="item" key=${w.id}>
            <div class="grow"><div class="title done">${w.name}</div>
              <div class="sub">${paid ? `${fmtDate(paid.date)} · ödenen` : 'tahmini fiyat'}</div></div>
            <span class="amt">${tl(paid ? paid.amount : w.price)}</span>
            <button class="link small" onClick=${() => actions.patch('wishlist', w.id, { bought: false })}>Geri al</button>
          </div>`;
        })}
      <//>`}`}

    ${form && html`<${WishForm} ctx=${ctx} item=${form.item} onClose=${() => setForm(null)} />`}
    ${buying && html`<${ItemForm} ctx=${ctx} kind="expense"
      preset=${{ name: buying.name, amount: Number(buying.price), shared: true }}
      onSaved=${() => { celebrate('Hayırlı olsun!'); return actions.patch('wishlist', buying.id, { bought: true }); }}
      onClose=${() => setBuying(null)} />`}`;
}

// ---------- Param ----------

/** Güncel kurlar (/api/rates); son alınan değer cihazda saklanır, internet yoksa o gösterilir */
function useRates() {
  const [r, setR] = useState(() => { try { return JSON.parse(localStorage.getItem('tf-rates')); } catch { return null; } });
  useEffect(() => {
    fetch('./api/rates')
      .then(x => (x.ok ? x.json() : Promise.reject(new Error(x.status))))
      .then(d => { setR(d); try { localStorage.setItem('tf-rates', JSON.stringify(d)); } catch { /* yok say */ } })
      .catch(() => {});
  }, []);
  return r;
}

/** "Ben" sekmesi: menü + alt sayfalar (Birikimim, Hesaplaşma, Raporlar, Ayarlar) */
function BenScreen({ ctx }) {
  const { fin, saveFin, members, names, uid, rows } = ctx;
  const [page, setPageState] = useState(() => {
    try { const p = localStorage.getItem('tf-ben-page'); localStorage.removeItem('tf-ben-page'); return p || null; } catch { return null; }
  });
  const setPage = p => { setPageState(p); window.scrollTo(0, 0); };
  const [f, setF] = useState(fin);
  useEffect(() => {
    if (f === fin) return;
    const t = setTimeout(() => saveFin(f), 600);
    return () => clearTimeout(t);
  }, [f]);
  const rates = useRates();
  const usdTl = Math.round(Number(f.usd_amount) * (rates?.usd || Number(f.usd_rate) || 0));
  const eurTl = Math.round(Number(f.eur_amount || 0) * (rates?.eur || 0));
  const goldTl = Math.round(Number(f.gold_grams || 0) * (rates?.gold || 0));
  const totalSaved = Number(f.savings_tl) + usdTl + eurTl + goldTl;

  const myName = names[uid] || '';

  const back = title => html`
    <header class="top sub-head">
      <button class="link" onClick=${() => setPage(null)}>‹ Ben</button>
      <h1>${title}</h1>
    </header>`;

  if (page === 'savings') return html`${back('Birikimim')}<${SavingsView} f=${f} setF=${setF} rates=${rates} totals=${{ usdTl, eurTl, goldTl, totalSaved }} />`;
  if (page === 'report') return html`${back('Raporlar')}<${ReportView} ctx=${ctx} />`;
  if (page === 'settle') return html`${back('Hesaplaşma')}<${SettleView} ctx=${ctx} />`;
  if (page === 'goals') return html`${back('Hedefler')}<${GoalsView} ctx=${ctx} />`;
  if (page === 'help') return html`${back('Nasıl kullanılır')}<${HelpView} />`;
  if (page === 'settings') return html`${back('Ayarlar')}<${SettingsView} ctx=${ctx} />`;

  const item = (id, icon, title, sub) => html`
    <button class="item menu-item" onClick=${() => setPage(id)}>
      <span class="menu-icon">${icon}</span>
      <span class="grow"><span class="title">${title}</span><span class="sub">${sub}</span></span>
      <span class="chev-r">›</span>
    </button>`;

  return html`
    <header class="top"><h1>${myName ? `Merhaba ${myName}` : 'Ben'}</h1></header>
    <${Buddy} face=${dailyFace(4)} say=${`Kumbaramızda ${tl(totalSaved)} var 🐷`} />
    <div class="card">
      ${item('savings', '💰', 'Birikimim', `${tl(totalSaved)} · gelir ${tl(f.income)}`)}
      ${item('help', '📖', 'Nasıl kullanılır', 'Adım adım, ekran görüntüleriyle')}
      ${item('goals', '🎯', 'Hedefler', `${(rows.goals || []).length} hedef · ${tl(sumBy(rows.goals || [], g => Number(g.saved)))} biriktirildi`)}
      ${item('settle', '💸', 'Hesaplaşma', 'Ortak kalemlerin mahsuplaşması')}
      ${item('report', '📊', 'Raporlar', 'Para nereye gidiyor, kategoriler, en büyük taksitler')}
      ${item('settings', '⚙️', 'Ayarlar', 'Aile, bildirimler, gösterim modu')}
    </div>
    ${SHOW && html`<p class="hint center">🎭 Gösterim modundasın: örnek veriler görünüyor.</p>`}`;
}

/** Ben > Kayıtlarım: kayıtlar şahsi/ortak ve türüne göre; ödenmedi/ödendi tiki burada atılır */
function RecordsView({ ctx }) {
  const [m, setM] = useState(thisMonth());
  const [side, setSide] = useState('nakit');
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState(null);
  return html`
    <div class="month-nav small">
      <button class="icon" onClick=${() => setM(addM(m, -1))} aria-label="Önceki ay">‹</button>
      <h2>${monthName(m)}</h2>
      <button class="icon" onClick=${() => setM(addM(m, 1))} aria-label="Sonraki ay">›</button>
    </div>
    <${Seg} value=${side} onChange=${setSide} options=${[['nakit', '💵 Nakit'], ['kart', '💳 Kredi kartı']]} />
    <${CategoryGroups} ctx=${ctx} m=${m} side=${side} key=${side + m} onToggle=${makeToggle(ctx, m)} onOpen=${x => setDetail(x)} />
    ${detail && html`<${RecordDetail} ctx=${ctx} m=${m} rec=${detail} onClose=${() => setDetail(null)} onEdit=${() => { setForm({ kind: detail.kind, item: detail.it }); setDetail(null); }} />`}
    ${form && html`<${ItemForm} ctx=${ctx} kind=${form.kind} item=${form.item} month=${m} onClose=${() => setForm(null)} />`}`;
}

/** Kayıtlar sekmesi: kayıtlarım (ödendi tiki) ve bankadan gelen hareketler tek ekranda */
function RecordsScreen({ ctx }) {
  const waiting = (ctx.rows.bank_events || []).filter(e => e.owner_id === ctx.uid && e.kind !== 'balance' && e.status === 'pending').length;
  const [part, setPartState] = useState(() => { try { return localStorage.getItem('tf-records') || 'records'; } catch { return 'records'; } });
  const setPart = v => { setPartState(v); window.scrollTo(0, 0); try { localStorage.setItem('tf-records', v); } catch { /* yok say */ } };
  return html`
    <header class="top"><h1>Kayıtlar</h1></header>
    <${Seg} value=${part} onChange=${setPart}
      options=${[['records', '🗂️ Kayıtlarım'], ['bank', `🏦 Banka hareketleri${waiting ? ` (${waiting})` : ''}`]]} />
    ${part === 'bank' ? html`<${BankHistoryView} ctx=${ctx} />` : html`<${RecordsView} ctx=${ctx} />`}`;
}

function SavingsView({ f, setF, rates, totals }) {
  const set = k => v => setF({ ...f, [k]: v });
  const { usdTl, eurTl, goldTl, totalSaved } = totals;
  const approx = v => (v ? `≈ ${tl(v)}` : '');
  return html`
    <div class="card hero">
      <div class="muted">Toplam birikim</div>
      <div class="big">${tl(totalSaved)}</div>
      <div class="rows">
        <div class="row"><span>TL</span><b>${tl(f.savings_tl)}</b></div>
        ${Number(f.usd_amount) > 0 && html`<div class="row"><span>${usd(f.usd_amount)}</span><b>${tl(usdTl)}</b></div>`}
        ${Number(f.eur_amount) > 0 && html`<div class="row"><span>${eur(f.eur_amount)}</span><b>${tl(eurTl)}</b></div>`}
        ${Number(f.gold_grams) > 0 && html`<div class="row"><span>${plain(f.gold_grams)} gr altın</span><b>${tl(goldTl)}</b></div>`}
      </div>
    </div>
    <${Group} title="Gelir">
      <label class="field"><span>Aylık gelir</span><${MoneyInput} value=${f.income} onInput=${set('income')} /></label>
    <//>
    <${Group} title="Kenardaki param">
      <label class="field"><span>TL birikim</span><${MoneyInput} value=${f.savings_tl} onInput=${set('savings_tl')} /></label>
      <label class="field"><span>Dolar<small>${approx(usdTl)}</small></span><${MoneyInput} value=${f.usd_amount} onInput=${set('usd_amount')} suffix="$" /></label>
      <label class="field"><span>Euro<small>${approx(eurTl)}</small></span><${MoneyInput} value=${f.eur_amount} onInput=${set('eur_amount')} suffix="€" /></label>
      <label class="field"><span>Altın<small>${approx(goldTl)}</small></span><${MoneyInput} value=${f.gold_grams} onInput=${set('gold_grams')} suffix="gr" /></label>
    <//>
    <p class="hint">${rates
      ? `Kurlar: $ ${tl(rates.usd)} · € ${tl(rates.eur)} (TCMB ${rates.date || ''}) · gram altın ${tl(rates.gold)}. Bu bilgileri sadece sen görürsün.`
      : 'Kurlar alınamadı, internet bağlantını kontrol et. Bu bilgileri sadece sen görürsün.'}</p>`;
}

const NOTIFY_TYPES = [
  ['shared', 'Ortak kayıt eklenince', 'Eşin ortak harcama, taksit ya da her ay ödemesi ekleyince'],
  ['wish', 'Alacaklara ekleme', 'Alacaklarımız listesine bir şey eklenince'],
  ['settle', 'Hesaplaşma hareketleri', 'Eşin "Gönderdim" ya da "Parayı aldım" deyince'],
  ['card', 'Kart ödemesi hatırlatması', "Ayın 1'i ve 3'ü, kart ödemeni girmediysen"],
  ['payday', 'Hesaplaşma günü', "Her ayın 5'i, 09:00"],
  ['daily', '22:00 hatırlatması', 'Bugün harcama girmediysen her akşam'],
  ['bank', 'Bankadan yeni hareket', 'Banka SMS\'i ya da e-postası gelince'],
  ['statement', 'Ekstre hatırlatması', 'Kart hesap kesim gününde 22:00: ekstreyi indir, kontrol ettir'],
];

function SettingsView({ ctx }) {
  const [fab, setFabState] = useState(fabPrefs);
  const setFab = (k, v) => {
    try { localStorage.setItem(k, v); } catch { /* yok say */ }
    setFabState(fabPrefs());
    window.dispatchEvent(new Event('tf-fab-change'));
  };
  const { household, members, uid, signOut } = ctx;
  const [copied, setCopied] = useState(false);
  const me = members.find(m => m.user_id === uid);
  const prefs = me?.notify_prefs || {};

  async function startShow() {
    if (!confirm('Gösterim moduna geçilsin mi? Gerçek verilerin gizlenir.')) return;
    await enterShowMode();
    location.reload();
  }
  async function copy() {
    try { await navigator.clipboard.writeText(household.invite_code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* kopyalanamadıysa kod ekranda görünüyor */ }
  }

  return html`
    <${Group} title=${`Aile · ${household.name}`}>
      ${members.map(m => html`<div class="row pad" key=${m.user_id}><span>${m.display_name}</span><span class="muted">${m.user_id === uid ? 'sen' : ''}</span></div>`)}
      ${members.length < 2 && !DEMO && html`
        <div class="row pad"><span>Davet kodu</span><button class="code" onClick=${copy}>${copied ? 'Kopyalandı' : household.invite_code}</button></div>`}
    <//>
    ${members.length < 2 && !DEMO && html`<p class="hint">Eşin uygulamada hesap açıp "Davet koduyla katıl" deyip bu kodu girsin.</p>`}

    <${Group} title="Harcama butonu">
      <label class="field toggle"><span>Yerini kilitle<small>Kapalıyken sürükleyip kenara bırakabilirsin</small></span>
        <input type="checkbox" checked=${fab.locked} onChange=${e => setFab('tf-fab-lock', e.target.checked ? '1' : '0')} /></label>
    <//>
    <${PushSettings} />
    <${BankLinkSettings} ctx=${ctx} />
    <${Group} title="Kredi kartı">
      <label class="field"><span>Senin kartının hesap kesim günü<small>Kesimden sonraki ortak kart harcamaları bir sonraki ayın hesaplaşmasına girer; o gün 22:00'de ekstre hatırlatması gelir</small></span>
        <select value=${prefs.cut_day || ''} onChange=${e => ctx.savePrefs({ ...prefs, cut_day: Number(e.target.value) || null })}>
          <option value="">Seç</option>
          ${Array.from({ length: 31 }, (_, i) => html`<option value=${i + 1}>Her ayın ${i + 1}'i</option>`)}
        </select></label>
      ${members.filter(m => m.user_id !== uid).map(m => m.notify_prefs?.cut_day
        ? html`<div class="row pad" key=${m.user_id}><span>${m.display_name} kartının kesim günü<small class="muted"> · ${m.display_name} kendisi girdi</small></span>
            <b>Her ayın ${m.notify_prefs.cut_day}'i</b></div>`
        : html`<label class="field" key=${m.user_id}><span>${m.display_name} kartının kesim günü<small>${m.display_name} kendisi girene kadar bu kullanılır</small></span>
            <select value=${prefs.cut_days?.[m.user_id] || ''} onChange=${e => ctx.savePrefs({ ...prefs, cut_days: { ...(prefs.cut_days || {}), [m.user_id]: Number(e.target.value) || null } })}>
              <option value="">Seç</option>
              ${Array.from({ length: 31 }, (_, i) => html`<option value=${i + 1}>Her ayın ${i + 1}'i</option>`)}
            </select></label>`)}
    <//>
    <${Group} title="Hangi bildirimler gelsin?">
      ${NOTIFY_TYPES.map(([k, title, sub]) => html`
        <label class="field toggle" key=${k}>
          <span>${title}<small>${sub}</small></span>
          <input type="checkbox" checked=${prefs[k] !== false}
            onChange=${e => ctx.savePrefs({ ...prefs, [k]: e.target.checked })} />
        </label>`)}
    <//>
    <p class="hint">Şahsi kayıtların için hiçbir zaman bildirim gitmez. Bu tercihler sadece sana gelen bildirimleri etkiler.</p>

    <${Group} title="Başkalarına gösterirken">
      ${SHOW
        ? html`<div class="row pad"><span>Gösterim modu açık 🎭</span><button class="pill on" onClick=${ctx.askExitShow}>Çık</button></div>`
        : DEMO
          ? html`<div class="row pad"><span>Örnek verilerle doldur</span><button class="pill on" onClick=${() => { if (confirm('Deneme verileri örnek verilerle değiştirilsin mi?')) { loadSample(); location.reload(); } }}>Yükle</button></div>`
          : html`<div class="row pad"><span>Gösterim modu 🎭</span><button class="pill on" onClick=${startShow}>Aç</button></div>`}
    <//>
    <p class="hint">${SHOW
      ? 'Şu an örnek veriler görünüyor. Gerçek verilere dönmek için şifren sorulur.'
      : 'Gerçek verilerin gizlenir, uydurma verilerle dolu bir örnek aile görünür. Çıkmak için şifren sorulur.'}</p>
    ${DEMO && !SHOW && html`<p class="hint">Deneme modundasınız: veriler sadece bu cihazda. Supabase bağlanınca iki telefon eşitlenir.</p>`}
    ${!SHOW && html`<button class="danger" onClick=${signOut}>${DEMO ? 'Deneme verilerini sıfırla' : 'Çıkış yap'}</button>`}`;
}

// ---------- Nasıl kullanılır ----------

const HELP_STEPS = [
  { img: 'bu-ay.png', title: 'Ana ekran: Özet', text: 'Uygulama her açılışta buradan başlar. Üstte "Ay sonunda kalan" senin nakit bakiyendir; altında hesaplaşma, kart ödemesi, taksit ve harcama grupları var, dokununca kalemleri açılır. Sağa kaydırınca kredi kartı tarafı gelir.' },
  { img: 'harcama.png', title: 'Harcama ekleme', text: 'Sağ alttaki + ile harcama ekle. Önce "Parayı şimdi ödediniz mi?" sorusunu cevapla. Ödediysen kartla ya da nakitle seç. Henüz ödemediysen "Henüz değil" de; bakiyeden düşer ama "henüz ödenmedi" olarak kalır, ödediğinde tikle.' },
  { img: 'harcama.png', title: 'Harcama tarihi', text: 'Harcama tarihi, alışverişi yaptığın gündür. Hangi aya yazılacağını bu belirler. Eski bir alışverişi girerken tarihi o güne ayarla.' },
  { img: 'bu-ay.png', title: 'Kart ödemesi', text: 'Ayın başında Bu Ay\'daki "Kredi kartı ödemesi" satırına dokun ve kartına ödediğin tutarı yaz. Kartla yaptığın tüm kayıtlar bu ödemenin içine geçer ve otomatik tiklenir.' },
  { img: 'bu-ay.png', title: 'Kart borcunu eşitle', text: 'Kart borcu satırının altındaki "Kart borcunu eşitle" ile ekstredeki gerçek borcu yazarsın. Fark düzeltme olarak eklenir; nakit bakiyen değişmez.' },
  { img: 'bu-ay.png', title: 'Bakiyeni eşitle', text: 'Harcama listesinin altındaki "Bakiye eşitle" ile bankadaki bakiyeni yaz. Aradaki fark "Diğer (bakiye eşitleme)" olarak eklenir.' },
  { img: 'bu-ay.png', title: 'Taksitler', text: 'Taksitler başlığındaki "Kalan ... · tümü" ile tüm taksitlerini gör: kalan borç, bitiş tarihleri ve biten taksitler. + Yeni ile taksit ekle.' },
  { img: null, title: 'Kayıtlarım ve ödendi tiki', text: 'Kayıtlar sekmesinde harcama, taksit ve aylık ödemeler şahsi/ortak gruplarda görünür. Planladığın ödemeyi "ödenmedi" bırak, ödeyince tikle.' },
  { img: null, title: 'Banka hareketleri', text: 'Bankadan SMS ya da e-posta gelince uygulamayı açtığında "Bankada yeni hareket" penceresi çıkar: bir kayıtla eşleştir, harcama olarak ekle ya da yok say. Kayıtlar > Banka hareketleri\'nde bekleyen ve işlenen hareketleri görürsün.' },
  { img: null, title: 'Hesaplaşma', text: 'Hesaplaşma sekmesinde eşinle olan ortak kalemlerin mahsuplaşmasını görürsün. "Kalem kalem kontrol et" ile her kalemi incele; gönderdiğinde "Gönderdim", parayı aldığında "Parayı aldım" de. Tamamlanınca o aya ait ortak ödemeler otomatik tiklenir ve kilitlenir.' },
  { img: null, title: 'Hedefler ve raporlar', text: 'Ben sekmesinde Hedefler ile tatil, araba gibi birikim hedeflerini takip et. Raporlar bölümünde para nereye gidiyor, kategorilere göre ve en büyük taksitleri gör.' },
  { img: null, title: 'Bildirimler ve ayarlar', text: 'Ben > Ayarlar\'da aile ve davet kodu, hangi bildirimlerin geleceği ve gösterim modu var. Her akşam 22:00\'de bugün harcama girmediysen hatırlatma gelir.' },
];

function HelpView() {
  const [i, setI] = useState(0);
  const step = HELP_STEPS[i];
  return html`
    <${Group} title=${`Adım ${i + 1} / ${HELP_STEPS.length}`}>
      <div class="help">
        ${step.img && html`<img class="help-img" src=${'./tutorial/' + step.img} alt=${step.title} />`}
        <h2>${step.title}</h2>
        <p>${step.text}</p>
      </div>
    <//>
    <div class="help-nav">
      <button class="pill" disabled=${i === 0} onClick=${() => { setI(i - 1); window.scrollTo(0, 0); }}>‹ Önceki</button>
      <span class="dots">${HELP_STEPS.map((_, k) => html`<i class=${k === i ? 'on' : ''} onClick=${() => setI(k)}></i>`)}</span>
      <button class="pill on" disabled=${i === HELP_STEPS.length - 1} onClick=${() => { setI(i + 1); window.scrollTo(0, 0); }}>Sonraki ›</button>
    </div>`;
}

// ---------- Kayıtlar: tiklenecek kayıtlar ----------

const REC_GROUPS = [
  ['own-exp', 'Şahsi harcama'],
  ['shared-exp', 'Ortak harcama'],
  ['own-inst', 'Şahsi taksit'],
  ['shared-inst', 'Ortak taksit'],
  ['fixed', 'Aylık ödeme'],
];

/** Seçili ay için kayıt grupları. Yalnızca o aya ait kayıtlar gelir. */
function recordGroups(rows, uid, m) {
  const exps = rows.expenses.filter(e => mk(e.date) === m);
  const insts = rows.installments.filter(i => inst.active(i, m));
  const fixed = rows.fixed_payments.filter(f => !f.created_at || mk(f.created_at) <= m);
  const mkItem = (table, kind) => it => ({ it, table, kind, amt: Number(kind === 'installment' ? it.monthly_amount : it.amount) || 0 });
  const all = {
    'own-exp': exps.filter(e => !e.shared).map(mkItem('expenses', 'expense')),
    'shared-exp': exps.filter(e => e.shared).map(mkItem('expenses', 'expense')),
    'own-inst': insts.filter(i => !i.shared).map(mkItem('installments', 'installment')),
    'shared-inst': insts.filter(i => i.shared).map(mkItem('installments', 'installment')),
    fixed: fixed.map(mkItem('fixed_payments', 'fixed')),
  };
  return REC_GROUPS.map(([id, title]) => ({
    id, title, items: all[id],
    total: sumBy(all[id], x => share(x.it, x.amt, uid)),
    hasUnpaid: all[id].some(x => !isPaid(x.it, m)),
  }));
}

const fmtDate = v => (v ? new Date(String(v).length === 7 ? `${v}-01` : v).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

/** Tek kaydın detayı: ne zaman açıldı, kaç ay kaldı, hangi karttan, bu ay ödendi mi */
function RecordDetail({ ctx, m, rec, onEdit, onClose }) {
  const { it, table, kind, amt } = rec;
  const { uid, names, actions } = ctx;
  const paid = isPaid(it, m);
  const settled = (it.paid_months || []).includes(`${paidKey(m, uid)}:settled`);
  const payerName = it.payer_id === uid ? 'Sen' : names[it.payer_id] || 'Eşin';
  const started = kind === 'installment' ? it.first_month : kind === 'expense' ? it.date : it.created_at;
  const from = it.on_card ? (it.payer_id === uid ? 'Senin kredi kartın' : `${payerName}in kredi kartı`) : 'Nakit / havale';

  async function toggle() {
    if (settled) return alert('Bu ödeme hesaplaşmada gönderildi, işareti kaldırılamaz.');
    const p = it.paid_months || [];
    const key = paidKey(m, uid);
    await actions.patch(table, it.id, { paid_months: paid ? p.filter(x => x !== key && x !== m) : [...p, key] });
  }

  return html`
    <${Sheet} title=${it.name} onClose=${onClose}
      right=${html`<button class="link strong" onClick=${onEdit}>Düzenle</button>`}>
      <div class="card rows">
        <div class="row"><span>Tutar</span><b>${tl(amt)}</b></div>
        <div class="row"><span>Hangi karttan / nasıl</span><b>${from}</b></div>
        ${it.shared && html`<div class="row"><span>Kartı ödeyen</span><b>${payerName}</b></div>`}
        ${it.shared && html`<div class="row"><span>Bölüşüm</span><b>${it.split === 'half' ? 'Yarı yarıya' : 'Tamamı kart sahibine'}</b></div>`}
        <div class="row"><span>Ne zaman açıldı</span><b>${fmtDate(started)}</b></div>
        ${kind === 'installment' && html`<div class="row"><span>Toplam tutar<small class="muted"> · ${inst.total(it)} × ${tl(it.monthly_amount)}</small></span><b>${tl(Number(it.monthly_amount) * inst.total(it))}</b></div>`}
        ${kind === 'installment' && it.shared && it.split === 'half' && html`<div class="row"><span>Senin payın (toplam)</span><b>${tl(Number(it.monthly_amount) * inst.total(it) / 2)}</b></div>`}
        ${kind === 'installment' && html`<div class="row"><span>Kaç ay kaldı</span><b>${inst.remaining(it, m)} / ${inst.total(it)} taksit</b></div>`}
        ${kind === 'installment' && html`<div class="row"><span>Son taksit</span><b>${shortMonth(inst.last(it))}</b></div>`}
      </div>
      <div class="card hero center-text">
        <div class="muted">${monthName(m)} için</div>
        <div class=${'big ' + (paid ? 'pos' : 'warn')}>${paid ? 'Ödendi ✓' : 'Ödenmedi'}</div>
        ${settled
          ? html`<div class="sub">Hesaplaşmada gönderildi 🔒</div>`
          : html`<button class=${paid ? 'pill on' : 'primary'} onClick=${toggle}>${paid ? 'Ödenmedi yap' : 'Ödendi işaretle'}</button>`}
      </div>
    <//>`;
}

// ---------- Bakiye özeti ----------

/** Nakit bakiyenin dökümü. Hesaplaşma satırı, ortak kalemlerin mahsuplaşmış net tutarıdır. */
function nakitBreakdown(rows, uid, m, income, members) {
  const card = cardFor(rows, uid, m);
  const cardAmt = card ? Number(card.amount) || 0 : 0;
  const res = { income, cardAmt, expense: 0, installment: 0, fixed: 0, meHalf: 0, pHalf: 0, items: { expense: [], installment: [], fixed: [] } };
  const items = [
    ...rows.expenses.filter(e => mk(e.date) === m && !coveredByCard(e, uid, card, 'expenses')).map(it => ({ it, kind: 'expense', amt: Number(it.amount) || 0 })),
    ...rows.installments.filter(i => inst.active(i, m) && !coveredByCard(i, uid, card)).map(it => ({ it, kind: 'installment', amt: Number(it.monthly_amount) || 0 })),
    ...rows.fixed_payments.filter(f => !coveredByCard(f, uid, card, 'fixed_payments')).map(it => ({ it, kind: 'fixed', amt: Number(it.amount) || 0 })),
  ];
  items.forEach(({ it, kind, amt }) => {
    if (!it.shared) { if (it.payer_id === uid) { res[kind] += amt; res.items[kind].push({ it, amt }); } return; }
    if (it.payer_id === uid) { res[kind] += amt; res.items[kind].push({ it, amt }); if (it.split === 'half') res.meHalf += amt; }
    else if (it.split === 'half') res.pHalf += amt;
  });
  // Hesaplaşma ekranındaki ayın tutarı o ayın 5'inde ödenir: aynı ayın nakdinden düşer.
  // Gönderildi/alındı işaretlendiyse kayıttaki tutar esas alınır; yoksa kalemlerden hesaplanır.
  // Ekim 2026 öncesi aylar uygulamada takip edilmedi; onların hesaplaşması sayılmaz.
  const rec = (rows.settlements || []).find(x => x.month === m);
  const prevDone = !!(rec?.sent_at || rec?.received_at);
  const sCur = m >= '2026-10' ? settlementFor(rows, members || [], m) : null;
  const settleIn = prevDone
    ? (rec.from_id === uid ? -Number(rec.amount) : rec.to_id === uid ? Number(rec.amount) : 0) || 0
    : sCur && sCur.amount >= 1 ? (sCur.from === uid ? -sCur.amount : sCur.amount) : 0;
  // Hesaplaşma dışında doğrudan gönderilen ortak harcama payları da bu ayın nakdinde
  const direct = sumBy(sCur?.sentDirect || [], x => (x.payer === uid ? x.debt : -x.debt));
  res.settleIn = Math.round(settleIn * 100) / 100;
  res.settle = Math.round((settleIn + direct) * 100) / 100;
  const c = carryFor(rows, uid, m);
  res.carry = c ? Number(c.amount) || 0 : 0;
  res.left = income - cardAmt - res.expense - res.installment - res.fixed + res.settle + res.carry;
  // Henüz ödenmedi: tiklenmemiş kendi nakit kalemlerim + henüz gönderilmemiş hesaplaşma borcum
  const settleOwed = settleIn < 0 && !prevDone ? -settleIn : 0;
  const unpaidItems = ['expense', 'installment', 'fixed'].flatMap(k => res.items[k]).filter(({ it }) => !isPaid(it, it.date ? mk(it.date) : m, uid));
  res.unpaid = Math.round((settleOwed + sumBy(unpaidItems, ({ amt }) => amt)) * 100) / 100;
  res.out = cardAmt + res.expense + res.installment + res.fixed + Math.max(0, -res.settle);
  return res;
}

/** Kullanılan limit: bankadan girilen + bilgi tarihinden sonraki kart harcamaları − bilgi tarihinden sonraki kart ödemeleri */
function cardUsedNowFor(fin, rows, uid) {
  const usedAt = fin.card_used_at ? String(fin.card_used_at).slice(0, 10) : null;
  const newSpend = usedAt ? sumBy(rows.expenses.filter(e => e.payer_id === uid && onCardItem(e, 'expenses') && String(e.date).slice(0, 10) > usedAt), e => Number(e.amount) || 0) : 0;
  const paidSince = usedAt ? sumBy((rows.card_payments || []).filter(c => c.owner_id === uid && c.created_at && new Date(c.created_at).toLocaleDateString('sv-SE') > usedAt), c => Number(c.amount) || 0) : 0;
  return (Number(fin.card_used) || 0) + newSpend - paidSince;
}

/** Açılır grup: başlık ve toplam; dokununca aşağı açılır */
const OzetGroup = ({ id, title, total, open, onToggle, children, sign = 'out' }) => {
  const v = Number(total) || 0;
  const plus = sign === 'in' || (sign === 'auto' && v >= 0);
  return html`
    <div class="group" id=${id ? `og-${id}` : undefined}>
      <button class="group-head fold" onClick=${onToggle} aria-expanded=${open}>
        <span><span class=${'chev' + (open ? ' open' : '')}>›</span>${title}</span>
        <span class=${'g-total ' + signed(v, plus).tone}>${signed(v, plus).text}</span>
      </button>
      ${open && html`<div class="card">${children}</div>`}
    </div>`;
};

/** Kayıt satırı: dokununca hemen altında detay açılır */
function OzetItem({ ctx, m, it, table, kind, amt, open, onToggle, sign = 'out' }) {
  const { uid, names } = ctx;
  const paid = isPaid(it, m);
  const payer = it.payer_id === uid ? 'sen' : names[it.payer_id] || 'eşin';
  const started = kind === 'installment' ? it.first_month : kind === 'expense' ? it.date : it.created_at;
  return html`
    <div>
      <button class="item" onClick=${onToggle}>
        <span class="grow"><span class="title">${it.name}</span>
          <span class="sub">${kind === 'installment' ? `${inst.remaining(it, m)} taksit kaldı · ` : ''}${it.on_card ? 'kredi kartı' : 'nakit'}${it.shared ? ` · ortak (${payer} ödedi)` : ''}</span></span>
        <span class=${'amt ' + signed(amt, sign === 'in').tone}>${signed(amt, sign === 'in').text}</span>
      </button>
      ${open && html`<div class="detail-inline">
        <div class="row pad"><span>Ne zaman açıldı</span><b>${fmtDate(started)}</b></div>
        ${kind === 'installment' && html`<div class="row pad"><span>Kaç ay kaldı</span><b>${inst.remaining(it, m)} / ${inst.total(it)} taksit</b></div>`}
        ${kind === 'installment' && html`<div class="row pad"><span>Son taksit</span><b>${shortMonth(inst.last(it))}</b></div>`}
        <div class="row pad"><span>${monthName(m)}</span><b class=${paid ? 'pos' : 'warn'}>${paid ? 'Ödendi ✓' : 'Ödenmedi'}</b></div>
      </div>`}
    </div>`;
}

/** Bu Ay'ın altındaki döküm: nakit ya da kart tarafının grupları. Üstteki satırın okuyla gelinen grup açılır ve görünür olur. */
function OzetGroups({ ctx, m, view, focus }) {
  const { rows, uid, fin, members, names } = ctx;
  const [groupOpen, setGroupOpen] = useState({});
  const [itemOpen, setItemOpen] = useState(null);
  useEffect(() => {
    if (!focus?.key) return;
    setGroupOpen(g => ({ ...g, [focus.key]: true }));
    // Sadece sayfayı dikey kaydır (scrollIntoView kaydırmalı nakit/kart alanını yatay da kaydırıyordu)
    setTimeout(() => {
      const el = document.getElementById(`og-${focus.key}`);
      if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 12 });
    }, 120);
  }, [focus]);
  const b = nakitBreakdown(rows, uid, m, Number(fin.income) || 0, members);
  const sCur = settlementFor(rows, members, m);
  const cards = cardItems(rows, uid, m);
  const who = id => (id === uid ? 'Sen' : names[id] || 'Eşin');
  const toggleGroup = k => setGroupOpen({ ...groupOpen, [k]: !groupOpen[k] });
  // Tutarı 0 ve içi boş grup gösterilmez
  const g = (k, title, total, children, sign, empty) => (!Math.round((Number(total) || 0) * 100) && empty ? null
    : html`<${OzetGroup} id=${k} sign=${sign} title=${title} total=${total} open=${!!groupOpen[k]} onToggle=${() => toggleGroup(k)}>${children}<//>`);
  const itemKey = (k, id) => `${k}:${id}`;
  const itemsOf = (k, list, table, kind) => list.map(x => ({ ...x, table, kind, key: itemKey(k, x.it.id) }));
  const renderItems = list => list.map(x => html`<${OzetItem} key=${x.key} ctx=${ctx} m=${m} it=${x.it} table=${x.table}
    kind=${x.kind} amt=${x.amt ?? x.amount} sign=${x.sign || 'out'} open=${itemOpen === x.key} onToggle=${() => setItemOpen(itemOpen === x.key ? null : x.key)} />`);
  const cardKind = k => cards.filter(c => c.kind === k);

  if (view === 'kart') return html`<div class="ozet-groups">
    ${g('kpay', 'Kart ödemesi (kullanılabilir bakiyeyi artırır)', b.cardAmt, html`<div class="row pad"><span>Bu ay yaptığın ödeme</span><b>${tl(b.cardAmt)}</b></div>`, 'in', true)}
    ${g('kfixed', 'Aylık ödemelerden kartla', sumBy(cardKind('Her ay'), c => c.amount), renderItems(cardKind('Her ay').map(c => ({ ...c, key: itemKey('kfixed', c.it.id) }))), 'out', !cardKind('Her ay').length)}
    ${g('kinst', 'Taksitlerden kartla', sumBy(cardKind('Taksit'), c => c.amount), renderItems(cardKind('Taksit').map(c => ({ ...c, key: itemKey('kinst', c.it.id) }))), 'out', !cardKind('Taksit').length)}
    ${g('kexp', 'Harcamalardan kartla', sumBy(cardKind('Harcama'), c => c.amount), renderItems(cardKind('Harcama').map(c => ({ ...c, key: itemKey('kexp', c.it.id) }))), 'out', !cardKind('Harcama').length)}
    ${!cards.length && !b.cardAmt && html`<div class="card"><${Empty}>Bu ay kartla yapılan kayıt yok<//></div>`}
  </div>`;

  return html`<div class="ozet-groups">
    ${g('settle', 'Hesaplaşma', b.settleIn, html`
      ${(sCur?.lines || []).map(l => html`<div class="row pad" key=${l.id}><span>${l.name}<small class="muted"> · ${l.kind} · ${who(l.payer)} ödedi</small></span><b>${tl(l.amount / 2)}</b></div>`)}
      <div class="row pad"><span>${b.settleIn >= 0 ? 'Sana gelecek' : 'Sana gidecek'}</span><b class=${b.settleIn >= 0 ? 'pos' : 'warn'}>${tl(Math.abs(b.settleIn))}</b></div>`, 'auto', !sCur?.lines?.length)}
    ${g('direct', 'Ay içinde gönderilen ortak paylar', b.settle - b.settleIn, html`
      ${(sCur?.sentDirect || []).map(l => html`<div class="row pad" key=${l.id}><span>${l.name}<small class="muted"> · ${who(l.payer)} ödedi · ${l.when}</small></span><b>${tl(l.debt)}</b></div>`)}`, 'auto', !(sCur?.sentDirect || []).length)}
    ${g('card', 'Kredi kartı ödemesi', b.cardAmt, html`<div class="row pad"><span>Bu ay yaptığın kart ödemesi</span><b>${tl(b.cardAmt)}</b></div>`, 'out', true)}
    ${g('fixed', 'Aylık ödemeler', b.fixed, renderItems(itemsOf('fixed', b.items.fixed, 'fixed_payments', 'fixed')), 'out', !b.items.fixed.length)}
    ${g('installment', 'Taksitler', b.installment, renderItems(itemsOf('installment', b.items.installment, 'installments', 'installment')), 'out', !b.items.installment.length)}
    ${g('expense', 'Harcamalar', b.expense, renderItems(itemsOf('expense', b.items.expense, 'expenses', 'expense')), 'out', !b.items.expense.length)}
  </div>`;
}

/** Kart limiti göstergesi: kullanıldıkça çubuk yeşilden kırmızıya döner */
function CardGauge({ limit, used }) {
  const avail = Math.max(0, limit - used);
  const ratio = limit > 0 ? Math.min(1, Math.max(0, used / limit)) : 0;
  const hue = Math.round(120 * (1 - ratio));
  return html`
    <div class="gauge">
      <div class="muted">Kart limiti</div>
      <div class="big gauge-limit">${tl(limit)}</div>
      <div class="gauge-bar"><div style=${`width:${(ratio * 100).toFixed(1)}%;background:hsl(${hue} 70% 46%)`}></div></div>
      <div class="gauge-row">
        <span>Kullanılan <b>${tl(used)}</b></span>
        <span>Kullanılabilir <b class="gauge-avail" style=${`color:hsl(${hue} 70% 38%)`}>${tl(avail)}</b></span>
      </div>
    </div>`;
}

/** Bu Ay'daki kredi kartı paneli: limit, kullanılan, kalan; satırların oku aşağıdaki ilgili gruba götürür */
function CardPanel({ ctx, m, onLimit, onCard }) {
  const { rows, uid, fin } = ctx;
  const card = cardFor(rows, uid, m);
  const cardAmt = card ? Number(card.amount) || 0 : 0;
  const limit = Number(fin.card_limit) || 0;
  const used = cardUsedNowFor(fin, rows, uid);
  const remain = Math.max(0, limit - used);
  const cards = cardItems(rows, uid, m);
  const sumKind = k => sumBy(cards.filter(c => c.kind === k), c => c.amount);
  const debtLeft = Math.max(0, (Number(fin.card_debt) || 0) - cardAmt);
  const row = (key, label, amt, sign) => {
    const s = amt == null ? { text: 'Girilmedi', tone: 'muted' } : signed(amt, sign === 'in');
    return html`
    <div class="row"><span>${label}</span>
      <span class="flow-right"><b class=${s.tone}>${s.text}</b><button class="flow-btn" aria-label="Detayını gör" onClick=${() => ctx.goOzet(key, m)}>›</button></span></div>`;
  };
  return html`
    <div class="group">
      <div class="card hero">
        <${CardGauge} limit=${limit} used=${used} />
        <button class="link small" onClick=${onLimit}>💳 Kart bilgilerini güncelle</button>
      </div>
      <div class="card rows">
        <div class="row"><span>Kalan kart borcu</span><b class=${debtLeft > 0 ? 'warn' : 'pos'}>${tl(debtLeft)}</b></div>
        <div class="row"><span></span><button class="link small" onClick=${onCard}>${card ? 'Kart ödemesini düzenle' : 'Kart ödemesini gir'}</button></div>
      </div>
    </div>`;
}

/** Bu Ay'daki kategori grupları: ödenmemiş kaydı olan açık gelir */
const recSub = (x, m, uid, names) => [
  x.kind === 'expense' ? fmtDate(x.it.date) : x.kind === 'installment' ? `${inst.remaining(x.it, m)} taksit kaldı` : 'her ay',
  x.it.on_card ? 'kart' : 'nakit',
  x.it.shared ? (x.it.payer_id === uid ? 'ortak · senin kartın' : `ortak · ${names[x.it.payer_id] || 'eşin'} kartı`) : null,
].filter(Boolean).join(' · ');

function CategoryGroups({ ctx, m, side, onToggle, onOpen }) {
  const { rows, uid, names } = ctx;
  const [toggled, setToggled] = useState({});
  const onCardRec = x => x.it.payer_id === uid && onCardItem(x.it, x.table);
  const groups = recordGroups(rows, uid, m).map(g => {
    const items = g.items.filter(x => (side === 'kart') === onCardRec(x));
    return { ...g, items, total: sumBy(items, x => share(x.it, x.amt, uid)), hasUnpaid: items.some(x => !isPaid(x.it, m)) };
  });
  const isOpen = g => (g.id in toggled ? toggled[g.id] : g.hasUnpaid);
  return html`<div>
    ${groups.map(g => html`
      <div class="group" key=${g.id}>
        <button class="group-head fold" onClick=${() => setToggled({ ...toggled, [g.id]: !isOpen(g) })} aria-expanded=${isOpen(g)}>
          <span><span class=${'chev' + (isOpen(g) ? ' open' : '')}>›</span>${g.title}${g.hasUnpaid ? ' · ödenmemiş var' : ''}</span>
          <span>${tl(g.total)}</span>
        </button>
        ${isOpen(g) && html`<div class="card">
          ${g.items.map(x => html`<${PayRow} key=${x.it.id} title=${x.it.name} sub=${recSub(x, m, uid, names)}
            amount=${share(x.it, x.amt, uid)} full=${x.amt} paid=${isPaid(x.it, m)}
            onToggle=${() => onToggle(x.table, x.it)} onOpen=${() => onOpen(x)} />`)}
          ${!g.items.length && html`<${Empty}>Bu ay bu grupta kayıt yok<//>`}
        </div>`}
      </div>`)}
  </div>`;
}

// ---------- Hedefler ----------

function GoalsView({ ctx }) {
  const goals = ctx.rows.goals || [];
  const [editing, setEditing] = useState(null);
  return html`
    <${Group} title="Hedeflerim">
      ${goals.map(g => {
        const pct = g.target ? Math.min(100, Math.round((Number(g.saved) / Number(g.target)) * 100)) : 0;
        return html`
          <button class="item tall" key=${g.id} onClick=${() => setEditing({ item: g })}>
            <div class="grow">
              <div class="line"><span class="title">${g.name}</span><span>%${pct}</span></div>
              <div class="bar"><div style=${`width:${pct}%`} class=${pct >= 100 ? 'full' : ''}></div></div>
              <div class="sub">${tl(g.saved)} / ${tl(g.target)}</div>
            </div>
          </button>`;
      })}
      ${!goals.length && html`<${Empty}>Tatil, araba, ev… bir hedef ekle<//>`}
    <//>
    <button class="primary ghost" onClick=${() => setEditing({})}>+ Yeni hedef</button>
    <p class="hint">Hedefe biriken tutarı kendin güncelle. Sadece sen görürsün.</p>
    ${editing && html`<${GoalForm} ctx=${ctx} item=${editing.item} onClose=${() => setEditing(null)} />`}`;
}

function GoalForm({ ctx, item, onClose }) {
  const [name, setName] = useState(item?.name || '');
  const [target, setTarget] = useState(Number(item?.target || 0));
  const [saved, setSaved] = useState(Number(item?.saved || 0));
  async function save() {
    if (!name.trim() || !(target > 0)) return;
    const row = { name: name.trim(), target, saved };
    const ok = item ? await ctx.actions.patch('goals', item.id, row) : await ctx.actions.add('goals', row);
    if (ok !== false) onClose();
  }
  async function remove() {
    if (!confirm(`"${item.name}" hedefi silinsin mi?`)) return;
    await ctx.actions.del('goals', item.id);
    onClose();
  }
  return html`
    <${Sheet} title=${item ? 'Hedefi düzenle' : 'Yeni hedef'} onClose=${onClose}
      right=${html`<button class="link strong" onClick=${save}>Kaydet</button>`}>
      <div class="card form">
        <label class="field"><input placeholder="Hedef (ör. Tatil, Araba)" value=${name} onInput=${e => setName(e.target.value)} /></label>
        <label class="field"><span>Hedef tutar</span><${MoneyInput} value=${target} onInput=${setTarget} /></label>
        <label class="field"><span>Şu an biriken</span><${MoneyInput} value=${saved} onInput=${setSaved} /></label>
      </div>
      ${item && html`<button class="danger" onClick=${remove}>Sil</button>`}
    <//>`;
}

// ---------- Devir ----------

function CarrySheet({ ctx, ask, onClose }) {
  const { actions } = ctx;
  const [busy, setBusy] = useState(false);
  const markAsked = () => { try { sessionStorage.setItem(`tf-carry-asked-${ask.now}`, '1'); } catch { /* yok say */ } };
  async function answer(amount) {
    setBusy(true);
    const ok = await actions.add('carryovers', { month: ask.now, amount });
    markAsked();
    if (ok !== false) onClose();
    setBusy(false);
  }
  return html`
    <${Sheet} title="📅 Devir" onClose=${() => { markAsked(); onClose(); }}>
      <div class="card hero center-text">
        <div class="muted">${monthName(ask.prev)} ayından kalan nakit bakiyen</div>
        <div class="big pos">${tl(ask.amount)}</div>
        <p class="hint">Bu tutarı ${monthName(ask.now)} ayının nakit bakiyesine ekleyelim mi?</p>
        <button class="primary" disabled=${busy} onClick=${() => answer(ask.amount)}>Devret</button>
        <button class="link small" disabled=${busy} onClick=${() => answer(0)}>Devretme</button>
      </div>
    <//>`;
}

// ---------- Bildirimler ----------

/** Eşe gidecek bildirim; şahsi kayıtlar için null (onlar gizli kalır) */
function notifyText(table, r, who) {
  if (table === 'wishlist') return { type: 'wish', title: '🛋️ Alacaklara eklendi', body: `${who}: ${r.name}${Number(r.price) ? ` · ${tl(r.price)}` : ''}` };
  if (!r.shared) return null;
  if (table === 'expenses') return { type: 'shared', title: '🛍️ Yeni ortak harcama', body: `${who}: ${r.name} · ${tl(r.amount)}` };
  if (table === 'installments') return { type: 'shared', title: '💳 Yeni ortak taksit', body: `${who}: ${r.name} · ${tl(r.monthly_amount)} × ${inst.total(r)} ay` };
  if (table === 'fixed_payments') return { type: 'shared', title: '🔁 Yeni ortak aylık ödeme', body: `${who}: ${r.name} · ${tl(r.amount)}` };
  return null;
}

function b64ToBytes(b64) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
}

function PushSettings() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const [state, setState] = useState(supported ? Notification.permission : 'unsupported');
  const [busy, setBusy] = useState(false);

  async function enable() {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      setState(perm);
      if (perm !== 'granted') return;
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription())
        || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY) }));
      await api.savePush(sub.toJSON());
      celebrate('Bildirimler açık!');
    } catch (err) {
      alert('Bildirim açılamadı: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    try {
      const r = await api.notify({ test: true });
      if (!r?.sent) alert('Bu cihaz için kayıt bulunamadı. Önce "Yenile" deyip tekrar dene.');
    } catch (err) {
      alert('Test gönderilemedi: ' + err.message);
    } finally {
      setBusy(false);
    }
  }

  let content;
  if (DEMO || !VAPID_PUBLIC_KEY) content = html`<div class="row pad"><span class="muted">Supabase kurulunca açılır</span></div>`;
  else if (!supported) content = html`<div class="row pad"><span class="muted">${standalone ? 'Bu cihaz bildirim desteklemiyor (iOS 16.4+ gerekir)' : 'Önce Safari → Paylaş → Ana Ekrana Ekle, sonra oradan açın'}</span></div>`;
  else if (state === 'denied') content = html`<div class="row pad"><span class="muted">Kapalı. Ayarlar → Bildirimler bölümünden açabilirsiniz.</span></div>`;
  else content = html`<div class="row pad"><span>${state === 'granted' ? 'Bu cihazda açık ✓' : 'Eşin ortak bir şey ekleyince haber ver'}</span>
    <button class="pill on" disabled=${busy} onClick=${enable}>${state === 'granted' ? 'Yenile' : 'Aç'}</button></div>
    ${state === 'granted' && html`<div class="row pad"><span>Kurulumu dene</span>
      <button class="pill on" disabled=${busy} onClick=${sendTest}>Bana test gönder</button></div>`}`;

  return html`<${Group} title="Bildirimler">${content}<//>`;
}

function ExitShowSheet({ onClose }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      await exitShowMode(pw);
      location.reload();
    } catch {
      setMsg('Şifre hatalı');
      setBusy(false);
    }
  }
  return html`
    <${Sheet} title="Gerçek verilere dön" onClose=${onClose}>
      <form onSubmit=${submit}>
        <div class="card form">
          <label class="field"><input type="password" autocomplete="current-password" placeholder="Hesap şifren" value=${pw} onInput=${e => setPw(e.target.value)} required autofocus /></label>
        </div>
        <button class="primary" type="submit" disabled=${busy || !pw}>Çık</button>
        ${msg && html`<p class="hint center">${msg}</p>`}
      </form>
    <//>`;
}

// ---------- Giriş & kurulum ----------

function AuthScreen({ onDone }) {
  const [mode, setMode] = useState('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const s = mode === 'in' ? await api.signIn(email.trim(), pw) : await api.signUp(email.trim(), pw);
      if (s) onDone();
      else setMsg('E-postana gelen onay linkine tıkla, sonra buradan giriş yap.');
    } catch (err) {
      setMsg(err.message.includes('Invalid login') ? 'E-posta ya da şifre hatalı' : err.message);
    }
    setBusy(false);
  }

  return html`
    <div class="welcome">
      <div class="logo">🏡</div>
      <h1>${APP_NAME}</h1>
      <p class="muted">Taksitler, ödemeler, alışveriş</p>
      <${Seg} value=${mode} onChange=${setMode} options=${[['in', 'Giriş yap'], ['up', 'Hesap aç']]} />
      <form class="card form" onSubmit=${submit}>
        <label class="field"><input type="email" autocomplete="email" placeholder="E-posta" value=${email} onInput=${e => setEmail(e.target.value)} required /></label>
        <label class="field"><input type="password" autocomplete=${mode === 'in' ? 'current-password' : 'new-password'} placeholder="Şifre (en az 6 karakter)" value=${pw} onInput=${e => setPw(e.target.value)} required minlength="6" /></label>
        <button class="primary" type="submit" disabled=${busy}>${mode === 'in' ? 'Giriş yap' : 'Hesap aç'}</button>
      </form>
      ${msg && html`<p class="hint center">${msg}</p>`}
    </div>`;
}

function SetupScreen({ onDone }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('create');
  const [code, setCode] = useState('');
  const [family, setFamily] = useState(APP_NAME);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      if (mode === 'create') {
        const h = await api.rpc('create_household', { p_name: family, p_display_name: name.trim() });
        const seed = Object.entries(DEFAULT_SHOPPING).flatMap(([category, names]) => names.map(n => ({ household_id: h.id, name: n, category })));
        await api.insert('shopping_items', seed);
      } else {
        await api.rpc('join_household', { p_code: code, p_display_name: name.trim() });
      }
      onDone();
    } catch (err) {
      setMsg(err.message);
      setBusy(false);
    }
  }

  return html`
    <div class="welcome">
      <div class="logo">👋</div>
      <h1>Hoş geldin</h1>
      <form onSubmit=${submit}>
        <div class="card form">
          <label class="field"><input placeholder="Adın" value=${name} onInput=${e => setName(e.target.value)} required /></label>
        </div>
        ${!DEMO && html`<${Seg} value=${mode} onChange=${setMode} options=${[['create', 'Aile oluştur'], ['join', 'Davet koduyla katıl']]} />`}
        <div class="card form">
          ${mode === 'create'
            ? html`<label class="field"><span>Aile adı</span><input value=${family} onInput=${e => setFamily(e.target.value)} /></label>`
            : html`<label class="field"><input placeholder="Davet kodu" value=${code} onInput=${e => setCode(e.target.value.toUpperCase())} required /></label>`}
        </div>
        <button class="primary" type="submit" disabled=${busy || !name.trim()}>Devam</button>
      </form>
      ${mode === 'create' && html`<p class="hint center">Eşin daha sonra davet koduyla aynı aileye katılır.</p>`}
      ${msg && html`<p class="hint center">${msg}</p>`}
    </div>`;
}

// ---------- Birleşik sekmeler ----------

/** Alışveriş sekmesi: üstte Market / Alacaklar seçimi */
function ListsScreen({ ctx }) {
  const [part, setPartState] = useState(() => { try { return localStorage.getItem('tf-lists') || 'shop'; } catch { return 'shop'; } });
  const setPart = v => { setPartState(v); window.scrollTo(0, 0); try { localStorage.setItem('tf-lists', v); } catch { /* yok say */ } };
  const open = ctx.rows.shopping_items.filter(i => i.in_list && !i.checked);
  const listCount = open.filter(i => !i.owner_id).length;
  const mineCount = open.filter(i => i.owner_id === ctx.uid).length;
  const wishCount = ctx.rows.wishlist.filter(w => !w.bought).length;
  const n = c => (c ? ` (${c})` : '');
  return html`
    <header class="top"><h1>Alışveriş</h1></header>
    <${Seg} value=${part} onChange=${setPart}
      options=${[['shop', `🛒 Market${n(listCount)}`], ['mine', `👤 Kişisel${n(mineCount)}`], ['wish', `🛋️ Alacaklar${n(wishCount)}`]]} />
    ${part === 'wish' ? html`<${WishScreen} ctx=${ctx} embedded />`
      : html`<${ShoppingScreen} ctx=${ctx} embedded personal=${part === 'mine'} key=${part} />`}`;
}

/** Hesaplaşma sekmesi */
function SettleScreen({ ctx }) {
  return html`
    <header class="top"><h1>Hesaplaşma</h1></header>
    <${SettleView} ctx=${ctx} />`;
}

// ---------- Uygulama ----------

const TABS = [
  ['shop', 'Alışveriş', '🛒'],
  ['settle', 'Hesaplaşma', '💸'],
  ['month', 'Özet', null],
  ['records', 'Kayıtlar', '🗂️'],
  ['money', 'Ben', '👤'],
];

/** Bu Ay sekmesinin simgesi: bugünün ayı ve günü */
const TodayIcon = () => {
  const d = new Date();
  return html`<span class="cal"><span class="cal-m">${AYLAR[d.getMonth()].slice(0, 3).toLocaleUpperCase('tr')}</span><span class="cal-d">${d.getDate()}</span></span>`;
};

/** Her sekmede duran, sürüklenebilir "Harcama ekle" butonu */
const fabPrefs = () => {
  try { return { locked: localStorage.getItem('tf-fab-lock') === '1' }; }
  catch { return { locked: false }; }
};

// ---------- Banka e-postalarından gelen harcamalar ----------

const localDay = t => new Date(t).toLocaleDateString('sv-SE');
const whenShort = t => new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Banka hareketinin eşleşebileceği kayıtlar: tutarı en yakın olan üstte.
 *  Kart: benim kart/harcama kayıtlarım. Giden para: nakit kayıtlarım + göndereceğim hesaplaşma. Gelen para: alacağım hesaplaşma. */
function matchCandidates(ctx, ev) {
  const { rows, uid, members } = ctx;
  const day = localDay(ev.occurred_at);
  const m = mk(day);
  const from = localDay(Date.parse(day) - 40 * 86400000);
  const to = localDay(Date.parse(day) + 10 * 86400000);
  const used = new Set((rows.bank_events || []).filter(e => e.status === 'matched' && e.id !== ev.id && (e.matched_table === 'expenses' || mk(localDay(e.occurred_at)) === m)).map(e => e.matched_id));
  // Ekim 2026 öncesi aylar takip edilmedi; onların hesaplaşması önerilmez
  const settles = [addM(m, -1), m, addM(m, 1)].filter(month => month >= '2026-10').map(month => {
    const st = settlementFor(rows, members, month);
    const rec = rows.settlements.find(x => x.month === month);
    const mine = ev.kind === 'out' ? st?.from === uid && !rec?.sent_at : st?.to === uid && !rec?.received_at;
    return st && st.amount >= 1 && mine
      ? { it: { id: `s-${month}`, name: `Hesaplaşma · ${monthName(month)}` }, table: 'settlements', month, kind: ev.kind === 'out' ? 'Gönderilecek hesaplaşma' : 'Gelecek hesaplaşma', amount: st.amount, sub: `ödeme günü 5 ${AYLAR[Number(month.slice(5, 7)) - 1]}` }
      : null;
  }).filter(Boolean);
  if (ev.kind === 'in') return settles;
  const cash = ev.kind === 'out';
  const list = [
    ...rows.expenses.filter(e => e.payer_id === uid && Number(e.amount) > 0 && e.date >= from && e.date <= to
      && (cash ? !e.on_card && !isPaid(e, mk(e.date), uid) : true))
      .map(it => ({ it, table: 'expenses', kind: 'Harcama', amount: Number(it.amount), sub: fmtDate(it.date) })),
    ...rows.fixed_payments.filter(f => f.payer_id === uid && (cash ? !onCardItem(f, 'fixed_payments') && !isPaid(f, m, uid) : true))
      .map(it => ({ it, table: 'fixed_payments', kind: 'Her ay', amount: Number(it.amount), sub: monthName(m) })),
    ...rows.installments.filter(i => i.payer_id === uid && inst.active(i, m) && (cash ? !onCardItem(i) && !isPaid(i, m, uid) : true))
      .map(it => ({ it, table: 'installments', kind: 'Taksit', amount: Number(it.monthly_amount), sub: `${inst.remaining(it, m)} taksit kaldı` })),
  ].filter(c => !used.has(c.it.id));
  return [...(cash ? settles : []), ...list].sort((a, b) => Math.abs(a.amount - ev.amount) - Math.abs(b.amount - ev.amount)).slice(0, 15);
}

const BANK_KIND = { card: '💳 Kart harcaması', out: '↗️ Giden para', in: '↙️ Gelen para' };

/** Uygulama açılınca ekranın ortasında: bankadan gelen ve henüz işlenmemiş hareketler, birer birer */
function BankInboxSheet({ ctx, events, onNew, onClose }) {
  const { fin, actions } = ctx;
  const [idx, setIdx] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => { lockScroll(); return unlockScroll; }, []);
  const i = Math.min(idx, events.length - 1);
  const ev = events[i];
  const go = n => { setIdx(n); setOpen(false); };
  const done = (e, p) => { setOpen(false); return actions.patch('bank_events', e.id, p); };
  if (!ev) return null;

  async function match(c) {
    const day = localDay(ev.occurred_at);
    if (c.table === 'settlements') {
      const kind = ev.kind === 'out' ? 'sent' : 'received';
      if (!confirm(`${c.it.name} ${kind === 'sent' ? '"Gönderildi"' : '"Alındı"'} olarak işaretlensin mi?${Math.abs(c.amount - ev.amount) >= 1 ? `\n\nHesaplaşma ${tl(c.amount)}, bankadaki tutar ${tl(ev.amount)}.` : ''}`)) return;
      if (await settleMark(ctx, c.month, kind, true) === false) return;
      await done(ev, { status: 'matched', matched_table: 'settlements' });
      return;
    }
    const p = {};
    if (c.table === 'expenses') {
      if (Math.abs(c.amount - ev.amount) >= 0.01
        && confirm(`Tutar ${tl(c.amount)} yerine bankadaki ${tl(ev.amount)} olarak güncellensin mi?`)) p.amount = ev.amount;
      p.date = day;
      if (c.it.pay_date) p.pay_date = c.it.pay_date === c.it.date ? day : settleDay(day, cutDayOf(ctx.members, c.it.payer_id));
    }
    if (ev.kind === 'card') {
      if (c.table === 'expenses') p.on_card = true;
    } else {
      // Nakit ödeme yapıldı: kaydı "ödendi" işaretle
      const key = paidKey(mk(day), ctx.uid);
      const pm = c.it.paid_months || [];
      if (!pm.includes(key)) p.paid_months = [...pm, key];
    }
    if (Object.keys(p).length) await actions.patch(c.table, c.it.id, p);
    await done(ev, { status: 'matched', matched_table: c.table, matched_id: c.it.id });
    celebrate('Eşleştirildi!');
  }

  const cands = open ? matchCandidates(ctx, ev) : [];
  const isIn = ev.kind === 'in';
  const isCardPay = ev.kind === 'out' && ev.merchant === 'Kredi kartı ödemesi';
  async function cardPay() {
    const m = mk(localDay(ev.occurred_at));
    const prev = Number(cardFor(ctx.rows, ctx.uid, m)?.amount) || 0;
    if (!confirm(`${monthName(m)} kart ödemesi olarak kaydedilsin mi?${prev ? `\n\nBu ay daha önce ${tl(prev)} girilmiş; toplam ${tl(prev + ev.amount)} olur.` : ''}`)) return;
    if (await saveCardPayment(ctx, m, prev + ev.amount) === false) return;
    await done(ev, { status: 'matched', matched_table: 'card_payments' });
  }
  return html`
    <div class="backdrop center" onClick=${onClose}>
      <div class="modal" onClick=${e => e.stopPropagation()}>
        <div class="modal-top">
          <span class="muted">🔔 Bankada yeni hareket${events.length > 1 ? ` · ${i + 1}/${events.length}` : ''}</span>
          <button class="link" onClick=${onClose}>Sonra</button>
        </div>
        <div class="modal-kind">${BANK_KIND[ev.kind]}</div>
        <div class=${'modal-amount ' + (isIn ? 'pos' : 'neg')}>${isIn ? '+' : '−'} ${tl(ev.amount)}</div>
        ${ev.merchant && html`<div class="modal-who">${ev.merchant}</div>`}
        <div class="muted">${whenShort(ev.occurred_at)}</div>
        ${fin.bank_balance != null && html`<div class="modal-bal"><span>Güncel bakiye<small class="muted"> · ${whenShort(fin.bank_balance_at)}</small></span><b>${tl(fin.bank_balance)}</b></div>`}
        <div class="modal-actions">
          ${isCardPay && html`<button class="primary" onClick=${cardPay}>💳 Kart ödemesi olarak kaydet</button>`}
          <button class=${isCardPay ? 'primary ghost' : 'primary'} onClick=${() => setOpen(!open)}>🔗 ${isIn ? 'Hesaplaşma geldi' : 'Bir kayıtla eşleştir'}</button>
          ${!isIn && html`<button class="primary ghost" onClick=${() => onNew(ev)}>+ ${ev.kind === 'card' ? 'Yeni harcama olarak ekle' : 'Harcama olarak ekle'}</button>`}
          <button class="link" onClick=${() => done(ev, { status: 'ignored' })}>${ev.kind === 'card' ? 'Yok say' : ev.kind === 'out' ? 'Kendi hesabıma gönderdim · yok say' : 'Kendi hesabımdan geldi · yok say'}</button>
        </div>
        ${open && html`<div class="detail-inline modal-list">
          <div class="row pad"><small class="muted">${isIn ? 'Hangi hesaplaşmanın parası geldi?' : 'Hangi kaydınla aynı? Tutarı en yakın olanlar üstte.'}</small></div>
          ${cands.map(c => html`
            <button class="item" key=${c.table + c.it.id} onClick=${() => match(c)}>
              <span class="grow"><span class="title">${c.it.name}</span><span class="sub">${c.kind} · ${c.sub}${c.it.on_card ? ' · kart' : ''}</span></span>
              <span class="amt">${tl(c.amount)}</span></button>`)}
          ${!cands.length && html`<${Empty}>${isIn ? 'Bekleyen bir hesaplaşma yok; kendi hesabından geldiyse yok say' : ev.kind === 'out' ? 'Eşleşecek kayıt yok; harcama olarak ekle ya da yok say' : 'Eşleşecek kayıt yok, yeni harcama olarak ekle'}<//>`}
        </div>`}
        ${events.length > 1 && html`<div class="modal-nav">
          <button class="link" disabled=${i === 0} onClick=${() => go(i - 1)}>‹ Önceki</button>
          <button class="link" disabled=${i >= events.length - 1} onClick=${() => go(i + 1)}>Sonraki ›</button>
        </div>`}
      </div>
    </div>`;
}

const BANK_STATUS = { pending: 'Bekliyor', added: 'Harcama olarak eklendi', matched: 'Eşleştirildi', ignored: 'Yok sayıldı' };

/** Ben > Banka hareketleri: bekleyenler, işlenenler (geri alınabilir) ve bakiye bildirimleri */
function BankHistoryView({ ctx }) {
  const { rows, uid, actions, fin } = ctx;
  const mine = (rows.bank_events || []).filter(e => e.owner_id === uid).sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  const moves = mine.filter(e => e.kind !== 'balance');
  const pending = moves.filter(e => e.status === 'pending');
  const done = moves.filter(e => e.status !== 'pending').slice(0, 60);
  const balances = mine.filter(e => e.kind === 'balance').slice(0, 10);
  const linked = e => {
    if (e.status !== 'matched') return '';
    if (e.matched_table === 'settlements') return ' · hesaplaşma';
    if (e.matched_table === 'card_payments') return ' · kart ödemesi';
    const it = (rows[e.matched_table] || []).find(x => x.id === e.matched_id);
    return it ? ` · ${it.name}` : '';
  };
  async function undo(e) {
    if (!confirm('Bu hareket tekrar "bekliyor" olsun mu?\n\nEşleştirme ya da eklemeyle kayıtlarda yapılan değişiklikler geri alınmaz; gerekirse kaydı kendin düzelt.')) return;
    await actions.patch('bank_events', e.id, { status: 'pending', matched_table: null, matched_id: null });
  }
  const row = e => html`
    <div class="row pad" key=${e.id}>
      <span>${e.merchant || BANK_KIND[e.kind]}<small class="muted"> · ${BANK_KIND[e.kind]} · ${whenShort(e.occurred_at)}<br />${BANK_STATUS[e.status]}${linked(e)}</small></span>
      <span class="flow-right" style="flex-direction: column; align-items: flex-end">
        <b class=${e.kind === 'in' ? 'pos' : 'neg'} style="white-space: nowrap">${e.kind === 'in' ? '+' : '−'} ${tl(e.amount)}</b>
        ${e.status !== 'pending' && html`<button class="link small" onClick=${() => undo(e)}>Geri al</button>`}
      </span>
    </div>`;
  return html`
    ${fin.bank_balance != null && html`<div class="card hero">
      <div class="muted">Bankadaki bakiye · ${whenShort(fin.bank_balance_at)}</div>
      <div class="big">${tl(fin.bank_balance)}</div>
    </div>`}
    <${Group} title=${`Bekleyenler (${pending.length})`}>
      ${pending.map(row)}
      ${!pending.length && html`<${Empty}>Bekleyen hareket yok<//>`}
    <//>
    ${pending.length > 0 && html`<button class="primary" onClick=${ctx.openBank}>Bekleyenleri şimdi işle</button>`}
    <${Group} title="İşlenenler">
      ${done.map(row)}
      ${!done.length && html`<${Empty}>Henüz işlenen hareket yok<//>`}
    <//>
    <${Group} title="Bakiye bildirimleri">
      ${balances.map(e => html`<div class="row pad" key=${e.id}><span>${whenShort(e.occurred_at)}</span><b>${tl(e.amount)}</b></div>`)}
      ${!balances.length && html`<${Empty}>Henüz bakiye bildirimi gelmedi<//>`}
    <//>`;
}

/** Ayarlar: bankadan otomatik aktarım kaynağı (kapalı / e-posta / SMS; aynı anda biri) ve kurulum bilgileri */
function BankLinkSettings({ ctx }) {
  const { rows, uid, members, savePrefs } = ctx;
  const link = (rows.bank_links || []).find(l => l.user_id === uid) || (rows.bank_links || [])[0];
  const prefs = members.find(m => m.user_id === uid)?.notify_prefs || {};
  const source = prefs.bank_source || 'off';
  const [copied, setCopied] = useState('');
  const address = SUPABASE_URL && link ? `${SUPABASE_URL}/functions/v1/bank?k=${link.token}` : '';
  async function copy(k, v) {
    try { await navigator.clipboard.writeText(v); setCopied(k); setTimeout(() => setCopied(''), 1500); } catch { /* ekranda görünüyor */ }
  }
  const btn = (k, label, v) => html`<button class="code" onClick=${() => copy(k, v)}>${copied === k ? 'Kopyalandı' : label}</button>`;
  if (!SUPABASE_URL) return html`<${Group} title="Bankadan otomatik aktarım"><${Empty}>Deneme modunda kullanılamaz<//><//>`;
  return html`
    <${Group} title="Bankadan otomatik aktarım">
      <div class="field col">
        <span>Kart harcamaları ve bakiye nereden gelsin?<small>İkisi aynı anda açık olmaz, böylece harcama iki kez gelmez</small></span>
        <${Seg} value=${source} onChange=${v => savePrefs({ ...prefs, bank_source: v === 'off' ? null : v })}
          options=${[['off', 'Kapalı'], ['email', '✉️ E-posta'], ['sms', '💬 SMS']]} />
      </div>
      ${source !== 'off' && !link && html`
        <div class="row pad"><span>Önce kişisel bağlantı anahtarını oluştur</span></div>
        <button class="primary ghost" onClick=${() => ctx.actions.insertRaw('bank_links', {})}>Anahtar oluştur</button>`}
      ${source === 'email' && link && html`
        <div class="row pad"><span>Gmail betiği<small class="muted"> · içinde kişisel anahtarın var, paylaşma</small></span>
          ${btn('e', 'Betik ayarlarını kopyala', [`const ADRES = '${address}';`, `const ACIK_ANAHTAR = '${SUPABASE_ANON_KEY}';`].join('\n'))}</div>`}
      ${source === 'sms' && link && html`
        <div class="row pad"><span>1. Adres<small class="muted"> · paylaşma</small></span>${btn('u', 'Kopyala', address)}</div>
        <div class="row pad"><span>2. Yetki (Authorization)</span>${btn('h', 'Kopyala', `Bearer ${SUPABASE_ANON_KEY}`)}</div>`}
    <//>
    ${source === 'email' && link && html`<p class="hint">script.google.com'daki betikte const ADRES ve const ACIK_ANAHTAR satırlarını bununla değiştir.</p>`}
    ${source === 'sms' && link && html`<div class="hint">
      <b>iPhone'da kurulum (bir kez):</b><br />
      Kestirmeler → Otomasyon → + → <b>Mesaj</b> → Gönderen: Yapı Kredi (ya da "Mesaj içerir: TL") → <b>Hemen Çalıştır</b> → İleri<br />
      Yeni boş otomasyon → eylem ekle: <b>URL'nin İçeriklerini Al</b><br />
      · URL: 1. Adres<br />
      · Yöntem: POST · Başlıklar: <b>Authorization</b> = 2. Yetki<br />
      · İstek Gövdesi: JSON → <b>source</b> (Metin) = sms · <b>text</b> (Metin) = Kestirme Girdisi<br />
      Bankadan SMS gelince kart harcaması uygulamayı açtığında "Yeni harcama belirlendi" olarak sorulur, bakiye Bu Ay ekranında görünür.</div>`}`;
}

function QuickAdd({ onTap }) {
  const [prefs, setPrefs] = useState(fabPrefs);
  const [pos, setPos] = useState(() => { try { return JSON.parse(localStorage.getItem('tf-fab')) || null; } catch { return null; } });
  const drag = useRef(null);
  const latest = useRef(pos);
  const wrap = useRef(null);
  useEffect(() => {
    const on = () => setPrefs(fabPrefs());
    window.addEventListener('tf-fab-change', on);
    return () => window.removeEventListener('tf-fab-change', on);
  }, []);
  const down = e => {
    if (prefs.locked) { drag.current = { tap: true }; return; }
    const r = wrap.current.getBoundingClientRect();
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
  };
  const move = e => {
    const d = drag.current;
    if (!d || d.tap) return;
    if (Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 6) d.moved = true;
    if (!d.moved) return;
    const r = wrap.current.getBoundingClientRect();
    latest.current = {
      x: Math.min(window.innerWidth - r.width, Math.max(0, e.clientX - d.dx)),
      y: Math.min(window.innerHeight - r.height - 90, Math.max(8, e.clientY - d.dy)),
    };
    setPos(latest.current);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.tap || !d.moved) { onTap(); return; }
    // Bırakınca en yakın kenara yapış (ortada kalmasın)
    const r = wrap.current.getBoundingClientRect();
    const midX = latest.current.x + r.width / 2;
    latest.current = { x: midX < window.innerWidth / 2 ? 0 : window.innerWidth - r.width, y: latest.current.y };
    setPos(latest.current);
    try { localStorage.setItem('tf-fab', JSON.stringify(latest.current)); } catch { /* yok say */ }
  };
  return html`
    <div class="quick-wrap" ref=${wrap} style=${pos ? `left:${Math.min(pos.x, window.innerWidth - 80)}px;top:${pos.y}px;right:auto;bottom:auto` : ''}
      onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${() => { drag.current = null; }}>
      <button class="quick-btn" aria-label="Harcama ekle">+</button>
      <span class="quick-label">Harcama gir</span>
    </div>`;
}

function App() {
  const [phase, setPhase] = useState('loading');
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [members, setMembers] = useState([]);
  const [household, setHousehold] = useState(null);
  const [rows, setRows] = useState(null);
  const [fin, setFin] = useState(null);
  const [exitingShow, setExitingShow] = useState(false);
  const [askCard, setAskCard] = useState(false);
  const [askCarry, setAskCarry] = useState(null);
  const [quick, setQuick] = useState(false);
  const [bankOpen, setBankOpen] = useState(true);
  const [bankNew, setBankNew] = useState(null);
  // Her açılışta Bu Ay'dan başla
  const [tab, setTab] = useState('month');

  const hist = useRef([]);
  const edge = useRef(null);
  const goTab = id => {
    if (id === tab) return;
    hist.current = [...hist.current.slice(-19), tab];
    setTab(id);
    window.scrollTo(0, 0);
  };
  const back = () => {
    const prev = hist.current.pop();
    if (!prev) return;
    setTab(prev);
    window.scrollTo(0, 0);
  };
  const onEdgeStart = e => {
    const t = e.touches[0];
    edge.current = t.clientX < EDGE_PX ? { x: t.clientX, y: t.clientY } : null;
  };
  const onEdgeEnd = e => {
    const s = edge.current;
    edge.current = null;
    // Açık bir pencere (sayfa, form, onay) varsa geri gitme yapılmaz
    if (!s || quick || askCard || exitingShow || askCarry || document.querySelector('.backdrop')) return;
    const t = e.changedTouches[0];
    if (t.clientX - s.x > 70 && Math.abs(t.clientY - s.y) < 60) back();
  };

  async function reload() {
    const entries = await Promise.all(TABLES.map(async t => [t, await api.select(t)]));
    setRows(Object.fromEntries(entries));
    setMembers(await api.select('members'));
  }

  async function boot() {
    try {
      const s = await api.session();
      if (!s) return setPhase('auth');
      setUser(s.user);
      const mem = await api.select('members');
      if (!mem.some(m => m.user_id === s.user.id)) return setPhase('setup');
      const [h] = await api.select('households');
      setHousehold(h);
      await reload();
      setFin((await api.finance(s.user.id)) || { user_id: s.user.id, income: 0, savings_tl: 0, usd_amount: 0, usd_rate: 0 });
      setPhase('ready');
    } catch (err) {
      setError(err.message);
      setPhase('error');
    }
  }

  useEffect(() => { boot(); }, []);
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && phase === 'ready') reload().catch(() => {}); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [phase]);

  // Her açılışta: bu ayın kart ödemesi girilmediyse sor ("Sonra gireceğim" sadece bu açılış için)
  useEffect(() => {
    if (phase !== 'ready' || SHOW || !rows) return;
    const m = thisMonth();
    let asked = false;
    try { asked = sessionStorage.getItem(`tf-card-asked-${m}`) === '1'; } catch { /* yok say */ }
    if (!asked && !cardFor(rows, user.id, m)) setAskCard(true);
  }, [phase, rows === null]);
  // Ayın 5'inden sonra: önceki ayda nakit bakiye kaldıysa devir sor (bir kez; Ekim 2026'dan önceki aylar hariç)
  useEffect(() => {
    if (phase !== 'ready' || SHOW || !rows || !user || askCard) return;
    const now = thisMonth();
    const prev = addM(now, -1);
    if (new Date().getDate() < 5 || prev < '2026-10') return;
    if (carryFor(rows, user.id, now)) return;
    let asked = false;
    try { asked = sessionStorage.getItem(`tf-carry-asked-${now}`) === '1'; } catch { /* yok say */ }
    if (asked) return;
    const left = nakitLeftFor(rows, user.id, prev, Number(fin?.income) || 0, members);
    if (left > 0) setAskCarry({ prev, now, amount: Math.round(left) });
  }, [phase, rows === null, askCard]);
  const closeCardAsk = () => {
    setAskCard(false);
    try { sessionStorage.setItem(`tf-card-asked-${thisMonth()}`, '1'); } catch { /* yok say */ }
  };

  async function guard(fn) {
    try { await fn(); return true; } catch (err) { alert('Kaydedilemedi: ' + err.message); reload().catch(() => {}); return false; }
  }

  const names = Object.fromEntries(members.map(m => [m.user_id, m.display_name]));
  const actions = {
    add: (t, row) => guard(async () => {
      const [r] = await api.insert(t, { household_id: household.id, ...row });
      setRows(s => ({ ...s, [t]: [...s[t], r] }));
      const msg = notifyText(t, r, names[user.id] || 'Eşin');
      if (msg) api.notify(msg).catch(() => {});
    }),
    patch: (t, id, p) => guard(async () => {
      setRows(s => ({ ...s, [t]: s[t].map(r => (r.id === id ? { ...r, ...p } : r)) }));
      await api.update(t, id, p);
    }),
    insertRaw: (t, row) => guard(async () => {
      const [r] = await api.insert(t, row);
      setRows(s => ({ ...s, [t]: [...(s[t] || []), r] }));
    }),
    del: (t, id) => guard(async () => {
      setRows(s => ({ ...s, [t]: s[t].filter(r => r.id !== id) }));
      await api.remove(t, id);
    }),
  };

  async function saveFin(f) {
    setFin(f);
    await guard(() => api.saveFinance({ ...f, user_id: user.id }));
  }

  async function signOut() {
    if (!confirm(DEMO ? 'Tüm deneme verileri silinsin mi?' : 'Çıkış yapılsın mı?')) return;
    await api.signOut();
    setRows(null); setHousehold(null); setMembers([]);
    setPhase('loading');
    boot();
  }

  if (phase === 'loading') return html`<div class="welcome"><div class="logo">🏡</div><p class="muted">Yükleniyor…</p></div>`;
  if (phase === 'error') return html`<div class="welcome"><p>Bağlanılamadı</p><p class="hint center">${error}</p><button class="primary" onClick=${() => { setPhase('loading'); boot(); }}>Tekrar dene</button></div>`;
  if (phase === 'auth') return html`<${AuthScreen} onDone=${() => { setPhase('loading'); boot(); }} />`;
  if (phase === 'setup') return html`<${SetupScreen} onDone=${() => { setPhase('loading'); boot(); }} />`;

  ME = user.id;
  const ctx = { uid: user.id, rows, actions, members, names, fin, saveFin, household, signOut, askExitShow: () => setExitingShow(true),
    openBank: () => setBankOpen(true),
    goOzet: () => goTab('month'),
    goSettle: () => { try { localStorage.setItem('tf-ben-page', 'settle'); } catch { /* yok say */ } goTab('money'); },
    savePrefs: async prefs => {
      setMembers(ms => ms.map(m => (m.user_id === user.id ? { ...m, notify_prefs: prefs } : m)));
      await guard(() => api.saveNotifyPrefs(user.id, prefs));
    } };
  const bankPending = (rows.bank_events || []).filter(e => ['card', 'out', 'in'].includes(e.kind) && e.status === 'pending' && e.owner_id === user.id)
    .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : 1));
  const Screen = { month: MonthScreen, shop: ListsScreen, settle: SettleScreen, records: RecordsScreen, money: BenScreen }[tab] || MonthScreen;

  return html`
    <main class="screen" onTouchStart=${onEdgeStart} onTouchEnd=${onEdgeEnd}>
      ${SHOW
        ? html`<button class="demo-badge show" onClick=${() => setExitingShow(true)}>🎭 Gösterim modu · çıkmak için dokun</button>`
        : DEMO && html`<div class="demo-badge">Deneme modu</div>`}
      <${Screen} ctx=${ctx} key=${tab} />
    </main>
    <${Walker} />
    <${Party} />
    ${exitingShow && html`<${ExitShowSheet} onClose=${() => setExitingShow(false)} />`}
    ${askCard && html`<${CardSheet} ctx=${ctx} month=${thisMonth()} prompt=${true} onClose=${closeCardAsk} />`}
    ${!askCard && askCarry && html`<${CarrySheet} ctx=${ctx} ask=${askCarry} onClose=${() => setAskCarry(null)} />`}
    ${!askCard && !askCarry && bankOpen && !bankNew && !SHOW && bankPending.length > 0 && html`
      <${BankInboxSheet} ctx=${ctx} events=${bankPending} onNew=${ev => setBankNew(ev)} onClose=${() => setBankOpen(false)} />`}
    ${bankNew && html`<${ItemForm} ctx=${ctx} kind="expense" month=${mk(localDay(bankNew.occurred_at))}
      preset=${{ name: bankNew.merchant || (bankNew.kind === 'card' ? 'Kart harcaması' : 'Giden para'), amount: bankNew.amount, date: localDay(bankNew.occurred_at), on_card: bankNew.kind === 'card' }}
      onSaved=${() => actions.patch('bank_events', bankNew.id, { status: 'added' })} onClose=${() => setBankNew(null)} />`}
    <${QuickAdd} onTap=${() => setQuick(true)} />
    ${quick && html`<${ItemForm} ctx=${ctx} kind="expense" month=${thisMonth()} onClose=${() => setQuick(false)} />`}
    <nav class="tabs">
      ${TABS.map(([id, label, icon]) => html`
        <button class=${(tab === id ? 'on' : '') + (id === 'month' ? ' tab-main' : '')} onClick=${() => goTab(id)}>
          <span class="ti">${icon ?? html`<${TodayIcon} />`}</span><span>${label}</span>
        </button>`)}
    </nav>`;
}

document.title = APP_NAME;
document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', APP_NAME);
render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

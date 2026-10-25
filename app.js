import { html, render, useState, useEffect, useRef } from 'https://unpkg.com/htm@3.1.1/preact/standalone.module.js';
import { api, DEMO, SHOW, TABLES, enterShowMode, exitShowMode, loadSample } from './data.js';
import { DEFAULT_SHOPPING, CATEGORIES } from './defaults.js';
import { Buddy, Walker, Party, celebrate, dailyFace, faceFor } from './animals.js';
import { VAPID_PUBLIC_KEY, APP_NAME } from './config.js';

// ---------- Yardımcılar ----------

const tlFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const usdFmt = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
const tl = v => tlFmt.format(Number(v) || 0);
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
/** O ay kart ödemesi girildiyse, benim kartımdan ödenen taksit ödemenin içindedir; ayrıca sayılmaz.
 *  Eşin kartındaki taksitler sayılmaya devam eder (payı ayın 5'inde eşe gönderilir). */
/** Kayıt kartla mı ödeniyor? Taksitlerde varsayılan kart, harcama ve "her ay"da varsayılan nakit. */
const onCardItem = (it, table = 'installments') => (table === 'installments' ? it.on_card !== false : it.on_card === true);
const coveredByCard = (it, uid, card, table = 'installments') => !!card && it.payer_id === uid && onCardItem(it, table);
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
      const debtorKey = paidKey(m, it.payer_id === A ? B : A);
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
  rows.expenses.filter(e => mk(e.date) === m)
    .forEach(e => add(e, Number(e.amount), 'Harcama', `${Number(e.date.slice(8, 10))} ${AYLAR[Number(e.date.slice(5, 7)) - 1]}`));
  rows.installments.filter(i => inst.active(i, m))
    .forEach(i => add(i, Number(i.monthly_amount), 'Taksit', `${diffM(inst.first(i), m) + 1}/${inst.total(i)}. taksit`));
  rows.fixed_payments.forEach(f => add(f, Number(f.amount), 'Her ay', 'her ay tekrar eder'));
  const net = owe[A] - owe[B];
  return { lines, sentDirect, owe, A, B, from: net > 0 ? A : B, to: net > 0 ? B : A, amount: Math.round(Math.abs(net) * 100) / 100 };
}
const pick = a => a[Math.floor(Math.random() * a.length)];

// ---------- Ortak bileşenler ----------

function Sheet({ title, onClose, right, children }) {
  return html`
    <div class="backdrop" onClick=${onClose}>
      <div class="sheet" onClick=${e => e.stopPropagation()}>
        <div class="sheet-head">
          <button class="link" onClick=${onClose}>Vazgeç</button>
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
  const formRef = useRef(null);

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
    : kind === 'fixed' ? 'cash' : 'card';
  let method = methodPick || initialMethod;
  if (method === 'unpaid' && kind !== 'expense') method = 'cash';
  const showMethod = !shared || payer === uid;

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
    const row = { name: nm, shared, split: shared ? split : 'half', payer_id: shared ? payer : uid };
    if (kind === 'expense') Object.assign(row, { amount: amount_, date });
    if (kind === 'fixed') Object.assign(row, { amount: amount_ });
    if (kind === 'installment') Object.assign(row, { monthly_amount: amount_, first_month: `${first}-01`, last_month: `${last}-01` });
    row.on_card = showMethod && method === 'card';
    if (kind === 'expense' && !item) row.paid_months = showMethod && method === 'cash' ? [paidKey(mk(date), uid)] : [];
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
        ${kind === 'expense' && html`
          <label class="field"><span>Tarih</span><input type="date" value=${date} onInput=${e => setDate(e.target.value || date)} onChange=${e => setDate(e.target.value || date)} /></label>`}
        ${kind === 'installment' && html`
          <label class="field"><span>İlk taksit</span><input type="month" value=${first} onInput=${e => setFirst(e.target.value || first)} onChange=${e => setFirst(e.target.value || first)} /></label>
          <label class="field"><span>Son taksit</span><input type="month" value=${last} onInput=${pickLast} onChange=${pickLast} /></label>`}
      </div>
      ${showMethod && html`
        <div class="field col method">
          <span>Ödeme şekli</span>
          <${Seg} value=${method} onChange=${v => { setMethod(v); setErr(''); }}
            options=${kind === 'expense'
              ? [['card', '💳 Kart'], ['cash', '💵 Nakit'], ['unpaid', '⏳ Ödenmedi']]
              : [['card', '💳 Kart'], ['cash', '💵 Nakit / havale']]} />
          <small class="muted">${{
            card: 'Kart ödemeni girince toplama ayrıca eklenmez ve otomatik ödendi olur.',
            cash: kind === 'expense' ? 'Hemen ödendi olarak işaretlenir.' : 'Her ay toplama girer, tikini sen atarsın.',
            unpaid: 'Tiksiz kalır (ör. eşine göndereceğin para); gönderince tikle.',
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
      </div>
      ${item && item.owner_id === uid && html`<button class="danger" onClick=${remove}>Sil</button>`}
    <//>`;
}

// ---------- Bu Ay ----------

function MonthScreen({ ctx }) {
  const { rows, uid, actions, fin } = ctx;
  const [m, setM] = useState(thisMonth());
  const [form, setForm] = useState(null);

  const insts = rows.installments.filter(i => inst.active(i, m));
  const fixed = rows.fixed_payments;
  const exps = rows.expenses.filter(e => mk(e.date) === m).sort((a, b) => (a.date < b.date ? 1 : -1));

  const card = cardFor(rows, uid, m);
  const cardAmt = card ? Number(card.amount) || 0 : 0;
  const [cardOpen, setCardOpen] = useState(false);
  const [balOpen, setBalOpen] = useState(false);
  const mine = (x, amt) => share(x, Number(amt), uid);
  const counted = insts.filter(i => !coveredByCard(i, uid, card));
  const instT = sumBy(counted, i => mine(i, i.monthly_amount));
  const fixedCounted = fixed.filter(f => !coveredByCard(f, uid, card, 'fixed_payments'));
  const expsCounted = exps.filter(e => !coveredByCard(e, uid, card, 'expenses'));
  const fixT = sumBy(fixedCounted, f => mine(f, f.amount));
  const expT = sumBy(expsCounted, e => mine(e, e.amount));
  const total = cardAmt + instT + fixT + expT;
  const paidT = cardAmt + sumBy(counted.filter(i => isPaid(i, m)), i => mine(i, i.monthly_amount))
    + sumBy(fixedCounted.filter(f => isPaid(f, m)), f => mine(f, f.amount))
    + sumBy(expsCounted.filter(e => isPaid(e, m)), e => mine(e, e.amount));
  const inCard = card ? cardItems(rows, uid, m).length : 0;
  const cardTag = it => (it.payer_id === uid && onCardItem(it, it.monthly_amount != null ? 'installments' : it.date ? 'expenses' : 'fixed_payments')
    ? (card ? '💳 karta dahil, toplama eklenmez' : '💳 kartla') : null);

  // Ayın ilk 10 günü: geçen ayın hesaplaşması bekliyorsa hatırlat
  const prev = addM(thisMonth(), -1);
  const settle = m === thisMonth() && new Date().getDate() <= 10 ? settlementFor(rows, ctx.members, prev) : null;
  const settleDue = settle && settle.amount >= 1 && !rows.settlements.some(x => x.month === prev);
  const income = Number(fin.income) || 0;
  const left = income - total;

  const toggle = (table, it) => {
    const p = it.paid_months || [];
    const key = paidKey(m, uid);
    const was = isPaid(it, m);
    // Eşin kartından ödenen ortak harcamada tik = payımı ona gönderdim (ayın 5'ine girmez)
    if (!was && table === 'expenses' && it.shared && it.split === 'half' && it.payer_id !== uid) {
      const payerName = ctx.names[it.payer_id] || 'eşin';
      if (!confirm(`"${it.name}" harcamasında payın ${tl(Number(it.amount) / 2)}. Kartı ödeyen: ${payerName}.\n\nBu parayı gönderdin mi?\n\nTamam: gönderdim, ayın 5'indeki hesaplaşmaya eklenmez.\nVazgeç: tiklenmez, hesaplaşmada kalır.`)) return;
    }
    if (!was) celebrate(pick(['Ödendi!', 'Bir tane daha bitti!', 'Aferin bize!', 'Tıkır tıkır!']));
    const sentToPartner = !was && table === 'expenses' && it.shared && it.split === 'half' && it.payer_id !== uid;
    actions.patch(table, it.id, {
      paid_months: was
        ? p.filter(x => ![key, m, `${key}:settled`, `${key}:sent`].includes(x))
        : [...p, key, ...(sentToPartner ? [`${key}:sent`] : [])],
    });
  };
  const partner = ctx.members.find(x => x.user_id !== uid);
  /** Ortak kalemde eşin o ay kendi tikini attı mı */
  const partnerTag = it => (it.shared && partner
    ? `${partner.display_name} ${isPaid(it, m, partner.user_id) ? 'ödedi ✓' : 'ödemedi'}` : null);
  const allPaid = total > 0 && paidT >= total;
  const say = !income ? 'Merhaba! Önce Param sekmesinden gelirini yazalım mı? 🥕'
    : allPaid ? 'Bu ayın bütün ödemeleri tamam, harikasınız! 🎉'
    : left >= 0 ? `Bu ay ${tl(left)} artıyor, süpersiniz! ✨`
    : `Eyvah, ${tl(-left)} eksideyiz 🙈`;
  const subOf = (extra, it) => [extra, sharedLabel(it, ctx), partnerTag(it)].filter(Boolean).join(' · ');

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

    <div class="card hero">
      <div class="muted">Ay sonunda kalan</div>
      <div class=${'big ' + (left < 0 ? 'neg' : 'pos')}>${tl(left)}</div>
      ${!income && html`<div class="sub">Param sekmesinden aylık gelirini gir</div>`}
      <div class="rows">
        <div class="row"><span>Gelir</span><b>${tl(income)}</b></div>
        <div class="row"><span>Kredi kartı ödemesi</span><b>${card ? tl(cardAmt) : html`<span class="warn">Girilmedi</span>`}</b></div>
        <div class="row"><span>Diğer ödemeler</span><b>${tl(total - cardAmt)}</b></div>
        <div class="row"><span>Bu ay toplam ödeme</span><b>${tl(total)}</b></div>
        <div class="row"><span>Ödendi</span><b class="muted">${tl(paidT)}</b></div>
        <div class="row"><span>Henüz ödenmedi</span><b class="warn">${tl(total - paidT)}</b></div>
      </div>
    </div>

    <${Group} title="Kredi kartı" total=${cardAmt}>
      ${card
        ? html`<div class="item" onClick=${() => setCardOpen(true)}>
            <span class="check on">💳</span>
            <div class="grow"><div class="title">Kart ödemesi</div>
              <div class="sub">${inCard ? `Kartındaki ${inCard} kayıt dahil` : 'Kartla ödenen kayıt yok'}</div></div>
            <div class="amt">${tl(cardAmt)}</div>
          </div>`
        : html`<div class="item" onClick=${() => setCardOpen(true)}>
            <span class="check warn">!</span>
            <div class="grow"><div class="title">${monthName(m)} kart ödemeni gir</div>
              <div class="sub">Ne kadar ödediysen o ayın bütçesinden düşer</div></div>
            <span class="pill on">Gir</span>
          </div>`}
    <//>

    <${Group} title="Taksitler" total=${instT}>
      ${insts.map(i => coveredByCard(i, uid, card)
        ? html`<${PayRow} key=${i.id} title=${i.name} paid=${isPaid(i, m)}
            sub=${subOf(`${cardTag(i)} · ${inst.remaining(i, m)} taksit kaldı`, i)}
            amount=${mine(i, i.monthly_amount)} onToggle=${() => toggle('installments', i)}
            onOpen=${() => setForm({ kind: 'installment', item: i })} />`
        : html`<${PayRow} key=${i.id} title=${i.name}
            sub=${subOf(`${inst.remaining(i, m)} taksit kaldı · son ${shortMonth(inst.last(i))}`, i)}
            amount=${mine(i, i.monthly_amount)} full=${Number(i.monthly_amount)} paid=${isPaid(i, m)}
            onToggle=${() => toggle('installments', i)} onOpen=${() => setForm({ kind: 'installment', item: i })} />`)}
      ${!insts.length && html`<${Empty}>Bu ay taksit yok<//>`}
    <//>

    <${Group} title="Aylık Ödemeler" total=${fixT}>
      ${fixed.map(f => html`<${PayRow} key=${f.id} title=${f.name} sub=${subOf(cardTag(f) || '', f)}
        amount=${mine(f, f.amount)} full=${Number(f.amount)} paid=${isPaid(f, m)}
        onToggle=${() => toggle('fixed_payments', f)} onOpen=${() => setForm({ kind: 'fixed', item: f })} />`)}
      ${!fixed.length && html`<${Empty}>Kira, fatura, abonelik… "+" ile "Her ay" seçerek ekle<//>`}
    <//>

    <${Group} title="Harcamalar" total=${expT}>
      ${exps.map(e => html`<${PayRow} key=${e.id} title=${e.name}
        sub=${subOf([`${Number(e.date.slice(8, 10))} ${AYLAR[Number(e.date.slice(5, 7)) - 1]}`, cardTag(e)].filter(Boolean).join(' · '), e)}
        amount=${mine(e, e.amount)} full=${Number(e.amount)} paid=${isPaid(e, m)}
        onToggle=${() => toggle('expenses', e)} onOpen=${() => setForm({ kind: 'expense', item: e })} />`)}
      ${!exps.length && html`<${Empty}>Bu ay harcama yok<//>`}
      ${m === thisMonth() && html`<button class="item link-row" onClick=${() => setBalOpen(true)}>⚖️ Bakiye eşitle<span class="sub">Bankadaki bakiyenle aynı olsun</span></button>`}
    <//>

    <button class="fab" onClick=${() => setForm({ kind: 'expense' })} aria-label="Ekle">+</button>
    ${form && html`<${ItemForm} ctx=${ctx} ...${form} month=${m} onClose=${() => setForm(null)} />`}
    ${cardOpen && html`<${CardSheet} ctx=${ctx} month=${m} onClose=${() => setCardOpen(false)} />`}
    ${balOpen && html`<${BalanceSheet} ctx=${ctx} expected=${income - paidT} onClose=${() => setBalOpen(false)} />`}`;
}

// ---------- Bakiye eşitleme ----------

/** Bankadaki gerçek bakiyeyi girince farkı tek bir "Diğer" harcamasıyla kapatır */
function BalanceSheet({ ctx, expected, onClose }) {
  const { uid, actions } = ctx;
  const [real, setReal] = useState(0);
  const [touched, setTouched] = useState(false);
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

// ---------- Kredi kartı ödemesi ----------

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
    const row = { amount: value ?? amount, includes_installments: true };
    const ok = card ? await actions.patch('card_payments', card.id, row)
      : await actions.add('card_payments', { ...row, month, owner_id: uid });
    if (ok !== false) {
      if ((value ?? amount) > 0) {
        // Kart ödendiyse o ay kartımdan ödenen her şey (taksit, her ay, harcama) benim adıma ödenmiş olur
        const key = paidKey(month, uid);
        for (const { it, table } of included) {
          if (!(it.paid_months || []).includes(key)) await actions.patch(table, it.id, { paid_months: [...(it.paid_months || []), key] });
        }
        if (!card) celebrate('Kart ödemesi girildi!');
      }
      onClose();
    }
    setBusy(false);
  }
  async function remove() {
    if (!confirm('Bu ayın kart ödemesi silinsin mi?')) return;
    await actions.del('card_payments', card.id);
    onClose();
  }

  return html`
    <${Sheet} title=${`💳 ${monthName(month)}`} onClose=${onClose}
      right=${html`<button class="link strong" disabled=${busy} onClick=${() => save()}>Kaydet</button>`}>
      ${prompt && html`<p class="lead">Yeni ay başladı! Bu ay kredi kartına ne kadar ödedin?</p>`}
      ${err && html`<p class="error">${err}</p>`}
      <div class="card form">
        <label class="field"><span>Ödediğin tutar</span><${MoneyInput} value=${amount} onInput=${v => { setAmount(v); setErr(''); }} /></label>
      </div>
      <p class="hint">Bu tutar ${monthName(month)} bütçenden düşer. Sadece sen görürsün.</p>
      <${Group} title="Bu ödemeye dahil olanlar (senin kartın)" total=${sumBy(included, x => x.amount)}>
        ${included.map(({ it, kind, amount: a }) => html`<div class="row pad" key=${it.id}><span>${it.name}<small class="muted"> · ${kind}${it.shared ? ' · ortak, yarısı eşinden gelir' : ''}</small></span>
          <b>${tl(a)}</b></div>`)}
        ${!included.length && html`<${Empty}>Bu ay kartla ödenen kayıt yok<//>`}
      <//>
      <p class="hint">Kaydedince bunlar senin adına "ödendi" olarak tiklenir; o ay ayrıca düşülmez. Ödeme şekli "Kart" olan kayıtlar buraya girer. Eşinin kartındaki ortak kalemlerin payı bakiyenden düşmeye devam eder (ayın 5'inde eşine gönderilir).</p>
      ${!card && html`<button class="primary ghost" disabled=${busy} onClick=${() => save(0)}>Bu ay kart ödemem yok</button>`}
      ${prompt && !card && html`<button class="link small" onClick=${onClose}>Sonra gireceğim</button>`}
      ${card && html`<button class="danger" onClick=${remove}>Sil</button>`}
    <//>`;
}

// ---------- Hesaplaşma (ayın 5'i) ----------

const LOG_LABEL = { sent: 'Gönderdim', unsent: '"Gönderdim" işaretini kaldırdı', received: 'Parayı aldım', unreceived: '"Aldım" işaretini kaldırdı' };

function SettleView({ ctx }) {
  const { rows, members, names, uid, actions } = ctx;
  const [m, setM] = useState(addM(thisMonth(), -1));
  const [review, setReview] = useState(false);
  const s = settlementFor(rows, members, m);
  const rec = rows.settlements.find(x => x.month === m);
  const who = id => (id === uid ? 'Sen' : names[id] || 'Eşin');
  const when = t => new Date(t).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  /** Gönderdim / Aldım işaretini koyar ya da kaldırır; her adım log'a yazılır, bütçeye dokunmaz */
  async function mark(kind, on) {
    const question = {
      sent: `${who(s.to)} kişisine ${tl(s.amount)} gönderdin mi?`,
      received: `${who(s.from)} kişisinden ${tl(s.amount)} aldın mı?`,
    }[kind];
    if (!confirm(on ? question : 'İşaret kaldırılsın mı?')) return;
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
      // Hesaplaşmayla borçlu kendi payını ödemiş olur: o ayın kalemlerinde borçluyu "ödedi" olarak işaretle
      for (const l of s.lines) {
        const debtor = l.payer === s.A ? s.B : s.A;
        const it = rows[l.table].find(x => x.id === l.id);
        const key = paidKey(m, debtor);
        const p = it?.paid_months || [];
        if (it && !p.includes(`${key}:settled`)) {
          await actions.patch(l.table, l.id, { paid_months: [...p.filter(x => x !== key), key, `${key}:settled`] });
        }
      }
      celebrate(kind === 'sent' ? 'Gönderildi!' : 'Hesaplar kapandı!');
      const me = names[uid] || 'Eşin';
      api.notify({
        title: '💸 Hesaplaşma',
        body: kind === 'sent' ? `${me}: ${monthName(m)} için ${tl(s.amount)} gönderdim` : `${me}: ${tl(s.amount)} geldi, aldım ✓`,
      }).catch(() => {});
    }
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
        <div class="sub">${monthName(m)} ortak harcamaları · ${monthName(addM(m, 1))} ayının 5'inde gönderilir</div>
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
    ${review && s && html`<${SettleSummary} s=${s} rec=${rec} month=${m} who=${who} uid=${uid}
      onMark=${async (kind, on) => { await mark(kind, on); }} onClose=${() => setReview(false)} />`}`;
}

/** Gönderimden önce kontrol: her yöndeki borç kalem kalem, ara toplamlar ve net tutar */
function SettleSummary({ s, rec, month, who, uid, onMark, onClose }) {
  const side = (debtor, creditor) => {
    const lines = s.lines.filter(l => l.payer === creditor);
    return html`
      <div class="group">
        <div class="group-head"><span>${who(debtor)} → ${who(creditor)}</span><span>${tl(s.owe[debtor])}</span></div>
        <div class="card">
          ${lines.map(l => html`
            <div class="item" key=${l.id}>
              <div class="grow"><div class="title">${l.name}</div>
                <div class="sub">${l.kind} · ${l.when} · ${creditor === uid ? 'sen ödedin' : `${who(creditor)} ödedi`} · toplam ${tl(l.amount)}</div></div>
              <div class="amt"><b>${tl(l.debt)}</b><div class="sub">${l.full ? 'tamamı' : 'yarısı'}</div></div>
            </div>`)}
          ${!lines.length && html`<${Empty}>Bu yönde borç yok<//>`}
          <div class="row pad total-row"><span>Ara toplam</span><b>${tl(s.owe[debtor])}</b></div>
        </div>
      </div>`;
  };

  return html`
    <${Sheet} title=${`💸 ${monthName(month)} özeti`} onClose=${onClose}>
      <p class="hint">${monthName(month)} ayının "yarı yarıya" ortak kalemleri. Kartı kim ödediyse diğeri yarısını borçlanır.</p>
      ${side(s.B, s.A)}
      ${side(s.A, s.B)}
      ${s.sentDirect.length > 0 && html`
        <div class="group">
          <div class="group-head"><span>Ay içinde gönderilenler (hesaba girmedi)</span></div>
          <div class="card">
            ${s.sentDirect.map(l => html`
              <div class="item" key=${l.id}>
                <div class="grow"><div class="title done">${l.name}</div>
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

// ---------- Ödemeler (taksitler + sabit) ----------

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

function PaymentsScreen({ ctx }) {
  const { rows, uid } = ctx;
  const [seg, setSegState] = useState(() => { try { return localStorage.getItem('tf-pay-seg') === 'fixed' ? 'fixed' : 'inst'; } catch { return 'inst'; } });
  const setSeg = v => { setSegState(v); try { localStorage.setItem('tf-pay-seg', v); } catch { /* yok say */ } };
  const [form, setForm] = useState(null);
  const now = thisMonth();

  const all = rows.installments;
  const live = all.filter(i => inst.remaining(i, now) > 0).sort((a, b) => (a.last_month > b.last_month ? 1 : -1));
  const done = all.filter(i => inst.remaining(i, now) === 0);
  const monthly = sumBy(all.filter(i => inst.active(i, now)), i => share(i, Number(i.monthly_amount), uid));
  const debt = sumBy(all, i => share(i, Number(i.monthly_amount), uid) * inst.remaining(i, now));
  const fixed = rows.fixed_payments;
  const open = (kind, item) => setForm({ kind, item });

  return html`
    <header class="top"><h1>Ödemeler</h1></header>
    <${Buddy} face=${dailyFace(1)} say=${live.length
      ? `${live.length} taksit sürüyor, ilki ${shortMonth(inst.last(live[0]))} ayında bitiyor! 💪`
      : 'Hiç taksit yok, oh be! 😌'} />
    <${Seg} value=${seg} onChange=${setSeg} options=${[['inst', 'Taksitler'], ['fixed', 'Her ay olanlar']]} />
    ${seg === 'inst' ? html`
      <div class="card rows">
        <div class="row"><span>Bu ayki taksitlerin</span><b>${tl(monthly)}</b></div>
        <div class="row"><span>Kalan toplam taksit borcun</span><b class="warn">${tl(debt)}</b></div>
      </div>
      <${FoldGroup} id="inst-own" title="Şahsi" count=${live.filter(i => !i.shared).length}
        total=${sumBy(live.filter(i => !i.shared && inst.active(i, now)), i => Number(i.monthly_amount))}>
        ${live.filter(i => !i.shared).map(i => html`<${InstRow} key=${i.id} i=${i} ctx=${ctx} onOpen=${() => open('installment', i)} />`)}
        ${!live.some(i => !i.shared) && html`<${Empty}>Şahsi taksit yok<//>`}
      <//>
      <${FoldGroup} id="inst-shared" title="Ortak" count=${live.filter(i => i.shared).length}
        total=${sumBy(live.filter(i => i.shared && inst.active(i, now)), i => share(i, Number(i.monthly_amount), uid))}>
        ${live.filter(i => i.shared).map(i => html`<${InstRow} key=${i.id} i=${i} ctx=${ctx} onOpen=${() => open('installment', i)} />`)}
        ${!live.some(i => i.shared) && html`<${Empty}>Ortak taksit yok<//>`}
      <//>
      ${done.length > 0 && html`<${FoldGroup} id="inst-done" title="Bitenler" count=${done.length}>
        ${done.map(i => html`<${InstRow} key=${i.id} i=${i} ctx=${ctx} onOpen=${() => open('installment', i)} />`)}
      <//>`}
    ` : html`
      <${Group} title="Her ay tekrar edenler" total=${sumBy(fixed, f => share(f, Number(f.amount), uid))}>
        ${fixed.map(f => html`<${PayRow} key=${f.id} title=${f.name} sub=${sharedLabel(f, ctx)}
          amount=${share(f, Number(f.amount), uid)} full=${Number(f.amount)} onOpen=${() => open('fixed', f)} />`)}
        ${!fixed.length && html`<${Empty}>Kira, aidat, faturalar, abonelikler…<//>`}
      <//>
      <p class="hint">Bu Ay ekranında her ay ödendi olarak işaretleyebilirsin.</p>
    `}
    <button class="fab" onClick=${() => setForm({ kind: seg === 'inst' ? 'installment' : 'fixed' })} aria-label="Ekle">+</button>
    ${form && html`<${ItemForm} ctx=${ctx} ...${form} onClose=${() => setForm(null)} />`}`;
}

// ---------- Alışveriş ----------

const catOrder = c => { const i = CATEGORIES.indexOf(c); return i < 0 ? 999 : i; };
function byCategory(items) {
  const map = {};
  items.forEach(i => { (map[i.category] ||= []).push(i); });
  return Object.entries(map).sort((a, b) => catOrder(a[0]) - catOrder(b[0]) || a[0].localeCompare(b[0], 'tr'));
}
const lower = s => s.toLocaleLowerCase('tr');

function ShoppingScreen({ ctx }) {
  const { rows, actions } = ctx;
  const [mode, setMode] = useState('list');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [newItem, setNewItem] = useState(null);
  const items = rows.shopping_items;
  const inList = items.filter(i => i.in_list);
  const checked = inList.filter(i => i.checked);

  async function quickAdd(e) {
    e.preventDefault();
    const name = q.trim();
    if (!name) return;
    const found = items.find(i => lower(i.name) === lower(name));
    if (found) await actions.patch('shopping_items', found.id, { in_list: true, checked: false });
    else await actions.add('shopping_items', { name, category: 'Diğer', in_list: true });
    setQ('');
  }
  const clearChecked = () => {
    celebrate('Alışveriş bitti!');
    checked.forEach(i => actions.patch('shopping_items', i.id, { in_list: false, checked: false }));
  };
  const filtered = q.trim() ? items.filter(i => lower(i.name).includes(lower(q.trim()))) : items;

  return html`
    <header class="top"><h1>Alışveriş</h1></header>
    <${Buddy} face=${dailyFace(2)} say=${inList.length
      ? `Listede ${inList.length - checked.length} şey kaldı, hadi markete! 🛒`
      : 'Liste boş. Dolap dolu mu acaba? 🧺'} />
    <${Seg} value=${mode} onChange=${m => { setMode(m); setQ(''); window.scrollTo(0, 0); }}
      options=${[['list', `Liste${inList.length ? ` (${inList.length})` : ''}`], ['all', 'Tüm ürünler']]} />

    ${mode === 'list' ? html`
      <form class="card search" onSubmit=${quickAdd}>
        <input placeholder="Listeye ekle (ör. Süt)" value=${q} onInput=${e => setQ(e.target.value)} />
        <button class="link strong" type="submit" disabled=${!q.trim()}>Ekle</button>
      </form>
      ${!inList.length && html`<div class="card"><${Empty}>Liste boş. "Tüm ürünler"den dokunarak ekleyin.<//></div>`}
      ${byCategory(inList).map(([cat, list]) => html`
        <${Group} key=${cat} title=${cat}>
          ${list.map(i => html`
            <div class="item" key=${i.id} onClick=${() => actions.patch('shopping_items', i.id, { checked: !i.checked })}>
              <span class=${'check' + (i.checked ? ' on' : '')}>${i.checked ? '✓' : ''}</span>
              <div class=${'grow title' + (i.checked ? ' done' : '')}>${i.name}</div>
            </div>`)}
        <//>`)}
      ${checked.length > 0 && html`<button class="primary" onClick=${clearChecked}>Alınanları listeden çıkar (${checked.length})</button>`}
    ` : html`
      <div class="card search">
        <input placeholder="Ürün ara" value=${q} onInput=${e => setQ(e.target.value)} />
        <button class="link" onClick=${() => setEditing(!editing)}>${editing ? 'Bitti' : 'Düzenle'}</button>
      </div>
      <button class="primary ghost" onClick=${() => setNewItem({ name: q.trim(), category: 'Diğer' })}>+ Yeni ürün</button>
      ${byCategory(filtered).map(([cat, list]) => html`
        <${Group} key=${cat} title=${cat}>
          ${list.sort((a, b) => a.name.localeCompare(b.name, 'tr')).map(i => html`
            <div class="item" key=${i.id}
              onClick=${() => !editing && actions.patch('shopping_items', i.id, { in_list: !i.in_list, checked: false })}>
              <div class="grow title">${i.name}</div>
              ${editing
                ? html`<button class="del" onClick=${() => confirm(`"${i.name}" katalogdan silinsin mi?`) && actions.del('shopping_items', i.id)}>Sil</button>`
                : html`<span class=${'pill' + (i.in_list ? ' on' : '')}>${i.in_list ? '✓ Listede' : '+'}</span>`}
            </div>`)}
        <//>`)}
    `}

    ${newItem && html`
      <${Sheet} title="Yeni Ürün" onClose=${() => setNewItem(null)}
        right=${html`<button class="link strong" disabled=${!newItem.name.trim()} onClick=${async () => {
          await actions.add('shopping_items', { name: newItem.name.trim(), category: newItem.category, in_list: true });
          setNewItem(null);
        }}>Kaydet</button>`}>
        <div class="card form">
          <label class="field"><input placeholder="Ürün adı" value=${newItem.name} onInput=${e => setNewItem({ ...newItem, name: e.target.value })} /></label>
          <label class="field"><span>Kategori</span>
            <select value=${newItem.category} onChange=${e => setNewItem({ ...newItem, category: e.target.value })}>
              ${CATEGORIES.map(c => html`<option value=${c}>${c}</option>`)}
            </select>
          </label>
        </div>
        <p class="hint">Ürün kataloğa eklenir ve listeye konur.</p>
      <//>`}`;
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

function WishScreen({ ctx }) {
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
    <header class="top"><h1>Alacaklarımız</h1></header>
    <${Buddy} face=${dailyFace(3)} say=${open.length
      ? `Yuvamız için ${open.length} hayalimiz var 🏡`
      : 'Hayal listesi boş. Ne alsak? ✨'} />
    <div class="card rows">
      <div class="row"><span>Alınacak ${open.length} şey</span><b>${tl(sumBy(open, w => Number(w.price)))}</b></div>
    </div>
    ${!open.length && html`<div class="card"><${Empty}>Çekyat, dresuar, kahvelik… "+" ile ekleyin<//></div>`}
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
        ${bought.map(w => html`
          <div class="item" key=${w.id}>
            <div class="grow title done">${w.name}</div>
            <button class="link small" onClick=${() => actions.patch('wishlist', w.id, { bought: false })}>Geri al</button>
          </div>`)}
      <//>`}`}

    <button class="fab" onClick=${() => setForm({})} aria-label="Ekle">+</button>
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

function MoneyScreen({ ctx }) {
  const { fin, saveFin, household, members, uid, signOut } = ctx;
  const [f, setF] = useState(fin);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (f === fin) return;
    const t = setTimeout(() => saveFin(f), 600);
    return () => clearTimeout(t);
  }, [f]);
  const set = k => v => setF({ ...f, [k]: v });
  const rates = useRates();
  const usdRate = rates?.usd || Number(f.usd_rate) || 0;
  const usdTl = Math.round(Number(f.usd_amount) * usdRate);
  const eurTl = Math.round(Number(f.eur_amount || 0) * (rates?.eur || 0));
  const goldTl = Math.round(Number(f.gold_grams || 0) * (rates?.gold || 0));
  const totalSaved = Number(f.savings_tl) + usdTl + eurTl + goldTl;
  const approx = v => (v ? `≈ ${tl(v)}` : '');

  async function startShow() {
    if (!confirm('Gösterim moduna geçilsin mi? Gerçek verilerin gizlenir.')) return;
    await enterShowMode();
    location.reload();
  }

  async function copy() {
    try { await navigator.clipboard.writeText(household.invite_code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* kopyalanamadıysa kod ekranda görünüyor */ }
  }

  return html`
    <header class="top"><h1>Param</h1></header>
    <${Buddy} face=${dailyFace(4)} say=${`Kumbaramızda ${tl(totalSaved)} var 🐷`} />
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
      : 'Kurlar alınamadı, internet bağlantını kontrol et. Bu bilgileri sadece sen görürsün.'}</p>
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

    <${SettleView} ctx=${ctx} />
    <${ReportView} ctx=${ctx} />

    <${Group} title=${household.name}>
      ${members.map(m => html`<div class="row pad" key=${m.user_id}><span>${m.display_name}</span><span class="muted">${m.user_id === uid ? 'sen' : ''}</span></div>`)}
      ${members.length < 2 && !DEMO && html`
        <div class="row pad"><span>Davet kodu</span><button class="code" onClick=${copy}>${copied ? 'Kopyalandı' : household.invite_code}</button></div>`}
    <//>
    <${PushSettings} />
    ${members.length < 2 && !DEMO && html`<p class="hint">Eşin uygulamada hesap açıp "Davet koduyla katıl" deyip bu kodu girsin.</p>`}
    ${DEMO && !SHOW && html`<p class="hint">Deneme modundasınız: veriler sadece bu cihazda. Supabase bağlanınca iki telefon eşitlenir.</p>`}

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
    ${!SHOW && html`<button class="danger" onClick=${signOut}>${DEMO ? 'Deneme verilerini sıfırla' : 'Çıkış yap'}</button>`}`;
}

// ---------- Bildirimler ----------

/** Eşe gidecek bildirim; şahsi kayıtlar için null (onlar gizli kalır) */
function notifyText(table, r, who) {
  if (table === 'wishlist') return { title: '🛋️ Alacaklara eklendi', body: `${who}: ${r.name}${Number(r.price) ? ` · ${tl(r.price)}` : ''}` };
  if (!r.shared) return null;
  if (table === 'expenses') return { title: '🛍️ Yeni ortak harcama', body: `${who}: ${r.name} · ${tl(r.amount)}` };
  if (table === 'installments') return { title: '💳 Yeni ortak taksit', body: `${who}: ${r.name} · ${tl(r.monthly_amount)} × ${inst.total(r)} ay` };
  if (table === 'fixed_payments') return { title: '🔁 Yeni ortak aylık ödeme', body: `${who}: ${r.name} · ${tl(r.amount)}` };
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

// ---------- Uygulama ----------

const TABS = [
  ['month', 'Bu Ay', '📅'],
  ['payments', 'Ödemeler', '💳'],
  ['shop', 'Alışveriş', '🛒'],
  ['wish', 'Alacaklar', '🛋️'],
  ['money', 'Param', '💰'],
];

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
  const [tab, setTab] = useState(() => { try { return localStorage.getItem('tf-tab') || 'month'; } catch { return 'month'; } });

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
  useEffect(() => { try { localStorage.setItem('tf-tab', tab); } catch { /* yok say */ } }, [tab]);

  // Her açılışta: bu ayın kart ödemesi girilmediyse sor ("Sonra gireceğim" sadece bu açılış için)
  useEffect(() => {
    if (phase !== 'ready' || SHOW || !rows) return;
    const m = thisMonth();
    let asked = false;
    try { asked = sessionStorage.getItem(`tf-card-asked-${m}`) === '1'; } catch { /* yok say */ }
    if (!asked && !cardFor(rows, user.id, m)) setAskCard(true);
  }, [phase, rows === null]);
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
    goSettle: () => { setTab('money'); setTimeout(() => document.getElementById('settle')?.scrollIntoView({ behavior: 'smooth' }), 250); } };
  const Screen = { month: MonthScreen, payments: PaymentsScreen, shop: ShoppingScreen, wish: WishScreen, money: MoneyScreen }[tab];

  return html`
    <main class="screen">
      ${SHOW
        ? html`<button class="demo-badge show" onClick=${() => setExitingShow(true)}>🎭 Gösterim modu · çıkmak için dokun</button>`
        : DEMO && html`<div class="demo-badge">Deneme modu</div>`}
      <${Screen} ctx=${ctx} key=${tab} />
    </main>
    <${Walker} />
    <${Party} />
    ${exitingShow && html`<${ExitShowSheet} onClose=${() => setExitingShow(false)} />`}
    ${askCard && html`<${CardSheet} ctx=${ctx} month=${thisMonth()} prompt=${true} onClose=${closeCardAsk} />`}
    <nav class="tabs">
      ${TABS.map(([id, label, icon]) => html`
        <button class=${tab === id ? 'on' : ''} onClick=${() => { setTab(id); window.scrollTo(0, 0); }}>
          <span class="ti">${icon}</span><span>${label}</span>
        </button>`)}
    </nav>`;
}

document.title = APP_NAME;
document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', APP_NAME);
render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

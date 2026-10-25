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

const isPaid = (item, m) => (item.paid_months || []).includes(m);

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
  return item.split === 'half' ? `Ortak · yarı yarıya · ${payer}` : `Ortak · tamamı ${payer}`;
}

const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
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
  const [amount, setAmount] = useState(Number(src.monthly_amount ?? src.amount ?? 0));
  const [date, setDate] = useState(src.date || (base === thisMonth() ? today() : `${base}-01`));
  const [first, setFirst] = useState(mk(src.first_month) || base);
  const [last, setLast] = useState(mk(src.last_month) || addM(base, 2));
  const [shared, setShared] = useState(!!src.shared);
  const [split, setSplit] = useState(src.split || 'half');
  const [payer, setPayer] = useState(src.payer_id || uid);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
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
    const amount_ = amt;
    const row = { name: nm, shared, split: shared ? split : 'half', payer_id: shared ? payer : uid };
    if (kind === 'expense') Object.assign(row, { amount: amount_, date });
    if (kind === 'fixed') Object.assign(row, { amount: amount_ });
    if (kind === 'installment') Object.assign(row, { monthly_amount: amount_, first_month: `${first}-01`, last_month: `${last}-01` });
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

  const mine = (x, amt) => share(x, Number(amt), uid);
  const instT = sumBy(insts, i => mine(i, i.monthly_amount));
  const fixT = sumBy(fixed, f => mine(f, f.amount));
  const expT = sumBy(exps, e => mine(e, e.amount));
  const total = instT + fixT + expT;
  const paidT = sumBy(insts.filter(i => isPaid(i, m)), i => mine(i, i.monthly_amount))
    + sumBy(fixed.filter(f => isPaid(f, m)), f => mine(f, f.amount)) + expT;
  const income = Number(fin.income) || 0;
  const left = income - total;

  const toggle = (table, it) => {
    const p = it.paid_months || [];
    if (!p.includes(m)) celebrate(pick(['Ödendi!', 'Bir tane daha bitti!', 'Aferin bize!', 'Tıkır tıkır!']));
    actions.patch(table, it.id, { paid_months: p.includes(m) ? p.filter(x => x !== m) : [...p, m] });
  };
  const allPaid = total > 0 && paidT >= total;
  const say = !income ? 'Merhaba! Önce Param sekmesinden gelirini yazalım mı? 🥕'
    : allPaid ? 'Bu ayın bütün ödemeleri tamam, harikasınız! 🎉'
    : left >= 0 ? `Bu ay ${tl(left)} artıyor, süpersiniz! ✨`
    : `Eyvah, ${tl(-left)} eksideyiz 🙈`;
  const subOf = (extra, it) => [extra, sharedLabel(it, ctx)].filter(Boolean).join(' · ');

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

    <div class="card hero">
      <div class="muted">Ay sonunda kalan</div>
      <div class=${'big ' + (left < 0 ? 'neg' : 'pos')}>${tl(left)}</div>
      ${!income && html`<div class="sub">Param sekmesinden aylık gelirini gir</div>`}
      <div class="rows">
        <div class="row"><span>Gelir</span><b>${tl(income)}</b></div>
        <div class="row"><span>Bu ay toplam ödeme</span><b>${tl(total)}</b></div>
        <div class="row"><span>Ödendi</span><b class="muted">${tl(paidT)}</b></div>
        <div class="row"><span>Henüz ödenmedi</span><b class="warn">${tl(total - paidT)}</b></div>
      </div>
    </div>

    <${Group} title="Taksitler" total=${instT}>
      ${insts.map(i => html`<${PayRow} key=${i.id} title=${i.name}
        sub=${subOf(`${inst.remaining(i, m)} taksit kaldı · son ${shortMonth(inst.last(i))}`, i)}
        amount=${mine(i, i.monthly_amount)} full=${Number(i.monthly_amount)} paid=${isPaid(i, m)}
        onToggle=${() => toggle('installments', i)} onOpen=${() => setForm({ kind: 'installment', item: i })} />`)}
      ${!insts.length && html`<${Empty}>Bu ay taksit yok<//>`}
    <//>

    <${Group} title="Aylık Ödemeler" total=${fixT}>
      ${fixed.map(f => html`<${PayRow} key=${f.id} title=${f.name} sub=${sharedLabel(f, ctx)}
        amount=${mine(f, f.amount)} full=${Number(f.amount)} paid=${isPaid(f, m)}
        onToggle=${() => toggle('fixed_payments', f)} onOpen=${() => setForm({ kind: 'fixed', item: f })} />`)}
      ${!fixed.length && html`<${Empty}>Kira, fatura, abonelik… "+" ile "Her ay" seçerek ekle<//>`}
    <//>

    <${Group} title="Harcamalar" total=${expT}>
      ${exps.map(e => html`<${PayRow} key=${e.id} title=${e.name}
        sub=${subOf(`${Number(e.date.slice(8, 10))} ${AYLAR[Number(e.date.slice(5, 7)) - 1]}`, e)}
        amount=${mine(e, e.amount)} full=${Number(e.amount)} onOpen=${() => setForm({ kind: 'expense', item: e })} />`)}
      ${!exps.length && html`<${Empty}>Bu ay harcama yok<//>`}
    <//>

    <button class="fab" onClick=${() => setForm({ kind: 'expense' })} aria-label="Ekle">+</button>
    ${form && html`<${ItemForm} ctx=${ctx} ...${form} month=${m} onClose=${() => setForm(null)} />`}`;
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
      </div>
    </div>`;
}

function PaymentsScreen({ ctx }) {
  const { rows, uid } = ctx;
  const [seg, setSeg] = useState('inst');
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
      <${Group} title="Şahsi">
        ${live.filter(i => !i.shared).map(i => html`<${InstRow} key=${i.id} i=${i} ctx=${ctx} onOpen=${() => open('installment', i)} />`)}
        ${!live.some(i => !i.shared) && html`<${Empty}>Şahsi taksit yok<//>`}
      <//>
      <${Group} title="Ortak">
        ${live.filter(i => i.shared).map(i => html`<${InstRow} key=${i.id} i=${i} ctx=${ctx} onOpen=${() => open('installment', i)} />`)}
        ${!live.some(i => i.shared) && html`<${Empty}>Ortak taksit yok<//>`}
      <//>
      ${done.length > 0 && html`<${Group} title="Bitenler">
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
  const usdTl = Number(f.usd_amount) * Number(f.usd_rate);

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
    <${Buddy} face=${dailyFace(4)} say=${`Kumbaramızda ${tl(Number(f.savings_tl) + usdTl)} var 🐷`} />
    <${Group} title="Gelir">
      <label class="field"><span>Aylık gelir</span><${MoneyInput} value=${f.income} onInput=${set('income')} /></label>
    <//>
    <${Group} title="Kenardaki param">
      <label class="field"><span>TL birikim</span><${MoneyInput} value=${f.savings_tl} onInput=${set('savings_tl')} /></label>
      <label class="field"><span>Dolar</span><${MoneyInput} value=${f.usd_amount} onInput=${set('usd_amount')} suffix="$" /></label>
      <label class="field"><span>Dolar kuru</span><${MoneyInput} value=${f.usd_rate} onInput=${set('usd_rate')} /></label>
    <//>
    <p class="hint">Kuru arada bir güncelleyin. Bu bilgileri sadece siz görürsünüz.</p>
    <div class="card hero">
      ${Number(f.usd_amount) > 0 && html`<div class="row"><span>${usd(f.usd_amount)} karşılığı</span><b>${tl(usdTl)}</b></div>`}
      <div class="muted">Toplam birikim</div>
      <div class="big">${tl(Number(f.savings_tl) + usdTl)}</div>
    </div>

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

  let content;
  if (DEMO || !VAPID_PUBLIC_KEY) content = html`<div class="row pad"><span class="muted">Supabase kurulunca açılır</span></div>`;
  else if (!supported) content = html`<div class="row pad"><span class="muted">${standalone ? 'Bu cihaz bildirim desteklemiyor (iOS 16.4+ gerekir)' : 'Önce Safari → Paylaş → Ana Ekrana Ekle, sonra oradan açın'}</span></div>`;
  else if (state === 'denied') content = html`<div class="row pad"><span class="muted">Kapalı. Ayarlar → Bildirimler bölümünden açabilirsiniz.</span></div>`;
  else content = html`<div class="row pad"><span>${state === 'granted' ? 'Bu cihazda açık ✓' : 'Eşin ortak bir şey ekleyince haber ver'}</span>
    <button class="pill on" disabled=${busy} onClick=${enable}>${state === 'granted' ? 'Yenile' : 'Aç'}</button></div>`;

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

  const ctx = { uid: user.id, rows, actions, members, names, fin, saveFin, household, signOut, askExitShow: () => setExitingShow(true) };
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

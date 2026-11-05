// Kredi kartı hesap özeti (ekstre) PDF'ini telefonda okur: PDF hiçbir yere gönderilmez.
// Şimdilik Yapı Kredi (World) ekstresinin düzenine göre yazıldı; satırlar tarihle başlar, tutar sağ sütundadır.

const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/';

/** PDF'teki yazıları satır satır döndürür: [{ page, y, items: [{ x, s }] }] (her sayfada yukarıdan aşağı) */
export async function readPdfLines(file, lib) {
  const pdfjs = lib || await import(`${PDFJS}pdf.min.mjs`);
  if (!lib) pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS}pdf.worker.min.mjs`;
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const lines = [];
    for (const it of tc.items) {
      const s = (it.str || '').trim();
      if (!s) continue;
      const y = it.transform[5], x = it.transform[4];
      let line = lines.find(l => Math.abs(l.y - y) <= 2);
      if (!line) lines.push(line = { page: p, y, items: [] });
      line.items.push({ x, s });
    }
    lines.sort((a, b) => b.y - a.y).forEach(l => { l.items.sort((a, b) => a.x - b.x); out.push(l); });
  }
  return out;
}

const AYLAR = ['ocak', 'şubat', 'mart', 'nisan', 'mayıs', 'haziran', 'temmuz', 'ağustos', 'eylül', 'ekim', 'kasım', 'aralık'];
const pad = n => String(n).padStart(2, '0');
/** "1 Kasım 2026" → "2026-11-01" */
function trDate(s) {
  const m = String(s).trim().match(/^(\d{1,2})\s+(\S+)\s+(\d{4})$/);
  if (!m) return null;
  const mo = AYLAR.indexOf(m[2].toLocaleLowerCase('tr'));
  return mo < 0 ? null : `${m[3]}-${pad(mo + 1)}-${pad(m[1])}`;
}
const MONEY = /^[+-]?\d{1,3}(?:\.\d{3})*,\d{2}$/;
const num = s => Number(String(s).replace(/[^\d,+-]/g, '').replace(',', '.'));
const moneyIn = s => { const m = String(s).match(/[+-]?\d{1,3}(?:\.\d{3})*,\d{2}/); return m ? num(m[0]) : null; };

// Ödeme aracısı önekleri ve şehir/ülke ekleri isimden atılır
const PREFIX = /^(?:IYZICO\s*[/*]\s*|IYZICO\s+\*?|ÖDEAL\/\/|ODEAL\/\/|HALKÖDE ÖD\/|AKÖDE ÖD\/|PAYTR\s*\*?\s*|PARAM\s*\*\s*)/i;
const CITY = /^(?:İSTANBUL|ISTANBUL|ANKARA|İZMİR|IZMIR|AYDIN|BURSA|ANTALYA|KOCAELİ|CORK|DUBLIN|LONDON|AMSTERDAM)$/i;

/** Ekstre satırındaki işyeri adını sadeleştirir: "MİGROS MİGROS AİRPORT | İSTANBUL | TR" → "MİGROS AİRPORT" */
export function cleanMerchant(parts) {
  const p = [...parts];
  if (p.length > 1 && /^[A-Z]{2,4}$/.test(p[p.length - 1])) p.pop();
  if (p.length > 1 && CITY.test(p[p.length - 1])) p.pop();
  let s = p.join(' ').replace(/\s+/g, ' ').trim().replace(PREFIX, '').replace(/^\*/, '')
    // Şehir adı işyeri adına yapışık gelebilir: "MODA ISTISTANBUL", "CENTER BİSTANBUL", "SAN FRANCISCOCAUS"
    .replace(/\s*(?:IST)?[İI]STANBUL$/i, '').replace(/\s+SAN FRANCISCO\w*$/i, '').replace(/^WW W\./i, 'WWW.').trim();
  const w = s.split(' ');
  if (w.length > 1 && w[0] === w[1]) s = w.slice(1).join(' ');
  return s;
}

const INFO = {
  cut: /^Hesap Kesim Tarihi/, due: /^Son Ödeme Tarihi/, debt: /^Dönem Borcu/, min: /^Ödenmesi Gereken Asgari/,
  prev: /^Önceki Dönem Hesap Özeti Borcu/, spend: /^Dönem İçi Harcamalar/, paid: /^Dönem İçi Ödemeler/,
  instLeft: /^Kalan Toplam Taksit Tutarı/, limit: /^Kart Limiti/, nextCut: /^Bir Sonraki Ay Hesap Kesim/,
};

/** Satırlardan ekstre bilgileri ve işlemler.
 *  items: { date, name, raw, amount, kind: 'buy' | 'payment' | 'fee', inst?: { k, n, total } } */
export function parseStatement(lines) {
  const info = {};
  const items = [];
  for (const l of lines) {
    // Sol sütun: etiket, ":" sonrası değer (sağdaki adres sütunu x ≥ 330 alınmaz)
    const left = l.items.filter(i => i.x < 330);
    const label = left[0]?.s || '';
    for (const [k, re] of Object.entries(INFO)) {
      if (info[k] != null || !re.test(label) || l.items[0].x > 60) continue;
      const val = left.slice(1).map(i => i.s).join(' ').replace(/^:\s*/, '').trim();
      info[k] = ['cut', 'due', 'nextCut'].includes(k) ? trDate(val) : moneyIn(val);
    }
    const first = l.items[0];
    const date = first && first.x < 80 ? trDate(first.s) : null;
    if (date) {
      const rest = l.items.slice(1);
      const ai = rest.findIndex(i => MONEY.test(i.s) && i.x > 300);
      if (ai < 0) continue;
      const desc = rest.slice(0, ai).map(i => i.s);
      const amtS = rest[ai].s;
      const raw = desc.join(' ');
      const name = cleanMerchant(desc);
      const kind = amtS.startsWith('+') ? 'payment' : /FAİZ|FAIZ|ÜCRET|UCRET|KKDF|BSMV/i.test(raw) ? 'fee' : 'buy';
      items.push({ date, name, raw, amount: Math.abs(num(amtS)), kind, line: items.length });
      continue;
    }
    // Taksit satırının altındaki açıklama: "24.489,80 TL'lik işlemin 4 / 5 taksidi"
    const text = l.items.map(i => i.s).join(' ');
    const t = text.match(/([\d.]+,\d{2})\s*TL'lik işlemin\s*(\d+)\s*\/\s*(\d+)\s*taksidi/i);
    if (t && items.length) items[items.length - 1].inst = { total: num(t[1]), k: Number(t[2]), n: Number(t[3]) };
    const fx = text.match(/İşlem Tutarı:\s*([\d.,]+)\s*([A-Z]{3})/);
    if (fx && fx[2] !== 'TRY' && items.length) items[items.length - 1].fx = `${fx[1]} ${fx[2]}`;
  }
  return { info, items };
}

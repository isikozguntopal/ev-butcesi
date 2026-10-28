// Banka SMS'i ya da e-postası metninden olay çıkarır: kart harcaması, para girişi/çıkışı, güncel bakiye.
// SMS'ler Türkçe karaktersiz gelir ("hesabiniza", "gelmistir"); karşılaştırma harf sadeleştirilerek yapılır.

export type Parsed = { kind: 'card' | 'balance' | 'in' | 'out'; amount: number; merchant: string | null; occurred_at: string | null };

const MAP: Record<string, string> = {
  'İ': 'i', 'I': 'i', 'ı': 'i', 'Ş': 's', 'ş': 's', 'Ğ': 'g', 'ğ': 'g', 'Ü': 'u', 'ü': 'u', 'Ö': 'o', 'ö': 'o', 'Ç': 'c', 'ç': 'c',
};
/** Küçük harf + Türkçe harfleri sadeleştir; uzunluk korunur, böylece bulunan yer orijinal metinde de aynıdır */
const norm = (s: string) => [...s].map(c => MAP[c] ?? (c.toLowerCase().length === 1 ? c.toLowerCase() : c)).join('');

const AMOUNT = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:tl|try)\b/g;
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

/** "28/10/2026 12:46:44" ya da "28.10.2026 12:46" → Türkiye saatiyle ISO */
function dateOf(t: string): string | null {
  const d = t.match(/(\d{2})[./](\d{2})[./](\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!d) return null;
  const iso = `${d[3]}-${d[2]}-${d[1]}T${d[4] ?? '12'}:${d[5] ?? '00'}:${d[6] ?? '00'}+03:00`;
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toISOString();
}

const clean = (s: string | undefined) => (s ? s.replace(/^[\s,:;-]+|[\s,:;-]+$/g, '').slice(0, 60) || null : null);

export function parseBankText(text: string): Parsed[] {
  const raw = text.replace(/\s+/g, ' ').trim();
  const t = norm(raw);
  if (/kampanya/.test(t) && !/(harcama|bakiye|eft|havale|fast|odeme)/.test(t)) return [];
  const when = dateOf(t);
  const out: Parsed[] = [];

  // Güncel bakiye (tek başına bakiye mesajı ya da işlem mesajının sonundaki "Guncel Bakiye")
  const bal = t.match(/(?:guncel bakiye|kullanilabilir bakiye|bakiye(?:niz|si)?)\D{0,25}?(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:tl|try)/);
  // İşlem tutarı: bakiye ifadesinden önceki ilk tutar
  const head = bal ? t.slice(0, bal.index) : t;
  const first = [...head.matchAll(AMOUNT)][0];

  let kind: Parsed['kind'] | null = null;
  if (/kart/.test(t) && /(harcama|alisveris|islem|provizyon)/.test(t) && !/iade/.test(t)) kind = 'card';
  else if (/(gelmistir|gelen (eft|havale|fast)|hesabiniza|para girisi|yatirilmistir)/.test(t)) kind = 'in';
  else if (/(gonderilmistir|giden (eft|havale|fast)|hesabinizdan|para cikisi|cekilmistir)/.test(t)) kind = 'out';

  if (kind && first) {
    let merchant: string | null = null;
    if (kind === 'card') {
      const m1 = t.match(/(?:tl|try)\s+(?:tutarinda(?:ki)?\s+)?(.{2,40}?)\s+(?:isyerinden|isyerinde|uye isyeri)/);
      const m2 = t.match(/(?:isyeri|is yeri|uye isyeri)\s*:\s*([^,;|]{2,40})/);
      const m3 = t.match(/(?:tarihinde|saatinde)\s+(.{2,40}?)\s+(?:isyerinden|isyerinde|'?(?:den|dan|de|da)\s)/);
      const m = m1 ?? m3 ?? m2;
      if (m) merchant = clean(raw.substr(m.index! + m[0].indexOf(m[1]), m[1].length));
    } else {
      const who = t.match(/,\s*(.{2,60}?)\s+tarafindan/) ?? t.match(/(?:hesabinizdan|,)\s*(.{2,60}?)\s+adina/)
        ?? t.match(/(?:alici|gonderen)\s*:?\s*([^,;|]{2,40})/);
      if (who) merchant = clean(raw.substr(who.index! + who[0].indexOf(who[1]), who[1].length));
    }
    out.push({ kind, amount: num(first[1]), merchant, occurred_at: when });
  }
  if (bal) out.push({ kind: 'balance', amount: num(bal[1]), merchant: null, occurred_at: when });
  return out;
}

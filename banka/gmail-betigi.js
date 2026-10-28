// Gmail → Aile Bütçesi: "Yapı Kredi" etiketli e-postalardan kart harcamasını ve bakiyeyi okur, uygulamaya gönderir.
// Kurulum: script.google.com > Yeni proje > bu dosyanın tamamını yapıştır.
// ADRES ve ANAHTAR'ı uygulamadaki Ben > Ayarlar > Banka bağlantısı bölümünden kopyala.
// Sonra üstten "kur" fonksiyonunu seçip Çalıştır de (bir kez izin ister). Her 5 dakikada bir kendiliğinden çalışır.

const ADRES = 'BURAYA_ADRES';
const ANAHTAR = 'BURAYA_ANAHTAR';
const ETIKET = 'Yapı Kredi';
const GUN = 3; // Son kaç günün e-postalarına bakılsın

/** Bir kez çalıştır: 5 dakikada bir otomatik çalışmayı kurar */
function kur() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('calistir').timeBased().everyMinutes(5).create();
  calistir();
}

/** Yeni e-postaları okur ve gönderir. Gönderilenler hatırlanır; sunucu da aynı e-postayı ikinci kez kaydetmez. */
function calistir() {
  const props = PropertiesService.getScriptProperties();
  const sent = JSON.parse(props.getProperty('gonderilen') || '[]');
  const events = mesajlar().filter(m => !sent.includes(m.getId())).map(ayikla).filter(Boolean);
  if (!events.length) return;
  const res = UrlFetchApp.fetch(ADRES, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ token: ANAHTAR, events }),
  });
  if (res.getResponseCode() !== 200) throw new Error(`Gönderilemedi (${res.getResponseCode()}): ${res.getContentText()}`);
  props.setProperty('gonderilen', JSON.stringify([...sent, ...events.map(e => e.msg_id)].slice(-400)));
}

/** Deneme: hiçbir şey göndermeden son e-postaların nasıl okunduğunu Günlük'e yazar */
function dene() {
  mesajlar().slice(0, 15).forEach(m => {
    const e = ayikla(m);
    Logger.log(`${m.getDate().toLocaleString('tr-TR')} | ${m.getSubject()}\n  → ${e ? JSON.stringify(e) : 'OKUNAMADI'}\n  metin: ${duz(m).slice(0, 300)}`);
  });
}

function mesajlar() {
  const label = GmailApp.getUserLabelByName(ETIKET);
  if (!label) throw new Error(`Gmail'de "${ETIKET}" etiketi yok`);
  const since = Date.now() - GUN * 86400000;
  return label.getThreads(0, 40)
    .flatMap(t => t.getMessages())
    .filter(m => m.getDate().getTime() >= since)
    .sort((a, b) => b.getDate() - a.getDate());
}

const duz = m => `${m.getSubject()} ${m.getPlainBody()}`.replace(/\s+/g, ' ').trim();
const kucuk = s => s.toLocaleLowerCase('tr-TR');

/** "1.234,56" → 1234.56 */
function sayi(s) { return Number(s.replace(/\./g, '').replace(',', '.')); }

/** E-postadan olay çıkarır; tanınmayan e-posta için null */
function ayikla(m) {
  const text = duz(m);
  const t = kucuk(text);
  if (t.includes('kampanya')  && !/(harcama|bakiye|eft|havale|fast)/.test(t)) return null;
  let kind = null;
  if (/kredi kart/.test(t) && /(harcama|alışveriş|işlem|provizyon)/.test(t)) kind = 'card';
  else if (/bakiye/.test(t)) kind = 'balance';
  else if (/(gelen (eft|havale|fast)|para girişi)/.test(t)) kind = 'in';
  else if (/(giden (eft|havale|fast)|para çıkışı)/.test(t)) kind = 'out';
  if (!kind) return null;

  // Tutar: "1.234,56 TL" biçimindeki ilk tutar (bakiye e-postasında "bakiye" kelimesinden sonraki)
  const amountRe = /(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*(?:TL|TRY)/;
  const tail = kind === 'balance' && t.indexOf('bakiye') >= 0 ? text.slice(t.indexOf('bakiye')) : text;
  const a = tail.match(amountRe) || text.match(amountRe);
  if (!a) return null;

  // İşyeri: "… işyerinde/işyerinden" öncesi ya da "İşyeri: …" sonrası (yarın gerçek e-postaya göre ayarlanacak)
  let merchant = null;
  const m1 = text.match(/(?:TL|TRY)\s+(?:tutarında(?:ki)?\s+)?(.{2,40}?)\s+(?:işyerinde|işyerinden|üye işyerinde)/i);
  const m2 = text.match(/(?:işyeri|iş yeri|üye işyeri)\s*:?\s*([^,;|]{2,40})/i);
  if (m1) merchant = m1[1].trim(); else if (m2) merchant = m2[1].trim();

  return { kind, amount: sayi(a[1]), merchant, occurred_at: m.getDate().toISOString(), msg_id: m.getId(), subject: m.getSubject() };
}

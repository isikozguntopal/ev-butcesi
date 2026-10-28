// Gmail → Aile Bütçesi: "Yapı Kredi" etiketli e-postaları uygulamaya gönderir.
// Tutar, işyeri ve bakiye uygulamanın sunucusunda ayıklanır; bu betik sadece e-posta metnini iletir.
// Kurulum: script.google.com > Yeni proje > bu dosyanın tamamını yapıştır.
// Aşağıdaki 2 ayar satırını uygulamadaki Ben > Ayarlar > Banka bağlantısı > "Betik ayarlarını kopyala" ile değiştir.
// Önce "dene"yi, doğru okuduğunu görünce "kur"u çalıştır. Uygulamada aktarım "E-posta" seçili olmalı.

const ADRES = 'BURAYA_ADRES';
const ACIK_ANAHTAR = 'BURAYA_ACIK_ANAHTAR';
const ETIKET = 'Yapı Kredi';
const GUN = 3; // Son kaç günün e-postalarına bakılsın

/** Bir kez çalıştır: 5 dakikada bir otomatik çalışmayı kurar */
function kur() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('calistir').timeBased().everyMinutes(5).create();
  calistir();
}

/** Yeni e-postaları gönderir. Gönderilenler hatırlanır; sunucu da aynı e-postayı ikinci kez kaydetmez. */
function calistir() {
  const props = PropertiesService.getScriptProperties();
  const sent = JSON.parse(props.getProperty('gonderilen') || '[]');
  const fresh = mesajlar().filter(m => !sent.includes(m.getId()));
  if (!fresh.length) return;
  const res = gonder(fresh, false);
  props.setProperty('gonderilen', JSON.stringify([...sent, ...fresh.map(m => m.getId())].slice(-400)));
  Logger.log(res);
}

/** Deneme: hiçbir şey kaydetmeden son e-postaların nasıl okunduğunu Yürütme günlüğüne yazar */
function dene() {
  const list = mesajlar().slice(0, 10);
  if (!list.length) return Logger.log(`"${ETIKET}" etiketinde son ${GUN} günde e-posta yok`);
  const res = JSON.parse(gonder(list, true));
  list.forEach(m => {
    const found = (res.events || []).filter(e => e.msg_id.startsWith(m.getId()));
    Logger.log(`${m.getDate().toLocaleString('tr-TR')} | ${m.getSubject()}\n  → ${found.length ? JSON.stringify(found.map(e => ({ tur: e.kind, tutar: e.amount, kim: e.merchant }))) : 'OKUNAMADI'}\n  metin: ${duz(m).slice(0, 300)}`);
  });
}

function gonder(list, dry) {
  const res = UrlFetchApp.fetch(ADRES, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: `Bearer ${ACIK_ANAHTAR}`, apikey: ACIK_ANAHTAR },
    payload: JSON.stringify({ source: 'email', dry, texts: list.map(m => ({ text: duz(m), id: m.getId(), at: m.getDate().toISOString() })) }),
  });
  if (res.getResponseCode() !== 200) throw new Error(`Gönderilemedi (${res.getResponseCode()}): ${res.getContentText()}`);
  return res.getContentText();
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

# Bankadan otomatik aktarım (SMS ya da e-posta)

Bankanın kart harcaması, para giriş/çıkışı ve bakiye mesajları uygulamaya kendiliğinden gelir.
Kart harcamaları uygulamayı açınca "Yeni harcama belirlendi" olarak sorulur (eşleştir / yeni harcama / yok say);
bakiye Bu Ay ekranında "Bankadaki bakiye" olarak görünür.

Uygulamada **Ben > Ayarlar > Bankadan otomatik aktarım** bölümünden kaynağı seç: Kapalı / E-posta / SMS.
İkisi aynı anda açık olmaz; seçili olmayan kaynaktan gelen mesaj kaydedilmez. Seçtikten sonra **Anahtar oluştur**.

Tutar, işyeri ve bakiye uygulamanın sunucusunda ayıklanır. Okunamayan bir mesaj olursa sadece sunucu güncellenir;
kestirmeyi ya da betiği yeniden kurmak gerekmez.

## SMS ile (iPhone Kestirmeler)

1. Bankada kart harcaması ve hesap hareketi bildirimlerini SMS kanalına aç.
2. Uygulamada kaynak: **SMS**. "1. Adres" ve "2. Yetki" değerlerini buradan kopyalayacaksın.
3. iPhone > **Kestirmeler** > **Otomasyon** > **+** > **Mesaj**
   - Gönderen: bankanın SMS adı (ör. Yapı Kredi). Listede yoksa "Mesaj İçerir" alanına `TL` yaz.
   - **Hemen Çalıştır**'ı seç ("Çalıştırmadan Önce Sor" kapalı) > İleri > **Yeni Boş Otomasyon**.
4. Eylem ekle: **URL'nin İçeriklerini Al**
   - URL: 1. Adres
   - Yöntem: **POST**
   - Başlıklar: anahtar `Authorization`, değer 2. Yetki
   - İstek Gövdesi: **JSON** > iki alan:
     - `source` (Metin) = `sms`
     - `text` (Metin) = **Kestirme Girdisi** (değişken listesinden seç)
5. Bitti. Bir sonraki banka SMS'inde otomatik çalışır.

## E-posta ile (Gmail betiği)

1. Bankada bildirimleri e-posta kanalına aç; "E-postalarımın finansal bilgilerimi içerecek şekilde iletilmesini istiyorum" açık olsun.
2. Gmail filtresi (bilgisayarda gmail.com > arama kutusundaki ayar simgesi):
   Kimden `yapikredi.com.tr`, Kelimeleri içeren `-subject:Kampanya` > Filtre oluştur > Gelen Kutusunu atla, etiket `Yapı Kredi`.
3. Uygulamada kaynak: **E-posta** > **Betik ayarlarını kopyala**.
4. script.google.com > **Yeni proje** > içini sil, `gmail-betigi.js` dosyasının tamamını yapıştır.
   `const ADRES` ve `const ACIK_ANAHTAR` satırlarını kopyaladığınla değiştir > Kaydet.
5. Fonksiyon menüsünden **dene** > Çalıştır. İlk seferde Google izin ister:
   İzinleri incele > hesabın > Gelişmiş > "…(güvenli değil) sayfasına git" > İzin ver.
   Yürütme günlüğünde son e-postaların nasıl okunduğu görünür; "OKUNAMADI" olanları bildir.
6. Doğruysa **kur** > Çalıştır. Her 5 dakikada bir kendiliğinden çalışır.
   Durdurmak için: projede sol menü **Tetikleyiciler** > sil.

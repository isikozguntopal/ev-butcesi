# Banka e-postalarını uygulamaya aktarma (Gmail)

Bankadan gelen kart harcaması ve günlük bakiye e-postaları, Gmail'deki küçük bir betikle uygulamaya gönderilir.
Kart harcamaları uygulamayı açınca "Yeni harcama belirlendi" olarak sorulur; bakiye Bu Ay ekranında görünür.

## 1. Banka
- Akıllı Asistan'da kart harcaması (alt sınır 1 TL) ve günlük bakiye bildirimlerini **e-posta** kanalına ayarla.
- E-Posta Ayarı'nda "E-postalarımın finansal bilgilerimi içerecek şekilde iletilmesini istiyorum" açık olsun.

## 2. Gmail etiketi
Bilgisayarda gmail.com > arama kutusundaki ayar simgesi:
- Kimden: `yapikredi.com.tr`
- Kelimeleri içeren: `-subject:Kampanya`
- Filtre oluştur > Gelen Kutusunu atla, Etiketi uygula: `Yapı Kredi`, eşleşen ileti dizilerine de uygula.

## 3. Anahtar
Uygulamada Ben > Ayarlar > Banka bağlantısı > **Anahtar oluştur**, sonra **Betik ayarlarını kopyala**.

## 4. Betik
1. Bilgisayarda script.google.com > **Yeni proje**.
2. Açılan dosyanın içini sil, `gmail-betigi.js` dosyasının tamamını yapıştır.
3. `const ADRES`, `const ACIK_ANAHTAR` ve `const ANAHTAR` ile başlayan 3 satırı seçip uygulamadan kopyaladığını yapıştır.
4. Kaydet (disk simgesi). Proje adı: "Aile Bütçesi Banka".
5. Üstteki fonksiyon menüsünden **dene**'yi seç > **Çalıştır**. İlk seferde Google izin ister:
   İzinleri incele > hesabını seç > "Gelişmiş" > "…(güvenli değil) sayfasına git" > İzin ver.
   (Betiği sen yazdığın için Google doğrulamamış der; betik sadece senin hesabında çalışır.)
6. Alttaki **Yürütme günlüğü**'nde son e-postaların nasıl okunduğu görünür. "OKUNAMADI" yazanları bana gönder.
7. Her şey doğruysa fonksiyon menüsünden **kur**'u seç > **Çalıştır**. Artık her 5 dakikada bir kendiliğinden çalışır.

Durdurmak için: script.google.com > projen > sol menü **Tetikleyiciler** > tetikleyiciyi sil.

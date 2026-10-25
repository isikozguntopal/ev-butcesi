# Kurulum

Toplam süre yaklaşık 15 dakika. Hepsi ücretsiz.

## 1. Veritabanı (Supabase)

1. https://supabase.com adresine girin ve **Start your project** ile hesap açın (GitHub ya da e-posta).
2. **New project** deyin:
   - Name: `ev-butcesi` (istediğiniz bir ad)
   - Database Password: güçlü bir şifre belirleyin ve bir yere not edin
   - Region: **Central EU (Frankfurt)**, Türkiye'ye en yakın bölge
3. Proje hazırlanınca soldaki menüden **SQL Editor** → **New query** açın. `supabase.sql` dosyasının tamamını yapıştırıp **Run** deyin. "Success" yazmalı.
4. **Authentication → Sign In / Providers → Email** sayfasında **Confirm email** seçeneğini kapatın. Böylece hesap açınca onay e-postası beklemeden giriş yaparsınız.
5. `config.example.js` dosyasını kopyalayıp adını `config.js` yapın. **Project Settings → API** sayfasındaki iki değeri bu dosyaya yapıştırın. `APP_NAME` alanına uygulamada görünecek adı yazın.

   `config.js` repoya gönderilmez (`.gitignore`), bu yüzden aile adı ve Supabase adresi GitHub'da görünmez.

   - **Project URL** → `SUPABASE_URL`
   - **anon public** anahtarı → `SUPABASE_ANON_KEY`

   Bu anahtar herkese açık olacak şekilde tasarlanmıştır. Verileriniz giriş ve veritabanı kurallarıyla korunur.
   ⚠️ **service_role** anahtarını asla kullanmayın.

## 1b. Bildirimler (isteğe bağlı)

Eşiniz ortak bir harcama, taksit ya da alacak eklediğinde telefonunuza bildirim gelir. Şahsi kayıtlar için bildirim gitmez, onlar gizli kalır.

1. Supabase'de **Edge Functions** → **Deploy a new function** → **Via Editor** seçin.
2. Fonksiyon adı `notify` olsun. `supabase/functions/notify/index.ts` dosyasının içeriğini yapıştırıp **Deploy** deyin.
3. **Edge Functions → Secrets** sayfasında iki değer ekleyin:
   - `VAPID_PUBLIC_KEY` ve `VAPID_PRIVATE_KEY`: bir anahtar çifti üretin (`npx web-push generate-vapid-keys`). Herkese açık olanı `config.js` içindeki `VAPID_PUBLIC_KEY` alanına da yazın.
   - Gizli anahtarı (`VAPID_PRIVATE_KEY`) sadece Supabase Secrets'a girin, kimseyle paylaşmayın.
4. Telefonda uygulamayı **ana ekrandan** açın ve **Param → Bildirimler → Aç** deyin. İkiniz de ayrı ayrı açmalısınız. iOS 16.4 veya üstü gerekir.

## 2. Yayınlama (Netlify, ücretsiz)

1. https://app.netlify.com/drop adresine girin ve ücretsiz hesap açın.
2. Proje klasörünü (içinde `index.html` olan) sayfaya sürükleyip bırakın. Birkaç saniye içinde bir link verir, örneğin `https://harika-isim-123.netlify.app`.
3. İsterseniz **Site configuration → Change site name** ile adresi istediğiniz bir adla değiştirebilirsiniz.

Güncelleme yaparken: Netlify'da sitenizi açın, **Deploys** sekmesine gidip klasörü yeniden sürükleyin.

## 3. Telefonlara ekleme

Her iki telefonda da:

1. Linki **Safari**'de açın.
2. **Paylaş** (kare içinde ok) → **Ana Ekrana Ekle** → **Ekle**.
3. Ana ekrandaki simgeden açın. (Eklerken çıkan ekranda adı istediğiniz gibi değiştirebilirsiniz.)

## 4. Aileyi kurma

1. **İlk kişi:** Hesap açın, adınızı yazın, **Aile oluştur** deyin. Alışveriş kataloğu hazır ürünlerle dolu gelir.
2. **Param** sekmesinin altında 6 haneli **davet kodu** görünür. Bu kodu eşinize gönderin.
3. **Eşiniz:** Kendi e-postasıyla hesap açar, adını yazar, **Davet koduyla katıl** deyip kodu girer.

## Kim neyi görür?

| Kayıt | Kim görür? |
|---|---|
| Şahsi harcama, taksit, aylık ödeme | Sadece ekleyen kişi |
| "Ortak alım" işaretli kayıtlar | İkiniz de |
| Gelir ve birikim (Param) | Sadece sahibi |
| Alışveriş listesi, Alacaklarımız | İkiniz de |

Ortak alımda **Yarı yarıya** seçilirse tutarın yarısı ikinizin bütçesine de yansır. **Tamamı kart sahibine** seçilirse tamamı kart sahibinin bütçesine yansır, diğer kişi kaydı sadece bilgi olarak görür.

## Bilgisayarda deneme

`config.js` boşken uygulama **deneme modunda** açılır. Bu modda veriler sadece o tarayıcıda kalır.

```bash
python3 -m http.server 8765
```

Sonra tarayıcıda http://localhost:8765 adresini açın.

Not: Supabase'in ücretsiz planında proje 1 hafta hiç kullanılmazsa uykuya geçer. Supabase panelinden tek tıkla tekrar açılır.

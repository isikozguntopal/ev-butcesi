// Yeni aile kurulurken alışveriş kataloğuna eklenen hazır ürünler
export const DEFAULT_SHOPPING = {
  'Meyve & Sebze': ['Domates', 'Salatalık', 'Sivri biber', 'Kapya biber', 'Soğan', 'Patates', 'Sarımsak', 'Limon', 'Havuç', 'Kabak', 'Patlıcan', 'Ispanak', 'Elma', 'Muz', 'Portakal', 'Mandalina', 'Üzüm', 'Avokado'],
  'Yeşillik': ['Maydanoz', 'Dereotu', 'Taze nane', 'Roka', 'Marul', 'Kıvırcık', 'Taze soğan', 'Tere', 'Semizotu'],
  'Kahvaltılık': ['Yumurta', 'Beyaz peynir', 'Kaşar peyniri', 'Siyah zeytin', 'Yeşil zeytin', 'Bal', 'Reçel', 'Tereyağı', 'Tahin', 'Pekmez', 'Fındık ezmesi', 'Sucuk'],
  'Süt Ürünleri': ['Süt', 'Yoğurt', 'Ayran', 'Krema', 'Labne', 'Kefir'],
  'Et, Tavuk & Balık': ['Kıyma', 'Kuşbaşı et', 'Tavuk göğsü', 'Tavuk but', 'Bütün tavuk', 'Köfte', 'Balık'],
  'Temel Gıda': ['Ekmek', 'Pirinç', 'Bulgur', 'Makarna', 'Un', 'Şeker', 'Tuz', 'Ayçiçek yağı', 'Zeytinyağı', 'Kırmızı mercimek', 'Yeşil mercimek', 'Nohut', 'Kuru fasulye', 'Domates salçası', 'Biber salçası', 'Ton balığı', 'Yulaf', 'Galeta unu', 'Kabartma tozu', 'Maya'],
  'Baharat & Sos': ['Karabiber', 'Pul biber', 'Kimyon', 'Kekik', 'Kuru nane', 'Toz kırmızı biber', 'Ketçap', 'Mayonez', 'Hardal', 'Sirke', 'Nar ekşisi', 'Soya sosu'],
  'İçecek & Atıştırmalık': ['Çay', 'Türk kahvesi', 'Filtre kahve', 'Su', 'Maden suyu', 'Meyve suyu', 'Bisküvi', 'Çikolata', 'Kuruyemiş', 'Cips', 'Kraker'],
  'Dondurulmuş': ['Dondurulmuş sebze', 'Patates kızartması', 'Mantı', 'Dondurma'],
  'Temizlik': ['Çamaşır deterjanı', 'Renkliler için deterjan', 'Yumuşatıcı', 'Bulaşık makinesi tableti', 'Bulaşık makinesi parlatıcısı', 'Bulaşık makinesi tuzu', 'Elde bulaşık deterjanı', 'Çamaşır suyu', 'Yüzey temizleyici', 'Cam temizleyici', 'Banyo temizleyici', 'Kireç çözücü', 'Tuvalet temizleyici', 'Krem temizleyici', 'Leke çıkarıcı', 'Sünger', 'Bulaşık bezi', 'Mikrofiber bez', 'Çöp poşeti', 'Paspas yedeği', 'Lavabo açıcı'],
  'Kağıt Ürünleri': ['Tuvalet kağıdı', 'Kağıt havlu', 'Peçete', 'Islak mendil', 'Cep mendili'],
  'Kişisel Bakım': ['Şampuan', 'Saç kremi', 'Duş jeli', 'Kalıp sabun', 'Sıvı sabun', 'Diş macunu', 'Diş fırçası', 'Diş ipi', 'Ağız gargarası', 'Deodorant', 'Tıraş bıçağı', 'Tıraş köpüğü', 'Pamuk', 'Kulak çubuğu', 'Hijyenik ped', 'Nemlendirici krem', 'Güneş kremi', 'El kremi'],
  'Mutfak Sarf': ['Streç film', 'Alüminyum folyo', 'Pişirme kağıdı', 'Buzdolabı poşeti', 'Kilitli poşet', 'Çakmak'],
  'Ev & Diğer': ['Pil', 'Ampul', 'Sinek ilacı', 'Oda kokusu', 'Çamaşır mandalı', 'Askı'],
};

export const CATEGORIES = [...Object.keys(DEFAULT_SHOPPING), 'Diğer'];

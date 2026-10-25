-- Taksit kredi kartiyla mi odeniyor? (KYK gibi kart disi taksitler icin false)
-- Kart odemesi girilince, sahibinin kartindan odenen taksitler o ay ayrica dusulmez.
-- Mevcut veriler silinmez; tum taksitler varsayilan olarak "kartla" sayilir.
alter table installments add column if not exists on_card boolean not null default true;

-- Odeme sekli: harcama ve "her ay" odemelerinde kart mi nakit mi?
-- Kart secilenler, kart odemesi girilince o ay ayrica dusulmez ve otomatik tiklenir.
-- Mevcut kayitlar "nakit" baslar; toplamlar degismez. Mevcut veriler silinmez.
alter table fixed_payments add column if not exists on_card boolean not null default false;
alter table expenses add column if not exists on_card boolean not null default false;

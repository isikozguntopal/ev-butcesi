-- Kart limiti: limit, bankadaki kullanılan tutar ve bilgi tarihi. Mevcut veriler silinmez.
alter table finances add column if not exists card_limit numeric not null default 0;
alter table finances add column if not exists card_used numeric not null default 0;
alter table finances add column if not exists card_used_at date;

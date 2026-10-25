-- Ortak alimda yeni secenek: "other" = karti biri oder, tamami digerine aittir
-- (hesaplasmada tutarin tamami kart sahibine geri gonderilir). Mevcut veriler degismez.
alter table installments drop constraint if exists installments_split_check;
alter table installments add constraint installments_split_check check (split in ('half', 'payer', 'other'));
alter table fixed_payments drop constraint if exists fixed_payments_split_check;
alter table fixed_payments add constraint fixed_payments_split_check check (split in ('half', 'payer', 'other'));
alter table expenses drop constraint if exists expenses_split_check;
alter table expenses add constraint expenses_split_check check (split in ('half', 'payer', 'other'));

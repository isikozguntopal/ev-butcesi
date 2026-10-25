-- Kisiye ozel "odendi" tikleri, harcamalarda odendi, hesaplasma gonderildi/alindi kaydi
-- Mevcut veriler silinmez; sadece yeni alanlar eklenir ve eski tikler kisiye baglanir.

-- Harcamalar da tiklenebilsin. Eski harcamalar odenmis sayilir.
alter table expenses add column if not exists paid_months text[] not null default '{}';
update expenses
  set paid_months = array[to_char(date, 'YYYY-MM') || ':' || payer_id::text]
  where paid_months = '{}';

-- Eski "YYYY-MM" tiklerini "YYYY-MM:kisi" yap (karti odeyen kisiye baglanir)
update installments set paid_months = coalesce((
  select array_agg(case when x like '%:%' then x else x || ':' || payer_id::text end) from unnest(paid_months) x
), '{}');
update fixed_payments set paid_months = coalesce((
  select array_agg(case when x like '%:%' then x else x || ':' || payer_id::text end) from unnest(paid_months) x
), '{}');

-- Hesaplasma: kim gonderdi, kim aldi, ne zaman (log)
alter table settlements add column if not exists sent_at timestamptz;
alter table settlements add column if not exists sent_by uuid;
alter table settlements add column if not exists received_at timestamptz;
alter table settlements add column if not exists received_by uuid;
alter table settlements add column if not exists log jsonb not null default '[]';
update settlements set sent_at = created_at, sent_by = created_by where sent_at is null;

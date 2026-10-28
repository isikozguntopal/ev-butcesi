-- 012: Harcamada ödeme tarihi ve kişisel alışveriş listesi
-- Supabase > SQL Editor: tamamını yapıştırıp "Run" deyin.

-- Ortak harcamada payın ödeneceği gün (boşsa harcama tarihi). Hesaplaşma bu tarihin ayına göre yapılır.
alter table expenses add column if not exists pay_date date;

-- Kişisel liste: owner_id dolu ürünler sadece sahibine görünür; boş olanlar ailenin ortak listesi.
alter table shopping_items add column if not exists owner_id uuid references auth.users on delete cascade;
drop policy if exists "aile" on shopping_items;
create policy "aile" on shopping_items for all
  using (household_id = my_household() and (owner_id is null or owner_id = auth.uid()))
  with check (household_id = my_household() and (owner_id is null or owner_id = auth.uid()));

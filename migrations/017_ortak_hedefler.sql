-- 017: Ortak hedefler. "Ortak" işaretli hedefi ailedeki iki kişi de görür, para ekler, düzenler ve siler.
-- Kişisel hedefleri yine sadece sahibi görür.
-- Supabase > SQL Editor: tamamını yapıştırıp "Run" deyin.
alter table goals add column if not exists shared boolean not null default false;
drop policy if exists "kendim" on goals;
drop policy if exists "oku" on goals;
drop policy if exists "ekle" on goals;
drop policy if exists "guncelle" on goals;
drop policy if exists "sil" on goals;
create policy "oku" on goals for select using (owner_id = auth.uid() or (shared and household_id = my_household()));
create policy "ekle" on goals for insert with check (owner_id = auth.uid() and household_id = my_household());
create policy "guncelle" on goals for update using (owner_id = auth.uid() or (shared and household_id = my_household())) with check (household_id = my_household());
create policy "sil" on goals for delete using (owner_id = auth.uid() or (shared and household_id = my_household()));

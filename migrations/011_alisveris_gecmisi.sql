-- Alışveriş geçmişi: tamamlanan alışverişin tarihi, toplamı ve ürünleri. Aile herkes görür.
create table if not exists shopping_trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  date date not null default current_date,
  total numeric not null default 0,
  items text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table shopping_trips enable row level security;
drop policy if exists "aile" on shopping_trips;
create policy "aile" on shopping_trips for all using (household_id = my_household()) with check (household_id = my_household());

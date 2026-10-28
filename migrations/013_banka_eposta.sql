-- 013: Banka e-postalarından otomatik gelen harcamalar ve bakiye
-- Supabase > SQL Editor: tamamını yapıştırıp "Run" deyin.

-- Bankadan gelen olaylar (kart harcaması, günlük bakiye…). Sadece sahibi görür.
-- Kayıtları "bank" fonksiyonu ekler; uygulama sadece okur ve durumunu günceller.
create table if not exists bank_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('card', 'balance', 'in', 'out')),
  amount numeric not null,
  merchant text,
  occurred_at timestamptz not null default now(),
  msg_id text not null,
  subject text,
  status text not null default 'pending' check (status in ('pending', 'added', 'matched', 'ignored')),
  matched_table text,
  matched_id uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, msg_id)
);
alter table bank_events enable row level security;
drop policy if exists "kendim oku" on bank_events;
drop policy if exists "kendim guncelle" on bank_events;
create policy "kendim oku" on bank_events for select using (owner_id = auth.uid());
create policy "kendim guncelle" on bank_events for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- Gmail'deki betiğin kullandığı kişisel bağlantı anahtarı. Sadece sahibi görür.
create table if not exists bank_links (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  token text unique not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);
alter table bank_links enable row level security;
drop policy if exists "kendim" on bank_links;
create policy "kendim" on bank_links for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Bankanın bildirdiği son bakiye
alter table finances add column if not exists bank_balance numeric;
alter table finances add column if not exists bank_balance_at timestamptz;

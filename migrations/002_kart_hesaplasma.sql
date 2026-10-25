-- Kredi kartı ödemeleri, ayın 5'i hesaplaşması, euro ve altın
-- Supabase > SQL Editor > New query: yapıştırıp "Run" deyin. (Bir kez çalıştırmak yeterli.)

alter table finances add column if not exists eur_amount numeric not null default 0;
alter table finances add column if not exists gold_grams numeric not null default 0;

-- Her ay kredi kartına yapılan ödeme (sadece sahibi görür)
create table if not exists card_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  month text not null,
  amount numeric not null default 0,
  includes_installments boolean not null default true,
  created_at timestamptz not null default now(),
  unique (owner_id, month)
);
alter table card_payments enable row level security;
drop policy if exists "kendim" on card_payments;
create policy "kendim" on card_payments for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and household_id = my_household());

-- Ayın 5'inde yapılan para transferi kaydı (ailede herkes görür)
create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  month text not null,
  from_id uuid references auth.users on delete set null,
  to_id uuid references auth.users on delete set null,
  amount numeric not null default 0,
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, month)
);
alter table settlements enable row level security;
drop policy if exists "aile" on settlements;
create policy "aile" on settlements for all
  using (household_id = my_household())
  with check (household_id = my_household());

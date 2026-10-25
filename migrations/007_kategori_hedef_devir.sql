-- Kategoriler, hedefler, manuel devir. Mevcut veriler silinmez.
alter table expenses add column if not exists category text not null default 'Diğer';
alter table installments add column if not exists category text not null default 'Diğer';
alter table fixed_payments add column if not exists category text not null default 'Diğer';

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  target numeric not null default 0,
  saved numeric not null default 0,
  created_at timestamptz not null default now()
);
alter table goals enable row level security;
drop policy if exists "kendim" on goals;
create policy "kendim" on goals for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create table if not exists carryovers (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  month text not null,
  amount numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, month)
);
alter table carryovers enable row level security;
drop policy if exists "kendim" on carryovers;
create policy "kendim" on carryovers for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

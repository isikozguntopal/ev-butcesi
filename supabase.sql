-- Aile Bütçesi veritabanı
-- Supabase > SQL Editor > New query: bu dosyanın tamamını yapıştırıp "Run" deyin.

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Ailemiz',
  invite_code text unique not null default upper(substr(md5(random()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table members (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  household_id uuid not null references households on delete cascade,
  display_name text not null,
  notify_prefs jsonb not null default '{}',
  created_at timestamptz not null default now()
);

-- Gelir ve birikim: sadece sahibi görür
create table finances (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  income numeric not null default 0,
  savings_tl numeric not null default 0,
  usd_amount numeric not null default 0,
  usd_rate numeric not null default 0,
  eur_amount numeric not null default 0,
  gold_grams numeric not null default 0
);

-- Kişisel ya da ortak kayıtlar (shared = true ise iki kişi de görür)
create table installments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  payer_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  monthly_amount numeric not null,
  first_month date not null,
  last_month date not null,
  shared boolean not null default false,
  split text not null default 'half' check (split in ('half', 'payer')),
  paid_months text[] not null default '{}',
  on_card boolean not null default true,
  created_at timestamptz not null default now()
);

create table fixed_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  payer_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  amount numeric not null,
  shared boolean not null default false,
  split text not null default 'half' check (split in ('half', 'payer')),
  paid_months text[] not null default '{}',
  on_card boolean not null default false,
  created_at timestamptz not null default now()
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  payer_id uuid not null default auth.uid() references auth.users on delete cascade,
  name text not null,
  amount numeric not null,
  date date not null default current_date,
  shared boolean not null default false,
  split text not null default 'half' check (split in ('half', 'payer')),
  paid_months text[] not null default '{}',
  on_card boolean not null default false,
  created_at timestamptz not null default now()
);

-- Ailenin ortak listeleri
create table shopping_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  category text not null default 'Diğer',
  in_list boolean not null default false,
  checked boolean not null default false,
  created_at timestamptz not null default now()
);

create table wishlist (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  price numeric not null default 0,
  target_month date,
  note text,
  bought boolean not null default false,
  created_at timestamptz not null default now()
);

-- Giriş yapan kişinin ailesi
create function my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid()
$$;

alter table households enable row level security;
alter table members enable row level security;
alter table finances enable row level security;

create policy "aile" on households for select using (id = my_household());
create policy "aile" on members for select using (household_id = my_household());
create policy "kendim" on members for update using (user_id = auth.uid());
create policy "kendim" on finances for all using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['installments', 'fixed_payments', 'expenses'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "oku" on %I for select using (owner_id = auth.uid() or (shared and household_id = my_household()))', t);
    execute format('create policy "ekle" on %I for insert with check (owner_id = auth.uid() and household_id = my_household())', t);
    execute format('create policy "guncelle" on %I for update using (owner_id = auth.uid() or (shared and household_id = my_household())) with check (household_id = my_household())', t);
    execute format('create policy "sil" on %I for delete using (owner_id = auth.uid())', t);
  end loop;
  foreach t in array array['shopping_items', 'wishlist'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "aile" on %I for all using (household_id = my_household()) with check (household_id = my_household())', t);
  end loop;
end $$;

create function create_household(p_name text, p_display_name text) returns households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'Zaten bir aileye katıldınız';
  end if;
  insert into households (name) values (coalesce(nullif(trim(p_name), ''), 'Ailemiz')) returning * into h;
  insert into members (user_id, household_id, display_name) values (auth.uid(), h.id, p_display_name);
  return h;
end $$;

create function join_household(p_code text, p_display_name text) returns households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'Zaten bir aileye katıldınız';
  end if;
  select * into h from households where invite_code = upper(trim(p_code));
  if not found then
    raise exception 'Davet kodu bulunamadı';
  end if;
  insert into members (user_id, household_id, display_name) values (auth.uid(), h.id, p_display_name);
  return h;
end $$;

-- Bildirim abonelikleri (her telefon kendi kaydını yönetir)
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "kendim" on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

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
  sent_at timestamptz,
  sent_by uuid,
  received_at timestamptz,
  received_by uuid,
  log jsonb not null default '[]',
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (household_id, month)
);
alter table settlements enable row level security;
drop policy if exists "aile" on settlements;
create policy "aile" on settlements for all
  using (household_id = my_household())
  with check (household_id = my_household());

-- Kategoriler, hedefler, manuel devir (migrations/007)
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

-- Kart borcu eşitleme (migrations/008)
alter table card_payments add column if not exists card_adjust numeric not null default 0;

-- Ekstre ayı (migrations/009)
alter table card_payments add column if not exists statement_month text;

-- Kart limiti (migrations/010)
alter table finances add column if not exists card_limit numeric not null default 0;
alter table finances add column if not exists card_used numeric not null default 0;
alter table finances add column if not exists card_used_at date;
alter table finances add column if not exists card_debt numeric not null default 0;

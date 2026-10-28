-- 015: Harcama kaydına fiş fotoğrafı
-- Supabase > SQL Editor: yapıştırıp "Run" deyin. (Fiş deposu 014'te kuruldu.)
alter table expenses add column if not exists receipt_path text;

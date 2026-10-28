-- 014: Market alışverişine fiş fotoğrafı
-- Supabase > SQL Editor: tamamını yapıştırıp "Run" deyin.

alter table shopping_trips add column if not exists receipt_path text;

-- Fişler gizli bir depoda; sadece aynı ailenin üyeleri görebilir (dosya yolu: <aile kimliği>/<dosya>.jpg)
insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
drop policy if exists "fis oku" on storage.objects;
drop policy if exists "fis ekle" on storage.objects;
drop policy if exists "fis sil" on storage.objects;
create policy "fis oku" on storage.objects for select
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.my_household()::text);
create policy "fis ekle" on storage.objects for insert
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.my_household()::text);
create policy "fis sil" on storage.objects for delete
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = public.my_household()::text);

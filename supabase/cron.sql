-- Aylık hatırlatma bildirimleri: her ayın 1, 3 ve 5'inde saat 09:00 (Türkiye)
-- Önce "notify" Edge Function'ı kurulmuş ve CRON_SECRET secret'ı eklenmiş olmalı.
-- <PROJE_REF>, <ANON_KEY> ve <CRON_SECRET> yerlerini doldurup SQL Editor'da çalıştırın.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('aylik-hatirlatma') where exists (select 1 from cron.job where jobname = 'aylik-hatirlatma');

select cron.schedule('aylik-hatirlatma', '0 6 1,3,5 * *', $$
  select net.http_post(
    url := 'https://<PROJE_REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <ANON_KEY>',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body := '{}'::jsonb
  );
$$);

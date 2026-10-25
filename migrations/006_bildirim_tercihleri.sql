-- Kisiye ozel bildirim tercihleri (bos = hepsi acik). Mevcut veriler degismez.
alter table members add column if not exists notify_prefs jsonb not null default '{}';

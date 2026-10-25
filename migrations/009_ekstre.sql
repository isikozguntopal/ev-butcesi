-- Kart ödemesi hangi ekstreye ait? (boşsa ödeme ayı). Mevcut veriler silinmez.
alter table card_payments add column if not exists statement_month text;

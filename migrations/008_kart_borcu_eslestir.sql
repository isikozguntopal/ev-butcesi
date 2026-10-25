-- Kart borcu eşitleme: bankadaki gerçek borç ile uygulama arasındaki fark (nakit bakiyeyi etkilemez)
alter table card_payments add column if not exists card_adjust numeric not null default 0;

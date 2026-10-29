-- 016: Ortak kayıtları (taksit, aylık ödeme, harcama) ailedeki iki kişi de silebilir.
-- Kişisel kayıtları yine sadece sahibi siler.
-- Supabase > SQL Editor: tamamını yapıştırıp "Run" deyin.
do $$
declare t text;
begin
  foreach t in array array['installments', 'fixed_payments', 'expenses'] loop
    execute format('drop policy if exists "sil" on %I', t);
    execute format('create policy "sil" on %I for delete using (owner_id = auth.uid() or (shared and household_id = my_household()))', t);
  end loop;
end $$;

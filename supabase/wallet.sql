-- =====================================================================
-- Music Mute · automatic InstaPay / Vodafone Cash verification
-- How it works:
--   1. Buyer (signed in) opens a request: 100 EGP, his name as shown in InstaPay
--      (and the number he pays from for Vodafone Cash). Valid 24 hours.
--   2. Buyer sends 100 EGP to the shop InstaPay / wallet.
--   3. The shop phone receives the "money received" SMS; an SMS-forwarder app
--      posts it to the `wallet-sms` edge function.
--   4. The function reads amount + sender name / number, matches exactly one
--      open request and activates the license — no screenshot, no human.
-- Run once in the Supabase SQL editor. Safe to re-run.
-- =====================================================================

alter table public.payments add column if not exists expected_amount numeric(10,2);
alter table public.payments add column if not exists payer_phone text;
alter table public.payments add column if not exists expires_at timestamptz;
alter table public.payments add column if not exists auto boolean not null default false;
create index if not exists payments_auto_idx on public.payments(auto, status, expected_amount);

alter table public.licenses drop constraint if exists licenses_source_check;
alter table public.licenses add constraint licenses_source_check
  check (source in ('manual','creem','paymob','gift','easykash','paytabs','gumroad','wallet'));

alter table public.payments add column if not exists payer_name text;

-- Buyer starts (or resumes) an automatic wallet payment. Price is the fixed price_egp (100).
-- p_name  = sender name as it appears in InstaPay (bank SMS show it)
-- p_phone = number he pays from (Vodafone Cash SMS show it)
drop function if exists public.start_wallet_payment(text, text);
create or replace function public.start_wallet_payment(p_method text, p_name text, p_phone text default null)
returns table(id uuid, amount numeric, expires_at timestamptz, pay_to text)
language plpgsql security definer set search_path = public as $$
declare
  me text := jwt_email();
  base numeric;
  nm text := upper(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')));
  phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  existing payments;
begin
  if me = '' or auth.uid() is null then raise exception 'Please sign in first'; end if;
  if p_method not in ('instapay', 'vodafone_cash') then raise exception 'Bad method'; end if;
  if array_length(regexp_split_to_array(nm, ' '), 1) < 2 then raise exception 'Enter at least your first two names as they appear in InstaPay'; end if;
  if phone is not null and phone !~ '^01[0125][0-9]{8}$' then raise exception 'Enter a valid 11-digit number'; end if;
  if p_method = 'vodafone_cash' and phone is null then raise exception 'Enter the Vodafone Cash number you will pay from'; end if;
  if exists (select 1 from licenses l where l.email = me and l.active) then raise exception 'already_licensed'; end if;

  select coalesce(nullif(value, '')::numeric, 100) into base from settings where key = 'price_egp';
  base := coalesce(base, 100);

  select * into existing from payments p
   where p.user_id = auth.uid() and p.auto and p.status = 'pending' and p.expires_at > now()
   order by p.created_at desc limit 1;
  if existing.id is not null then
    update payments set method = p_method, payer_name = nm, payer_phone = phone,
      expected_amount = base, amount_egp = base, expires_at = now() + interval '24 hours'
     where payments.id = existing.id;
    return query select existing.id, base, now() + interval '24 hours',
      coalesce((select value from settings where key = 'wallet_number'), '');
    return;
  end if;

  return query
  insert into payments (user_id, email, method, amount_egp, reference, payer_name, payer_phone, expected_amount, expires_at, auto)
  values (auth.uid(), me, p_method, base, left('AUTO ' || nm || coalesce(' ' || phone, ''), 120), nm, phone, base, now() + interval '24 hours', true)
  returning payments.id, payments.expected_amount, payments.expires_at,
    coalesce((select value from settings where key = 'wallet_number'), '');
end $$;
revoke execute on function public.start_wallet_payment(text, text, text) from anon;

-- Public setting shown on /buy.
insert into public.settings (key, value) values ('wallet_number', '01044855081')
on conflict (key) do update set value = excluded.value;
insert into public.settings (key, value) values ('instapay_handle', '01044855081')
on conflict (key) do update set value = excluded.value;
insert into public.settings (key, value) values ('vodafone_cash_number', '01044855081')
on conflict (key) do update set value = excluded.value;

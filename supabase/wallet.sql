-- =====================================================================
-- Music Mute · automatic InstaPay / Vodafone Cash verification
-- How it works:
--   1. Buyer (signed in) asks for a payment → gets a UNIQUE amount (e.g. 100.37 EGP)
--      valid for 2 hours, and tells us the wallet/phone he pays from.
--   2. Buyer sends that exact amount to the shop wallet.
--   3. The shop phone receives the "money received" SMS; an SMS-forwarder app
--      posts it to the `wallet-sms` edge function.
--   4. The function reads amount (+ sender number if present), matches the
--      pending payment and activates the license — no screenshot, no human.
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

-- Buyer starts (or resumes) an automatic wallet payment.
create or replace function public.start_wallet_payment(p_method text, p_phone text)
returns table(id uuid, amount numeric, expires_at timestamptz, pay_to text)
language plpgsql security definer set search_path = public as $$
declare
  me text := jwt_email();
  base numeric;
  amt numeric;
  phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  existing payments;
  tries int := 0;
begin
  if me = '' or auth.uid() is null then raise exception 'Please sign in first'; end if;
  if p_method not in ('instapay', 'vodafone_cash') then raise exception 'Bad method'; end if;
  if phone !~ '^01[0125][0-9]{8}$' then raise exception 'Enter the 11-digit number you will pay from'; end if;
  if exists (select 1 from licenses l where l.email = me and l.active) then raise exception 'already_licensed'; end if;

  -- Reuse an open request from the same buyer.
  select * into existing from payments p
   where p.user_id = auth.uid() and p.auto and p.status = 'pending' and p.expires_at > now()
   order by p.created_at desc limit 1;
  if existing.id is not null then
    update payments set method = p_method, payer_phone = phone where payments.id = existing.id;
    return query select existing.id, existing.expected_amount, existing.expires_at,
      coalesce((select value from settings where key = 'wallet_number'), '');
    return;
  end if;

  select coalesce(nullif(value, '')::numeric, 100) into base from settings where key = 'price_egp';
  base := coalesce(base, 100);
  -- Unique piasters among open requests (01..99).
  loop
    tries := tries + 1;
    amt := base + (1 + floor(random() * 99)) / 100.0;
    exit when not exists (select 1 from payments p where p.auto and p.status = 'pending'
                          and p.expires_at > now() and p.expected_amount = amt);
    if tries > 200 then raise exception 'Busy, please try again in a few minutes'; end if;
  end loop;

  return query
  insert into payments (user_id, email, method, amount_egp, reference, payer_phone, expected_amount, expires_at, auto)
  values (auth.uid(), me, p_method, amt, 'AUTO ' || amt::text || ' from ' || phone, phone, amt, now() + interval '2 hours', true)
  returning payments.id, payments.expected_amount, payments.expires_at,
    coalesce((select value from settings where key = 'wallet_number'), '');
end $$;
revoke execute on function public.start_wallet_payment(text, text) from anon;

-- Public setting shown on /buy.
insert into public.settings (key, value) values ('wallet_number', '01044855081')
on conflict (key) do update set value = excluded.value;
insert into public.settings (key, value) values ('instapay_handle', '01044855081')
on conflict (key) do update set value = excluded.value;
insert into public.settings (key, value) values ('vodafone_cash_number', '01044855081')
on conflict (key) do update set value = excluded.value;

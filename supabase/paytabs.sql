-- =====================================================================
-- Music Mute · PayTabs Egypt (automatic EGP: Visa, Mastercard, Meeza)
-- Run once in the Supabase SQL editor AFTER schema.sql (and easykash.sql
-- if you ran it). Safe to re-run.
-- =====================================================================

-- Licenses can now come from PayTabs.
alter table public.licenses drop constraint if exists licenses_source_check;
alter table public.licenses add constraint licenses_source_check
  check (source in ('manual','creem','paymob','gift','easykash','paytabs'));

-- On/off switch (admin turns it on once the PayTabs account + secrets are ready).
insert into public.settings (key, value) values ('paytabs_enabled', 'false')
on conflict (key) do nothing;

-- One row per checkout attempt. Created only by the paytabs-checkout edge function.
create sequence if not exists public.paytabs_order_seq start 5001;
create table if not exists public.paytabs_orders (
  id bigint generated always as identity primary key,
  ref text not null unique default ('MP' || nextval('public.paytabs_order_seq')::text),  -- sent to PayTabs as cart_id
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (email = lower(email)),
  name text,
  mobile text,
  amount_egp numeric(10,2) not null check (amount_egp > 0),
  status text not null default 'pending' check (status in ('pending','paid','failed')),
  tran_ref text,
  payment_method text,
  amount_paid numeric(10,2),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists paytabs_orders_email_idx on public.paytabs_orders(email, created_at desc);

alter table public.paytabs_orders enable row level security;
drop policy if exists "own or admin paytabs orders" on public.paytabs_orders;
create policy "own or admin paytabs orders" on public.paytabs_orders
  for select using (email = jwt_email() or is_admin());
-- No insert/update policies: only the edge functions (service role) write here.

-- Admin dashboard numbers include both card providers.
create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'licenses', (select count(*) from licenses where active),
    'manual', (select count(*) from licenses where active and source = 'manual'),
    'creem', (select count(*) from licenses where active and source = 'creem'),
    'easykash', (select count(*) from licenses where active and source = 'easykash'),
    'paytabs', (select count(*) from licenses where active and source = 'paytabs'),
    'pending', (select count(*) from payments where status = 'pending'),
    'egp_approved', (select coalesce(sum(amount_egp),0) from payments where status = 'approved')
                    + coalesce((select sum(amount_egp) from easykash_orders where status = 'paid'), 0)
                    + (select coalesce(sum(amount_egp),0) from paytabs_orders where status = 'paid'));
end $$;
revoke execute on function public.admin_stats() from anon;

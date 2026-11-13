-- =====================================================================
-- Music Mute · licensing backend (Supabase)
-- Lifetime licenses tied to the buyer's email.
--   * EGP: buyer pays by InstaPay / Vodafone Cash, submits a payment record,
--          an admin approves it -> license activates.
--   * USD: buyer pays on Creem -> signed webhook -> license activates.
-- Run once in SQL Editor. Safe to re-run.
-- =====================================================================

-- ---------- Tables ----------
create table if not exists public.settings (
  key text primary key,
  value text not null default ''
);
insert into public.settings (key, value) values
  ('price_egp', '100'),
  ('price_usd', '2.99'),
  ('instapay_handle', ''),
  ('vodafone_cash_number', ''),
  ('creem_checkout_url', ''),
  ('support_email', '')
on conflict (key) do nothing;

create table if not exists public.admins (
  email text primary key
);

create table if not exists public.licenses (
  email text primary key check (email = lower(email)),
  active boolean not null default true,
  source text not null check (source in ('manual','creem','paymob','gift')),
  reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  email text not null,
  method text not null check (method in ('instapay','vodafone_cash')),
  amount_egp numeric(10,2) not null check (amount_egp > 0),
  reference text not null check (char_length(reference) between 3 and 120),
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  admin_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists payments_status_idx on public.payments(status, created_at desc);

create table if not exists public.webhook_events (
  id text primary key,              -- provider event id (idempotency)
  provider text not null,
  event_type text not null,
  email text,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor text,
  action text not null,
  target text,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------- Helpers ----------
create or replace function public.jwt_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = jwt_email()) and jwt_email() <> '';
$$;

-- Payment rows always carry the signed-in user's own email; status starts pending.
create or replace function public.guard_payment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.user_id := auth.uid();
      new.email := jwt_email();
    end if;
    new.status := 'pending'; new.reviewed_by := null; new.reviewed_at := null; new.admin_note := null;
  end if;
  return new;
end $$;
drop trigger if exists guard_payment_trg on public.payments;
create trigger guard_payment_trg before insert on public.payments
  for each row execute function public.guard_payment();

-- ---------- RPCs used by the extension and the website ----------
-- Is the signed-in user's email licensed?
create or replace function public.my_license()
returns table(active boolean, source text, since timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(l.active, false), l.source, l.created_at
  from (select jwt_email() as e) me
  left join licenses l on l.email = me.e
  where me.e <> '';
$$;

create or replace function public.approve_payment(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare p payments;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select * into p from payments where id = p_id for update;
  if p.id is null then raise exception 'Payment not found'; end if;
  update payments set status = 'approved', reviewed_by = jwt_email(), reviewed_at = now(), admin_note = p_note where id = p_id;
  insert into licenses (email, active, source, reference)
    values (p.email, true, 'manual', p.method || ':' || p.reference)
    on conflict (email) do update set active = true, updated_at = now(),
      reference = excluded.reference, source = excluded.source;
  insert into audit_log (actor, action, target, details)
    values (jwt_email(), 'approve_payment', p.email, jsonb_build_object('payment', p_id, 'amount_egp', p.amount_egp));
end $$;

create or replace function public.reject_payment(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  update payments set status = 'rejected', reviewed_by = jwt_email(), reviewed_at = now(), admin_note = p_note where id = p_id;
  insert into audit_log (actor, action, target, details) values (jwt_email(), 'reject_payment', p_id::text, jsonb_build_object('note', p_note));
end $$;

create or replace function public.set_license(p_email text, p_active boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  insert into licenses (email, active, source, reference) values (lower(trim(p_email)), p_active, 'gift', p_note)
    on conflict (email) do update set active = p_active, updated_at = now();
  insert into audit_log (actor, action, target, details) values (jwt_email(), case when p_active then 'grant' else 'revoke' end, lower(trim(p_email)), jsonb_build_object('note', p_note));
end $$;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'licenses', (select count(*) from licenses where active),
    'manual', (select count(*) from licenses where active and source = 'manual'),
    'creem', (select count(*) from licenses where active and source = 'creem'),
    'pending', (select count(*) from payments where status = 'pending'),
    'egp_approved', (select coalesce(sum(amount_egp),0) from payments where status = 'approved'));
end $$;

-- ---------- Row Level Security ----------
alter table public.settings enable row level security;
alter table public.admins enable row level security;
alter table public.licenses enable row level security;
alter table public.payments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_log enable row level security;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "anyone reads settings" on public.settings for select using (true);
create policy "admins edit settings" on public.settings for update using (is_admin()) with check (is_admin());
create policy "admins see admins" on public.admins for select using (is_admin());
create policy "own or admin license" on public.licenses for select using (email = jwt_email() or is_admin());
create policy "submit own payment" on public.payments for insert with check (auth.uid() is not null and jwt_email() <> '');
create policy "own or admin payments" on public.payments for select using (user_id = auth.uid() or is_admin());
create policy "admins read audit" on public.audit_log for select using (is_admin());
-- webhook_events: no policies -> only the service role (edge function) can touch it.

revoke execute on function public.approve_payment(uuid, text) from anon;
revoke execute on function public.reject_payment(uuid, text) from anon;
revoke execute on function public.set_license(text, boolean, text) from anon;
revoke execute on function public.admin_stats() from anon;

-- ---------- Storage: private receipt screenshots ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mm receipts upload own" on storage.objects;
drop policy if exists "mm receipts read" on storage.objects;
create policy "mm receipts upload own" on storage.objects for insert
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "mm receipts read" on storage.objects for select
  using (bucket_id = 'receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

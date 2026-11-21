-- EGP "unlock now, owner checks later" (Nov 21, 2026).
-- The buyer opens a wallet request (start_wallet_payment), transfers 100 EGP,
-- then taps "I've sent the money". That unlocks the licence immediately.
-- The owner later checks the bank app and either approves (confirmed) or
-- rejects — rejecting also turns the licence off (the extension re-checks
-- every 12 hours, so it locks again).

alter table public.payments add column if not exists claimed_at timestamptz;

create or replace function public.claim_wallet_payment(p_id uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me text := jwt_email();
  p payments;
begin
  if me = '' or auth.uid() is null then raise exception 'Please sign in first'; end if;
  select * into p from payments where id = p_id and user_id = auth.uid() and auto;
  if p.id is null then raise exception 'Payment request not found'; end if;
  if p.status = 'rejected' then raise exception 'This payment was rejected. Contact support.'; end if;
  if p.status = 'pending' and p.expires_at < now() then raise exception 'This request expired. Start a new one.'; end if;
  -- Only one unconfirmed claim per buyer at a time.
  if exists (select 1 from payments q where q.user_id = auth.uid() and q.claimed_at is not null
               and q.status = 'pending' and q.id <> p_id) then
    raise exception 'You already have a payment waiting for confirmation.';
  end if;

  update payments set claimed_at = coalesce(claimed_at, now()), expires_at = greatest(expires_at, now() + interval '30 days')
   where id = p_id;
  insert into licenses (email, active, source, reference)
  values (me, true, 'wallet', 'claim:' || p_id::text)
  on conflict (email) do update set active = true, source = 'wallet', reference = 'claim:' || p_id::text, updated_at = now()
   where licenses.active = false or licenses.reference like 'claim:%';
  insert into audit_log (actor, action, target, details)
  values (me, 'claim_wallet_payment', p_id::text, jsonb_build_object('name', p.payer_name, 'phone', p.payer_phone));
  return true;
end $$;
grant execute on function public.claim_wallet_payment(uuid) to authenticated;

-- Rejecting a claimed payment also turns off the licence it unlocked.
create or replace function public.reject_payment(p_id uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  update payments set status = 'rejected', reviewed_by = jwt_email(), reviewed_at = now(), admin_note = p_note where id = p_id;
  update licenses set active = false, updated_at = now() where reference = 'claim:' || p_id::text;
  insert into audit_log (actor, action, target, details) values (jwt_email(), 'reject_payment', p_id::text, jsonb_build_object('note', p_note));
end $$;

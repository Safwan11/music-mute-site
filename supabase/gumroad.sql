-- Music Mute · Gumroad (USD / worldwide). Run once in the Supabase SQL editor. Safe to re-run.
alter table public.licenses drop constraint if exists licenses_source_check;
alter table public.licenses add constraint licenses_source_check
  check (source in ('manual','creem','paymob','gift','easykash','paytabs','gumroad'));

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'licenses', (select count(*) from licenses where active),
    'manual', (select count(*) from licenses where active and source = 'manual'),
    'creem', (select count(*) from licenses where active and source in ('creem','gumroad')),
    'easykash', (select count(*) from licenses where active and source = 'easykash'),
    'paytabs', (select count(*) from licenses where active and source = 'paytabs'),
    'pending', (select count(*) from payments where status = 'pending'),
    'egp_approved', (select coalesce(sum(amount_egp),0) from payments where status = 'approved')
                    + coalesce((select sum(amount_egp) from easykash_orders where status = 'paid'), 0)
                    + (select coalesce(sum(amount_egp),0) from paytabs_orders where status = 'paid'));
end $$;
revoke execute on function public.admin_stats() from anon;

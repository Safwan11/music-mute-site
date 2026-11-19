-- Code-free license check for the extension.
-- The buyer verifies their email on the website when paying; the extension
-- only asks "which email did you pay with?" and checks it here.
-- To stop one paid email being shared widely, each license works on at most
-- 3 devices (an anonymous random id the extension generates once).

create table if not exists public.license_devices (
  email text not null,
  device_id text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (email, device_id)
);
alter table public.license_devices enable row level security;
drop policy if exists "admin devices" on public.license_devices;
create policy "admin devices" on public.license_devices for all using (is_admin()) with check (is_admin());

insert into public.settings (key, value) values ('max_devices', '3')
on conflict (key) do nothing;

create or replace function public.check_license(p_email text, p_device text)
returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  e text := lower(trim(coalesce(p_email, '')));
  d text := left(trim(coalesce(p_device, '')), 64);
  lic_active boolean;
  max_dev int := coalesce((select value::int from settings where key = 'max_devices'), 3);
  n int;
begin
  if e !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(d) < 16 then
    return jsonb_build_object('active', false, 'reason', 'bad_input');
  end if;
  select active into lic_active from licenses where email = e;
  if not coalesce(lic_active, false) then
    return jsonb_build_object('active', false, 'reason', 'not_paid');
  end if;
  if exists (select 1 from license_devices where email = e and device_id = d) then
    update license_devices set last_seen = now() where email = e and device_id = d;
    return jsonb_build_object('active', true);
  end if;
  select count(*) into n from license_devices where email = e;
  if n >= max_dev then
    return jsonb_build_object('active', false, 'reason', 'device_limit', 'max', max_dev);
  end if;
  insert into license_devices (email, device_id) values (e, d);
  return jsonb_build_object('active', true);
end $$;

revoke all on function public.check_license(text, text) from public;
grant execute on function public.check_license(text, text) to anon, authenticated;

-- Admin: free up a buyer's device slots (e.g. new laptop).
create or replace function public.reset_devices(p_email text)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not is_admin() then raise exception 'not_admin'; end if;
  delete from license_devices where email = lower(trim(p_email));
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.reset_devices(text) to authenticated;

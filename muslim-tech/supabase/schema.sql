-- Muslim Tech website: inquiries + careers applications
-- Runs in the shared Supabase project (xztvijjnjzpzwcwqduri). Safe to re-run.
create table if not exists public.mt_submissions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('inquiry','application')),
  lang text not null default 'en' check (lang in ('en','ar')),
  name text not null,
  company text,
  email text not null,
  country text,
  phone text,
  service text,
  project_type text,
  budget text,
  start_date date,
  area text,
  linkedin text,
  description text not null,
  file_path text,
  file_name text,
  ip_hash text,
  email_status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists mt_submissions_ip_idx on public.mt_submissions (ip_hash, created_at desc);
create index if not exists mt_submissions_created_idx on public.mt_submissions (created_at desc);

alter table public.mt_submissions enable row level security;
-- Only the Edge Function (service role) writes. Admins (public.admins) can read.
drop policy if exists "mt admins read" on public.mt_submissions;
create policy "mt admins read" on public.mt_submissions for select using (public.is_admin());

-- Private bucket for attachments and CVs
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mt-uploads', 'mt-uploads', false, 5242880, array[
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png','image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "mt uploads admin read" on storage.objects;
create policy "mt uploads admin read" on storage.objects for select
  using (bucket_id = 'mt-uploads' and public.is_admin());

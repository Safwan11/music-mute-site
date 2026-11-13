# Music Mute — website & licensing backend

- `site/` — static site (Cloudflare Pages, build output dir = `site`, no build command).
  - `/` landing (AR/EN), `/buy` checkout (EGP manual + USD via Creem), `/admin` approvals, `/privacy`.
- `supabase/schema.sql` — run in the Supabase SQL editor (project `xztvijjnjzpzwcwqduri`).
- `supabase/functions/creem-webhook` — deployed with JWT verification OFF; needs secret `CREEM_WEBHOOK_SECRET`.

Only the public publishable key is in the site/extension. All rules are enforced by RLS + RPCs.

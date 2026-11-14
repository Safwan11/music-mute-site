# Music Mute — website & licensing backend

- `site/` — static site (Cloudflare Pages, build output dir = `site`, no build command).
  - `/` landing (AR/EN), `/buy` checkout (EGP manual + USD via Creem), `/admin` approvals, `/privacy`.
- `supabase/schema.sql` — run in the Supabase SQL editor (project `xztvijjnjzpzwcwqduri`).
- `supabase/functions/creem-webhook` — deployed with JWT verification OFF; needs secret `CREEM_WEBHOOK_SECRET`.
- `supabase/easykash.sql` — run after `schema.sql` (EasyKash orders table + `easykash` license source + `easykash_enabled` switch).
- `supabase/functions/easykash-checkout` — creates the EasyKash Direct Pay link for the signed-in buyer. JWT verification OFF (checks the token itself). Secret `EASYKASH_API_KEY`.
- `supabase/functions/easykash-webhook` — EasyKash Callback URL `https://xztvijjnjzpzwcwqduri.supabase.co/functions/v1/easykash-webhook`. JWT verification OFF. Secret `EASYKASH_HMAC_SECRET` (HMAC-SHA512 check per EasyKash docs).
- Turn EasyKash on: /admin → Settings → `easykash_enabled` = `true`.

Only the public publishable key is in the site/extension. All rules are enforced by RLS + RPCs.

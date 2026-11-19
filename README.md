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

## PayTabs Egypt (automatic EGP card payments)

Freelancer account: only national ID + bank statement (no commercial register / tax card).

1. Run `supabase/paytabs.sql` in the SQL editor.
2. Deploy 3 edge functions with **Verify JWT OFF**: `paytabs-checkout`, `paytabs-callback`, `paytabs-return`.
3. Secrets: `PAYTABS_PROFILE_ID`, `PAYTABS_SERVER_KEY` (PayTabs dashboard → Developers → Key management).
   Test keys work right after sign-up; swap to live keys once the account is approved.
4. `/admin` → `paytabs_enabled = true`. If both PayTabs and EasyKash are on, PayTabs is used.

The checkout sends the callback/return URLs itself — nothing to set in the PayTabs dashboard.
Callback is verified with HMAC-SHA256 (header `signature`) over the raw body; license goes to the signed-in email on the order.

## Automatic InstaPay / Vodafone Cash (no screenshots)

1. Run `supabase/wallet.sql`.
2. Deploy `wallet-sms` (Verify JWT OFF). Secrets: `WALLET_SMS_TOKEN` (long random), optional `WALLET_SMS_SENDERS`.
3. On the phone that receives the wallet/bank SMS, install an "SMS to URL" forwarder and point it to
   `https://xztvijjnjzpzwcwqduri.supabase.co/functions/v1/wallet-sms?key=<WALLET_SMS_TOKEN>` (POST JSON `{"from","text"}`).
4. Buyer gets a unique amount (e.g. 100.37) on /buy, pays it, and the SMS unlocks the license automatically.
   Unmatched credits are logged in `audit_log` (action `unmatched_credit`); receipts upload stays as a fallback.

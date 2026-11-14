# Muslim Tech — company website

Bilingual (English / Arabic) static website for Muslim Tech: software QA & testing, technical support, application support and development.

- **Live:** https://muslim-tech.pages.dev (Cloudflare Pages)
- **English:** `/` · **Arabic (RTL):** `/ar/`
- **Forms:** contact inquiries and careers applications → Supabase Edge Function `mt-submit` → email to **muslimtech@gmail.com** + automatic acknowledgment to the sender.

## Structure

```
content/en.mjs, content/ar.mjs   All page text (edit copy here)
src/style.css, src/app.js        Design system and client script (menu, language preference, forms)
build.mjs                        Generates dist/ — 18 pages × 2 languages + 404, sitemap.xml, robots.txt, _headers
supabase/schema.sql              Table mt_submissions + private bucket mt-uploads (RLS on)
supabase/functions/mt-submit     Form handler: validation, spam traps, rate limit, file checks, storage, Gmail SMTP
```

## Build & deploy

```
node build.mjs        # writes dist/
```
Cloudflare Pages settings: build command `node build.mjs`, output directory `dist`. Every push to `main` redeploys.

Change the site URL or form endpoint with env vars `SITE_URL` and `FORM_ENDPOINT` (Cloudflare Pages → Settings → Environment variables).

## Email integration setup (Gmail)

No credentials are in this repository or the website. Email is sent server-side by the Edge Function.

1. Turn on 2-Step Verification for **muslimtech@gmail.com**.
2. Create an App Password: https://myaccount.google.com/apppasswords (name it "Muslim Tech website").
3. In Supabase → Edge Functions → Secrets (project `xztvijjnjzpzwcwqduri`), add:
   - `GMAIL_USER` = `muslimtech@gmail.com`
   - `GMAIL_APP_PASSWORD` = the 16-character App Password
   - optional `NOTIFY_TO` = a different inbox for notifications
4. Submit a test inquiry from the Contact page. You should receive the inquiry (with any attachment) and the sender gets a confirmation.

If the secrets are missing, submissions are still saved (`email_status = not_configured`) and can be viewed in Supabase → Table editor → `mt_submissions`; attachments are in Storage → `mt-uploads`.

## Security

- Server-side validation and length limits on every field; HTML escaped in emails.
- Spam protection: hidden honeypot field, minimum fill time, 5 submissions per IP per hour (IP stored only as a salted hash).
- Uploads: extension allow-list, 5 MB limit and file-signature check; stored in a private bucket.
- Row Level Security: only the Edge Function (service role) writes; only admins can read.
- Security headers and a Content Security Policy via `_headers`; no analytics or third-party trackers.
- Optional: add Cloudflare Turnstile for stronger bot protection if spam appears.

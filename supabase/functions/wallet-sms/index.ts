// Automatic InstaPay / Vodafone Cash verification.
// The shop phone runs an "SMS → URL" forwarder app that POSTs every incoming
// bank / wallet SMS here:
//   https://xztvijjnjzpzwcwqduri.supabase.co/functions/v1/wallet-sms?key=<WALLET_SMS_TOKEN>
// Body: JSON {"from": "...", "text": "..."} (also accepts "message"/"body", or form fields).
//
// Secrets:  WALLET_SMS_TOKEN  (required, long random string, also put in the forwarder URL)
//           WALLET_SMS_SENDERS (optional, comma list of allowed sender IDs, e.g. "VF-Cash,InstaPay,CIB")
// Deploy with "Verify JWT" OFF.
//
// Matching (only open auto requests: pending, not expired), amount must be >= price (100 EGP):
//   1. sender NAME in the SMS matches the name the buyer typed (InstaPay bank SMS show the name)
//   2. sender NUMBER in the SMS == the number the buyer said he pays from (wallet SMS show the number)
// If 0 or 2+ requests match, nothing is granted and the SMS is logged as unmatched_credit.
import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();
function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function sha(s: string) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
// Arabic-Indic digits → Latin, Arabic decimal separator → "."
const normDigits = (s: string) =>
  s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
   .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
   .replace(/٫/g, ".").replace(/٬/g, ",");

const CREDIT = /(استلام|استلمت|تم استلام|إيداع|ايداع|اضافة|إضافة|أضيف|اضيف|وارد|تحويل وارد|(إلى|الى|ل)\s*حسابك|لحسابك|received|credited|credit|deposit|incoming|to your account)/i;
const DEBIT = /(خصم|سحب|من حسابك|تم تحويل مبلغ .{0,40}(إلى|الى)|debited|withdraw|you sent|sent to|from your account|purchase|شراء)/i;

export function parseSms(raw: string) {
  const text = normDigits(raw).replace(/\s+/g, " ");
  const amounts: number[] = [];
  const re = /(?:(?:EGP|LE|L\.E|ج\.م|جنيه|جنية|مبلغ|بمبلغ|amount|of)\s*:?\s*)((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)|((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s*(?:EGP|LE|L\.E|ج\.م|جنيه|جنية|جم)/gi;
  for (const m of text.matchAll(re)) {
    const v = Number((m[1] ?? m[2]).replace(/,/g, ""));
    if (v > 0 && v < 100000) amounts.push(v);
  }
  const phones = [...text.matchAll(/(?:\+?2)?(01[0125]\d{8})/g)].map((m) => m[1]);
  // Sender name: "... من ABDELRAHMAN ASHRAF برقم مرجعي ..." / "... from AHMED ALI via InstaPay"
  const nm = text.match(/(?:^|\s)من\s+(?!حسابك|رقم)([A-Za-z\u0621-\u064A][A-Za-z\u0621-\u064A .'-]{1,60}?)(?:\s+(?=برقم|بتاريخ|رقم|بمرجع|عبر|على|في|للمزيد)|\s*[.,،]|\s*$)/)
    ?? text.match(/\bfrom\s+(?!your\b)([A-Za-z][A-Za-z .'-]{1,60}?)\s*(?=\bvia\b|\bref|\bon\b|\.|,|$)/i);
  const name = nm ? nm[1].trim() : "";
  return { text, amounts, phones, name, credit: CREDIT.test(text) && !DEBIT.test(text) };
}

// Compare names loosely: every word the buyer typed (first two words at least) must appear in the SMS name.
export function nameMatches(buyer: string, sms: string) {
  const norm = (x: string) => x.toUpperCase()
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/[^A-Z\u0621-\u064A ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
  const b = norm(buyer).slice(0, 3), m = norm(sms);
  if (b.length < 2 || !m.length) return false;
  return b.every((w) => m.includes(w));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const url = new URL(req.url);
  const token = Deno.env.get("WALLET_SMS_TOKEN") ?? "";
  const given = url.searchParams.get("key") ?? req.headers.get("x-key") ?? "";
  if (!token || !safeEqual(given, token)) return new Response("unauthorized", { status: 401 });

  // Accept JSON or form bodies from different forwarder apps.
  let from = "", body = "";
  const ct = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  try {
    if (ct.includes("json") || raw.trim().startsWith("{")) {
      const j = JSON.parse(raw);
      from = String(j.from ?? j.sender ?? j.address ?? j.phone ?? "");
      body = String(j.text ?? j.message ?? j.body ?? j.msg ?? j.content ?? "");
    } else {
      const f = new URLSearchParams(raw);
      from = f.get("from") ?? f.get("sender") ?? "";
      body = f.get("text") ?? f.get("message") ?? f.get("body") ?? raw;
    }
  } catch { body = raw; }
  if (!body) return new Response("ok (empty)");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const allowed = (Deno.env.get("WALLET_SMS_SENDERS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const senderOk = !allowed.length || allowed.some((a) => from.toLowerCase().includes(a));
  const p = parseSms(body);

  // Store every SMS once (idempotent) so nothing is lost and admins can review.
  const id = `sms:${await sha(from + "|" + body)}`;
  const { error: dupErr } = await db.from("webhook_events").insert({
    id, provider: "wallet-sms", event_type: p.credit ? "credit" : "other", email: null,
    payload: { from, body, amounts: p.amounts, phones: p.phones, name: p.name, senderOk },
  });
  if (dupErr?.code === "23505") return new Response("ok (duplicate)");
  if (!senderOk || !p.credit || !p.amounts.length) return new Response("ok (ignored)");

  const { data: open } = await db.from("payments").select("*")
    .eq("auto", true).eq("status", "pending").gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });
  const { data: priceRow } = await db.from("settings").select("value").eq("key", "price_egp").maybeSingle();
  const price = Number(priceRow?.value || 100);
  const shop = (Deno.env.get("WALLET_NUMBER") ?? "01044855081");
  const payerPhones = p.phones.filter((x) => x !== shop);

  const paid = Math.max(...p.amounts);
  let match = null as any, rule = "";
  if (paid >= price - 0.005) {
    const byName = p.name ? (open ?? []).filter((o) => o.payer_name && nameMatches(o.payer_name, p.name)) : [];
    const byPhone = payerPhones.length ? (open ?? []).filter((o) => payerPhones.includes(o.payer_phone)) : [];
    if (byName.length === 1) { match = byName[0]; rule = "name"; }
    else if (byPhone.length === 1) { match = byPhone[0]; rule = "phone"; }
  }
  if (!match) {
    await db.from("audit_log").insert({ actor: "wallet-sms", action: "unmatched_credit", target: from, details: { amounts: p.amounts, phones: payerPhones, name: p.name, sms: id } });
    return new Response("ok (no match)");
  }

  const { data: upd } = await db.from("payments").update({
    status: "approved", reviewed_by: `auto-sms:${rule}`, reviewed_at: new Date().toISOString(),
    admin_note: `Auto-verified from SMS (${rule})`,
  }).eq("id", match.id).eq("status", "pending").select("id");
  if (!upd?.length) return new Response("ok (already handled)");

  await db.from("licenses").upsert(
    { email: match.email, active: true, source: "wallet", reference: `${match.method}:${match.expected_amount}:${id}`, updated_at: new Date().toISOString() },
    { onConflict: "email" },
  );
  await db.from("audit_log").insert({ actor: "wallet-sms", action: "grant", target: match.email, details: { payment: match.id, rule, amounts: p.amounts, sms: id } });
  return new Response("ok (activated)");
});

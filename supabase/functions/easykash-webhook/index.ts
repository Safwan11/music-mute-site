// EasyKash callback -> grants the Music Mute lifetime license automatically.
// Set this function's URL as the Callback URL in EasyKash > Settings > Integration Settings:
//   https://xztvijjnjzpzwcwqduri.supabase.co/functions/v1/easykash-webhook
// Secrets: EASYKASH_HMAC_SECRET (same page). Deploy with "Verify JWT" OFF.
//
// Signature (from EasyKash docs, verified against their example):
//   HMAC-SHA512(hex) of ProductCode+Amount+ProductType+PaymentMethod+status+easykashRef+customerReference
import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();

async function hmac512Hex(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("EASYKASH_HMAC_SECRET");
  if (!secret) return new Response("Not configured", { status: 500 });

  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return new Response("Bad JSON", { status: 400 }); }

  const signed = [p.ProductCode, p.Amount, p.ProductType, p.PaymentMethod, p.status, p.easykashRef, p.customerReference]
    .map(s).join("");
  const given = s(p.signatureHash).trim().toLowerCase();
  if (!given || !safeEqual(await hmac512Hex(secret, signed), given)) {
    return new Response("Bad signature", { status: 401 });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const ref = s(p.customerReference);
  const ekRef = s(p.easykashRef);
  const status = s(p.status).toUpperCase();

  // Idempotency
  const { error: dupErr } = await db.from("webhook_events").insert({
    id: `easykash:${ekRef || ref}:${status}`, provider: "easykash", event_type: status,
    email: s(p.BuyerEmail).toLowerCase() || null, payload: p,
  });
  if (dupErr?.code === "23505") return new Response("ok (duplicate)");
  if (dupErr) return new Response("db error", { status: 500 });

  if (status !== "PAID") return new Response("ok (not paid)");

  // The license goes to the SIGNED-IN email stored on our order, not to what was typed on EasyKash.
  const { data: order } = await db.from("easykash_orders").select("*").eq("ref", ref).maybeSingle();
  if (!order) {
    await db.from("audit_log").insert({ actor: "easykash", action: "unknown_order", target: ref, details: p });
    return new Response("ok (unknown order)");
  }
  const paid = Number(s(p.Amount));
  if (!(paid >= Number(order.amount_egp) - 0.01)) {
    await db.from("audit_log").insert({ actor: "easykash", action: "underpaid", target: order.email, details: { ref, paid, expected: order.amount_egp } });
    return new Response("ok (amount mismatch)");
  }

  await db.from("easykash_orders").update({
    status: "paid", easykash_ref: ekRef, payment_method: s(p.PaymentMethod), amount_paid: paid, paid_at: new Date().toISOString(),
  }).eq("id", order.id);
  await db.from("licenses").upsert(
    { email: order.email, active: true, source: "easykash", reference: `${ref}:${ekRef}`, updated_at: new Date().toISOString() },
    { onConflict: "email" },
  );
  await db.from("audit_log").insert({ actor: "easykash", action: "grant", target: order.email, details: { ref, easykashRef: ekRef, method: p.PaymentMethod, amount: paid } });
  return new Response("ok");
});

// PayTabs server-to-server callback (IPN) -> grants the Music Mute lifetime license.
// The checkout function sends this URL automatically with every payment:
//   https://xztvijjnjzpzwcwqduri.supabase.co/functions/v1/paytabs-callback
// Secrets: PAYTABS_SERVER_KEY. Deploy with "Verify JWT" OFF.
//
// PayTabs signs the raw JSON body: header "signature" = HMAC-SHA256(body, server key), hex.
import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();
async function hmac256Hex(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
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

// deno-lint-ignore no-explicit-any
type P = Record<string, any>;

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const serverKey = Deno.env.get("PAYTABS_SERVER_KEY");
  if (!serverKey) return new Response("Not configured", { status: 500 });

  const raw = await req.text();
  const given = (req.headers.get("signature") ?? "").trim().toLowerCase();
  if (!given || !safeEqual(await hmac256Hex(serverKey, raw), given)) {
    return new Response("Bad signature", { status: 401 });
  }
  let p: P;
  try { p = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const ref = s(p.cart_id);
  const tranRef = s(p.tran_ref);
  const status = s(p.payment_result?.response_status).toUpperCase(); // A = authorised/paid
  const tranType = s(p.tran_type).toLowerCase();

  const { error: dupErr } = await db.from("webhook_events").insert({
    id: `paytabs:${tranRef || ref}:${status}`, provider: "paytabs", event_type: status || "unknown",
    email: s(p.customer_details?.email).toLowerCase() || null, payload: p,
  });
  if (dupErr?.code === "23505") return new Response("ok (duplicate)");
  if (dupErr) return new Response("db error", { status: 500 });

  const { data: order } = await db.from("paytabs_orders").select("*").eq("ref", ref).maybeSingle();
  if (!order) {
    await db.from("audit_log").insert({ actor: "paytabs", action: "unknown_order", target: ref, details: p });
    return new Response("ok (unknown order)");
  }

  if (status !== "A" || (tranType && tranType !== "sale")) {
    if (order.status === "pending") await db.from("paytabs_orders").update({ status: "failed", tran_ref: tranRef || order.tran_ref }).eq("id", order.id);
    return new Response("ok (not paid)");
  }

  const paid = Number(s(p.tran_total || p.cart_amount));
  const currency = s(p.tran_currency || p.cart_currency).toUpperCase();
  if (currency !== "EGP" || !(paid >= Number(order.amount_egp) - 0.01)) {
    await db.from("audit_log").insert({ actor: "paytabs", action: "amount_mismatch", target: order.email, details: { ref, paid, currency, expected: order.amount_egp } });
    return new Response("ok (amount mismatch)");
  }

  // License goes to the SIGNED-IN email stored on our order.
  await db.from("paytabs_orders").update({
    status: "paid", tran_ref: tranRef, payment_method: s(p.payment_info?.payment_method || p.payment_info?.card_scheme),
    amount_paid: paid, paid_at: new Date().toISOString(),
  }).eq("id", order.id);
  await db.from("licenses").upsert(
    { email: order.email, active: true, source: "paytabs", reference: `${ref}:${tranRef}`, updated_at: new Date().toISOString() },
    { onConflict: "email" },
  );
  await db.from("audit_log").insert({ actor: "paytabs", action: "grant", target: order.email, details: { ref, tranRef, amount: paid } });
  return new Response("ok");
});

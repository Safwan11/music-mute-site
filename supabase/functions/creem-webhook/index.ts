// Creem webhook -> grants / revokes Music Mute lifetime licenses.
// Secrets: CREEM_WEBHOOK_SECRET (from Creem dashboard). SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are injected automatically by Supabase.
// Deploy with "Verify JWT" OFF (Creem does not send a Supabase JWT).
import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("CREEM_WEBHOOK_SECRET");
  if (!secret) return new Response("Not configured", { status: 500 });

  const raw = await req.text();
  const given = (req.headers.get("creem-signature") ?? "").trim().toLowerCase();
  if (!given || !safeEqual(await hmacHex(secret, raw), given)) {
    return new Response("Bad signature", { status: 401 });
  }

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }

  const type: string = evt.eventType ?? evt.event_type ?? "";
  const obj = evt.object ?? {};
  const email: string = String(obj.customer?.email ?? obj.order?.customer?.email ?? "").trim().toLowerCase();
  const orderId: string = String(obj.order?.id ?? obj.id ?? "");
  const eventId: string = String(evt.id ?? `${type}:${orderId}`);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Idempotency: ignore an event we've already processed.
  const { error: dupErr } = await db.from("webhook_events").insert({
    id: eventId, provider: "creem", event_type: type, email: email || null, payload: evt,
  });
  if (dupErr?.code === "23505") return new Response("ok (duplicate)");
  if (dupErr) return new Response("db error", { status: 500 });

  if (!email) return new Response("ok (no email)");

  if (type === "checkout.completed") {
    const status = String(obj.order?.status ?? obj.status ?? "").toLowerCase();
    if (status && status !== "paid" && status !== "completed") return new Response("ok (not paid)");
    await db.from("licenses").upsert(
      { email, active: true, source: "creem", reference: orderId, updated_at: new Date().toISOString() },
      { onConflict: "email" },
    );
    await db.from("audit_log").insert({ actor: "creem", action: "grant", target: email, details: { order: orderId } });
  } else if (type === "refund.created" || type === "dispute.created") {
    await db.from("licenses").update({ active: false, updated_at: new Date().toISOString() })
      .eq("email", email).eq("source", "creem");
    await db.from("audit_log").insert({ actor: "creem", action: "revoke", target: email, details: { type, order: orderId } });
  }
  return new Response("ok");
});

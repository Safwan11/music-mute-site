// Gumroad "Ping" -> grants the Music Mute lifetime license automatically (USD / worldwide).
// Gumroad → Settings → Advanced → Ping endpoint:
//   https://xztvijjnjzpzwcwqduri.supabase.co/functions/v1/gumroad-ping
// Product must have "Generate a unique license key per sale" ON.
// Secret: GUMROAD_PRODUCT_ID (from the product page → Content/License key section).
// Deploy with "Verify JWT" OFF.
//
// Ping is not signed, so we never trust it on its own: every sale is re-checked
// with Gumroad's public license-verify API (product_id + license_key).
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const productId = Deno.env.get("GUMROAD_PRODUCT_ID");
  if (!productId) return new Response("Not configured", { status: 500 });

  const form = await req.formData().catch(() => null);
  if (!form) return new Response("Bad request", { status: 400 });
  const key = String(form.get("license_key") ?? "");
  if (!key) return new Response("ok (no license key)");

  // Ask Gumroad itself whether this is a real, paid, non-refunded sale of OUR product.
  const vr = await fetch("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ product_id: productId, license_key: key, increment_uses_count: "false" }),
  });
  // deno-lint-ignore no-explicit-any
  const v: any = await vr.json().catch(() => ({}));
  const p = v?.purchase;
  if (!v?.success || !p) return new Response("ok (not verified)");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const email = String(p.email ?? "").trim().toLowerCase();
  const saleId = String(p.sale_id ?? p.id ?? key);
  const bad = p.refunded || p.chargebacked || p.disputed;
  const event = bad ? "refund" : "sale";

  const { error: dupErr } = await db.from("webhook_events").insert({
    id: `gumroad:${saleId}:${event}`, provider: "gumroad", event_type: event, email: email || null, payload: p,
  });
  if (dupErr?.code === "23505") return new Response("ok (duplicate)");
  if (dupErr) return new Response("db error", { status: 500 });
  if (!email) return new Response("ok (no email)");

  if (bad) {
    await db.from("licenses").update({ active: false, updated_at: new Date().toISOString() })
      .eq("email", email).eq("source", "gumroad");
    await db.from("audit_log").insert({ actor: "gumroad", action: "revoke", target: email, details: { saleId } });
    return new Response("ok (revoked)");
  }
  await db.from("licenses").upsert(
    { email, active: true, source: "gumroad", reference: `gumroad:${saleId}`, updated_at: new Date().toISOString() },
    { onConflict: "email" },
  );
  await db.from("audit_log").insert({ actor: "gumroad", action: "grant", target: email, details: { saleId, price: p.price, test: p.test } });
  return new Response("ok");
});

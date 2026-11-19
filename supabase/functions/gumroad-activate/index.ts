// Activate a Gumroad purchase on the SIGNED-IN email using the Gumroad license key.
// For buyers who paid on Gumroad with a different email than the one they use in the extension.
// Called from /activate with the user's Supabase session. Secret: GUMROAD_PRODUCT_ID.
// Deploy with "Verify JWT" OFF (the function checks the token itself).
// One purchase = one active email: activating moves the license from the old email.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const productId = Deno.env.get("GUMROAD_PRODUCT_ID");
  if (!productId) return json({ error: "Not configured" }, 503);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  if (!email) return json({ error: "Please sign in again" }, 401);

  let key = "";
  try { key = String((await req.json()).key ?? "").trim().toUpperCase(); } catch { /* */ }
  if (!/^[A-Z0-9]{8}(-[A-Z0-9]{8}){3}$/.test(key)) return json({ error: "That doesn't look like a Gumroad license key (XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX)" }, 400);

  const vr = await fetch("https://api.gumroad.com/v2/licenses/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ product_id: productId, license_key: key, increment_uses_count: "false" }),
  });
  // deno-lint-ignore no-explicit-any
  const v: any = await vr.json().catch(() => ({}));
  const p = v?.purchase;
  if (!v?.success || !p) return json({ error: "License key not found" }, 404);
  if (p.refunded || p.chargebacked || p.disputed) return json({ error: "This purchase was refunded" }, 410);

  const saleId = String(p.sale_id ?? p.id ?? key);
  const ref = `gumroad:${saleId}`;
  // Move the license: switch off any other email holding this same purchase.
  await db.from("licenses").update({ active: false, updated_at: new Date().toISOString() })
    .eq("reference", ref).neq("email", email);
  await db.from("licenses").upsert(
    { email, active: true, source: "gumroad", reference: ref, updated_at: new Date().toISOString() },
    { onConflict: "email" },
  );
  await db.from("audit_log").insert({ actor: email, action: "gumroad_activate", target: email, details: { saleId, purchaseEmail: String(p.email ?? "").toLowerCase() } });
  return json({ ok: true });
});

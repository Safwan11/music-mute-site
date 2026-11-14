// EasyKash checkout -> creates a Direct Pay link for the signed-in buyer.
// Called from /buy with the buyer's Supabase session token.
// Secrets: EASYKASH_API_KEY (EasyKash > Settings > Integration Settings).
// Optional: SITE_URL (defaults to https://music-mute.pages.dev).
// Deploy with "Verify JWT" OFF — the function checks the user's token itself.
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = Deno.env.get("SITE_URL") ?? "https://music-mute.pages.dev";
const PAY_URL = "https://back.easykash.net/api/directpayv1/pay";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("EASYKASH_API_KEY");
  if (!apiKey) return json({ error: "EasyKash is not configured yet" }, 503);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Who is buying? (must be signed in, so the license goes to a verified email)
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: uErr } = await db.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  if (uErr || !email) return json({ error: "Please sign in again" }, 401);

  let body: { name?: string; mobile?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const name = String(body.name ?? "").trim().slice(0, 80) || email.split("@")[0];
  const mobile = String(body.mobile ?? "").replace(/[^\d]/g, "");
  if (!/^01[0125]\d{8}$/.test(mobile)) return json({ error: "Enter a valid Egyptian mobile number (11 digits)" }, 400);

  // Settings: price + on/off switch
  const { data: rows } = await db.from("settings").select("key,value").in("key", ["price_egp", "easykash_enabled"]);
  const S = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
  if (S.easykash_enabled !== "true") return json({ error: "Card payment is not available yet" }, 503);
  const amount = Number(S.price_egp || 100);

  // Already licensed? Don't charge twice.
  const { data: lic } = await db.from("licenses").select("active").eq("email", email).maybeSingle();
  if (lic?.active) return json({ error: "already_licensed" }, 409);

  const { data: order, error: oErr } = await db.from("easykash_orders")
    .insert({ user_id: u.user!.id, email, name, mobile, amount_egp: amount })
    .select("id, ref").single();
  if (oErr || !order) return json({ error: "Could not create order" }, 500);

  const res = await fetch(PAY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: apiKey },
    body: JSON.stringify({
      amount,
      currency: "EGP",
      cashExpiry: 24,
      name,
      email,
      mobile,
      redirectUrl: `${SITE}/thanks?provider=easykash&order=${order.ref}`,
      customerReference: order.ref,
    }),
  });
  const text = await res.text();
  let out: { redirectUrl?: string } = {};
  try { out = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !out.redirectUrl) {
    await db.from("easykash_orders").update({ status: "failed" }).eq("id", order.id);
    await db.from("audit_log").insert({ actor: "easykash", action: "checkout_error", target: email, details: { status: res.status, body: text.slice(0, 500) } });
    return json({ error: "Payment page could not be opened, please try again" }, 502);
  }
  return json({ url: out.redirectUrl, ref: order.ref });
});

// PayTabs Egypt checkout -> creates a Hosted Payment Page for the signed-in buyer.
// Called from /buy with the buyer's Supabase session token.
// Secrets: PAYTABS_PROFILE_ID, PAYTABS_SERVER_KEY (PayTabs dashboard > Developers > Key management).
// Optional: SITE_URL (default https://music-mute.pages.dev), PAYTABS_ENDPOINT (default Egypt region).
// Deploy with "Verify JWT" OFF — the function checks the user's token itself.
import { createClient } from "npm:@supabase/supabase-js@2";

const SITE = Deno.env.get("SITE_URL") ?? "https://music-mute.pages.dev";
const BASE = Deno.env.get("PAYTABS_ENDPOINT") ?? "https://secure-egypt.paytabs.com";
const FN = `${Deno.env.get("SUPABASE_URL")}/functions/v1`;

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

  const profileId = Number(Deno.env.get("PAYTABS_PROFILE_ID"));
  const serverKey = Deno.env.get("PAYTABS_SERVER_KEY");
  if (!profileId || !serverKey) return json({ error: "Card payment is not configured yet" }, 503);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Must be signed in, so the license goes to a verified email.
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u, error: uErr } = await db.auth.getUser(token);
  const email = u?.user?.email?.toLowerCase();
  if (uErr || !email) return json({ error: "Please sign in again" }, 401);

  let body: { name?: string; mobile?: string } = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const name = String(body.name ?? "").trim().slice(0, 80) || email.split("@")[0];
  const mobile = String(body.mobile ?? "").replace(/[^\d]/g, "");
  if (!/^01[0125]\d{8}$/.test(mobile)) return json({ error: "Enter a valid Egyptian mobile number (11 digits)" }, 400);

  const { data: rows } = await db.from("settings").select("key,value").in("key", ["price_egp", "paytabs_enabled"]);
  const S = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value]));
  if (S.paytabs_enabled !== "true") return json({ error: "Card payment is not available yet" }, 503);
  const amount = Number(S.price_egp || 100);

  const { data: lic } = await db.from("licenses").select("active").eq("email", email).maybeSingle();
  if (lic?.active) return json({ error: "already_licensed" }, 409);

  const { data: order, error: oErr } = await db.from("paytabs_orders")
    .insert({ user_id: u.user!.id, email, name, mobile, amount_egp: amount })
    .select("id, ref").single();
  if (oErr || !order) return json({ error: "Could not create order" }, 500);

  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;
  const res = await fetch(`${BASE}/payment/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json", authorization: serverKey },
    body: JSON.stringify({
      profile_id: profileId,
      tran_type: "sale",
      tran_class: "ecom",
      cart_id: order.ref,
      cart_currency: "EGP",
      cart_amount: amount,
      cart_description: "Music Mute — lifetime license",
      paypage_lang: "ar",
      hide_shipping: true,
      customer_details: {
        name, email, phone: `+2${mobile}`,
        street1: "Online", city: "Cairo", state: "C", country: "EG", zip: "00000", ...(ip ? { ip } : {}),
      },
      callback: `${FN}/paytabs-callback`,
      return: `${FN}/paytabs-return`,
    }),
  });
  const text = await res.text();
  let out: { redirect_url?: string; tran_ref?: string } = {};
  try { out = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !out.redirect_url) {
    await db.from("paytabs_orders").update({ status: "failed" }).eq("id", order.id);
    await db.from("audit_log").insert({ actor: "paytabs", action: "checkout_error", target: email, details: { status: res.status, body: text.slice(0, 500) } });
    return json({ error: "Payment page could not be opened, please try again" }, 502);
  }
  if (out.tran_ref) await db.from("paytabs_orders").update({ tran_ref: out.tran_ref }).eq("id", order.id);
  return json({ url: out.redirect_url, ref: order.ref });
});

// PayTabs "return" URL. After paying, PayTabs POSTs the buyer's browser here (form-encoded).
// A static Pages site can't receive that POST, so this function checks it and
// 303-redirects to /thanks?provider=paytabs&order=...&status=success|failed.
// The license itself is granted by paytabs-callback; this only decides what the buyer sees.
// Secrets: PAYTABS_SERVER_KEY. Deploy with "Verify JWT" OFF.

const SITE = Deno.env.get("SITE_URL") ?? "https://music-mute.pages.dev";
const enc = new TextEncoder();

async function hmac256Hex(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// PHP urlencode(): everything but [A-Za-z0-9_.-] is %XX, space is "+".
const phpEncode = (v: string) =>
  [...enc.encode(v)].map((b) => {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9_.\-]/.test(c)) return c;
    if (b === 0x20) return "+";
    return "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }).join("");

const go = (params: Record<string, string>) =>
  new Response(null, { status: 303, headers: { Location: `${SITE}/thanks?${new URLSearchParams(params)}` } });

Deno.serve(async (req) => {
  let f: Record<string, string> = {};
  if (req.method === "POST") {
    const fd = await req.formData().catch(() => null);
    if (fd) for (const [k, v] of fd.entries()) f[k] = String(v);
  } else {
    f = Object.fromEntries(new URL(req.url).searchParams);
  }

  const order = (f.cartId ?? "").replace(/[^A-Za-z0-9]/g, "");
  const serverKey = Deno.env.get("PAYTABS_SERVER_KEY");
  let verified = false;
  if (serverKey && f.signature) {
    const data = Object.keys(f).filter((k) => k !== "signature" && f[k] !== "").sort()
      .map((k) => `${phpEncode(k)}=${phpEncode(f[k])}`).join("&");
    verified = (await hmac256Hex(serverKey, data)) === f.signature.toLowerCase();
  }
  const st = (f.respStatus ?? "").toUpperCase();
  // Unverified -> "checking": the thanks page then waits for the callback to grant the license.
  const status = !verified ? "pending" : st === "A" ? "success" : st === "P" || st === "H" ? "pending" : "failed";
  return go({ provider: "paytabs", order, status });
});

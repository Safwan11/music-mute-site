// Muslim Tech — website form handler (contact inquiries + careers applications).
// Validates, rate-limits, stores the submission and file, then emails the
// company inbox and sends the visitor an acknowledgment.
// Secrets: GMAIL_USER, GMAIL_APP_PASSWORD (optional NOTIFY_TO, default muslimtecheg@gmail.com).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected by Supabase. Deploy with Verify JWT OFF.
import { createClient } from "npm:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const ALLOWED_ORIGINS = [/^https:\/\/([a-z0-9-]+\.)?muslim-tech\.pages\.dev$/, /^http:\/\/localhost(:\d+)?$/];
const MAX = 5 * 1024 * 1024;
const TYPES: Record<string, { mime: string; sig: number[][] }> = {
  pdf: { mime: "application/pdf", sig: [[0x25, 0x50, 0x44, 0x46]] },
  png: { mime: "image/png", sig: [[0x89, 0x50, 0x4e, 0x47]] },
  jpg: { mime: "image/jpeg", sig: [[0xff, 0xd8, 0xff]] },
  jpeg: { mime: "image/jpeg", sig: [[0xff, 0xd8, 0xff]] },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", sig: [[0x50, 0x4b, 0x03, 0x04]] },
  doc: { mime: "application/msword", sig: [[0xd0, 0xcf, 0x11, 0xe0]] },
};
const FILE_RULES: Record<string, { field: string; exts: string[]; required: boolean }> = {
  inquiry: { field: "file", exts: ["pdf", "doc", "docx", "png", "jpg", "jpeg"], required: false },
  application: { field: "cv", exts: ["pdf", "doc", "docx"], required: true },
};

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clean = (v: FormDataEntryValue | null, max: number) => (typeof v === "string" ? v.replace(/\u0000/g, "").trim().slice(0, max) : "");

function cors(origin: string | null) {
  const ok = origin && ALLOWED_ORIGINS.some((r) => r.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin! : "https://muslim-tech.pages.dev",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, h: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...h, "content-type": "application/json" } });

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return json({ ok: false, code: "network" }, 405, h);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ ok: false, code: "network" }, 400, h); }

  const kind = clean(form.get("kind"), 20);
  if (kind !== "inquiry" && kind !== "application") return json({ ok: false, code: "network" }, 400, h);
  const lang = clean(form.get("lang"), 2) === "ar" ? "ar" : "en";

  // Spam traps: honeypot + minimum fill time
  if (clean(form.get("website"), 200)) return json({ ok: true }, 200, h); // silently accept bots
  if (Number(clean(form.get("elapsed"), 12)) < 3000) return json({ ok: false, code: "tooFast" }, 400, h);

  const d = {
    name: clean(form.get("name"), 120), company: clean(form.get("company"), 160), email: clean(form.get("email"), 160).toLowerCase(),
    country: clean(form.get("country"), 80), phone: clean(form.get("phone"), 40), service: clean(form.get("service"), 80),
    project_type: clean(form.get("type"), 80), budget: clean(form.get("budget"), 60), start_date: clean(form.get("start"), 10),
    area: clean(form.get("area"), 80), linkedin: clean(form.get("linkedin"), 300), description: clean(form.get("description"), 5000),
  };
  const need = kind === "inquiry" ? ["name", "company", "email", "country", "service", "project_type", "description"] : ["name", "email", "country", "area", "description"];
  for (const k of need) if (!(d as Record<string, string>)[k]) return json({ ok: false, code: "required" }, 400, h);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(d.email)) return json({ ok: false, code: "email" }, 400, h);
  if (d.linkedin && !/^https?:\/\/\S+\.\S+/.test(d.linkedin)) return json({ ok: false, code: "url" }, 400, h);
  if (d.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(d.start_date)) d.start_date = "";

  // File validation (extension, size and magic bytes)
  const rule = FILE_RULES[kind];
  const f = form.get(rule.field);
  let file: { bytes: Uint8Array; ext: string; name: string } | null = null;
  if (f instanceof File && f.size > 0) {
    const ext = (f.name.split(".").pop() || "").toLowerCase();
    if (!rule.exts.includes(ext)) return json({ ok: false, code: "fileType" }, 400, h);
    if (f.size > MAX) return json({ ok: false, code: "fileSize" }, 400, h);
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (!TYPES[ext].sig.some((s) => s.every((b, i) => bytes[i] === b))) return json({ ok: false, code: "fileType" }, 400, h);
    file = { bytes, ext, name: f.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) };
  } else if (rule.required) return json({ ok: false, code: "required" }, 400, h);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Rate limit: 5 submissions per IP per hour
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const ip_hash = await sha256("mt:" + ip);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("mt_submissions").select("id", { count: "exact", head: true }).eq("ip_hash", ip_hash).gte("created_at", since);
  if ((count ?? 0) >= 5) return json({ ok: false, code: "rate" }, 429, h);

  let file_path: string | null = null;
  if (file) {
    file_path = `${kind}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${file.ext}`;
    const up = await db.storage.from("mt-uploads").upload(file_path, file.bytes, { contentType: TYPES[file.ext].mime });
    if (up.error) return json({ ok: false, code: "network" }, 500, h);
  }

  const { data: row, error } = await db.from("mt_submissions").insert({
    kind, lang, ...d, start_date: d.start_date || null, company: d.company || null, phone: d.phone || null,
    service: d.service || null, project_type: d.project_type || null, budget: d.budget || null, area: d.area || null,
    linkedin: d.linkedin || null, file_path, file_name: file?.name ?? null, ip_hash,
  }).select("id, created_at").single();
  if (error) return json({ ok: false, code: "network" }, 500, h);

  // Email (best effort — the submission is already stored)
  const user = Deno.env.get("GMAIL_USER"), pass = Deno.env.get("GMAIL_APP_PASSWORD");
  const to = Deno.env.get("NOTIFY_TO") || "muslimtecheg@gmail.com";
  let email_status = "not_configured";
  if (user && pass) {
    const smtp = new SMTPClient({ connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: user, password: pass } } });
    try {
      const labels: [string, string][] = kind === "inquiry"
        ? [["Name", d.name], ["Company", d.company], ["Email", d.email], ["Country", d.country], ["Phone", d.phone], ["Service", d.service], ["Project type", d.project_type], ["Budget", d.budget], ["Start date", d.start_date], ["Language", lang]]
        : [["Name", d.name], ["Email", d.email], ["Country", d.country], ["Area", d.area], ["LinkedIn", d.linkedin], ["Language", lang]];
      const when = new Date(row.created_at).toUTCString();
      const rows = labels.filter(([, v]) => v).map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#5A6B8A">${k}</td><td style="padding:6px 0"><b>${esc(v)}</b></td></tr>`).join("");
      const subject = kind === "inquiry" ? `New project inquiry: ${d.company || d.name} (${d.service})` : `New careers application: ${d.name} (${d.area})`;
      await smtp.send({
        from: `Muslim Tech Website <${user}>`, to, replyTo: d.email, subject,
        html: `<div style="font-family:Arial,sans-serif;color:#0E1B33"><h2 style="margin:0 0 12px">${esc(subject)}</h2><p style="color:#5A6B8A">Received ${esc(when)} · ID ${row.id}</p><table>${rows}</table><h3>${kind === "inquiry" ? "Project description" : "Introduction"}</h3><p style="white-space:pre-wrap">${esc(d.description)}</p>${file ? `<p>Attachment: ${esc(file.name)}</p>` : ""}</div>`,
        attachments: file ? [{ filename: file.name, content: file.bytes, encoding: "binary", contentType: TYPES[file.ext].mime }] : [],
      });
      const ack = lang === "ar"
        ? { s: kind === "inquiry" ? "استلمنا طلبك — Muslim Tech" : "استلمنا طلب انضمامك — Muslim Tech", b: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;color:#0E1B33;line-height:1.8"><p>مرحبًا ${esc(d.name)}،</p><p>${kind === "inquiry" ? "شكرًا لتواصلك مع Muslim Tech. استلمنا تفاصيل مشروعك وسنراجعها ونعود إليك قريبًا، عادةً خلال يوم عمل واحد." : "شكرًا لاهتمامك بالتعاون مع Muslim Tech. استلمنا بياناتك وسنتواصل معك عند توفر فرصة مناسبة."}</p><p>يمكنك الرد على هذه الرسالة لإضافة أي تفاصيل.</p><p>فريق Muslim Tech<br>برمجيات أفضل. تشغيل بثقة.</p></div>` }
        : { s: kind === "inquiry" ? "We received your inquiry — Muslim Tech" : "We received your application — Muslim Tech", b: `<div style="font-family:Arial,sans-serif;color:#0E1B33;line-height:1.6"><p>Hi ${esc(d.name)},</p><p>${kind === "inquiry" ? "Thank you for contacting Muslim Tech. We have received your project details and will review them and get back to you soon, usually within one business day." : "Thank you for your interest in working with Muslim Tech. We have received your details and will contact you when a suitable opportunity comes up."}</p><p>You can reply to this email to add more information.</p><p>The Muslim Tech team<br>Deliver Better Software. Operate With Confidence.</p></div>` };
      await smtp.send({ from: `Muslim Tech <${user}>`, to: d.email, replyTo: to, subject: ack.s, html: ack.b });
      email_status = "sent";
    } catch (e) {
      console.error("smtp", e);
      email_status = "failed";
    } finally {
      try { await smtp.close(); } catch { /* ignore */ }
    }
  }
  await db.from("mt_submissions").update({ email_status }).eq("id", row.id);
  return json({ ok: true, id: row.id }, 200, h);
});

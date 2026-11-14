// Static site generator for Muslim Tech (EN + AR). Run: node build.mjs
import fs from 'node:fs';
import path from 'node:path';
import en from './content/en.mjs';
import ar from './content/ar.mjs';

const SITE = process.env.SITE_URL || 'https://muslim-tech.pages.dev';
const ENDPOINT = process.env.FORM_ENDPOINT || 'https://xztvijjnjzpzwcwqduri.supabase.co/functions/v1/mt-submit';
const EMAIL = 'muslimtech@gmail.com';
const OUT = path.resolve('dist');
const YEAR = new Date().getFullYear();

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Icons (24px stroke) ----------
const P = {
  qa: '<path d="M9 11l2 2 4-4"/><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z"/>',
  support: '<path d="M4 13a8 8 0 0116 0"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2.5-5 2.5"/>',
  ops: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 12l3-3 2 2 4-4"/><path d="M8 20h8M12 16v4"/>',
  dev: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  api: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.3 11l7.4-3.9M8.3 13l7.4 3.9"/>',
  consult: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="9"/>',
};
const icon = (k, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[k]}</svg>`;
const LOGO = `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#1F6FEB"/><path d="M27.5 9.5a11 11 0 100 21 9 9 0 110-21z" fill="#fff"/><path d="M24.5 17.2l1.1 2.3 2.5.4-1.8 1.8.4 2.5-2.2-1.2-2.3 1.2.5-2.5-1.8-1.8 2.5-.4z" fill="#22C3E6"/></svg>`;

// ---------- Routes ----------
const R = { home: '/', about: '/about/', services: '/services/', industries: '/industries/', how: '/how-we-work/', pricing: '/pricing/', contact: '/contact/', careers: '/careers/', faq: '/faq/', privacy: '/privacy/', terms: '/terms/', cookies: '/cookies/' };
const url = (t, p) => (t.prefix + p).replace(/\/+$/, '/') || '/';
const svcPath = (s) => `/services/${s.slug}/`;
const other = (t) => (t.lang === 'en' ? ar : en);

// ---------- Layout ----------
function head(t, { title, desc, p, schema = [] }) {
  const o = other(t);
  const full = title.includes('Muslim Tech') ? title : `${title} | Muslim Tech`;
  const canon = SITE + url(t, p);
  return `<!DOCTYPE html>
<html lang="${t.lang}" dir="${t.dir}" data-endpoint="${ENDPOINT}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canon}">
<link rel="alternate" hreflang="en" href="${SITE + url(en, p)}">
<link rel="alternate" hreflang="ar" href="${SITE + url(ar, p)}">
<link rel="alternate" hreflang="x-default" href="${SITE + url(en, p)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Muslim Tech">
<meta property="og:title" content="${esc(full)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canon}"><meta property="og:image" content="${SITE}/assets/og.png">
<meta property="og:locale" content="${t.lang === 'ar' ? 'ar_AR' : 'en_US'}"><meta property="og:locale:alternate" content="${o.lang === 'ar' ? 'ar_AR' : 'en_US'}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0A1730">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=Sora:wght@600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/style.css">
${schema.map((s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`).join('\n')}
${p === '/' && t.lang === 'en' ? `<script>try{if(localStorage.getItem('mt-lang')==='ar'&&!document.referrer.startsWith(location.origin))location.replace('/ar/')}catch(e){}</script>` : ''}
</head>
<body>
<a class="skip" href="#main">${t.nav.skip}</a>`;
}

function header(t, p) {
  const o = other(t);
  const items = [['home', R.home], ['about', R.about], ['services', R.services], ['industries', R.industries], ['how', R.how], ['pricing', R.pricing], ['contact', R.contact]];
  const cur = (rp) => (rp === '/' ? p === '/' : p.startsWith(rp)) ? ' aria-current="page"' : '';
  return `<header class="site-header"><div class="wrap hdr">
<a class="logo" href="${url(t, '/')}">${LOGO}<span>Muslim Tech</span></a>
<button class="menu-btn" aria-expanded="false" aria-controls="mainnav" data-menu="${t.nav.menu}" data-close="${t.nav.close}">${t.nav.menu}</button>
<nav class="mainnav" id="mainnav" aria-label="Main">${items.map(([k, rp]) => `<a href="${url(t, rp)}"${cur(rp)}>${t.nav[k]}</a>`).join('')}</nav>
<div class="hdr-actions"><a class="lang" href="${url(o, p)}" hreflang="${o.lang}" lang="${o.lang}" data-setlang="${o.lang}">${t.nav.switchTo}</a>
<a class="btn btn-primary btn-sm" href="${url(t, R.contact)}">${t.nav.quote}</a></div>
</div></header>
<main id="main">`;
}

function footer(t, p) {
  const o = other(t);
  const q = [['home', R.home], ['about', R.about], ['services', R.services], ['industries', R.industries], ['how', R.how], ['pricing', R.pricing], ['careers', R.careers], ['faq', R.faq], ['contact', R.contact]];
  return `</main>
<footer class="site-footer"><div class="wrap">
<div class="ft">
 <div><a class="logo" href="${url(t, '/')}">${LOGO}<span>Muslim Tech</span></a><p class="tag">${t.tagline}</p><p>${t.shortDesc}</p></div>
 <div><h4>${t.footer.quick}</h4><ul>${q.map(([k, rp]) => `<li><a href="${url(t, rp)}">${t.nav[k]}</a></li>`).join('')}</ul></div>
 <div><h4>${t.footer.services}</h4><ul>${t.services.map((s) => `<li><a href="${url(t, svcPath(s))}">${s.title}</a></li>`).join('')}</ul></div>
 <div><h4>${t.footer.contact}</h4><ul><li><a href="mailto:${EMAIL}">${EMAIL}</a></li><li><a href="${url(t, R.contact)}">${t.nav.quote}</a></li></ul>
 <h4 style="margin-top:22px">${t.footer.lang}</h4><ul><li><a href="${url(en, p)}" lang="en" data-setlang="en">English</a> / <a href="${url(ar, p)}" lang="ar" data-setlang="ar">العربية</a></li></ul></div>
</div>
<div class="ft-bottom"><span>© ${YEAR} Muslim Tech. ${t.footer.rights}</span>
<span><a href="${url(t, R.privacy)}">${t.footer.privacy}</a> · <a href="${url(t, R.terms)}">${t.footer.terms}</a> · <a href="${url(t, R.cookies)}">${t.footer.cookies}</a></span></div>
</div></footer>
${p !== R.contact ? `<a class="btn btn-primary float-cta" href="${url(t, R.contact)}">${t.nav.quote}</a>` : ''}
<script type="application/json" id="i18n-errors">${JSON.stringify(t.errors)}</script>
<script src="/assets/app.js" defer></script>
</body></html>`;
}

const page = (t, meta, body) => head(t, meta) + header(t, meta.p) + body + footer(t, meta.p);

const crumbs = (t, items) => `<nav class="crumbs" aria-label="Breadcrumb"><a href="${url(t, '/')}">${t.common.breadcrumbHome}</a>${items.map(([n, h]) => ` / ${h ? `<a href="${url(t, h)}">${n}</a>` : `<span aria-current="page">${n}</span>`}`).join('')}</nav>`;
const pageHero = (t, title, lead, trail) => `<section class="page-hero"><div class="wrap">${crumbs(t, trail || [[title]])}<h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ''}</div></section>`;

const ctaBand = (t) => `<section><div class="wrap"><div class="cta"><div><h2>${t.common.ctaTitle}</h2><p>${t.common.ctaText}</p></div>
<div class="actions"><a class="btn btn-primary" href="${url(t, R.contact)}">${t.common.ctaBtn}</a><span class="mail">${t.common.emailUs} <a href="mailto:${EMAIL}">${EMAIL}</a></span></div></div></div></section>`;

const faqList = (items) => `<div class="faq">${items.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join('')}</div>`;
const faqSchema = (items) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
const orgSchema = (t) => ({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Muslim Tech', url: SITE, email: EMAIL, logo: SITE + '/assets/favicon.svg', description: t.shortDesc, slogan: t.tagline, areaServed: 'Worldwide' });
const crumbSchema = (t, list) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list.map(([n, p], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: SITE + url(t, p) })) });

const featured = (t) => t.services.slice(0, 2).map((s) => `<a class="feature" href="${url(t, svcPath(s))}"><span class="ico">${icon(s.icon)}</span><h3>${s.title}</h3><p>${s.short}</p>
<ul>${s.includes.slice(0, 6).map((i) => `<li>${i}</li>`).join('')}</ul><span class="more">${t.common.learnMore}</span></a>`).join('');
const svcList = (t, list) => list.map((s) => `<a class="svc-item" href="${url(t, svcPath(s))}"><span class="ico">${icon(s.icon)}</span><div><h3>${s.title}</h3><p>${s.short}</p></div></a>`).join('');
const servicesBlock = (t) => `<div class="svc-feature">${featured(t)}</div><div class="svc-list">${svcList(t, t.services.slice(2))}</div>`;
const timeline = (t) => `<ol class="timeline">${t.process.map(([h, d]) => `<li><h3>${h}</h3><p>${d}</p></li>`).join('')}</ol>`;
const models = (t) => `<div class="models">${t.models.map(([h, l]) => `<div class="model"><h3>${h}</h3><ul>${l.map((x) => `<li>${x}</li>`).join('')}</ul></div>`).join('')}</div>`;
const why = (t, cls = '') => `<div class="why ${cls}">${t.home.why.map(([h, d]) => `<div><h3>${h}</h3><p>${d}</p></div>`).join('')}</div>`;

// ---------- Hero console ----------
const CONSOLE = {
  en: { title: 'Release 4.12 readiness', env: 'staging', rows: [['Checkout regression suite', '48 of 48 passed', 'ok'], ['POST /api/orders', '200 OK, 182 ms', 'ok'], ['Login and 2FA flow (UAT)', 'Accepted', 'ok'], ['Incident INC-2041, root cause logged', 'Resolved', 'ok'], ['Safari 17 date picker', 'Fix verified', 'warn']], ready: 'Ready to release' },
  ar: { title: 'جاهزية الإصدار 4.12', env: 'staging', rows: [['اختبار انحدار صفحة الدفع', '48 من 48 ناجحة', 'ok'], ['POST /api/orders', '200 OK, 182 ms', 'ok'], ['تسجيل الدخول والتحقق الثنائي (UAT)', 'مقبول', 'ok'], ['الحادثة INC-2041 وتسجيل السبب الجذري', 'تم الحل', 'ok'], ['منتقي التاريخ في Safari 17', 'تم التحقق من الإصلاح', 'warn']], ready: 'جاهز للإطلاق' },
};
const consoleHtml = (t) => {
  const c = CONSOLE[t.lang];
  return `<div class="console" role="img" aria-label="${esc(c.title)}"><div class="console-top"><i></i><i></i><i></i><b>${c.title}</b><span class="release">${c.env}</span></div>
<div class="console-body">${c.rows.map(([a, b, s]) => `<div class="c-row"><span class="st ${s === 'warn' ? 'warn' : ''}">${icon(s === 'warn' ? 'alert' : 'check')}</span><span>${a}</span><span class="meta">${b}</span></div>`).join('')}</div>
<div class="console-foot"><div class="bar"><span></span></div><span class="ready">${c.ready}</span></div></div>`;
};

const GLOBE = `<svg class="globe" viewBox="0 0 400 400" fill="none" aria-hidden="true"><defs><radialGradient id="g" cx="50%" cy="40%"><stop offset="0" stop-color="#1F6FEB" stop-opacity=".35"/><stop offset="1" stop-color="#0A1730" stop-opacity="0"/></radialGradient></defs><circle cx="200" cy="200" r="190" fill="url(#g)"/><g stroke="#2a4680" stroke-width="1.2"><circle cx="200" cy="200" r="150"/><ellipse cx="200" cy="200" rx="60" ry="150"/><ellipse cx="200" cy="200" rx="110" ry="150"/><path d="M50 200h300M70 130h260M70 270h260"/></g><g fill="#22C3E6"><circle cx="152" cy="150" r="5"/><circle cx="248" cy="185" r="5"/><circle cx="228" cy="210" r="5"/><circle cx="262" cy="200" r="4"/><circle cx="128" cy="135" r="4"/><circle cx="96" cy="160" r="4"/></g><g stroke="#22C3E6" stroke-opacity=".55" stroke-width="1.5" fill="none"><path d="M152 150Q200 120 248 185"/><path d="M96 160Q170 110 228 210"/><path d="M128 135Q200 150 262 200"/></g></svg>`;

// ---------- Pages ----------
function home(t) {
  const h = t.home;
  return page(t, { title: h.title, desc: h.metaDesc, p: '/', schema: [orgSchema(t), faqSchema(t.faq.slice(0, 6))] }, `
<section class="hero"><div class="wrap hero-grid"><div>
<p class="kicker">${h.heroEyebrow}</p>
<h1>${t.tagline}</h1>
<p class="lead">${h.heroText}</p>
<div class="hero-ctas"><a class="btn btn-primary" href="${url(t, R.contact)}">${t.common.discuss}</a><a class="btn btn-ghost" href="${url(t, R.services)}">${t.common.explore}</a></div>
</div>${consoleHtml(t)}</div></section>

<section><div class="wrap split"><h2>${h.introTitle}</h2><div>${h.introText.map((x) => `<p class="lead">${x}</p>`).join('')}</div></div></section>

<section class="tint"><div class="wrap"><div class="sec-head"><h2>${h.servicesTitle}</h2><p>${h.servicesText}</p></div>${servicesBlock(t)}</div></section>

<section class="dark"><div class="wrap"><div class="sec-head"><h2>${h.whyTitle}</h2></div>${why(t)}</div></section>

<section><div class="wrap"><div class="sec-head"><h2>${h.industriesTitle}</h2><p>${h.industriesText}</p></div>
<div class="ind compact">${t.industries.map(([n]) => `<div><h3>${n}</h3></div>`).join('')}</div>
<p style="margin-top:22px"><a href="${url(t, R.industries)}">${t.common.learnMore}</a></p></div></section>

<section class="tint"><div class="wrap"><div class="sec-head"><h2>${h.processTitle}</h2><p>${h.processText}</p></div>${timeline(t)}</div></section>

<section><div class="wrap"><div class="sec-head"><h2>${h.modelsTitle}</h2><p>${h.modelsText}</p></div>${models(t)}</div></section>

<section class="tint"><div class="wrap"><div class="sec-head"><h2>${h.capsTitle}</h2></div><div class="caps">${h.caps.map(([a, b]) => `<div><h3>${a}</h3><p>${b}</p></div>`).join('')}</div></div></section>

<section class="dark"><div class="wrap split"><div><h2>${h.globalTitle}</h2><p class="lead">${h.globalText}</p><div class="regions">${h.regions.map((r) => `<span>${r}</span>`).join('')}</div></div>${GLOBE}</div></section>

<section><div class="wrap split"><div><h2>${h.faqTitle}</h2><p><a href="${url(t, R.faq)}">${t.nav.faq}</a></p></div>${faqList(t.faq.slice(0, 6))}</div></section>
${ctaBand(t)}`);
}

function about(t) {
  const a = t.pages.about;
  return page(t, { title: a.title, desc: a.metaDesc, p: R.about, schema: [crumbSchema(t, [[t.nav.home, '/'], [a.title, R.about]])] }, `
${pageHero(t, a.title, a.lead)}
<section><div class="wrap">${a.sections.map(([h, d]) => `<div class="about-sec"><h2>${h}</h2><p class="lead" style="margin:0">${d}</p></div>`).join('')}</div></section>
<section class="tint"><div class="wrap"><div class="sec-head"><h2>${a.valuesTitle}</h2></div><div class="values">${a.values.map(([h, d]) => `<div><h3>${h}</h3><p>${d}</p></div>`).join('')}</div></div></section>
<section><div class="wrap"><div class="sec-head"><h2>${a.whyTitle}</h2></div>${why(t, 'light')}</div></section>
${ctaBand(t)}`);
}

function services(t) {
  const s = t.pages.services;
  return page(t, { title: s.title, desc: s.metaDesc, p: R.services, schema: [crumbSchema(t, [[t.nav.home, '/'], [s.title, R.services]])] }, `
${pageHero(t, s.title, s.lead)}
<section><div class="wrap">${servicesBlock(t)}</div></section>
<section class="tint"><div class="wrap"><div class="sec-head"><h2>${t.home.modelsTitle}</h2><p>${t.home.modelsText}</p></div>${models(t)}</div></section>
${ctaBand(t)}`);
}

function service(t, s) {
  const p = svcPath(s);
  const others = t.services.filter((x) => x.slug !== s.slug);
  const schema = [{ '@context': 'https://schema.org', '@type': 'Service', name: s.title, description: s.metaDesc, provider: { '@type': 'Organization', name: 'Muslim Tech', url: SITE }, areaServed: 'Worldwide', url: SITE + url(t, p) }, faqSchema(s.faqs), crumbSchema(t, [[t.nav.home, '/'], [t.nav.services, R.services], [s.title, p]])];
  return page(t, { title: s.title, desc: s.metaDesc, p, schema }, `
${pageHero(t, s.title, s.intro, [[t.nav.services, R.services], [s.title]])}
<section><div class="wrap detail"><div>
<div class="block"><h2>${t.common.problems}</h2><ul class="dash">${s.problems.map((x) => `<li>${x}</li>`).join('')}</ul></div>
<div class="block"><h2>${t.common.included}</h2><ul class="checks">${s.includes.map((x) => `<li>${x}</li>`).join('')}</ul></div>
<div class="block"><h2>${t.common.benefits}</h2><ul class="checks">${s.benefits.map((x) => `<li>${x}</li>`).join('')}</ul></div>
<div class="block"><h2>${t.common.approach}</h2><ol class="steps">${s.approach.map((x) => `<li>${x}</li>`).join('')}</ol></div>
<div class="block"><h2>${t.common.tech}</h2><div class="tech"><div><h4>${t.common.techNow}</h4><div class="chips">${s.techNow.map((x) => `<span>${x}</span>`).join('')}</div></div>
<div><h4>${t.common.techEngagement}</h4><div class="chips soft">${s.techEngagement.map((x) => `<span>${x}</span>`).join('')}</div></div></div></div>
<div class="block"><h2>${t.common.faqs}</h2>${faqList(s.faqs)}</div>
</div>
<aside><h3>${t.common.ctaTitle}</h3><p style="color:var(--muted);font-size:.95rem">${t.common.ctaText}</p><a class="btn btn-primary" style="width:100%;margin-bottom:22px" href="${url(t, R.contact)}">${t.nav.quote}</a>
<h3>${t.common.related}</h3>${others.map((o) => `<a class="other" href="${url(t, svcPath(o))}">${o.title}</a>`).join('')}</aside>
</div></section>
${ctaBand(t)}`);
}

function industries(t) {
  const s = t.pages.industries;
  return page(t, { title: s.title, desc: s.metaDesc, p: R.industries, schema: [crumbSchema(t, [[t.nav.home, '/'], [s.title, R.industries]])] }, `
${pageHero(t, s.title, s.lead)}
<section><div class="wrap"><div class="ind">${t.industries.map(([n, d]) => `<div><h3>${n}</h3><p>${d}</p></div>`).join('')}</div><p class="note">${s.note}</p></div></section>
${ctaBand(t)}`);
}

function how(t) {
  const s = t.pages.how;
  return page(t, { title: s.title, desc: s.metaDesc, p: R.how, schema: [crumbSchema(t, [[t.nav.home, '/'], [s.title, R.how]])] }, `
${pageHero(t, s.title, s.lead)}
<section><div class="wrap">${timeline(t)}</div></section>
<section class="tint"><div class="wrap"><div class="sec-head"><h2>${t.home.modelsTitle}</h2><p>${t.home.modelsText}</p></div>${models(t)}</div></section>
${ctaBand(t)}`);
}

function pricing(t) {
  const s = t.pages.pricing;
  return page(t, { title: s.title, desc: s.metaDesc, p: R.pricing, schema: [crumbSchema(t, [[t.nav.home, '/'], [s.title, R.pricing]])] }, `
${pageHero(t, s.title, s.lead)}
<section><div class="wrap"><div class="pricing-opts">${s.options.map(([h, d]) => `<div><h3>${h}</h3><p>${d}</p></div>`).join('')}</div></div></section>
<section class="tint"><div class="wrap"><div class="sec-head"><h2>${t.home.modelsTitle}</h2><p>${t.home.modelsText}</p></div>${models(t)}</div></section>
<section><div class="wrap"><div class="sec-head"><h2>${s.factorsTitle}</h2></div><div class="factors">${s.factors.map((f) => `<span>${f}</span>`).join('')}</div></div></section>
${ctaBand(t)}`);
}

const field = (name, label, input, full = false) => `<div class="field${full ? ' full' : ''}"><label for="${name}">${label}</label>${input}<span class="err" aria-live="polite"></span></div>`;
const opts = (list, choose) => `<option value="">${choose}</option>` + list.map((o) => `<option>${esc(o)}</option>`).join('');

function contact(t) {
  const c = t.pages.contact, f = c.f;
  return page(t, { title: c.title, desc: c.metaDesc, p: R.contact, schema: [crumbSchema(t, [[t.nav.home, '/'], [c.title, R.contact]])] }, `
${pageHero(t, c.title, c.lead)}
<section><div class="wrap contact-grid">
<form data-kind="inquiry" data-success="${esc(c.success)}" novalidate enctype="multipart/form-data">
<div class="form-grid">
${field('name', f.name, `<input id="name" name="name" required maxlength="120" autocomplete="name">`)}
${field('company', f.company, `<input id="company" name="company" required maxlength="160" autocomplete="organization">`)}
${field('email', f.email, `<input id="email" name="email" type="email" required maxlength="160" autocomplete="email" dir="ltr">`)}
${field('country', f.country, `<input id="country" name="country" required maxlength="80" autocomplete="country-name">`)}
${field('phone', f.phone, `<input id="phone" name="phone" type="tel" maxlength="40" autocomplete="tel" dir="ltr">`)}
${field('service', f.service, `<select id="service" name="service" required>${opts(c.serviceOptions, f.choose)}</select>`)}
${field('type', f.type, `<select id="type" name="type" required>${opts(c.typeOptions, f.choose)}</select>`)}
${field('budget', f.budget, `<select id="budget" name="budget">${opts(c.budgetOptions, f.choose)}</select>`)}
${field('start', f.start, `<input id="start" name="start" type="date">`)}
${field('desc', f.desc, `<textarea id="desc" name="description" required maxlength="5000"></textarea>`, true)}
${field('file', f.file, `<input id="file" name="file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg">`, true)}
</div>
<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<button class="btn btn-primary" type="submit" style="margin-top:20px" data-sending="${f.sending}">${f.submit}</button>
<div class="form-msg" role="status" tabindex="-1"></div>
</form>
<aside class="side-card"><h3>${c.sideTitle}</h3><p>${c.sideEmail}</p><p><a href="mailto:${EMAIL}">${EMAIL}</a></p><p>${c.sideReply}</p></aside>
</div></section>`);
}

function careers(t) {
  const c = t.pages.careers, f = c.f;
  return page(t, { title: c.title, desc: c.metaDesc, p: R.careers, schema: [crumbSchema(t, [[t.nav.home, '/'], [c.title, R.careers]])] }, `
${pageHero(t, c.title, c.lead)}
<section><div class="wrap"><div class="caps">${c.areas.map(([h, d]) => `<div><h3>${h}</h3><p>${d}</p></div>`).join('')}</div><p class="note">${c.note}</p></div></section>
<section class="tint"><div class="wrap" style="max-width:820px">
<form data-kind="application" data-success="${esc(c.success)}" novalidate enctype="multipart/form-data">
<div class="form-grid">
${field('name', f.name, `<input id="name" name="name" required maxlength="120" autocomplete="name">`)}
${field('email', f.email, `<input id="email" name="email" type="email" required maxlength="160" autocomplete="email" dir="ltr">`)}
${field('country', f.country, `<input id="country" name="country" required maxlength="80">`)}
${field('area', f.area, `<select id="area" name="area" required>${opts(c.areaOptions, f.choose)}</select>`)}
${field('linkedin', f.linkedin, `<input id="linkedin" name="linkedin" type="url" maxlength="300" dir="ltr" placeholder="https://www.linkedin.com/in/…">`, true)}
${field('cv', f.cv, `<input id="cv" name="cv" type="file" required accept=".pdf,.doc,.docx">`, true)}
${field('intro', f.intro, `<textarea id="intro" name="description" required maxlength="3000"></textarea>`, true)}
</div>
<div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<button class="btn btn-primary" type="submit" style="margin-top:20px" data-sending="${f.sending}">${f.submit}</button>
<div class="form-msg" role="status" tabindex="-1"></div>
</form></div></section>`);
}

function faqPage(t) {
  const s = t.pages.faq;
  return page(t, { title: s.title, desc: s.metaDesc, p: R.faq, schema: [faqSchema(t.faq), crumbSchema(t, [[t.nav.home, '/'], [s.title, R.faq]])] }, `
${pageHero(t, s.title, s.lead)}
<section><div class="wrap" style="max-width:860px">${faqList(t.faq)}</div></section>
${ctaBand(t)}`);
}

function legal(t, key) {
  const L = t.legal[key];
  return page(t, { title: L.title, desc: L.metaDesc, p: R[key] }, `
${pageHero(t, L.title, '')}
<section><div class="wrap prose"><p class="updated">${t.legal.updated}</p>${L.body.map(([h, d]) => `<h2>${h}</h2><p>${d.replace(EMAIL, `<a href="mailto:${EMAIL}">${EMAIL}</a>`)}</p>`).join('')}</div></section>`);
}

function notFound() {
  const e = en.pages.notFound, a = ar.pages.notFound;
  return head(en, { title: e.title, desc: e.lead, p: '/' }).replace('<link rel="canonical"', '<meta name="robots" content="noindex"><link rel="canonical"') + header(en, '/') + `
<section class="nf"><div class="wrap"><div class="code">404</div><h1>${e.title}</h1><p class="lead" style="margin:0 auto 24px">${e.lead}</p>
<p><a class="btn btn-primary" href="/">${e.back}</a></p>
<div dir="rtl" lang="ar" style="margin-top:36px"><h2 style="font-size:1.4rem">${a.title}</h2><p class="lead" style="margin:0 auto 16px">${a.lead}</p><a class="btn btn-outline" href="/ar/">${a.back}</a></div></div></section>` + footer(en, '/');
}

// ---------- Write ----------
function write(p, html) {
  const file = p.endsWith('.html') ? path.join(OUT, p) : path.join(OUT, p, 'index.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html);
}

fs.rmSync(OUT, { recursive: true, force: true });
const urls = [];
for (const t of [en, ar]) {
  const add = (p, html) => { write(url(t, p), html); urls.push(p); };
  add('/', home(t));
  add(R.about, about(t));
  add(R.services, services(t));
  t.services.forEach((s) => add(svcPath(s), service(t, s)));
  add(R.industries, industries(t));
  add(R.how, how(t));
  add(R.pricing, pricing(t));
  add(R.contact, contact(t));
  add(R.careers, careers(t));
  add(R.faq, faqPage(t));
  ['privacy', 'terms', 'cookies'].forEach((k) => add(R[k], legal(t, k)));
}
write('404.html', notFound());

// assets
fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
fs.copyFileSync('src/style.css', path.join(OUT, 'assets/style.css'));
fs.copyFileSync('src/app.js', path.join(OUT, 'assets/app.js'));
fs.writeFileSync(path.join(OUT, 'assets/favicon.svg'), LOGO.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
if (fs.existsSync('src/og.png')) fs.copyFileSync('src/og.png', path.join(OUT, 'assets/og.png'));

// sitemap + robots + headers
const uniq = [...new Set(urls)];
const today = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${uniq.flatMap((p) => [en, ar].map((t) => `<url><loc>${SITE + url(t, p)}</loc><lastmod>${today}</lastmod>
<xhtml:link rel="alternate" hreflang="en" href="${SITE + url(en, p)}"/><xhtml:link rel="alternate" hreflang="ar" href="${SITE + url(ar, p)}"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE + url(en, p)}"/></url>`)).join('\n')}
</urlset>`);
fs.writeFileSync(path.join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
fs.writeFileSync(path.join(OUT, '_headers'), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://xztvijjnjzpzwcwqduri.supabase.co; form-action 'self'; frame-ancestors 'none'; base-uri 'self'
/assets/*
  Cache-Control: public, max-age=86400
`);
console.log(`Built ${uniq.length * 2} pages + 404 into dist/`);

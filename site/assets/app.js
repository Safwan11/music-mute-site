// Shared: Supabase client (public key only), language toggle, helpers.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPABASE_URL = 'https://xztvijjnjzpzwcwqduri.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_pZXY2-n1qFS2TwFkB4jS-w_-PGNpEOg';
export const CHROME_STORE_URL = ''; // set after the store listing is approved
export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---- i18n: elements carry data-ar / data-en (text) and data-ar-ph / data-en-ph (placeholder)
export let lang = localStorage.getItem('mm-lang') || (navigator.language?.startsWith('ar') ? 'ar' : 'en');
export const t = (ar, en) => (lang === 'ar' ? ar : en);
export function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  $$('[data-ar]').forEach((el) => { el.innerHTML = el.dataset[lang]; });
  $$('[data-ar-ph]').forEach((el) => { el.placeholder = el.dataset[lang + 'Ph']; });
  const b = $('#langBtn'); if (b) b.textContent = lang === 'ar' ? 'English' : 'العربية';
  document.dispatchEvent(new Event('langchange'));
}
export function initLang() {
  const b = $('#langBtn');
  if (b) b.addEventListener('click', () => { lang = lang === 'ar' ? 'en' : 'ar'; localStorage.setItem('mm-lang', lang); applyLang(); });
  applyLang();
}

export function msg(el, text, kind = '') { el.textContent = text || ''; el.className = 'msg ' + kind; }

export async function getSettings() {
  const { data } = await sb.from('settings').select('key,value');
  return Object.fromEntries((data || []).map((r) => [r.key, r.value]));
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Email + 6-digit code sign-in. Calls onSignedIn(session) when done.
export function mountLogin(root, onSignedIn, presetEmail = '') {
  root.innerHTML = `
    <div data-step="email">
      <label data-ar="الإيميل" data-en="Email"></label>
      <input class="ltr" id="lgEmail" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(presetEmail)}">
      <button class="btn primary" id="lgSend" style="margin-top:12px;width:100%" data-ar="ابعتلي كود الدخول" data-en="Email me a sign-in code"></button>
    </div>
    <div data-step="code" class="hidden">
      <label data-ar="اكتب الكود اللي وصلك (6 أرقام)" data-en="Enter the 6-digit code we emailed you"></label>
      <input class="code" id="lgCode" inputmode="numeric" maxlength="6" placeholder="••••••">
      <button class="btn primary" id="lgVerify" style="margin-top:12px;width:100%" data-ar="تأكيد" data-en="Verify"></button>
      <button class="btn ghost sm" id="lgBack" style="margin-top:8px" data-ar="غيّر الإيميل" data-en="Change email"></button>
    </div>
    <div class="msg" id="lgMsg"></div>`;
  applyLang();
  const m = $('#lgMsg', root);
  let email = '';
  $('#lgSend', root).onclick = async () => {
    email = $('#lgEmail', root).value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return msg(m, t('اكتب إيميل صحيح', 'Enter a valid email'), 'err');
    $('#lgSend', root).disabled = true;
    const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    $('#lgSend', root).disabled = false;
    if (error) return msg(m, error.message, 'err');
    $('[data-step=email]', root).classList.add('hidden');
    $('[data-step=code]', root).classList.remove('hidden');
    msg(m, t('بعتنا الكود على ', 'Code sent to ') + email + t(' — بص في الـ Spam لو مش لاقيه', ' — check Spam if you don’t see it'), 'ok');
    $('#lgCode', root).focus();
  };
  $('#lgVerify', root).onclick = async () => {
    $('#lgVerify', root).disabled = true;
    const { data, error } = await sb.auth.verifyOtp({ email, token: $('#lgCode', root).value.trim(), type: 'email' });
    $('#lgVerify', root).disabled = false;
    if (error) return msg(m, t('الكود غلط أو انتهى', 'Wrong or expired code'), 'err');
    onSignedIn(data.session);
  };
  $('#lgBack', root).onclick = () => {
    $('[data-step=email]', root).classList.remove('hidden');
    $('[data-step=code]', root).classList.add('hidden'); msg(m, '');
  };
  $('#lgCode', root).addEventListener('keydown', (e) => e.key === 'Enter' && $('#lgVerify', root).click());
  $('#lgEmail', root).addEventListener('keydown', (e) => e.key === 'Enter' && $('#lgSend', root).click());
}

(() => {
  const html = document.documentElement;
  const lang = html.lang;
  const endpoint = html.dataset.endpoint;

  // Language preference
  try {
    document.querySelectorAll('[data-setlang]').forEach((a) =>
      a.addEventListener('click', () => localStorage.setItem('mt-lang', a.dataset.setlang)));
    const saved = localStorage.getItem('mt-lang');
    if (!saved) localStorage.setItem('mt-lang', lang);
  } catch (_) {}

  // Mobile menu
  const btn = document.querySelector('.menu-btn');
  const nav = document.querySelector('.mainnav');
  if (btn && nav) btn.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? btn.dataset.close : btn.dataset.menu;
  });

  // Forms
  const ERR = JSON.parse(document.getElementById('i18n-errors')?.textContent || '{}');
  const ALLOWED = { file: ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg'], cv: ['pdf', 'doc', 'docx'] };
  const MAX = 5 * 1024 * 1024;

  function setErr(field, msg) {
    const wrap = field.closest('.field');
    if (!wrap) return;
    wrap.classList.toggle('invalid', !!msg);
    const e = wrap.querySelector('.err');
    if (e) e.textContent = msg || '';
    field.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }

  function validate(form) {
    let ok = true, first = null;
    form.querySelectorAll('input,select,textarea').forEach((f) => {
      if (f.closest('.hp') || f.type === 'hidden') return;
      let msg = '';
      const v = (f.value || '').trim();
      if (f.required && !v && f.type !== 'file') msg = ERR.required;
      else if (f.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) msg = ERR.email;
      else if (f.type === 'url' && v && !/^https?:\/\/\S+\.\S+/.test(v)) msg = ERR.url;
      else if (f.type === 'file') {
        const file = f.files[0];
        if (f.required && !file) msg = ERR.required;
        else if (file) {
          const ext = file.name.split('.').pop().toLowerCase();
          if (!(ALLOWED[f.name] || []).includes(ext)) msg = ERR.fileType;
          else if (file.size > MAX) msg = ERR.fileSize;
        }
      }
      setErr(f, msg);
      if (msg) { ok = false; first = first || f; }
    });
    if (first) first.focus();
    return ok;
  }

  document.querySelectorAll('form[data-kind]').forEach((form) => {
    const started = Date.now();
    const msgBox = form.querySelector('.form-msg');
    const submit = form.querySelector('button[type=submit]');
    form.querySelectorAll('input,select,textarea').forEach((f) =>
      f.addEventListener('change', () => setErr(f, '')));

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      msgBox.className = 'form-msg'; msgBox.textContent = '';
      if (!validate(form)) return;
      if (Date.now() - started < 3000) { msgBox.className = 'form-msg bad'; msgBox.textContent = ERR.tooFast; return; }
      const data = new FormData(form);
      data.set('kind', form.dataset.kind);
      data.set('lang', lang);
      data.set('elapsed', String(Date.now() - started));
      const label = submit.textContent;
      submit.disabled = true; submit.textContent = submit.dataset.sending;
      try {
        const res = await fetch(endpoint, { method: 'POST', body: data });
        const out = await res.json().catch(() => ({}));
        if (res.status === 429) throw new Error(ERR.rate);
        if (!res.ok || !out.ok) throw new Error(ERR[out.code] || ERR.network);
        form.reset();
        msgBox.className = 'form-msg ok'; msgBox.textContent = form.dataset.success;
        msgBox.focus();
      } catch (e) {
        msgBox.className = 'form-msg bad';
        msgBox.textContent = (e && e.message && e.message !== 'Failed to fetch') ? e.message : ERR.network;
      } finally {
        submit.disabled = false; submit.textContent = label;
      }
    });
  });
})();

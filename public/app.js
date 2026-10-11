// LocalAI — frontend (vanilla JS, nessun build step)

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- Icone (stile lucide) ----------
const P = {
  panel: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  gallery: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  spark: '<path d="M12 2c.5 4.8 2.7 7.6 7.5 8.3v1.4C14.7 12.4 12.5 15.2 12 22h-.1c-.5-6.8-2.7-9.6-7.5-10.3v-1.4C9.2 9.6 11.4 6.8 11.9 2z" fill="currentColor" stroke="none"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 5-3v10l-5-3"/>',
  brain: '<path d="M9.5 2A2.5 2.5 0 0 0 7 4.5v.1A3 3 0 0 0 4.6 9 3 3 0 0 0 5 14.6 3 3 0 0 0 8 19.5 2.5 2.5 0 0 0 12 21V4.5A2.5 2.5 0 0 0 9.5 2Z"/><path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v.1A3 3 0 0 1 19.4 9a3 3 0 0 1-.4 5.6 3 3 0 0 1-3 4.9A2.5 2.5 0 0 1 12 21"/>',
  send: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/>',
  down: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  text: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h10"/>',
  x: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  bulb: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  chip: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6M9 9h1"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3.5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  page: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3"/><path d="m16 7 3 3"/><path d="m19 4 2 2"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m6 9 3 3-3 3"/><path d="M12 15h5"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
};
const icon = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[n] || ''}</svg>`;
$$('[data-icon]').forEach((el) => { el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon, el.classList.contains('send') ? 18 : 18)); });

// ---------- Stato ----------
const prefs = (() => { try { return JSON.parse(localStorage.getItem('localai.prefs') || '{}'); } catch { return {}; } })();
const savePrefs = () => { try { localStorage.setItem('localai.prefs', JSON.stringify(prefs)); } catch {} };

const state = {
  config: null,
  convs: [],
  conv: null,
  tool: null,
  computer: false,
  think: !!prefs.think,
  gpu: null,
  view: 'chat',
  stick: true,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (!opts.raw && data.code === 'auth_required') showLogin();
    if (!opts.raw && data.code === 'password_change_required') showPasswordForm(true);
    throw Object.assign(new Error(data.error || `Errore ${res.status}`), { status: res.status, code: data.code });
  }
  return data;
}

// ---------- Markdown ----------
marked.use({
  gfm: true, breaks: false,
  renderer: {
    code({ text, lang }) {
      const l = (lang || '').split(/\s/)[0];
      return `<div class="codeblock"><div class="codeblock-head"><span>${esc(l || 'codice')}</span><button type="button" data-copy-code>${icon('copy', 14)}Copia</button></div><pre><code>${esc(text)}</code></pre></div>`;
    },
    link({ href, text }) {
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
});
// I modelli a volte scrivono simboli in LaTeX ($\rightarrow$): li convertiamo nei caratteri corrispondenti
const LATEX = { rightarrow: '→', to: '→', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔', times: '×', cdot: '·', geq: '≥', ge: '≥', leq: '≤', le: '≤', approx: '≈', neq: '≠', pm: '±', degree: '°', euro: '€' };
const fixLatex = (t) => t.replace(/\$\s*\\(\w+)\s*\$/g, (m, k) => LATEX[k] || m);
// Formule matematiche: $...$ e \(...\) in linea, $$...$$ e \[...\] a blocco (KaTeX, servito in locale)
const tex = (src, display) => {
  try { return katex.renderToString(src, { displayMode: display, throwOnError: false, output: 'html' }); }
  catch { return esc(src); }
};
const looksLikeMath = (t) => /[\\^_=]/.test(t);
marked.use({ extensions: [
  {
    name: 'blockMath', level: 'block',
    start: (src) => src.match(/\$\$|\\\[/)?.index,
    tokenizer(src) {
      const m = /^\$\$([\s\S]+?)\$\$/.exec(src) || /^\\\[([\s\S]+?)\\\]/.exec(src);
      if (m) return { type: 'blockMath', raw: m[0], text: m[1].trim() };
    },
    renderer: (t) => `<div class="math-block">${tex(t.text, true)}</div>`,
  },
  {
    name: 'inlineMath', level: 'inline',
    start: (src) => src.match(/\$|\\\(/)?.index,
    tokenizer(src) {
      const m = /^\$(?!\s)((?:\\\$|[^$\n])+?)(?<!\s)\$/.exec(src) || /^\\\(([\s\S]+?)\\\)/.exec(src);
      if (m && looksLikeMath(m[1])) return { type: 'inlineMath', raw: m[0], text: m[1] };
    },
    renderer: (t) => tex(t.text, false),
  },
] });
const renderMd = (text) => DOMPurify.sanitize(marked.parse(fixLatex(text || '')), { ADD_ATTR: ['target', 'data-copy-code'] });

async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
  if (btn) {
    const old = btn.innerHTML;
    btn.innerHTML = icon('check', 14) + (btn.textContent.trim() ? 'Copiato' : '');
    setTimeout(() => { btn.innerHTML = old; }, 1400);
  }
}

// ---------- Elementi ----------
const el = {
  app: $('#app'), thread: $('#thread'), scroller: $('#scroller'), welcome: $('#welcome'),
  input: $('#input'), composer: $('#composer'), send: $('#send'), opts: $('#opts'),
  convList: $('#conv-list'), modelName: $('#model-name'), modelMenu: $('#model-menu'),
  gpuPill: $('#gpu-pill'), gpuLabel: $('#gpu-label'), gpuMenu: $('#gpu-menu'),
  toBottom: $('#to-bottom'), gallery: $('#gallery'), lightbox: $('#lightbox'), lbBody: $('#lb-body'),
  projects: $('#projects'),
};

// ---------- Sidebar ----------
const isMobile = () => matchMedia('(max-width: 860px)').matches;
function setSidebar(open) {
  el.app.classList.toggle('collapsed', !open);
  if (!isMobile()) { prefs.sidebar = open; savePrefs(); }
}
setSidebar(isMobile() ? false : prefs.sidebar !== false);
$('#btn-collapse').onclick = () => setSidebar(false);
$('#btn-open').onclick = () => setSidebar(true);
$('#scrim').onclick = () => setSidebar(false);
$('#btn-new').onclick = () => { newChat(); if (isMobile()) setSidebar(false); };
$('#btn-gallery').onclick = () => { openGallery(); if (isMobile()) setSidebar(false); };
$('#btn-projects').onclick = () => { openProjects(); if (isMobile()) setSidebar(false); };

function groupLabel(ts) {
  const d = new Date(ts), now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff < 1) return 'Oggi';
  if (diff < 2) return 'Ieri';
  if (diff < 7) return 'Ultimi 7 giorni';
  if (diff < 30) return 'Ultimi 30 giorni';
  return 'Meno recenti';
}

function renderConvList() {
  let html = '', last = null;
  for (const c of state.convs) {
    const g = c.pinned ? 'Fissate' : groupLabel(c.updatedAt);
    if (g !== last) { html += `<div class="conv-group">${g}</div>`; last = g; }
    html += `<div class="conv ${state.conv?.id === c.id ? 'active' : ''}" data-id="${c.id}">
      <span class="conv-title">${esc(c.title)}</span>
      <span class="conv-actions">
        <button data-act="rename" title="Rinomina">${icon('pencil', 14)}</button>
        <button data-act="delete" title="Elimina">${icon('trash', 14)}</button>
      </span></div>`;
  }
  el.convList.innerHTML = html || '<div class="conv-group">Nessuna conversazione</div>';
}

el.convList.addEventListener('click', async (e) => {
  const row = e.target.closest('.conv');
  if (!row) return;
  const id = row.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'delete') {
    if (!confirm('Eliminare questa conversazione e i media generati?')) return;
    await api(`/api/conversations/${id}`, { method: 'DELETE' });
    state.convs = state.convs.filter((c) => c.id !== id);
    if (state.conv?.id === id) newChat(); else renderConvList();
    return;
  }
  if (act === 'rename') {
    const c = state.convs.find((x) => x.id === id);
    const title = row.querySelector('.conv-title');
    const input = Object.assign(document.createElement('input'), { value: c.title });
    title.replaceWith(input); input.focus(); input.select();
    const done = async (ok) => {
      if (ok && input.value.trim() && input.value.trim() !== c.title) {
        c.title = input.value.trim();
        await api(`/api/conversations/${id}`, { method: 'PATCH', body: { title: c.title } }).catch(() => {});
        if (state.conv?.id === id) state.conv.title = c.title;
      }
      renderConvList();
    };
    input.onkeydown = (ev) => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
    input.onblur = () => done(true);
    return;
  }
  openConv(id);
  if (isMobile()) setSidebar(false);
});

async function loadConvs() {
  state.convs = await api('/api/conversations').catch(() => []);
  renderConvList();
}

// ---------- Viste / routing ----------
function showView(v) {
  state.view = v;
  $('#view-chat').hidden = v !== 'chat';
  $('#view-gallery').hidden = v !== 'gallery';
  $('#view-projects').hidden = v !== 'projects';
  $('#btn-gallery').classList.toggle('active', v === 'gallery');
  $('#btn-projects').classList.toggle('active', v === 'projects');
}

function newChat(push = true) {
  state.conv = null;
  state.computer = false;
  renderOpts();
  showView('chat');
  el.thread.innerHTML = '';
  el.welcome.hidden = false;
  document.title = 'LocalAI';
  if (push && location.pathname !== '/') history.pushState(null, '', '/');
  renderConvList();
  updateSend();
  el.input.focus();
}

async function openConv(id, push = true) {
  showView('chat');
  let c;
  try { c = await api(`/api/conversations/${id}`); }
  catch { return newChat(); }
  state.conv = c;
  state.computer = !!c.computer;
  renderOpts();
  el.welcome.hidden = true;
  el.thread.innerHTML = '';
  for (const m of c.messages) renderMessage(m);
  document.title = `${c.title} · LocalAI`;
  if (push && location.pathname !== `/c/${id}`) history.pushState(null, '', `/c/${id}`);
  renderConvList();
  updateSend();
  scrollToBottom(true);
}

window.addEventListener('popstate', route);
function route() {
  const m = location.pathname.match(/^\/c\/([\w-]+)/);
  if (m) openConv(m[1], false);
  else if (location.pathname.startsWith('/galleria')) openGallery(false);
  else if (location.pathname.startsWith('/progetti/')) openProject(decodeURIComponent(location.pathname.slice(10)), false);
  else if (location.pathname.startsWith('/progetti')) openProjects(false);
  else newChat(false);
}

// ---------- Scroll ----------
el.scroller.addEventListener('scroll', () => {
  const gap = el.scroller.scrollHeight - el.scroller.scrollTop - el.scroller.clientHeight;
  state.stick = gap < 140;
  el.toBottom.hidden = gap < 400;
});
el.toBottom.onclick = () => scrollToBottom(true);
function scrollToBottom(force) {
  if (force || state.stick) el.scroller.scrollTop = el.scroller.scrollHeight;
}

// ---------- Messaggi ----------
const findMsg = (id) => state.conv?.messages.find((m) => m.id === id);

function upsertMsg(m) {
  if (!state.conv) return m;
  const i = state.conv.messages.findIndex((x) => x.id === m.id);
  if (i >= 0) { Object.assign(state.conv.messages[i], m); return state.conv.messages[i]; }
  state.conv.messages.push(m);
  return m;
}

function renderMessage(m) {
  let node = document.getElementById(`m-${m.id}`);
  if (m.role === 'user') {
    if (node) return;
    if (m.auto) {
      el.thread.insertAdjacentHTML('beforeend', `<div class="msg msg-auto" id="m-${m.id}">${icon('refresh', 13)}Immagini pronte: continuo il lavoro</div>`);
      return;
    }
    const TOOL_LABEL = { image: ['image', 'Immagine'], video: ['video', 'Video'], web: ['globe', 'Ricerca web'] };
    const tl = TOOL_LABEL[m.tool];
    const tag = tl ? `<div class="tag">${icon(tl[0], 13)}${tl[1]}</div>` : '';
    const imgs = (m.attachments || []).map((a, i) => a.kind === 'document'
      ? `<a class="doc-chip" href="${esc(a.url)}" target="_blank" rel="noopener">${icon('doc', 18)}<span><b>${esc(a.name)}</b><small>${a.pages} ${a.pages === 1 ? 'pagina' : 'pagine'}${a.scanned ? ' · senza testo' : ''}</small></span></a>`
      : `<img src="${esc(a.url)}" alt="" data-att="${i}" loading="lazy">`).join('');
    el.thread.insertAdjacentHTML('beforeend', `<div class="msg msg-user" id="m-${m.id}">${imgs ? `<div class="user-images">${imgs}</div>` : ''}${m.content || tag ? `<div class="bubble">${tag}${esc(m.content)}</div>` : ''}</div>`);
    return;
  }
  if (!node) {
    el.thread.insertAdjacentHTML('beforeend', `<div class="msg msg-ai" id="m-${m.id}">
      <div class="avatar">${icon('spark', 16)}</div>
      <div class="ai-body">
        <details class="thinking" hidden><summary>${icon('right', 14)}<span></span></summary><div class="thinking-text"></div></details>
        <details class="steps" hidden><summary>${icon('globe', 14)}<span class="steps-title"></span>${icon('right', 13)}</summary><div class="steps-list"></div></details>
        <div class="ws-actions" hidden></div>
        <div class="status-line" hidden></div>
        <div class="md"></div>
        <div class="media-grid"></div>
        <div class="sources" hidden></div>
        <div class="msg-error" hidden></div>
        <div class="msg-tools" hidden></div>
      </div></div>`);
    node = document.getElementById(`m-${m.id}`);
  }
  const live = m.status === 'pending' || m.status === 'streaming' || m.status === 'waiting';
  $('.avatar', node).classList.toggle('live', live);

  // Ragionamento
  const th = $('.thinking', node);
  th.hidden = !m.thinking;
  if (m.thinking) {
    $('summary span', th).textContent = live && !m.content ? 'Sto ragionando…' : 'Ragionamento';
    $('.thinking-text', th).textContent = m.thinking;
  }

  renderSteps(node, m, live);
  renderComputer(node, m);

  // Stato (attesa GPU / caricamento)
  const st = $('.status-line', node);
  const showStatus = live && !m.content && !m.thinking && !(m.media || []).length && !(m.steps || []).some((s) => !WS_STEP.has(s.type) || s.status === 'running');
  st.hidden = !showStatus;
  if (showStatus) {
    const txt = m.status === 'waiting' ? `In attesa della GPU (${esc(m.waitReason || 'occupata')})…` : '';
    st.innerHTML = `<span class="typing"><i></i><i></i><i></i></span>${txt ? `<span>${txt}</span>` : ''}`;
  }

  const md = $('.md', node);
  md.innerHTML = renderMd(m.content);
  md.classList.toggle('cursor', m.status === 'streaming' && !!m.content && !(m.media || []).length);

  for (const media of m.media || []) renderMedia(m, media);
  $('.media-grid', node).classList.toggle('multi', (m.media || []).filter((x) => x.type === 'image').length > 1);

  renderSources(node, m, live);

  const err = $('.msg-error', node);
  err.hidden = !m.error;
  if (m.error) err.textContent = `⚠ ${m.error}`;

  const tools = $('.msg-tools', node);
  tools.hidden = live || !m.content;
  if (!tools.hidden && !tools.childElementCount) {
    // in "k" da 1024 token, come si indica la finestra (16k = 16384)
    const k = (n) => `${(n / 1024).toFixed(1).replace(/\.0$/, '').replace('.', ',')}k`;
    const stats = [
      m.stats?.evalCount && m.stats?.evalMs ? `${(m.stats.evalCount / (m.stats.evalMs / 1000)).toFixed(0)} tok/s` : '',
      m.stats?.ctxUsed && m.stats?.numCtx ? `contesto ${k(m.stats.ctxUsed)}/${k(m.stats.numCtx)}` : '',
    ].filter(Boolean).join(' · ');
    tools.innerHTML = `<button data-copy-msg title="Copia">${icon('copy', 16)}</button>${stats ? `<span class="stats" title="Velocità di scrittura e token usati della finestra di contesto (stima)">${stats}</span>` : ''}`;
  }
  if (m.status === 'stopped' && !m.content && !(m.media || []).length) md.innerHTML = '<p style="color:var(--faint)">Interrotto.</p>';
}

// ---------- Ricerca web: passaggi ----------
const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

function renderSteps(node, m, live) {
  const box = $('.steps', node);
  const steps = (m.steps || []).filter((s) => !WS_STEP.has(s.type));
  box.hidden = !steps.length;
  if (!steps.length) return;
  const running = steps.find((s) => s.status === 'running');
  const reads = steps.filter((s) => s.type === 'read' && s.status === 'done').length;
  const searches = steps.filter((s) => s.type === 'search').length;
  const visions = steps.filter((s) => s.type === 'vision').length;
  const docSteps = steps.filter((s) => s.type === 'document');
  const parts = [];
  if (docSteps.length) parts.push('Documento consultato');
  if (visions) parts.push(visions === 1 ? 'Immagine analizzata' : `${visions} immagini analizzate`);
  if (searches) parts.push(`${searches} ${searches === 1 ? 'ricerca' : 'ricerche'}`);
  if (reads) parts.push(`${reads} ${reads === 1 ? 'pagina letta' : 'pagine lette'}`);
  $('.steps-title', box).textContent = running
    ? (running.type === 'document' ? (running.text || 'Leggo il documento…') : running.type === 'vision' ? `Analizzo l'${running.title}…` : running.type === 'search' ? `Cerco «${running.query}»…` : `Leggo ${domain(running.url)}…`)
    : parts.join(' · ');
  $('summary > svg', box).outerHTML = icon(searches ? 'globe' : docSteps.length ? 'doc' : 'eye', 14);
  box.classList.toggle('live', !!running);
  if (box.dataset.auto !== 'off') box.open = live && !m.content;
  $('.steps-list', box).innerHTML = steps.map((s) => {
    const state = s.status === 'running' ? '<span class="spin"></span>' : s.status === 'error' ? `<span class="step-err" title="${esc(s.error || '')}">non riuscita</span>` : '';
    if (s.type === 'document') {
      return `<div class="step">${icon('doc', 14)}<div class="step-body"><div>${s.status === 'running' ? 'Analisi' : 'Documento'}: <b>${esc(s.title || '')}</b> ${state}</div>${s.text ? `<div class="faint" style="white-space:pre-wrap">${esc(s.text)}</div>` : ''}</div></div>`;
    }
    if (s.type === 'vision') {
      return `<div class="step">${icon('eye', 14)}<div class="step-body"><div>Lettura dell'${esc(s.title || 'immagine')} con il modello visivo ${state}</div>${s.text ? `<div class="vision-text">${esc(s.text)}</div>` : ''}</div></div>`;
    }
    if (s.type === 'search') {
      const chips = (s.results || []).map((r) => `<a class="src" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" title="${esc(r.title)}">${esc(domain(r.url))}</a>`).join('');
      return `<div class="step">${icon('search', 14)}<div class="step-body"><div>Ricerca: <b>${esc(s.query)}</b> ${state}</div>${chips ? `<div class="srcs">${chips}</div>` : ''}</div></div>`;
    }
    return `<div class="step">${icon('page', 14)}<div class="step-body"><div>Lettura: <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || domain(s.url))}</a> <span class="faint">${esc(domain(s.url))}</span> ${state}</div></div></div>`;
  }).join('');
}

// ---------- Modalità Computer: file creati e comandi ----------
const WS_STEP = new Set(['file', 'command']);
const fmtSize = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1).replace('.', ',')} KB` : `${(n / 1048576).toFixed(1).replace('.', ',')} MB`);
/** URL di un file della cartella di lavoro (porta separata, stesso indirizzo da cui si usa l'app: funziona anche da telefono). */
function wsUrl(p, download = false) {
  const ws = state.config?.workspace;
  if (!ws) return '#';
  const enc = String(p).split('/').map(encodeURIComponent).join('/');
  return `${location.protocol}//${location.hostname}:${ws.port}/${ws.token}/${enc}${download ? '?download' : ''}`;
}
function wsLinks(p, { dir = false, bare = false } = {}) {
  if (!p) return '';
  const viewable = dir || /\.(html?|txt|md|json|css|js|py|ps1|bat|csv|svg|png|jpe?g|gif|webp|pdf)$/i.test(p);
  const web = dir || /\.html?$/i.test(p);
  const links = `${viewable ? `<a href="${esc(wsUrl(dir ? `${p}/` : p))}" target="_blank" rel="noopener">${icon(web ? 'play' : 'open', 13)}${web ? 'Apri' : 'Vedi'}</a>` : ''}${dir ? '' : `<a href="${esc(wsUrl(p, true))}">${icon('download', 13)}Scarica</a>`}`;
  return bare ? links : `<span class="ws-links">${links}</span>`;
}
/** Percorso di un passaggio rispetto alla cartella di lavoro (nei task dei progetti è relativo al progetto). */
const stepPath = (s) => (s.base ? `${s.base}/${s.path}` : s.path);
const FILE_LABEL = { list: 'Elenco file', read: 'Letto', write: 'Scritto', delete: 'Eliminato', word: 'Documento Word', pdf: 'PDF', image: 'Immagine', append: 'Continuo' };

function renderComputer(node, m) {
  const box = $('.ws-actions', node);
  // le letture e gli elenchi sono dettagli: si mostrano solo mentre sono in corso o se falliscono
  // i blocchi aggiunti a un file (append) si mostrano come dimensione aggiornata del file scritto
  const grown = new Map();
  for (const s of m.steps || []) if (s.action === 'append' && s.status === 'done') grown.set(s.path, s.size);
  const steps = (m.steps || []).filter((s) => WS_STEP.has(s.type) && !(['read', 'list', 'append'].includes(s.action) && s.status === 'done'))
    .map((s) => (s.action === 'write' && grown.has(s.path) ? { ...s, size: grown.get(s.path) } : s));
  box.hidden = !steps.length;
  if (!steps.length) { box.innerHTML = ''; return; }
  box.innerHTML = steps.map((s) => {
    const spin = s.status === 'running' ? '<span class="spin"></span>' : '';
    const err = s.status === 'error' ? `<div class="step-err">${esc(s.error || 'non riuscito')}</div>` : '';
    if (s.type === 'file') {
      if (s.action === 'image' && s.status === 'done') return `<div class="ws-act"><div class="ws-act-head">${icon('image', 14)}<span>Immagine salvata</span><b>${esc(s.path)}</b><span class="faint">${fmtSize(s.size)}</span>${wsLinks(stepPath(s))}</div></div>`;
      const label = s.action === 'write' ? (s.status !== 'done' ? 'Scrittura' : s.created ? 'Creato' : 'Aggiornato') : FILE_LABEL[s.action] || s.action;
      const extra = s.action === 'word' && s.method ? `<span class="faint">${esc(s.method)}</span>` : s.size != null ? `<span class="faint">${fmtSize(s.size)}</span>` : '';
      const links = s.status === 'done' && ['write', 'word', 'pdf'].includes(s.action) ? wsLinks(stepPath(s)) : '';
      return `<div class="ws-act"><div class="ws-act-head">${icon(s.action === 'word' || s.action === 'pdf' ? 'doc' : 'page', 14)}<span>${label}</span><b>${esc(s.path || '')}</b>${extra}${spin}${links}</div>${err}</div>`;
    }
    const where = s.cwd ? ` <span class="faint">in ${esc(s.cwd)}</span>` : '';
    const res = s.status === 'done'
      ? `<span class="${s.exitCode === 0 ? 'ws-ok' : 'step-err'}">${s.timedOut ? 'interrotto (tempo scaduto)' : `uscita ${s.exitCode}`}</span>`
      : s.status === 'declined' ? '<span class="faint">non eseguito</span>' : '';
    const confirm = s.status === 'confirm' ? `<div class="ws-confirm">Vuoi eseguire questo comando sul PC?
        <button class="btn primary" data-cmd="${s.id}" data-approve="1">Esegui</button><button class="btn" data-cmd="${s.id}" data-approve="0">Annulla</button></div>` : '';
    const out = s.output ? `<pre>${esc(s.output)}</pre>` : '';
    return `<div class="ws-act${s.status === 'confirm' ? ' confirm' : ''}"><div class="ws-act-head">${icon('terminal', 14)}<code>${esc(s.command)}</code>${where}${spin}${res}</div>${confirm}${out}${err}</div>`;
  }).join('');
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-cmd]');
  if (!b || !state.conv) return;
  b.parentElement.querySelectorAll('button').forEach((x) => { x.disabled = true; });
  try { await api(`/api/conversations/${state.conv.id}/commands/${b.dataset.cmd}`, { body: { approve: b.dataset.approve === '1' } }); }
  catch (err) { alert(err.message); b.parentElement.querySelectorAll('button').forEach((x) => { x.disabled = false; }); }
});

/** Fonti consultate (dai passaggi reali, mai dal testo del modello): pagine lette, altrimenti i primi risultati. */
function renderSources(node, m, live) {
  const box = $('.sources', node);
  const steps = m.steps || [];
  const read = steps.filter((s) => s.type === 'read' && s.status === 'done').map((s) => ({ url: s.url, title: s.title }));
  const list = read.length ? read : steps.flatMap((s) => s.results || []).slice(0, 4);
  const uniq = [...new Map(list.map((x) => [x.url, x])).values()];
  box.hidden = live || !uniq.length;
  if (box.hidden) return;
  box.innerHTML = `<div class="sources-title">Fonti</div><div class="sources-list">${uniq.map((x, i) => `
    <a class="source" href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.url)}">
      <span class="n">${i + 1}</span><span class="t">${esc(x.title || domain(x.url))}</span><span class="d">${esc(domain(x.url))}</span>
    </a>`).join('')}</div>`;
}

// se l'utente apre/chiude a mano il riquadro, non lo tocchiamo più automaticamente
document.addEventListener('click', (e) => {
  const sum = e.target.closest('.steps > summary');
  if (sum) sum.parentElement.dataset.auto = 'off';
});

const pending = new Set();
function scheduleRender(m) {
  if (pending.has(m.id)) return;
  pending.add(m.id);
  requestAnimationFrame(() => { pending.delete(m.id); renderMessage(m); scrollToBottom(); });
}

el.thread.addEventListener('click', (e) => {
  const cc = e.target.closest('[data-copy-code]');
  if (cc) return copyText(cc.closest('.codeblock').querySelector('code').textContent, cc);
  const cm = e.target.closest('[data-copy-msg]');
  if (cm) return copyText(findMsg(cm.closest('.msg').id.slice(2))?.content || '', cm);
  const act = e.target.closest('[data-media-act]');
  if (act) return mediaAction(act);
  const ui = e.target.closest('.user-images img');
  if (ui) {
    const m = findMsg(ui.closest('.msg').id.slice(2));
    const a = m?.attachments?.[ui.dataset.att];
    if (a) openLightbox({ url: a.url, type: 'image', id: a.id || 'img', workflowName: 'Immagine allegata', prompt: a.description || '', width: a.width, height: a.height });
    return;
  }
  const img = e.target.closest('img.result');
  if (img) {
    const card = img.closest('.media-card');
    const m = findMsg(card.dataset.msg);
    openLightbox(m?.media.find((x) => x.id === card.dataset.id));
  }
});

// ---------- Media ----------
const PHASES = {
  'Modello': 'Carico il modello', 'Text encoder': 'Carico il text encoder', 'Video VAE': 'Carico il VAE', 'Audio VAE': 'Carico il VAE audio',
  'VAE': 'Carico il VAE', 'Prompt': 'Codifica del prompt', 'Prompt / dimensioni / durata': 'Codifica del prompt',
  'Sampler': 'Generazione', 'SamplerCustomAdvanced': 'Generazione', 'VAEDecode': 'Decodifica',
  'VAEDecodeAudio': 'Decodifica audio', 'CreateVideo': 'Montaggio video', 'SaveVideo': 'Salvataggio', 'SaveImage': 'Salvataggio',
};
const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; };

function statusText(md) {
  switch (md.status) {
    case 'engineering': return 'Scrivo il prompt…';
    case 'queued': return 'In coda';
    case 'running': return `<span class="elapsed" data-start="${md.startedAt || Date.now()}">${fmtTime(Date.now() - (md.startedAt || Date.now()))}</span>`;
    case 'done': return md.startedAt && md.finishedAt ? `in ${fmtTime(md.finishedAt - md.startedAt)}` : '';
    case 'error': return 'Errore';
    case 'cancelled': return 'Annullato';
    default: return '';
  }
}

function renderMedia(msg, md) {
  const node = document.getElementById(`m-${msg.id}`);
  if (!node) return;
  const grid = $('.media-grid', node);
  let card = grid.querySelector(`[data-id="${md.id}"]`);
  const ratio = (md.width || 1) / (md.height || 1);
  const sig = `${md.status}|${md.url || ''}`;

  if (!card) {
    card = document.createElement('div');
    card.className = 'media-card';
    card.dataset.id = md.id;
    card.dataset.msg = msg.id;
    grid.append(card);
  }
  if (card.dataset.sig !== sig) {
    card.dataset.sig = sig;
    card.style.maxWidth = `${Math.min(560, Math.round(460 * ratio))}px`;
    const meta = [md.aspect, md.seconds ? `${md.seconds} s` : '', md.width && md.height ? `${md.width}×${md.height}` : ''].filter(Boolean).join(' · ');
    let frame = '';
    if (md.status === 'done' && md.url) {
      frame = md.type === 'video'
        ? `<video src="${md.url}" controls playsinline preload="metadata" loop></video>`
        : `<img class="result" src="${md.url}" alt="" loading="lazy">`;
    } else if (['engineering', 'queued', 'running'].includes(md.status)) {
      const label = md.status === 'engineering' ? `Preparo il prompt per ${esc(md.workflowName)}…`
        : md.status === 'queued' ? 'In coda: attendo la GPU…' : '';
      frame = `<img class="preview" alt="" ${md._preview ? `src="${md._preview}"` : 'hidden'}><div class="shimmer"></div>
        ${label ? `<div class="media-state"><div class="big">${icon(md.type, 26)}<span>${label}</span></div></div>` : ''}
        ${md.status === 'running' ? `<div class="media-overlay"><div class="row"><span class="phase">${esc(md._phase || 'Avvio…')}</span><span class="pct"></span></div><div class="bar"><i></i></div></div>` : ''}`;
    }
    const showPrompt = md.status === 'engineering' || card.dataset.promptOpen === '1';
    card.innerHTML = `
      <div class="media-head">${md.sourceUrl ? `<img class="src-thumb" src="${esc(md.sourceUrl)}" alt="" title="Immagine di partenza">` : icon(md.type, 15)}<span class="name">${esc(md.workflowName || '')}</span><span class="sep">·</span><span class="meta">${esc(meta)}</span><span class="grow"></span><span class="st">${statusText(md)}</span></div>
      ${frame ? `<div class="media-frame" style="aspect-ratio:${md.width}/${md.height}">${frame}</div>` : ''}
      ${md.status === 'error' ? `<div class="media-error">${esc(md.error || 'Errore sconosciuto')}</div>` : ''}
      <div class="media-prompt" ${showPrompt ? '' : 'hidden'}><pre>${esc(md.prompt || md._draft || '')}</pre></div>
      ${mediaActions(md)}`;
  } else {
    $('.st', card).innerHTML = statusText(md);
  }
  if (md.status === 'engineering') $('.media-prompt pre', card).textContent = md._draft || md.prompt || '';
  if (md.status === 'running') patchProgress(card, md);
}

function mediaActions(md) {
  const b = (act, ic, label) => `<button type="button" data-media-act="${act}">${icon(ic, 15)}${label}</button>`;
  if (md.status === 'engineering') return '';
  if (md.status === 'queued' || md.status === 'running') return `<div class="media-actions"><span class="grow"></span>${b('cancel', 'x', 'Annulla')}</div>`;
  const ext = md.type === 'video' ? 'mp4' : 'png';
  return `<div class="media-actions">
    ${md.status === 'done' ? `<a href="${md.url}" download="localai-${md.id.slice(0, 8)}.${ext}">${icon('download', 15)}Scarica</a>` : ''}
    ${b('regenerate', 'refresh', md.status === 'done' ? 'Rigenera' : 'Riprova')}
    ${md.prompt ? b('prompt', 'text', 'Prompt') : ''}
    <span class="grow"></span>
    ${md.status === 'done' && md.type === 'image' ? b('zoom', 'open', '') : ''}
  </div>`;
}

function patchProgress(card, md) {
  const pv = $('.preview', card);
  if (pv && md._preview && pv.src !== md._preview) { pv.src = md._preview; pv.hidden = false; }
  const phase = $('.phase', card);
  if (phase) phase.textContent = md._phase || 'Avvio…';
  const pct = $('.pct', card), bar = $('.bar i', card);
  if (md._max > 1) {
    if (pct) pct.textContent = `${md._value}/${md._max}`;
    if (bar) bar.style.width = `${(md._value / md._max) * 100}%`;
  } else if (pct) pct.textContent = '';
}

function findMedia(mediaId) {
  for (const m of state.conv?.messages || []) {
    const md = (m.media || []).find((x) => x.id === mediaId);
    if (md) return [m, md];
  }
  return [];
}

async function mediaAction(btn) {
  const card = btn.closest('.media-card');
  const [msg, md] = findMedia(card.dataset.id);
  if (!md) return;
  const act = btn.dataset.mediaAct;
  const cid = state.conv.id;
  if (act === 'cancel') return api(`/api/conversations/${cid}/media/${md.id}/cancel`, { method: 'POST' });
  if (act === 'zoom') return openLightbox(md);
  if (act === 'regenerate') {
    return api(`/api/conversations/${cid}/messages/${msg.id}/media/${md.id}/regenerate`, { method: 'POST', body: {} })
      .catch((e) => alert(e.message));
  }
  if (act === 'prompt') {
    const box = $('.media-prompt', card);
    const open = box.hidden;
    box.hidden = !open;
    card.dataset.promptOpen = open ? '1' : '';
    if (open) {
      box.innerHTML = `<textarea spellcheck="false">${esc(md.prompt)}</textarea>
        <div class="row"><button type="button" class="btn" data-media-act="copy-prompt">Copia</button><button type="button" class="btn primary" data-media-act="run-edited">Genera con questo prompt</button></div>`;
    }
    return;
  }
  if (act === 'copy-prompt') return copyText($('textarea', card).value, btn);
  if (act === 'run-edited') {
    const prompt = $('textarea', card).value;
    card.dataset.promptOpen = '';
    $('.media-prompt', card).hidden = true;
    return api(`/api/conversations/${cid}/messages/${msg.id}/media/${md.id}/regenerate`, { method: 'POST', body: { prompt } })
      .catch((e) => alert(e.message));
  }
}

setInterval(() => {
  for (const e of $$('.elapsed')) e.textContent = fmtTime(Date.now() - Number(e.dataset.start));
}, 1000);

// ---------- Eventi dal server ----------
let es, esWasOpen = false;
function connectEvents() {
  if (es) es.close();
  es = new EventSource('/api/events');
  es.onopen = () => {
    if (esWasOpen && state.conv) openConv(state.conv.id, false); // risincronizza dopo una disconnessione
    esWasOpen = true;
  };
  es.onmessage = (e) => { try { onEvent(JSON.parse(e.data)); } catch (err) { console.error(err); } };
}

function onEvent(evt) {
  if (evt.type === 'gpu') return renderGpu(evt.state);
  if (evt.type === 'project') {
    if (state.view === 'projects' && (!state.project || state.project.id === evt.project.id)) refreshProject();
    return;
  }
  if (evt.type === 'title') {
    const c = state.convs.find((x) => x.id === evt.conversationId);
    if (c) { c.title = evt.title; renderConvList(); }
    if (state.conv?.id === evt.conversationId) { state.conv.title = evt.title; document.title = `${evt.title} · LocalAI`; }
    return;
  }
  if (evt.type === 'done') loadConvs();
  if (!state.conv || evt.conversationId !== state.conv.id) return;

  switch (evt.type) {
    case 'message': {
      const m = upsertMsg(evt.message);
      // risposta partita dal server (ripresa automatica in modalità Computer): il tasto diventa «Ferma»
      if (m.role === 'assistant' && m.status === 'pending' && state.conv) { state.conv.running = true; updateSend(); }
      renderMessage(m);
      scrollToBottom(m.role === 'user');
      break;
    }
    case 'status': {
      const m = findMsg(evt.messageId); if (!m) break;
      m.status = evt.status; m.waitReason = evt.reason;
      renderMessage(m);
      break;
    }
    case 'delta': {
      const m = findMsg(evt.messageId); if (!m) break;
      m.status = 'streaming';
      if (evt.content) m.content += evt.content;
      if (evt.thinking) m.thinking = (m.thinking || '') + evt.thinking;
      scheduleRender(m);
      break;
    }
    case 'step': {
      const m = findMsg(evt.messageId); if (!m) break;
      m.steps = m.steps || [];
      const i = m.steps.findIndex((x) => x.id === evt.step.id);
      if (i >= 0) m.steps[i] = evt.step; else m.steps.push(evt.step);
      m.status = 'streaming';
      scheduleRender(m);
      break;
    }
    case 'content': {
      const m = findMsg(evt.messageId); if (!m) break;
      m.content = evt.content;
      scheduleRender(m);
      break;
    }
    case 'media': {
      const m = findMsg(evt.messageId); if (!m) break;
      m.media = m.media || [];
      const i = m.media.findIndex((x) => x.id === evt.media.id);
      const prev = i >= 0 ? m.media[i] : null;
      const md = { ...(prev || {}), ...evt.media };
      if (md.status !== 'running') { delete md._preview; delete md._phase; delete md._value; delete md._max; }
      if (i >= 0) m.media[i] = md; else m.media.push(md);
      renderMessage(m);
      scrollToBottom(!prev);
      break;
    }
    case 'prompt_delta': {
      const [m, md] = findMedia(evt.mediaId); if (!md) break;
      md._draft = (md._draft || '') + evt.delta;
      renderMedia(m, md);
      scrollToBottom();
      break;
    }
    case 'progress': {
      const [m, md] = findMedia(evt.mediaId); if (!md) break;
      if (evt.phase) { md._phase = PHASES[evt.phase] || evt.phase; md._max = 0; }
      if (evt.max) { md._value = evt.value; md._max = evt.max; md._phase = md._phase === 'Codifica del prompt' || !md._phase ? 'Generazione' : md._phase; }
      const card = document.querySelector(`.media-card[data-id="${md.id}"]`);
      if (card) patchProgress(card, md);
      break;
    }
    case 'preview': {
      const [, md] = findMedia(evt.mediaId); if (!md) break;
      md._preview = evt.dataUrl;
      const card = document.querySelector(`.media-card[data-id="${md.id}"]`);
      if (card) patchProgress(card, md);
      break;
    }
    case 'done': {
      const m = findMsg(evt.messageId); if (!m) break;
      m.status = evt.status; m.error = evt.error; m.stats = evt.stats;
      state.conv.running = false;
      renderMessage(m);
      updateSend();
      break;
    }
  }
}

// ---------- GPU ----------
function renderGpu(s) {
  state.gpu = s;
  const pill = el.gpuPill;
  pill.classList.remove('ollama', 'comfy', 'busy');
  let label;
  if (s.active) {
    pill.classList.add('busy', s.active.who === 'comfy' ? 'comfy' : 'ollama');
    label = s.active.phase || (s.active.who === 'comfy' ? 'ComfyUI al lavoro' : 'Gemma al lavoro');
  } else if (s.owner === 'ollama') { pill.classList.add('ollama'); label = 'Gemma in VRAM'; }
  else if (s.owner === 'comfy') { pill.classList.add('comfy'); label = 'ComfyUI in VRAM'; }
  else label = 'GPU libera';
  if (s.queued?.length) label += ` · +${s.queued.length} in coda`;
  el.gpuLabel.textContent = label;
  if (!el.gpuMenu.hidden) renderGpuMenu();
}

function renderGpuMenu() {
  const s = state.gpu || {};
  const who = { ollama: 'Ollama (Gemma)', comfy: 'ComfyUI', none: '—' };
  el.gpuMenu.innerHTML = `
    <div class="menu-note"><b>VRAM condivisa</b><br>Ollama e ComfyUI si alternano sulla GPU: quando uno serve, l'altro viene scaricato.</div>
    <div class="menu-sep"></div>
    <div class="menu-note">In memoria: ${who[s.owner] || 'nessuno'}<br>
    ${s.active ? `In corso: ${esc(s.active.label)}${s.active.phase ? ` — ${esc(s.active.phase)}` : ''}<br>` : ''}
    ${s.queued?.length ? `In coda: ${s.queued.map(esc).join(', ')}` : ''}</div>
    <div class="menu-sep"></div>
    <button class="menu-item" id="btn-release">${icon('chip', 16)}<div>Libera la VRAM<small>Scarica tutti i modelli</small></div></button>`;
  $('#btn-release').onclick = async () => { el.gpuMenu.hidden = true; await api('/api/gpu/release', { method: 'POST' }).catch((e) => alert(e.message)); };
}
el.gpuPill.onclick = (e) => { e.stopPropagation(); el.modelMenu.hidden = true; el.gpuMenu.hidden = !el.gpuMenu.hidden; if (!el.gpuMenu.hidden) renderGpuMenu(); };

// ---------- Modello ----------
function currentModel() { return prefs.model || state.config?.defaultModel; }
function renderModel() {
  const name = currentModel() || '';
  const models = state.config?.models || [];
  const cur = models.find((m) => m.name === name);
  el.modelName.textContent = cur?.label || name.replace(/:latest$/, '');
  el.modelName.parentElement.title = name;
  el.modelMenu.innerHTML = models.length
    ? models.map((m) => `<button class="menu-item" data-model="${esc(m.name)}" title="${esc(m.name)}"><div>${esc(m.label || m.name)}<small>${esc([m.params, m.quant, m.thinking ? 'ragionamento' : '', m.vision ? 'vede le immagini' : ''].filter(Boolean).join(' · '))}</small></div>${m.name === name ? `<span class="check">${icon('check', 16)}</span>` : ''}</button>`).join('')
    : '<div class="menu-note">Nessun modello Ollama con supporto ai tool trovato.</div>';
}
$('#model-btn').onclick = (e) => { e.stopPropagation(); el.gpuMenu.hidden = true; el.modelMenu.hidden = !el.modelMenu.hidden; };
el.modelMenu.onclick = (e) => {
  const b = e.target.closest('[data-model]'); if (!b) return;
  prefs.model = b.dataset.model; savePrefs(); renderModel(); el.modelMenu.hidden = true;
};
document.addEventListener('click', (e) => {
  if (!e.target.closest('#model-menu')) el.modelMenu.hidden = true;
  if (!e.target.closest('#gpu-menu')) el.gpuMenu.hidden = true;
});

// ---------- Composer ----------
const coarse = matchMedia('(pointer: coarse)').matches;
function autosize() { el.input.style.height = 'auto'; el.input.style.height = `${Math.min(el.input.scrollHeight, 220)}px`; }
el.input.addEventListener('input', () => { autosize(); updateSend(); });
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !coarse && !e.isComposing) { e.preventDefault(); el.composer.requestSubmit(); }
});

function updateSend() {
  const running = !!state.conv?.running;
  const uploading = state.attachments.some((a) => !a.file);
  el.send.classList.toggle('stop', running);
  el.send.innerHTML = icon(running ? 'stop' : 'send', 18);
  el.send.title = running ? 'Interrompi' : 'Invia';
  el.send.disabled = !running && (uploading || (!el.input.value.trim() && !state.attachments.length));
}

// ---------- Allegati (immagini) ----------
state.attachments = [];
const MAX_ATT = 4, MAX_SIDE = 1600;
const attBox = $('#attachments');
const fileInput = $('#file-input'), cameraInput = $('#camera-input');

/** Ridimensiona nel browser (max 1600 px, JPEG) rispettando l'orientamento EXIF delle foto del telefono. */
async function prepareImage(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error(`Formato non supportato: ${file.name || 'immagine'}`); }
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.9));
  return { blob, width: w, height: h };
}

const docType = (f) => (/\.pdf$/i.test(f.name) || f.type === 'application/pdf' ? 'application/pdf'
  : /\.(md|markdown)$/i.test(f.name) ? 'text/markdown' : /\.txt$/i.test(f.name) || f.type === 'text/plain' ? 'text/plain' : null);

async function addFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name) || docType(f));
  for (const f of list) {
    if (state.attachments.length >= MAX_ATT) { alert(`Massimo ${MAX_ATT} allegati per messaggio`); break; }
    const dt = docType(f);
    const att = { key: Math.random().toString(36).slice(2), preview: dt ? null : URL.createObjectURL(f), kind: dt ? 'document' : 'image', name: f.name };
    state.attachments.push(att);
    renderAttachments();
    if (dt) {
      try {
        if (f.size > 60 * 1024 * 1024) throw new Error('Documento troppo grande (max 60 MB)');
        const res = await fetch('/api/uploads', { method: 'POST', headers: { 'Content-Type': dt, 'X-Filename': encodeURIComponent(f.name) }, body: f });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Caricamento non riuscito');
        if (data.scanned) alert(`«${f.name}» sembra una scansione senza testo selezionabile: non potrò leggerne il contenuto.`);
        Object.assign(att, data);
      } catch (err) {
        state.attachments = state.attachments.filter((a) => a !== att);
        alert(err.message);
      }
      renderAttachments();
      continue;
    }
    try {
      const { blob, width, height } = await prepareImage(f);
      const res = await fetch(`/api/uploads?w=${width}&h=${height}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Caricamento non riuscito');
      Object.assign(att, data);
    } catch (err) {
      state.attachments = state.attachments.filter((a) => a !== att);
      alert(err.message);
    }
    renderAttachments();
  }
}

function renderAttachments() {
  attBox.hidden = !state.attachments.length;
  attBox.innerHTML = state.attachments.map((a) => a.kind === 'document'
    ? `<div class="att att-doc ${a.file ? '' : 'loading'}" data-key="${a.key}">${icon('doc', 22)}<div class="att-doc-info"><b>${esc(a.name)}</b><small>${a.file ? `${a.pages} ${a.pages === 1 ? 'pagina' : 'pagine'}` : 'lettura…'}</small></div>${a.file ? '' : '<span class="spin"></span>'}
      <button type="button" class="att-x" data-remove="${a.key}" title="Rimuovi">${icon('close', 12)}</button></div>`
    : `<div class="att ${a.file ? '' : 'loading'}" data-key="${a.key}">
    <img src="${a.preview}" alt="">${a.file ? '' : '<span class="spin"></span>'}
    <button type="button" class="att-x" data-remove="${a.key}" title="Rimuovi">${icon('close', 12)}</button></div>`).join('');
  const hasDoc = state.attachments.some((a) => a.kind === 'document');
  const hasImg = state.attachments.some((a) => a.kind !== 'document');
  el.input.placeholder = hasDoc && !hasImg ? 'Chiedi di riassumerlo, analizzarlo o verificarlo sul web…'
    : hasImg ? 'Chiedi qualcosa sull\'immagine, o chiedi di modificarla o animarla…' : 'Scrivi un messaggio…';
  updateSend();
}
attBox.addEventListener('click', (e) => {
  const k = e.target.closest('[data-remove]')?.dataset.remove;
  if (!k) return;
  state.attachments = state.attachments.filter((a) => a.key !== k);
  renderAttachments();
});
$('#btn-attach').onclick = () => fileInput.click();
$('#btn-camera').onclick = () => cameraInput.click();
for (const inp of [fileInput, cameraInput]) inp.onchange = () => { addFiles(inp.files); inp.value = ''; };
el.input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/') || docType(f));
  if (files.length) { e.preventDefault(); addFiles(files); }
});
const dropZone = $('#view-chat');
dropZone.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.composer.classList.add('drag'); } });
dropZone.addEventListener('dragleave', (e) => { if (!dropZone.contains(e.relatedTarget)) el.composer.classList.remove('drag'); });
dropZone.addEventListener('drop', (e) => {
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  el.composer.classList.remove('drag');
  addFiles(e.dataTransfer.files);
});

function renderOpts() {
  $$('.chip[data-tool]').forEach((c) => c.classList.toggle('on', c.dataset.tool === state.tool));
  $('#chip-think').classList.toggle('on', state.think);
  $('#chip-computer').classList.toggle('on', state.computer);
  const wf = state.config?.workflows || [];
  const sel = (key, options, title) => `<label class="select-chip" title="${title}"><select data-pref="${key}">${options.map(([v, l]) => `<option value="${v}" ${String(prefs[key] ?? 'auto') === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
  let html = '';
  if (state.tool === 'image') {
    const imgs = wf.filter((w) => w.type === 'image' && w.mode === 'text2img' && w.available !== false);
    if (imgs.length > 1) html += sel('imageModel', [['auto', 'Modello auto'], ...imgs.map((w) => [w.id, w.name])], 'Modello immagine');
    html += sel('aspect', [['auto', 'Formato auto'], ['1:1', '1:1'], ['4:3', '4:3'], ['3:4', '3:4'], ['16:9', '16:9'], ['9:16', '9:16'], ['3:2', '3:2'], ['2:3', '2:3']], 'Formato');
  } else if (state.tool === 'video') {
    const v = wf.find((w) => w.type === 'video');
    const d = v?.duration || { min: 2, max: 10 };
    const durs = [['auto', 'Durata auto']];
    for (let s = d.min; s <= d.max; s++) durs.push([s, `${s} s`]);
    html += sel('vaspect', [['auto', 'Formato auto'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1']], 'Formato');
    html += sel('duration', durs, 'Durata');
  }
  el.opts.innerHTML = html;
}
el.opts.addEventListener('change', (e) => {
  const s = e.target.closest('select[data-pref]');
  if (s) { prefs[s.dataset.pref] = s.value; savePrefs(); }
});
$$('.chip[data-tool]').forEach((c) => {
  c.onclick = () => { state.tool = state.tool === c.dataset.tool ? null : c.dataset.tool; renderOpts(); el.input.focus(); };
});
$('#chip-computer').onclick = () => {
  state.computer = !state.computer;
  renderOpts();
  if (state.conv) api(`/api/conversations/${state.conv.id}`, { method: 'PATCH', body: { computer: state.computer } }).catch(() => {});
  el.input.placeholder = state.computer ? 'Cosa creo o faccio sul PC? (es. un gioco tipo Tetris, una pagina web, un documento Word…)' : 'Scrivi un messaggio…';
  el.input.focus();
};
$('#chip-think').onclick = () => { state.think = !state.think; prefs.think = state.think; savePrefs(); renderOpts(); };

el.composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.conv?.running) {
    return api(`/api/conversations/${state.conv.id}/stop`, { method: 'POST' }).catch(() => {});
  }
  const text = el.input.value.trim();
  if (!text && !state.attachments.length) return;
  if (state.attachments.some((a) => !a.file)) return;
  await sendMessage(text, state.tool);
});

async function sendMessage(text, tool) {
  const atts = state.attachments.filter((a) => a.file);
  el.input.value = ''; autosize();
  state.attachments = [];
  renderAttachments();
  try {
    if (!state.conv) {
      const c = await api('/api/conversations', { method: 'POST' });
      state.conv = c;
      el.welcome.hidden = true;
      el.thread.innerHTML = '';
      history.pushState(null, '', `/c/${c.id}`);
      state.convs.unshift({ id: c.id, title: c.title, updatedAt: c.updatedAt });
      renderConvList();
    }
    state.conv.running = true;
    updateSend();
    state.stick = true;
    const body = {
      text, tool, model: currentModel(), think: state.think, computer: state.computer,
      imageModel: prefs.imageModel || 'auto',
      aspect: tool === 'video' ? (prefs.vaspect || 'auto') : tool === 'image' ? (prefs.aspect || 'auto') : 'auto',
      duration: tool === 'video' ? (prefs.duration || 'auto') : 'auto',
      attachments: atts.map(({ kind, file, textFile, width, height }) => ({ kind, file, textFile, width, height })),
    };
    const out = await api(`/api/conversations/${state.conv.id}/messages`, { body });
    for (const m of [out.userMessage, out.message]) { renderMessage(upsertMsg(m)); }
    scrollToBottom(true);
  } catch (err) {
    if (state.conv) state.conv.running = false;
    el.input.value = text; autosize();
    state.attachments = atts;
    renderAttachments();
    alert(err.message);
  }
  updateSend();
}

// ---------- Benvenuto ----------
const SUGGESTIONS = [
  { ic: 'image', t: 'Crea un\'immagine', d: 'Un faro su una scogliera durante una tempesta, in stile pittura a olio', tool: 'image' },
  { ic: 'video', t: 'Genera un video', d: 'Un gatto che si stiracchia al sole su un davanzale, con le fusa', tool: 'video' },
  { ic: 'bulb', t: 'Spiegami', d: 'Come funzionano i modelli di diffusione, in parole semplici' },
  { ic: 'code', t: 'Scrivi codice', d: 'Uno script Python che rinomina le foto in base alla data EXIF' },
];
$('#suggestions').innerHTML = SUGGESTIONS.map((s, i) => `<button class="suggestion" data-i="${i}"><b>${icon(s.ic, 15)}${s.t}</b><span>${s.d}</span></button>`).join('');
$('#suggestions').onclick = (e) => {
  const b = e.target.closest('.suggestion'); if (!b) return;
  const s = SUGGESTIONS[b.dataset.i];
  sendMessage(s.d, s.tool || null);
};
function greet() {
  const h = new Date().getHours();
  $('#welcome-title').textContent = h < 6 ? 'Ancora sveglio? Come posso aiutarti?' : h < 13 ? 'Buongiorno, come posso aiutarti?' : h < 18 ? 'Buon pomeriggio, come posso aiutarti?' : 'Buonasera, come posso aiutarti?';
}

// ---------- Galleria ----------
async function openGallery(push = true) {
  showView('gallery');
  state.conv = null;
  renderConvList();
  if (push) history.pushState(null, '', '/galleria');
  document.title = 'Galleria · LocalAI';
  const items = await api('/api/media').catch(() => []);
  state.gallery = items;
  el.gallery.innerHTML = items.length
    ? items.map((m, i) => `<div class="tile" data-i="${i}">${m.type === 'video'
        ? `<video src="${m.url}#t=0.5" muted preload="metadata" playsinline></video><span class="badge">${icon('video', 12)}${m.seconds || ''}s</span>`
        : `<img src="${m.url}" loading="lazy" alt="">`}</div>`).join('')
    : '<div class="empty">Le immagini e i video che generi compariranno qui.</div>';
}
el.gallery.addEventListener('click', (e) => {
  const t = e.target.closest('.tile'); if (!t) return;
  openLightbox(state.gallery[t.dataset.i], true);
});
el.gallery.addEventListener('mouseover', (e) => { const v = e.target.closest('.tile video'); if (v) v.play().catch(() => {}); });
el.gallery.addEventListener('mouseout', (e) => { const v = e.target.closest('.tile video'); if (v) v.pause(); });

// ---------- Progetti: piano, coda di task e verifica automatica ----------
const when = (t) => new Date(t).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const TASK_STATUS = { queued: 'In coda', running: 'In corso', testing: 'Verifica', done: 'Fatto', failed: 'Non riuscito', error: 'Errore', cancelled: 'Fermato' };
const TYPE_ICON = { code: 'code', page: 'page', read: 'search', chat: 'text' };
const modelLabel = (name) => (state.config?.models || []).find((m) => m.name === name)?.label || String(name || '').replace(/:latest$/, '');

async function openProjects(push = true) {
  showView('projects');
  state.conv = null;
  state.project = null;
  renderConvList();
  if (push) history.pushState(null, '', '/progetti');
  document.title = 'Progetti · LocalAI';
  const list = await api('/api/projects').catch(() => []);
  el.projects.innerHTML = `<div class="pj-head"><h2>Progetti</h2></div>
    <p class="faint-note" style="margin:0">Ogni progetto ha la sua cartella sul PC, un piano e una coda di task che i modelli locali eseguono uno alla volta, con test e controllo delle pagine automatici. Le cartelle create in chat con <b>Computer</b> compaiono qui.</p>
    <div class="pj-new"><input id="pj-name" placeholder="Nome del nuovo progetto (es. Tetris, Sito ristorante)" maxlength="80"><button class="btn primary" id="pj-create">Crea progetto</button></div>
    ${list.length ? list.map((p) => `<button class="project pj-row" data-open="${esc(p.id)}">
      <h3>${icon('folder', 16)}${esc(p.name)}${p.active ? '<span class="pj-pill on">coda attiva</span>' : ''}</h3>
      <div class="faint-note" style="margin:0">${p.total ? `${p.done} di ${p.total} task fatti${p.queued ? ` · ${p.queued} in coda` : ''}${p.failed ? ` · ${p.failed} non riusciti` : ''}` : 'Nessun task'}${p.running ? ` · ora: ${esc(p.running)}` : ''} · ${when(p.updatedAt)}</div>
    </button>`).join('') : '<div class="empty">Ancora nessun progetto. Creane uno qui sopra, oppure in una chat attiva <b>Computer</b> e chiedi, per esempio, «crea un gioco tipo Tetris».</div>'}`;
  const create = async () => {
    const name = $('#pj-name').value.trim();
    if (!name) return $('#pj-name').focus();
    try { const p = await api('/api/projects', { body: { name } }); openProject(p.id); }
    catch (err) { alert(err.message); }
  };
  $('#pj-create').onclick = create;
  $('#pj-name').onkeydown = (e) => { if (e.key === 'Enter') create(); };
}

async function openProject(id, push = true) {
  showView('projects');
  state.conv = null;
  renderConvList();
  if (push) history.pushState(null, '', `/progetti/${encodeURIComponent(id)}`);
  let p;
  try { p = await api(`/api/projects/${encodeURIComponent(id)}`); }
  catch (err) { alert(err.message); return openProjects(); }
  state.project = p;
  document.title = `${p.name} · LocalAI`;
  renderProject();
}

/** Ricarica il progetto aperto quando il server segnala un cambiamento (senza perdere il piano che si sta scrivendo). */
let pjTimer = null;
function refreshProject() {
  clearTimeout(pjTimer);
  pjTimer = setTimeout(async () => {
    if (state.view !== 'projects') return;
    if (!state.project) return openProjects(false);
    try { state.project = await api(`/api/projects/${encodeURIComponent(state.project.id)}`); renderProject(); } catch {}
  }, 300);
}

function renderCheck(c) {
  const cls = c.ok === true ? 'ok' : c.ok === false ? 'ko' : 'na';
  const label = { test: 'Test', page: 'Pagina', vision: 'Screenshot' }[c.kind] || c.kind;
  return `<div class="pj-check ${cls}"><div><b>${label}</b> <span class="faint">tentativo ${c.attempt || 1}${c.model ? ` · ${esc(modelLabel(c.model))}` : ''}${c.command ? ` · <code>${esc(c.command)}</code>` : ''}</span></div>
    <div>${esc(c.summary || '')}</div>
    ${c.screenshotUrl ? `<a href="${esc(c.screenshotUrl)}" target="_blank" rel="noopener"><img class="pj-shot" src="${esc(c.screenshotUrl)}" alt="Screenshot" loading="lazy"></a>` : ''}
    ${c.output && c.kind !== 'vision' ? `<details><summary>Dettagli</summary><pre>${esc(c.output)}</pre></details>` : ''}</div>`;
}

function renderTask(t, i, p) {
  const busy = t.status === 'running' || t.status === 'testing';
  const open = state.openTasks?.has(t.id);
  const btn = (act, ic, title) => `<button data-task="${t.id}" data-act="${act}" title="${title}">${icon(ic, 14)}</button>`;
  return `<div class="pj-task ${t.status}" data-id="${t.id}">
    <div class="pj-task-head">
      <span class="pj-num">${i + 1}</span>
      <select data-task-type="${t.id}" ${busy ? 'disabled' : ''} title="Tipo: decide il modello">${Object.entries(p.types).map(([k, v]) => `<option value="${k}" ${k === t.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="pj-title" data-toggle="${t.id}">${esc(t.title)}</button>
      <span class="pj-status">${busy ? '<span class="spin"></span>' : ''}${TASK_STATUS[t.status] || t.status}${t.attempts > 1 || (t.attempts && t.status !== 'done') ? ` · ${t.attempts} tent.` : ''}</span>
      <span class="pj-acts">${busy ? btn('stop', 'stop', 'Ferma') : `${btn('up', 'chevron', 'Su')}${['done', 'queued'].includes(t.status) ? '' : btn('retry', 'refresh', 'Rimetti in coda')}${t.status === 'done' ? btn('retry', 'refresh', 'Rifai') : ''}${btn('delete', 'trash', 'Elimina')}`}</span>
    </div>
    ${open ? `<div class="pj-task-body">
      <div class="pj-text">${esc(t.text)}</div>
      <div class="faint">${t.model ? `Modello: ${esc(modelLabel(t.model))}` : `Modello previsto: ${esc(modelLabel(p.models[t.type]))}`}${t.conversationId ? ` · <a href="/c/${t.conversationId}" data-conv="${t.conversationId}">apri la chat del task</a>` : ''}${!busy && !['done'].includes(t.status) ? ` · <button class="linkish" data-task="${t.id}" data-act="skip">segna come fatto</button>` : ''}</div>
      ${t.error ? `<div class="step-err">${esc(t.error)}</div>` : ''}
      ${t.summary ? `<div class="pj-summary">${esc(t.summary)}</div>` : ''}
      ${(t.checks || []).map(renderCheck).join('')}
    </div>` : ''}
  </div>`;
}

function renderProject() {
  const p = state.project;
  if (!p) return;
  const keepPlan = $('#pj-plan');
  const draft = keepPlan && keepPlan.dataset.dirty === '1' ? keepPlan.value : null;
  const admin = state.user?.role === 'admin';
  const hasIndex = p.files.some((f) => f.path === 'index.html');
  const queued = p.tasks.filter((t) => t.status === 'queued').length;
  const files = p.files.filter((f) => !f.dir);
  el.projects.innerHTML = `
    <div class="pj-head">
      <button class="btn ghost" data-back>${icon('right', 14)}Progetti</button>
      <h2>${esc(p.name)}</h2>
      ${p.active ? '<span class="pj-pill on">coda attiva</span>' : ''}
      <span class="spacer"></span>
      ${hasIndex ? `<a class="btn" href="${esc(wsUrl(`${p.folder}/index.html`))}" target="_blank" rel="noopener">${icon('play', 14)}Apri</a>` : ''}
      ${p.active ? `<button class="btn" data-pj="pause">Pausa</button><button class="btn" data-pj="stop">Ferma ora</button>` : `<button class="btn primary" data-pj="start" ${queued ? '' : 'disabled'}>${icon('play', 14)}Avvia coda${queued ? ` (${queued})` : ''}</button>`}
      <button class="btn ghost" data-pj="delete" title="Elimina progetto e cartella">${icon('trash', 14)}</button>
    </div>
    <p class="faint-note">I task partono uno alla volta (anche a browser chiuso): codice e pagine a ${esc(modelLabel(p.models.code))}, lettura e analisi a ${esc(modelLabel(p.models.read))}, testi a ${esc(modelLabel(p.models.chat))}. Dopo ogni task LocalAI fa i test e, per le pagine, apre il browser e guarda lo screenshot; se qualcosa non va il modello corregge.</p>

    <section class="pj-card">
      <div class="pj-card-head"><h3>Piano</h3><span class="faint">${esc(p.folder)}/PIANO.md · ogni punto «- …» diventa un task; tipo forzabile con [codice], [pagina], [lettura], [testo]</span></div>
      <textarea id="pj-plan" rows="8" placeholder="Scrivi qui il piano, oppure solo l'obiettivo (es. «un clone di Tetris giocabile anche da telefono») e premi «Scrivi il piano con l'AI».&#10;&#10;Esempio di piano:&#10;# Obiettivo&#10;Un gioco tipo Tetris per browser&#10;&#10;- [pagina] index.html con griglia 10×20, pezzi, rotazione e punteggio&#10;- [codice] logica in game.js con test in tests/game.test.js&#10;- [testo] README con i comandi">${esc(draft ?? p.plan)}</textarea>
      <div class="pj-row-btns"><button class="btn" data-pj="draft-plan" title="Un modello locale scrive il piano partendo da quello che c'è nel riquadro (anche solo l'obiettivo)">Scrivi il piano con l'AI</button><button class="btn" data-pj="save-plan">Salva piano</button><button class="btn primary" data-pj="plan-tasks">Crea task dal piano</button></div>
    </section>

    <section class="pj-card">
      <div class="pj-card-head"><h3>Task</h3><span class="faint">${p.done} di ${p.total} fatti</span></div>
      ${p.tasks.length ? p.tasks.map((t, i) => renderTask(t, i, p)).join('') : '<div class="faint-note" style="margin:0">Nessun task: crealo dal piano o aggiungilo qui sotto.</div>'}
      <div class="pj-add">
        <textarea id="pj-task-text" rows="2" placeholder="Nuovo task, es. «Aggiungi i livelli di difficoltà al gioco»"></textarea>
        <select id="pj-task-type"><option value="">Tipo automatico</option>${Object.entries(p.types).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <button class="btn" data-pj="add-task">Aggiungi</button>
      </div>
    </section>

    <section class="pj-card">
      <div class="pj-card-head"><h3>Verifica</h3></div>
      <label class="pj-check-opt"><input type="checkbox" id="pj-autotest" ${p.autoTest ? 'checked' : ''}> Fai girare i test dopo i task di codice${admin ? '' : ' (solo amministratore)'}</label>
      ${admin ? `<div class="pj-add"><input id="pj-testcmd" placeholder="Comando di test (vuoto = automatico: npm test, node --test, pytest/unittest)" value="${esc(p.testCommand || '')}"><button class="btn" data-pj="save-test">Salva</button></div>` : ''}
      <div id="pj-vision" class="faint-note" style="margin:6px 0 0"></div>
    </section>

    <section class="pj-card">
      <div class="pj-card-head"><h3>File</h3><span class="faint">${files.length}</span></div>
      ${files.length ? files.map((f) => `<div class="project-file"><span class="name">${esc(f.path)}</span><span class="faint">${fmtSize(f.size)} · ${when(f.mtime)}</span>${wsLinks(`${p.folder}/${f.path}`)}</div>`).join('') : '<div class="faint-note" style="margin:0">Cartella vuota</div>'}
    </section>

    <section class="pj-card">
      <div class="pj-card-head"><h3>Cronologia</h3></div>
      <div class="pj-log">${p.log.slice().reverse().map((l) => `<div><span class="faint">${when(l.at)}</span> ${esc(l.text)}</div>`).join('') || '<div class="faint">—</div>'}</div>
    </section>`;
  const plan = $('#pj-plan');
  if (draft !== null) plan.dataset.dirty = '1';
  plan.oninput = () => { plan.dataset.dirty = '1'; };
  renderVision();
}

async function renderVision(force) {
  const box = $('#pj-vision');
  if (!box) return;
  const admin = state.user?.role === 'admin';
  let v = state.vision;
  if (!v || force) v = state.vision = await api('/api/vision').catch(() => ({}));
  const rows = (v.results || []).map((r) => `<li>${r.ok ? '✅' : '❌'} ${esc(r.label || r.model)}${r.declared === false ? ' — non dichiara la lettura di immagini' : r.error ? ` — ${esc(r.error)}` : ` — ha letto «${esc((r.answer || '').slice(0, 60))}»${r.ms ? ` in ${Math.round(r.ms / 1000)} s` : ''}`}</li>`).join('');
  box.innerHTML = `<b>Modello che giudica gli screenshot:</b> ${v.at ? (v.chosen ? esc(modelLabel(v.chosen === 'comfy:qwen3-vl' ? 'Qwen3-VL (ComfyUI)' : v.chosen)) : 'nessuno ha letto l\'immagine di prova') : 'non ancora verificato (si verifica al primo task di tipo pagina)'}
    ${v.at ? `<span class="faint"> · verifica del ${when(v.at)}, testo atteso «${esc(v.expected)}»</span><ul class="pj-vis">${rows}</ul>` : ''}
    ${admin ? `<button class="btn" data-pj="vision">${v.at ? 'Ripeti la verifica' : 'Verifica ora quali modelli leggono le immagini'}</button>` : ''}`;
}

el.projects.addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open]');
  if (open) return openProject(open.dataset.open);
  if (e.target.closest('[data-back]')) return openProjects();
  const conv = e.target.closest('[data-conv]');
  if (conv) { e.preventDefault(); return openConv(conv.dataset.conv); }
  const tog = e.target.closest('[data-toggle]');
  if (tog) {
    state.openTasks = state.openTasks || new Set();
    const id = tog.dataset.toggle;
    if (state.openTasks.has(id)) state.openTasks.delete(id); else state.openTasks.add(id);
    return renderProject();
  }
  const p = state.project;
  if (!p) return;
  const base = `/api/projects/${encodeURIComponent(p.id)}`;
  const run = async (fn) => { try { const out = await fn(); if (out?.tasks) { state.project = out; renderProject(); } } catch (err) { alert(err.message); } };
  const tb = e.target.closest('[data-task]');
  if (tb) {
    if (tb.dataset.act === 'delete' && !confirm('Eliminare questo task?')) return;
    return run(() => api(`${base}/tasks/${tb.dataset.task}`, { body: { action: tb.dataset.act } }));
  }
  const b = e.target.closest('[data-pj]');
  if (!b) return;
  switch (b.dataset.pj) {
    case 'start': return run(() => api(`${base}/start`, { method: 'POST' }));
    case 'pause': return run(() => api(`${base}/pause`, { method: 'POST' }));
    case 'stop': return run(() => api(`${base}/pause`, { body: { stop: true } }));
    case 'draft-plan': {
      const goal = $('#pj-plan').value.trim();
      if (!goal) { alert('Scrivi prima nel riquadro l\'obiettivo del progetto'); return $('#pj-plan').focus(); }
      if (/^\s*(?:[-*+]|\d+[.)])\s+/m.test(goal) && !confirm('Il riquadro contiene già un piano: riscriverlo da capo con l\'AI?')) return;
      b.disabled = true;
      b.textContent = 'Il modello sta scrivendo il piano…';
      const plan = $('#pj-plan');
      plan.dataset.dirty = '';
      await run(() => api(`${base}/plan/draft`, { body: { goal } }));
      b.disabled = false;
      b.textContent = 'Scrivi il piano con l\'AI';
      return;
    }
    case 'save-plan': case 'plan-tasks': {
      const plan = $('#pj-plan');
      await run(() => api(`${base}/plan`, { method: 'PUT', body: { text: plan.value } }));
      if (b.dataset.pj === 'plan-tasks') await run(() => api(`${base}/plan/tasks`, { method: 'POST' }));
      return;
    }
    case 'add-task': {
      const text = $('#pj-task-text').value.trim();
      if (!text) return $('#pj-task-text').focus();
      return run(() => api(`${base}/tasks`, { body: { text, type: $('#pj-task-type').value || undefined } }));
    }
    case 'save-test': return run(() => api(base, { method: 'PATCH', body: { testCommand: $('#pj-testcmd').value } }));
    case 'vision':
      b.disabled = true;
      b.textContent = 'Verifica in corso (carica ogni modello, qualche minuto)…';
      try { state.vision = await api('/api/vision/check', { method: 'POST' }); } catch (err) { alert(err.message); }
      return renderVision();
    case 'delete':
      if (!confirm(`Eliminare il progetto «${p.name}» e tutta la sua cartella?`)) return;
      try { await api(base, { method: 'DELETE' }); openProjects(); } catch (err) { alert(err.message); }
  }
});
el.projects.addEventListener('change', (e) => {
  const p = state.project;
  if (!p) return;
  const base = `/api/projects/${encodeURIComponent(p.id)}`;
  const sel = e.target.closest('[data-task-type]');
  if (sel) api(`${base}/tasks/${sel.dataset.taskType}`, { body: { action: 'type', type: sel.value } }).then((out) => { state.project = out; renderProject(); }).catch((err) => alert(err.message));
  if (e.target.id === 'pj-autotest') api(base, { method: 'PATCH', body: { autoTest: e.target.checked } }).catch((err) => alert(err.message));
});

// ---------- Lightbox ----------
function openLightbox(md, fromGallery = false) {
  if (!md?.url) return;
  const ext = md.type === 'video' ? 'mp4' : 'png';
  el.lbBody.innerHTML = `${md.type === 'video' ? `<video src="${md.url}" controls autoplay loop playsinline></video>` : `<img src="${md.url}" alt="">`}
    <div class="lb-info">
      <h3>${esc(md.workflowName || '')}</h3>
      <pre>${esc([md.aspect, md.width && `${md.width}×${md.height}`, md.seconds && `${md.seconds} s`, md.seed != null && `seed ${md.seed}`].filter(Boolean).join(' · '))}</pre>
      <h3>Prompt</h3><pre>${esc(md.prompt || '')}</pre>
      <a href="${md.url}" download="localai-${md.id.slice(0, 8)}.${ext}">${icon('download', 14)}Scarica</a>
      ${fromGallery && md.conversationId ? `<button data-goto="${md.conversationId}">${icon('open', 14)}Apri la chat</button>` : ''}
    </div>`;
  el.lightbox.hidden = false;
}
function closeLightbox() { el.lightbox.hidden = true; el.lbBody.innerHTML = ''; }
$('#lb-close').onclick = closeLightbox;
el.lightbox.onclick = (e) => {
  const g = e.target.closest('[data-goto]');
  if (g) { closeLightbox(); openConv(g.dataset.goto); return; }
  if (e.target === el.lightbox || e.target === el.lbBody) closeLightbox();
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.lightbox.hidden) closeLightbox(); });

// ---------- Stato servizi ----------
async function pollStatus() {
  try {
    const s = await api('/api/status');
    $('#svc-ollama').className = `svc ${s.ollama ? 'up' : 'down'}`;
    $('#svc-comfy').className = `svc ${s.comfy ? 'up' : 'down'}`;
    renderGpu(s.gpu);
  } catch {
    $('#svc-ollama').className = 'svc down';
    $('#svc-comfy').className = 'svc down';
  }
}

// ---------- Utente, accesso e amministrazione ----------
const authEl = $('#auth'), loginForm = $('#login-form'), pwForm = $('#password-form');
const showErr = (form, msg) => { const p = $('.auth-error', form); p.textContent = msg || ''; p.hidden = !msg; };

function showLogin() {
  if (es) { es.close(); es = null; }
  authEl.hidden = false; loginForm.hidden = false; pwForm.hidden = true;
  showErr(loginForm);
  loginForm.reset();
  setTimeout(() => loginForm.username.focus(), 50);
}

function showPasswordForm(forced) {
  authEl.hidden = false; loginForm.hidden = true; pwForm.hidden = false;
  pwForm.dataset.forced = forced ? '1' : '';
  pwForm.reset();
  showErr(pwForm);
  $('#pw-title').textContent = forced ? 'Scegli la tua password' : 'Cambia password';
  $('#pw-sub').textContent = forced
    ? `Ciao ${state.user?.displayName || ''}! Stai usando una password temporanea: inseriscila e scegline una personale.`
    : 'Inserisci la password attuale e quella nuova.';
  $('#pw-current-label').textContent = forced ? 'Password temporanea' : 'Password attuale';
  $('#pw-cancel').textContent = forced ? 'Esci' : 'Annulla';
  setTimeout(() => pwForm.current.focus(), 50);
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr(loginForm);
  try {
    const { user } = await api('/api/auth/login', { body: { username: loginForm.username.value, password: loginForm.password.value }, raw: true });
    state.user = user;
    if (user.mustChangePassword) return showPasswordForm(true);
    authEl.hidden = true;
    startApp();
  } catch (err) { showErr(loginForm, err.message); }
});

pwForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr(pwForm);
  if (pwForm.next.value !== pwForm.confirm.value) return showErr(pwForm, 'Le due password non coincidono');
  try {
    const { user } = await api('/api/auth/password', { body: { current: pwForm.current.value, next: pwForm.next.value }, raw: true });
    state.user = user;
    authEl.hidden = true;
    startApp();
  } catch (err) { showErr(pwForm, err.message); }
});

$('#pw-cancel').onclick = () => {
  if (pwForm.dataset.forced) return logout();
  authEl.hidden = true;
};

async function logout() {
  await api('/api/auth/logout', { method: 'POST', raw: true }).catch(() => {});
  location.href = '/';
}

function renderUserBox() {
  const u = state.user;
  document.body.classList.toggle('is-admin', u?.role === 'admin');
  $('#user-avatar').textContent = (u?.displayName || '?').slice(0, 1).toUpperCase();
  $('#user-name').innerHTML = `${esc(u?.displayName)}<small>${u?.role === 'admin' ? 'Amministratore' : 'Utente'}</small>`;
}

const userMenu = $('#user-menu');
$('#user-btn').onclick = (e) => { e.stopPropagation(); userMenu.hidden = !userMenu.hidden; };
document.addEventListener('click', (e) => { if (!e.target.closest('#user-menu')) userMenu.hidden = true; });
userMenu.onclick = (e) => {
  const act = e.target.closest('[data-user-act]')?.dataset.userAct;
  userMenu.hidden = true;
  if (act === 'password') showPasswordForm(false);
  if (act === 'users') openUsers();
  if (act === 'logout') logout();
};

// Gestione utenti (solo admin)
const usersModal = $('#users-modal'), addUserForm = $('#add-user-form');
async function openUsers() {
  usersModal.hidden = false;
  showErr(addUserForm);
  renderWorkflows(state.config?.workflows || []);
  await renderUsers();
}
const MODE_LABEL = { text2img: 'testo → immagine', img2img: 'rielaborazione', edit: 'editing', identity: 'volto di riferimento', scene: 'stessa persona, nuova scena', upscale: 'upscale', text2video: 'testo → video', img2video: 'immagine → video', vision: 'lettura immagini' };
function renderWorkflows(list) {
  $('#wf-list').innerHTML = list.map((w) => `<div class="wf-row ${w.available ? '' : 'off'}">
    <span class="wf-dot"></span><div><b>${esc(w.name)}</b> <small>${esc(MODE_LABEL[w.mode] || w.mode)}</small>
    ${w.available ? '' : `<div class="wf-missing">Modelli mancanti su ComfyUI: ${w.missing.map(esc).join(', ')}</div>`}</div></div>`).join('');
}
$('#btn-wf-reload').onclick = async (e) => {
  e.target.disabled = true;
  try {
    const list = await api('/api/workflows/reload', { method: 'POST' });
    state.config.workflows = list;
    renderWorkflows(list);
    renderOpts();
  } catch (err) { alert(err.message); }
  e.target.disabled = false;
};
async function renderUsers() {
  const list = await api('/api/users').catch((e) => { showErr(addUserForm, e.message); return []; });
  $('#user-list').innerHTML = list.map((u) => `<div class="user-row">
      <span class="user-avatar">${esc(u.displayName.slice(0, 1).toUpperCase())}</span>
      <div class="who">${esc(u.displayName)}${u.role === 'admin' ? '<span class="badge-role">admin</span>' : ''}${u.mustChangePassword ? '<span class="badge-temp">password temporanea</span>' : ''}
        <small>@${esc(u.username)}</small></div>
      <button class="btn" data-reset="${u.id}" data-name="${esc(u.displayName)}">Reimposta password</button>
    </div>`).join('');
}
$('#user-list').onclick = async (e) => {
  const b = e.target.closest('[data-reset]'); if (!b) return;
  const pw = prompt(`Nuova password temporanea per ${b.dataset.name} (vuoto = 1234).\nAl prossimo accesso dovrà sceglierne una personale.`, '');
  if (pw === null) return;
  try {
    await api(`/api/users/${b.dataset.reset}/reset-password`, { body: { password: pw.trim() || undefined } });
    if (b.dataset.reset === state.user.id) return location.reload();
    await renderUsers();
  } catch (err) { alert(err.message); }
};
addUserForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showErr(addUserForm);
  const f = addUserForm;
  try {
    await api('/api/users', { body: { displayName: f.displayName.value, username: f.username.value, password: f.password.value.trim() || undefined, role: f.role.value } });
    f.reset();
    await renderUsers();
  } catch (err) { showErr(addUserForm, err.message); }
});
usersModal.addEventListener('click', (e) => { if (e.target === usersModal || e.target.closest('[data-close]')) usersModal.hidden = true; });

// ---------- Avvio ----------
let started = false;
async function startApp() {
  renderUserBox();
  if (started) { connectEvents(); await loadConvs(); return route(); }
  started = true;
  greet();
  renderOpts();
  updateSend();
  connectEvents();
  pollStatus();
  setInterval(pollStatus, 20000);
  state.config = await api('/api/config').catch(() => ({ models: [], workflows: [] }));
  if (prefs.model && !state.config.models.some((m) => m.name === prefs.model)) delete prefs.model;
  renderModel();
  renderOpts();
  await loadConvs();
  route();
}

(async function boot() {
  try {
    const { user } = await api('/api/auth/me', { raw: true });
    state.user = user;
    if (user.mustChangePassword) return showPasswordForm(true);
    startApp();
  } catch {
    showLogin();
  }
})();

// Mobile: segui l'altezza reale visibile (tastiera inclusa), cosi il campo di testo resta sopra la tastiera
if (window.visualViewport) {
  const fit = () => {
    document.documentElement.style.setProperty('--app-h', window.visualViewport.height + 'px');
    if (window.visualViewport.offsetTop) window.scrollTo(0, 0);
  };
  window.visualViewport.addEventListener('resize', fit);
  window.visualViewport.addEventListener('scroll', fit);
  fit();
}

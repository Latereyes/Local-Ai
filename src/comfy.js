import { randomUUID } from 'node:crypto';
import config from './config.js';

const base = config.comfy.url.replace(/\/$/, '');
const wsUrl = base.replace(/^http/, 'ws');
const clientId = randomUUID();

let ws = null;
let wsReady = null;
let runningPromptId = null;
const listeners = new Map(); // prompt_id -> fn(event)
const backlog = new Map();   // eventi arrivati prima che il listener fosse registrato

function dispatch(promptId, evt) {
  const fn = listeners.get(promptId);
  if (fn) return fn(evt);
  if (!backlog.has(promptId)) backlog.set(promptId, []);
  backlog.get(promptId).push(evt);
}

function connect() {
  if (wsReady) return wsReady;
  wsReady = new Promise((resolve, reject) => {
    const sock = new WebSocket(`${wsUrl}/ws?clientId=${clientId}`);
    sock.binaryType = 'arraybuffer';
    const timer = setTimeout(() => { sock.close(); reject(new Error('ComfyUI WebSocket timeout')); }, 8000);
    sock.onopen = () => { clearTimeout(timer); ws = sock; resolve(sock); };
    sock.onerror = () => {};
    sock.onclose = () => {
      clearTimeout(timer);
      ws = null; wsReady = null;
      reject(new Error('ComfyUI WebSocket chiuso'));
    };
    sock.onmessage = (msg) => {
      if (typeof msg.data !== 'string') return onBinary(msg.data);
      let m; try { m = JSON.parse(msg.data); } catch { return; }
      const d = m.data || {};
      if (m.type === 'executing' && d.prompt_id) runningPromptId = d.node === null ? null : d.prompt_id;
      if (m.type === 'execution_start') runningPromptId = d.prompt_id;
      if (d.prompt_id) dispatch(d.prompt_id, { type: m.type, data: d });
    };
  });
  wsReady.catch(() => {});
  return wsReady;
}

// Anteprime live (latent preview) inviate come frame binari
function onBinary(buf) {
  const view = new DataView(buf);
  const kind = view.getUint32(0);
  let promptId = runningPromptId, offset = 4, mime = 'image/jpeg';
  if (kind === 1) {
    mime = view.getUint32(4) === 2 ? 'image/png' : 'image/jpeg';
    offset = 8;
  } else if (kind === 4) {
    const metaLen = view.getUint32(4);
    try {
      const meta = JSON.parse(Buffer.from(buf, 8, metaLen).toString('utf8'));
      promptId = meta.prompt_id || promptId;
      mime = meta.image_type || mime;
    } catch {}
    offset = 8 + metaLen;
  } else return;
  if (!promptId) return;
  const b64 = Buffer.from(buf, offset).toString('base64');
  dispatch(promptId, { type: 'preview', data: { dataUrl: `data:${mime};base64,${b64}` } });
}

async function api(path, opts = {}) {
  const res = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    signal: opts.signal || AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`ComfyUI ${path} → ${res.status}`);
    err.body = text;
    throw err;
  }
  const type = res.headers.get('content-type') || '';
  return type.includes('json') ? res.json() : res;
}

export async function systemStats() {
  return api('/system_stats', { signal: AbortSignal.timeout(4000) });
}

export async function isUp() {
  try { await systemStats(); return true; } catch { return false; }
}

/** Libera la VRAM e attende che sia effettivamente rilasciata. */
export async function freeVram({ timeoutMs = 12000 } = {}) {
  await api('/free', { method: 'POST', body: JSON.stringify({ unload_models: true, free_memory: true }) });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 600));
    try {
      const dev = (await systemStats()).devices?.[0];
      if (dev && dev.vram_free / dev.vram_total > 0.8) return true;
    } catch {}
  }
  return false;
}

export async function interrupt(promptId) {
  await api('/queue', { method: 'POST', body: JSON.stringify({ delete: [promptId] }) }).catch(() => {});
  await api('/interrupt', { method: 'POST', body: JSON.stringify({ prompt_id: promptId }) }).catch(() => {});
}

/** Scarica un file di output da ComfyUI. */
export async function fetchFile({ filename, subfolder = '', type = 'output' }) {
  const q = new URLSearchParams({ filename, subfolder, type });
  const res = await fetch(`${base}/view?${q}`, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Download ${filename} fallito (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function formatNodeErrors(body) {
  try {
    const j = JSON.parse(body);
    const parts = [j.error?.message, j.error?.details].filter(Boolean);
    for (const [id, ne] of Object.entries(j.node_errors || {})) {
      for (const e of ne.errors || []) parts.push(`nodo ${id} (${ne.class_type}): ${e.message} ${e.details || ''}`.trim());
    }
    return parts.join(' — ');
  } catch { return body; }
}

/**
 * Esegue un grafo (formato API) e restituisce i file di output.
 * onEvent riceve: {type:'progress', value, max, node} | {type:'node', node} | {type:'preview', dataUrl} | {type:'queued', promptId}
 */
export async function run(graph, { onEvent = () => {}, signal } = {}) {
  await connect();
  let queued;
  try {
    queued = await api('/prompt', { method: 'POST', body: JSON.stringify({ prompt: graph, client_id: clientId }) });
  } catch (e) {
    throw new Error(e.body ? formatNodeErrors(e.body) : e.message);
  }
  const promptId = queued.prompt_id;
  onEvent({ type: 'queued', promptId });

  let cleanup;
  const done = new Promise((resolve, reject) => {
    const handle = ({ type, data }) => {
      if (type === 'progress') onEvent({ type: 'progress', value: data.value, max: data.max, node: data.node });
      else if (type === 'executing' && data.node) onEvent({ type: 'node', node: data.node, title: graph[data.node]?._meta?.title || graph[data.node]?.class_type });
      else if (type === 'preview') onEvent({ type: 'preview', dataUrl: data.dataUrl });
      else if (type === 'execution_success' || (type === 'executing' && data.node === null)) resolve();
      else if (type === 'execution_error') reject(new Error(`${data.node_type || ''}: ${data.exception_message || 'errore di esecuzione'}`.trim()));
      else if (type === 'execution_interrupted') reject(Object.assign(new Error('Generazione annullata'), { aborted: true }));
    };
    listeners.set(promptId, handle);
    for (const evt of backlog.get(promptId) || []) handle(evt);
    backlog.delete(promptId);

    // Rete di sicurezza: se il WebSocket cade, controlla la history periodicamente
    const poll = setInterval(async () => {
      if (ws) return;
      try {
        const h = await api(`/history/${promptId}`);
        const st = h[promptId]?.status;
        if (st?.completed) resolve();
        else if (st?.status_str === 'error') reject(new Error('Errore durante la generazione'));
      } catch {}
      connect().catch(() => {});
    }, 3000);
    cleanup = () => { clearInterval(poll); listeners.delete(promptId); };
    signal?.addEventListener('abort', () => interrupt(promptId), { once: true });
  });
  try {
    await done;
  } finally {
    cleanup?.();
  }

  const hist = await api(`/history/${promptId}`);
  const outputs = hist[promptId]?.outputs || {};
  const files = [];
  const texts = [];
  for (const out of Object.values(outputs)) {
    for (const key of ['images', 'gifs', 'videos', 'video']) {
      for (const f of out[key] || []) if (f?.filename && f.type === 'output') files.push(f);
    }
    for (const t of out.text || []) if (typeof t === 'string') texts.push(t);
  }
  return { promptId, files, texts };
}

/** File presenti in una cartella modelli di ComfyUI (es. 'diffusion_models'). */
export async function listModels(folder) {
  return api(`/models/${encodeURIComponent(folder)}`, { signal: AbortSignal.timeout(8000) });
}

/** Carica un'immagine nella cartella input di ComfyUI (sovrascrive se esiste). */
export async function uploadImage(buffer, filename) {
  const type = /\.png$/i.test(filename) ? 'image/png' : /\.webp$/i.test(filename) ? 'image/webp' : 'image/jpeg';
  const fd = new FormData();
  fd.append('image', new Blob([buffer], { type }), filename);
  fd.append('overwrite', 'true');
  const res = await fetch(`${base}/upload/image`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Upload su ComfyUI fallito (${res.status})`);
  const j = await res.json();
  return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
}

export { connect };

import config from './config.js';

const base = config.ollama.url.replace(/\/$/, '');

async function api(path, body, { timeout = 15000 } = {}) {
  const res = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`Ollama ${path} → ${res.status} ${await res.text().catch(() => '')}`);
  return res.json();
}

export async function isUp() {
  try { await api('/api/version', null, { timeout: 4000 }); return true; } catch { return false; }
}

const healthy = new Map(); // digest -> bool (file del modello leggibile)
const shown = new Map();   // nome modello -> /api/show (capacità, parametri del Modelfile…)

async function show(model) {
  if (!shown.has(model)) {
    try { shown.set(model, await api('/api/show', { model })); }
    catch { return {}; }
  }
  return shown.get(model);
}

/** Capacità dichiarate dal modello (es. 'vision' se può ricevere immagini). */
export async function capabilities(model) {
  return (await show(model || config.ollama.model)).capabilities || [];
}

/**
 * Contesto (token) da usare con il modello: quello del suo Modelfile se lo fissa
 * (es. Qwen Coder a 40k, misurato perché stia tutto nei 16 GB), altrimenti OLLAMA_CTX.
 */
export async function contextSize(model) {
  const m = /^num_ctx\s+(\d+)/m.exec((await show(model || config.ollama.model)).parameters || '');
  return m ? Number(m[1]) : config.ollama.numCtx;
}

async function isHealthy(m) {
  if (!healthy.has(m.digest)) {
    healthy.set(m.digest, await api('/api/show', { model: m.name }).then(() => true, () => false));
  }
  return healthy.get(m.digest);
}

/** Nome breve da mostrare: quello in config.ollama.labels, altrimenti la famiglia del modello (es. "gemma4" → "Gemma4"). */
export function displayName(m) {
  const label = config.ollama.labels[m.name.replace(/:latest$/, '')];
  if (label) return label;
  const fam = m.details?.family || m.name.split(/[:_-]/)[0];
  return fam.charAt(0).toUpperCase() + fam.slice(1);
}

/** Modelli installati e funzionanti, con le loro capacità (i tool servono per immagini/video). */
export async function listModels() {
  const { models: all = [] } = await api('/api/tags');
  const ok = await Promise.all(all.map(isHealthy));
  const models = all.filter((_, i) => ok[i]);
  return models.map((m) => ({
    name: m.name,
    label: displayName(m),
    size: m.size,
    params: m.details?.parameter_size,
    quant: m.details?.quantization_level,
    tools: (m.capabilities || []).includes('tools'),
    thinking: (m.capabilities || []).includes('thinking'),
    vision: (m.capabilities || []).includes('vision'),
  }));
}

export async function loaded() {
  const { models = [] } = await api('/api/ps');
  return models;
}

/** Scarica tutti i modelli dalla VRAM e attende che siano davvero usciti. */
export async function unloadAll({ timeoutMs = 15000 } = {}) {
  let models = await loaded();
  for (const m of models) await api('/api/generate', { model: m.name, keep_alive: 0 }).catch(() => {});
  const t0 = Date.now();
  while (models.length && Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 400));
    models = await loaded().catch(() => []);
  }
  return models.length === 0;
}

/**
 * Chat in streaming. onChunk riceve {content, thinking, tool_calls, done, ...stats}
 * Restituisce il messaggio completo.
 */
export async function chat({ model, messages, tools, think = false, options = {}, signal, onChunk = () => {} }) {
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: model || config.ollama.model,
      messages,
      tools: tools?.length ? tools : undefined,
      think,
      stream: true,
      keep_alive: config.ollama.keepAlive,
      options: { num_ctx: await contextSize(model), ...options },
    }),
  });
  if (!res.ok) throw new Error(`Ollama: ${(await res.text().catch(() => '')) || res.status}`);

  const out = { content: '', thinking: '', tool_calls: [], stats: null };
  const decoder = new TextDecoder();
  let buf = '';
  for await (const part of res.body) {
    buf += decoder.decode(part, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.error) throw new Error(`Ollama: ${j.error}`);
      const msg = j.message || {};
      if (msg.thinking) { out.thinking += msg.thinking; onChunk({ thinking: msg.thinking }); }
      if (msg.content) { out.content += msg.content; onChunk({ content: msg.content }); }
      if (msg.tool_calls?.length) { out.tool_calls.push(...msg.tool_calls); onChunk({ tool_calls: msg.tool_calls }); }
      if (j.done) {
        out.doneReason = j.done_reason;
        out.stats = { evalCount: j.eval_count, evalMs: j.eval_duration / 1e6, loadMs: j.load_duration / 1e6, promptCount: j.prompt_eval_count };
      }
    }
  }
  return out;
}

/** Richiesta breve non in streaming (titoli, ecc.). */
export async function complete({ model, messages, options = {}, format, timeout = 60000 }) {
  const j = await api('/api/chat', {
    model: model || config.ollama.model,
    messages,
    format,
    stream: false,
    think: false,
    keep_alive: config.ollama.keepAlive,
    options: { num_ctx: await contextSize(model), ...options },
  }, { timeout });
  return j.message?.content || '';
}

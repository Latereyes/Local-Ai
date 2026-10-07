import config from './config.js';

/**
 * Client dell'arbitro della GPU nell'agent del PC (remote-app-controller, porta 7070).
 * ChatBz e LocalAI chiedono lì il permesso di usare la GPU, così le loro richieste non si accavallano:
 * l'agent ne fa lavorare una alla volta e scarica Ollama o ComfyUI quando serve l'altro.
 * Se l'agent non risponde, le funzioni restituiscono null/false e l'app usa il suo arbitro interno come prima.
 */
const RETRY_MS = 30000;   // dopo un errore non si riprova l'agent per un po', per non rallentare ogni lavoro
let downUntil = 0;
let warned = false;

const enabled = () => config.agent.enabled && Date.now() >= downUntil;

function markDown(e) {
  downUntil = Date.now() + RETRY_MS;
  if (!warned) console.warn(`[gpu] agent del PC non raggiungibile (${e.message}): uso l'arbitro interno`);
  warned = true;
}

async function call(path, { method = 'POST', body, timeoutMs = 30000 } = {}) {
  const res = await fetch(config.agent.url + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(config.agent.token ? { Authorization: `Bearer ${config.agent.token}` } : {}) },
    body: method === 'POST' ? JSON.stringify(body || {}) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `agent ${path} → ${res.status}`), { status: res.status });
  return data;
}

/**
 * Attende il proprio turno sulla GPU. Restituisce { release() } quando tocca a noi,
 * oppure null se l'agent non c'è. onWait(stato) viene chiamato a ogni giro di attesa
 * con { position, active: { app, label } } (chi sta usando la GPU in questo momento).
 */
export async function acquire({ who, label, priority = 'high', onWait } = {}) {
  if (!enabled()) return null;
  let r;
  try {
    // La prima risposta arriva subito: se tocca aspettare, la UI dice chi sta usando la GPU
    r = await call('/api/gpu/acquire', { body: { who, label, priority, app: config.agent.app, waitMs: 500 } });
    while (r.status !== 'granted') {
      onWait?.(r);
      r = await call('/api/gpu/acquire', { body: { ticket: r.ticket } });
    }
  } catch (e) {
    if (r?.ticket) call(`/api/gpu/leases/${r.ticket}/release`, { timeoutMs: 3000 }).catch(() => {});
    markDown(e);
    return null;
  }
  warned = false;
  const id = r.lease;
  // Il permesso scade se non viene rinnovato (così un'app bloccata non tiene la GPU per sempre)
  const timer = setInterval(() => call(`/api/gpu/leases/${id}/renew`, { timeoutMs: 5000 })
    .catch((e) => console.warn(`[gpu] rinnovo del permesso: ${e.message}`)), 15000);
  timer.unref?.();
  return {
    owner: r.owner,
    release() {
      clearInterval(timer);
      return call(`/api/gpu/leases/${id}/release`, { timeoutMs: 5000 }).catch(() => {});
    },
  };
}

/** Libera la VRAM tramite l'agent (al proprio turno). false se l'agent non c'è. */
export async function free() {
  if (!enabled()) return false;
  try {
    await call('/api/gpu/free', { timeoutMs: 120000 });
    return true;
  } catch (e) {
    markDown(e);
    return false;
  }
}

/** Un'altra app sta usando la GPU o la sta aspettando (i lavori in sottofondo le lasciano il passo). */
export async function busyElsewhere() {
  if (!enabled()) return false;
  try {
    const s = await call('/api/gpu', { method: 'GET', timeoutMs: 3000 });
    return [s.active, ...(s.queue || [])].some((t) => t && t.app !== config.agent.app);
  } catch (e) {
    markDown(e);
    return false;
  }
}

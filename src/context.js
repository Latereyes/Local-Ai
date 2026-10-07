/**
 * Budget della finestra di contesto.
 *
 * Ollama non espone il tokenizer: i token si stimano dai caratteri (~3 per token tra italiano, inglese,
 * codice e pagine web, una stima prudente). A fine risposta Ollama riporta i token reali del prompt
 * (prompt_eval_count): se sono più della stima, il fattore di correzione del modello sale.
 * La correzione può solo rendere la stima più prudente, mai meno.
 */

const CHARS_PER_TOKEN = 3;
const IMAGE_TOKENS = 768;   // la stessa stima che usa Ollama per un'immagine
const MSG_OVERHEAD = 8;     // ruolo e separatori del template, per messaggio
const factor = new Map();   // modello -> moltiplicatore della stima (≥ 1)

const f = (model) => factor.get(model) || 1;

export const estimate = (text, model) => Math.ceil(String(text || '').length / CHARS_PER_TOKEN * f(model));

/** Caratteri che stanno in un certo numero di token. */
export const charsFor = (tokens, model) => Math.max(0, Math.floor(tokens * CHARS_PER_TOKEN / f(model)));

export function messageTokens(m, model) {
  let n = MSG_OVERHEAD + estimate(m.content, model);
  if (m.tool_calls?.length) n += estimate(JSON.stringify(m.tool_calls), model);
  if (m.images?.length) n += IMAGE_TOKENS * m.images.length;
  return n;
}

export const toolsTokens = (tools, model) => (tools?.length ? estimate(JSON.stringify(tools), model) : 0);

export const promptTokens = (messages, tools, model) =>
  messages.reduce((n, m) => n + messageTokens(m, model), toolsTokens(tools, model));

/** Corregge la stima del modello con i token reali del prompt riportati da Ollama. */
export function calibrate(model, estimated, actual) {
  if (!estimated || !actual || actual <= estimated) return;
  factor.set(model, Math.min(1.8, f(model) * actual / estimated));
}

/** Token da lasciare liberi per la risposta (e per il ragionamento, se è attivo). */
export const outputReserve = (numCtx, think) =>
  Math.round(Math.max(think ? 4096 : 2048, numCtx * (think ? 0.3 : 0.15)));

/** Errori di Ollama dovuti a un prompt più lungo della finestra di contesto. */
export const isContextError = (e) => /context|exceed|too long|truncat/i.test(e?.message || '');

/** Accorcia un testo tenendone l'inizio. */
export function shorten(text, maxChars, note = '[…accorciato per stare nella finestra di contesto…]') {
  text = String(text || '');
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - note.length - 1))}\n${note}`;
}

/**
 * Fa stare la conversazione (in place) nel budget di token, in quest'ordine:
 *   1. accorcia le pagine lette nei passaggi precedenti di questo turno
 *   2. toglie i turni più vecchi, tenendo gli ultimi due scambi
 *   3. accorcia tutti i risultati web
 *   4. toglie il resto della cronologia
 *   5. accorcia ancora i risultati web e, se non basta, il centro dell'ultimo messaggio (es. un documento enorme)
 * Il prompt di sistema e l'ultima domanda dell'utente restano sempre. Restituisce i token stimati.
 */
export function fit(convo, tools, budget, model) {
  const total = () => promptTokens(convo, tools, model);
  let used = total();
  if (used <= budget) return used;

  const lastUser = () => convo.findLastIndex((m) => m.role === 'user');
  // risultati web di questo turno (dopo l'ultima domanda), dal più vecchio
  const toolMsgs = () => convo.slice(lastUser() + 1).filter((m) => m.role === 'tool');
  const shrinkTools = (maxChars, msgs = toolMsgs()) => {
    for (const m of msgs) {
      if (used <= budget) return;
      if (m.content.length <= maxChars) continue;
      m.content = shorten(m.content, maxChars);
      used = total();
    }
  };
  const dropHistory = (keep) => {
    // un turno = messaggio utente + risposte/strumenti che lo seguono
    while (used > budget) {
      const starts = convo.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i > 0);
      if (starts.length <= keep + 1) return;
      convo.splice(starts[0], starts[1] - starts[0]);
      used = total();
    }
  };

  // 1. le pagine dei passaggi precedenti (l'ultimo passaggio è quello appena letto)
  const lastCall = convo.findLastIndex((m) => m.role === 'assistant' && m.tool_calls?.length);
  shrinkTools(2500, convo.slice(lastUser() + 1, Math.max(lastUser() + 1, lastCall)).filter((m) => m.role === 'tool'));
  if (used <= budget) return used;
  dropHistory(2);
  shrinkTools(1500);
  dropHistory(0);
  shrinkTools(600);
  if (used <= budget) return used;

  // ultima risorsa: il centro dell'ultimo messaggio utente (documenti o testo incollato molto lunghi)
  const u = convo[lastUser()];
  const excess = charsFor(used - budget, model) + 200;
  if (u && u.content.length > excess + 2000) {
    const keep = u.content.length - excess;
    const head = Math.floor(keep * 0.6);
    u.content = `${u.content.slice(0, head)}\n[…parte centrale omessa per stare nella finestra di contesto…]\n${u.content.slice(u.content.length - (keep - head))}`;
    used = total();
  }
  return used;
}

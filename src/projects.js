import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import config from './config.js';
import * as ollama from './ollama.js';
import * as workspace from './workspace.js';
import * as snapshots from './snapshots.js';

/**
 * Progetti: ogni progetto è una cartella della cartella di lavoro dell'utente (workspace/<utente>/<cartella>),
 * con un piano (PIANO.md nella cartella) e una coda di task eseguiti dai modelli locali uno alla volta.
 * I dati (task, esiti, cronologia) stanno in data/projects/<utente>/<cartella>.json.
 * Ogni task gira in una propria chat (così la cronologia resta consultabile e il contesto resta piccolo).
 */

export const bus = new EventEmitter();
bus.setMaxListeners(100);

export const PLAN_FILE = 'PIANO.md';
export const TYPES = {
  code: 'Codice',
  page: 'Pagina o gioco',
  read: 'Lettura e analisi',
  chat: 'Testo',
};
const TAGS = {
  codice: 'code', code: 'code', test: 'code', script: 'code',
  pagina: 'page', page: 'page', gioco: 'page', game: 'page', sito: 'page', web: 'page',
  lettura: 'read', read: 'read', analisi: 'read', riassunto: 'read', log: 'read', json: 'read',
  chat: 'chat', testo: 'chat', text: 'chat',
};

const cache = new Map(); // `${ownerId}/${folder}` -> progetto
const dirFor = (ownerId) => path.join(config.paths.projects, ownerId.replace(/[^\w-]/g, ''));
const fileFor = (ownerId, id) => path.join(dirFor(ownerId), `${encodeURIComponent(id)}.json`);

export class ProjectError extends Error { status = 400; }

/** Tipo del task dal testo: tag esplicito [codice] / [pagina] / [lettura] / [testo], altrimenti parole chiave. */
export function classify(text) {
  const t = String(text || '').toLowerCase();
  const tag = /^\s*\[([a-zà-ù]+)\]/.exec(t);
  if (tag && TAGS[tag[1]]) return TAGS[tag[1]];
  // chi comincia con un verbo di lettura è un'analisi anche se parla di codice («analizza il log di app.js»)
  if (/^\s*(riassumi|riassunto|analizza|estrai|leggi|classifica|elenca|confronta|sintetizza|trova nei log)\b/.test(t)) return 'read';
  // testi da scrivere (capitoli, articoli, racconti) in file .md/.txt: niente codice né test anche se nominano «funzioni»
  // o la verifica (libro mindfulness 2026-10-12: «Scrivi i capitoli 3 e 4…» era finito a Qwen Coder con i test del PDF)
  if (/^\s*(scrivi|riscrivi|completa|allunga|amplia|traduci|write|rewrite|translate)\b/.test(t)
    && /\b(capitol[oi]|chapters?|libro|book|articol[oi]|racconto|storia|testo|testi|introduzione|prefazione|conclusione|epilogo|poesi[ae])\b/.test(t)
    && !/\.(py|js|mjs|ts|html?|css|ps1|bat)\b|\b(script|codice|python|javascript|programma|pdf|html)\b/.test(t)) return 'chat';
  if (/\b(pagin[ae]|html|sito|gioc[ho]i?|videogioco|game|canvas|css|landing|interfaccia web)\b/.test(t)) return 'page';
  if (/\b(codice|script|funzion[ei]|test|python|javascript|typescript|node|programma|implementa|bug|refactor|classe|modulo|libreria|api|cli)\b|\.(py|js|ts|ps1|bat)\b/.test(t)) return 'code';
  if (/\b(riassum|riassunt|sintesi|analizz|log|estra[ei]|json|classific|elenc|confront|report|document[oi])/.test(t)) return 'read';
  return 'chat';
}

// ---------------- Verifica dei task di testo ----------------
// Libro mindfulness (2026-10-12): i task di testo non avevano nessuna verifica. Il piano chiedeva capitoli di almeno
// 10 pagine, i modelli ne scrivevano 3-4 (1000-2500 parole) e il task risultava fatto. Ora la lunghezza chiesta nel
// task («almeno 3000 parole», «almeno 10 pagine») si controlla sui file di testo scritti dal task.
export const WORDS_PER_PAGE = 250;
const NUM = (s) => Number(String(s).replace(/[.,'’\s]/g, ''));

/** Parole minime chieste dal task («almeno 3000 parole», «at least 12 pages»), 0 se non c'è una lunghezza. */
export function wordTarget(text) {
  let best = 0;
  const re = /\b(?:almeno|minimo|non meno di|at least|minimum(?: of)?)\s+(\d{1,3}(?:[.,'’ ]\d{3})+|\d+)\s*(parole|words|pagine|pages)\b/gi;
  for (const m of String(text || '').matchAll(re)) {
    const n = NUM(m[1]) * (/^pag/i.test(m[2]) ? WORDS_PER_PAGE : 1);
    if (n > best) best = n;
  }
  return best;
}

/** File di testo nominati nel task (cap_03.md, testi/intro.txt). */
export function textFiles(text) {
  return [...new Set((String(text || '').match(/[\w./-]*\w\.(?:md|markdown|txt)\b/gi) || []).map((f) => f.replace(/^\.\//, '')))];
}

export const countWords = (s) => (String(s || '').match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

/**
 * Controllo dei file di testo di un task. written: file di testo scritti dal task; read(path) → contenuto o null.
 * Restituisce { checks: [{ file, words, ok }], problems: [testo per il modello] }.
 */
export function textCheck(taskText, written, read) {
  const target = wordTarget(taskText);
  const notPlan = (f) => f.toUpperCase() !== PLAN_FILE.toUpperCase();
  const mentioned = textFiles(taskText).filter(notPlan);
  // un solo file nominato è il file del task: si controlla sempre, anche se l'ha scritto qualcun altro (il coordinatore
  // dalla chat del progetto: libro mindfulness, capitolo 3 di 1374 parole su 2000 risultato fatto). Con più file
  // nominati quelli già presenti possono essere letture (struttura_libro.md) e contano solo se il task li scrive.
  const own = mentioned.length === 1 ? mentioned : mentioned.filter((f) => read(f) == null);
  const files = [...new Set([...written.filter(notPlan), ...own])];
  const checks = [];
  const problems = [];
  for (const file of files) {
    const content = read(file);
    if (content == null) {
      checks.push({ file, words: 0, ok: false });
      problems.push(`${file} was not created. Write it with write_file (the first part) and append_file (the rest).`);
      continue;
    }
    const words = countWords(content);
    const ok = !target || words >= target * 0.9;
    checks.push({ file, words, ok });
    if (!ok) problems.push(`${file} has ${words} words, the task asks for at least ${target}. Continue it: read the end of the file, then add new sections with append_file (about 800-1200 words per call) until it reaches the length. Do not rewrite, summarize or shorten what is already there.`);
  }
  return { target, checks, problems };
}

/**
 * Output di un comando da mostrare al modello: senza byte binari. Libro mindfulness (2026-10-12): i test stampavano il
 * contenuto del PDF e l'errore arrivava a Qwen e al coordinatore come caratteri illeggibili, quindi nessuno lo correggeva.
 */
export function printable(s) {
  const text = String(s ?? '');
  const bad = (text.match(/[^\t\n\r\x20-\x7e -ɏ -⁯←-⇿─-◿]/g) || []).length;
  const clean = text.replace(/[^\t\n\r\x20-\x7e -ɏ -⁯←-⇿─-◿]+/g, '·').replace(/(?:·\s*){4,}/g, ' [byte binari omessi] ');
  return bad > text.length * 0.1 ? `${clean}\n[Nota di LocalAI: gran parte di questo output erano byte binari (per esempio un PDF stampato nel terminale): fai stampare ai test e allo script solo testo]` : clean;
}

/** Toglie il tag iniziale dal testo del task. */
export const stripTag = (text) => String(text || '').replace(/^\s*\[[a-zA-Zà-ù]+\]\s*/, '').trim();

/**
 * Task dal piano: le righe di elenco (-, *, 1.) e le caselle [ ]; le caselle già spuntate [x] si saltano.
 * Le righe rientrate sotto un punto sono dettagli di quel punto.
 */
export function parsePlan(text) {
  const tasks = [];
  let current = null;
  let rules = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    // la sezione «Regole» (meccaniche del gioco, criteri di riuscita) è riferimento per tutti i task, non un elenco di task
    const h = /^#{1,6}\s+(.*)$/.exec(raw);
    if (h) { rules = /\b(regole|criteri|rules|requisiti)\b/i.test(h[1]); current = null; continue; }
    if (rules) continue;
    const m = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?(.+)$/.exec(raw);
    if (m && m[1].length < 2) {
      current = m[2] && m[2] !== ' ' ? null : { text: m[3].trim() };
      if (current) tasks.push(current);
      continue;
    }
    if (current && raw.trim() && /^\s{2,}/.test(raw)) current.text += `\n${raw.trim()}`;
    else if (!raw.trim()) continue;
    else current = null;
  }
  return tasks.filter((t) => stripTag(t.text));
}

/** Modello per il tipo di task (installato e con supporto agli strumenti), altrimenti quello predefinito. */
export async function modelFor(type) {
  const want = config.projects.models[type] || config.ollama.model;
  const installed = await ollama.listModels().catch(() => []);
  const norm = (n) => n.replace(/:latest$/, '');
  const found = installed.find((m) => m.tools && norm(m.name) === norm(want));
  return found ? found.name : config.ollama.model;
}

/**
 * L'altro modello locale per un task che non riesce: Qwen Coder ↔ Gemma 26B (i modelli per codice e lettura).
 * null se non è installato o se è lo stesso.
 */
export async function otherModel(current) {
  const norm = (n) => String(n || '').replace(/:latest$/, '');
  const installed = await ollama.listModels().catch(() => []);
  for (const want of [config.projects.models.code, config.projects.models.read]) {
    const found = installed.find((m) => m.tools && norm(m.name) === norm(want));
    if (found && norm(found.name) !== norm(current)) return found.name;
  }
  return null;
}

/** Modelli diversi con cui il task ha già lavorato. */
export const modelsTried = (task) => [...new Set((task.modelsTried || []).map((m) => String(m).replace(/:latest$/, '')))];

function blank(ownerId, folder, name) {
  const now = Date.now();
  return { id: folder, ownerId, name: name || folder, folder, createdAt: now, updatedAt: now, active: false, autoTest: true, testCommand: '', tasks: [], log: [], chats: [] };
}

function read(ownerId, id) {
  const key = `${ownerId}/${id}`;
  if (cache.has(key)) return cache.get(key);
  let p = null;
  try { p = JSON.parse(fs.readFileSync(fileFor(ownerId, id), 'utf8')); } catch {}
  if (p) cache.set(key, p);
  return p;
}

const writing = new Map();
/** Salvataggio atomico (in coda per progetto) e notifica all'interfaccia. */
export function save(p, { touch = true } = {}) {
  if (touch) p.updatedAt = Date.now();
  cache.set(`${p.ownerId}/${p.id}`, p);
  bus.emit('project', { ownerId: p.ownerId, project: summary(p) });
  const key = `${p.ownerId}/${p.id}`;
  const next = (writing.get(key) || Promise.resolve()).then(async () => {
    await fsp.mkdir(dirFor(p.ownerId), { recursive: true });
    const f = fileFor(p.ownerId, p.id);
    await fsp.writeFile(`${f}.tmp`, JSON.stringify(p, null, 1));
    await fsp.rename(`${f}.tmp`, f);
  }).catch((e) => console.error('[projects] save', e.message));
  writing.set(key, next);
  return next;
}

/**
 * Notifica all'utente del progetto: nel browser (evento 'notify' verso l'interfaccia) e, se configurato,
 * sul telefono con ntfy (pubblicazione JSON, così titolo e testo restano in UTF-8).
 * level: 'ok' | 'info' | 'warn'.
 */
export function notify(p, { title, body = '', level = 'info' }) {
  const n = { ownerId: p.ownerId, projectId: p.id, project: p.name, title, body: String(body).slice(0, 400), level, at: Date.now() };
  bus.emit('notify', n);
  const { ntfyUrl, ntfyToken, appUrl } = config.notify;
  if (!ntfyUrl) return;
  let url;
  try { url = new URL(ntfyUrl); } catch { return console.warn('[notifiche] NTFY_URL non valido'); }
  const topic = url.pathname.replace(/^\/+|\/+$/g, '');
  fetch(url.origin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(ntfyToken ? { Authorization: `Bearer ${ntfyToken}` } : {}) },
    body: JSON.stringify({
      topic, title: `${p.name}: ${title}`, message: n.body || title,
      tags: [{ ok: 'white_check_mark', info: 'robot', warn: 'warning' }[level] || 'robot'],
      priority: level === 'warn' ? 4 : 3,
      ...(appUrl ? { click: `${appUrl}/progetti/${encodeURIComponent(p.id)}` } : {}),
    }),
    signal: AbortSignal.timeout(10000),
  }).then((r) => { r.body?.cancel().catch(() => {}); if (!r.ok) console.warn(`[notifiche] ntfy → ${r.status}`); }).catch((e) => console.warn(`[notifiche] ntfy: ${e.message}`));
}

export function addLog(p, text) {
  p.log.push({ at: Date.now(), text });
  if (p.log.length > 200) p.log.splice(0, p.log.length - 200);
}

/** Dati per l'interfaccia (senza la cronologia completa). */
export function summary(p) {
  const count = (s) => p.tasks.filter((t) => t.status === s).length;
  return {
    id: p.id, name: p.name, folder: p.folder, active: p.active, updatedAt: p.updatedAt,
    total: p.tasks.length, done: count('done'), queued: count('queued'), failed: count('failed') + count('error'),
    running: p.tasks.find((t) => t.status === 'running' || t.status === 'testing')?.title || null,
    waiting: p.waitingService || null,
  };
}

/** Tutti i progetti dell'utente: le cartelle della cartella di lavoro (anche quelle create in chat) più i dati salvati. */
export async function list(user) {
  const root = workspace.userRoot(user);
  const out = new Map();
  for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    out.set(e.name, read(user.id, e.name) || blank(user.id, e.name));
  }
  for (const f of await fsp.readdir(dirFor(user.id)).catch(() => [])) {
    if (!f.endsWith('.json')) continue;
    const p = read(user.id, decodeURIComponent(f.slice(0, -5)));
    if (p && !out.has(p.id) && fs.existsSync(path.join(root, p.folder))) out.set(p.id, p);
  }
  // ordine per ultima modifica (richiesta dell'utente, 2026-10-19): la più recente tra i dati del progetto (task,
  // piano, cronologia) e i file della cartella, così sale anche un progetto toccato a mano o da una chat Computer
  const rows = await Promise.all([...out.values()].map(async (p) => {
    const files = await workspace.listFiles(scoped(user, p), '', { limit: 1500 }).catch(() => []);
    const newest = Math.max(0, ...files.map((f) => f.mtime || 0));
    const saved = fs.existsSync(fileFor(user.id, p.id)) ? p.updatedAt || 0 : 0;
    return { ...summary(p), modifiedAt: Math.max(saved, newest) || p.updatedAt };
  }));
  return rows.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

/** Progetto dell'utente (creato al volo se la cartella esiste ma non ha ancora dati). */
export function get(user, id) {
  const folder = workspace.safeFolder(id);
  if (!folder) return null;
  const p = read(user.id, folder);
  if (p) return p;
  if (!fs.existsSync(path.join(workspace.userRoot(user), folder))) return null;
  const fresh = blank(user.id, folder);
  cache.set(`${user.id}/${folder}`, fresh);
  return fresh;
}

export async function create(user, name) {
  const clean = String(name || '').trim().slice(0, 80);
  const folder = workspace.folderName(clean);
  if (!folder) throw new ProjectError('Serve un nome per il progetto (lettere o numeri)');
  const dir = path.join(workspace.userRoot(user), folder);
  if (fs.existsSync(dir) && read(user.id, folder)) throw new ProjectError(`Esiste già un progetto «${folder}»`);
  await fsp.mkdir(dir, { recursive: true });
  const p = blank(user.id, folder, clean);
  addLog(p, 'Progetto creato');
  await save(p);
  return p;
}

export async function remove(user, p) {
  cache.delete(`${user.id}/${p.id}`);
  await fsp.rm(fileFor(user.id, p.id), { force: true });
  await workspace.deleteFile(user, p.folder).catch(() => {});
}

/** Utente "ristretto" alla cartella del progetto, per le funzioni di workspace.js. */
export const scoped = (user, p) => ({ ...user, project: p.folder });

/** Cartella del progetto sul disco. */
export const dirOf = (user, p) => workspace.userRoot(scoped(user, p));

// ---------------- STATO.md ----------------
// Libro mindfulness (2026-10-12): per «capire il quadro» i modelli rileggevano tutti i capitoli e riempivano il contesto.
// LocalAI scrive dopo ogni task un riassunto dello stato (fatto, file, problemi, da fare) che i task successivi leggono.
export const STATE_FILE = 'STATO.md';

/** File di esempio nella cartella del progetto (immagini e audio, fino a 2 livelli, al massimo 5), percorsi relativi. */
export function sampleFiles(dir) {
  const out = [];
  const walk = (rel, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= 5) return;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 2 && !/^(\.git|node_modules|tests?)$/i.test(e.name)) walk(r, depth + 1); }
      else if (/\.(jpe?g|png|webp|gif|bmp|wav|mp3|ogg|m4a)$/i.test(e.name)) out.push(r);
    }
  };
  walk('', 0);
  return out;
}

/** Funzioni che la verifica automatica non può provare (servono hardware o una persona), nominate nel task. */
export function manualChecks(text) {
  const t = String(text || '');
  return [
    [/fotocamer|camera|webcam|scann?eri[sz]z|barcode|codic[ei] a barre|qr ?code/i, 'la fotocamera'],
    [/microfon|microphone|registra(re|zione) (la )?voce|dettatura/i, 'il microfono'],
    [/\bgps\b|geolocali|posizione dell'utente|geolocation/i, 'la posizione'],
  ].filter(([re]) => re.test(t)).map(([, name]) => name);
}
const TYPE_NAME = { code: 'codice', page: 'pagina', read: 'lettura', chat: 'testo' };

/** Testo di STATO.md, dallo stato dei task (sempre rigenerato, non cresce all'infinito). */
export function stateText(p) {
  const line = (t) => `- [${TYPE_NAME[t.type] || t.type}] ${t.title}`;
  const done = p.tasks.filter((t) => t.status === 'done');
  const open = p.tasks.filter((t) => ['failed', 'error'].includes(t.status));
  const todo = p.tasks.filter((t) => ['queued', 'running', 'testing'].includes(t.status));
  const out = [`# Stato del progetto «${p.name}»`, '', `Scritto da LocalAI dopo ogni task: non modificarlo a mano. Ultimo aggiornamento: ${new Date().toLocaleString('it-IT')}.`];
  if (done.length) {
    out.push('', '## Fatto');
    for (const t of done) {
      out.push(line(t));
      if (t.summary) out.push(`  ${t.summary.replace(/\s+/g, ' ').slice(0, 300)}`);
      if (t.files?.length) out.push(`  File: ${t.files.join(', ')}`);
    }
  }
  if (open.length) out.push('', '## Problemi aperti', ...open.map((t) => `${line(t)}: ${t.error || 'non riuscito'}`));
  if (todo.length) out.push('', '## Da fare', ...todo.map(line));
  return `${out.join('\n')}\n`;
}

/** Scrive STATO.md nella cartella del progetto. */
export async function writeState(user, p) {
  await fsp.writeFile(path.join(dirOf(user, p), STATE_FILE), stateText(p));
}

/** Fotografia della cartella del progetto (snapshots.js): commit solo se è cambiato qualcosa; null senza git. */
export const snap = (user, p, message) => snapshots.snapshot(dirOf(user, p), message);

export async function readPlan(user, p) {
  try { return (await workspace.readFile(scoped(user, p), PLAN_FILE)).text || ''; } catch { return ''; }
}

export async function writePlan(user, p, text) {
  await workspace.writeFile(scoped(user, p), PLAN_FILE, String(text || ''), { fromUser: true });
  addLog(p, 'Piano aggiornato');
  await save(p);
}

/**
 * Un task di codice che nomina solo pagine (HTML/CSS) è una pagina: si verifica aprendola nel browser, non con i test
 * (prova «La mia libreria» 2026-10-13: app in un solo index.html, task marcati [codice] dal pianificatore).
 */
export function pageIfOnlyHtml(text, type) {
  if (type !== 'code') return type;
  // le librerie già pronte (zxing-browser.min.js, node_modules/…, vendor/…) non sono codice del task
  const files = (String(text || '').match(/[\w./-]*\w\.(?:html?|css|js|mjs|ts|py|json|md|txt)\b/gi) || [])
    .filter((f) => !/\.min\.js$|(^|\/)(node_modules|vendor|lib)\//i.test(f));
  const html = files.some((f) => /\.html?$/i.test(f));
  // pagina con fotocamera, microfono o posizione: i test automatici non possono provarle (i modelli scrivevano test che
  // simulavano un ISBN letto e poi fallivano con la scansione vera): si verifica la pagina e la parte hardware a mano
  const code = files.some((f) => !/\.(html?|css|md|txt|json)$/i.test(f));
  if ((html || !code) && manualChecks(text).length) return 'page';
  return files.length && files.every((f) => /\.(html?|css)$/i.test(f)) ? 'page' : type;
}

export function newTask(text, type) {
  const body = stripTag(text);
  return {
    id: randomUUID(),
    type: pageIfOnlyHtml(body, TYPES[type] ? type : classify(text)),
    text: body,
    title: body.split('\n')[0].slice(0, 100),
    status: 'queued',
    attempts: 0,
    checks: [],
    createdAt: Date.now(),
  };
}

// Ricette per i tipi di progetto noti (prove del 2026-10-12/13: libro, pagina pizzeria, gestore spese): la struttura
// che funziona con i modelli locali. Al pianificatore va solo quella del tipo riconosciuto nell'obiettivo.
export const RECIPES = [
  [/\b(libro|book|ebook|guida|manuale|romanzo|racconti|raccolta di articoli)\b/i, 'Libro o guida: un task [testo] per capitolo (file NN_titolo.md, «almeno N parole», la somma arriva alla lunghezza chiesta); se serve, un task [pagina] per la copertina; per il PDF un task [pagina] che crea book.html dai capitoli con uno script piccolo (eseguito con run_command) e lo stampa con html_to_pdf, con «tra X e Y pagine».'],
  [/\b(gioco|game|videogioco|clone di)\b/i, 'Gioco nel browser: un task [codice] per la logica (game.js, senza disegno, con i test node:test), poi un task [pagina] per index.html che la usa (canvas, comandi, punteggio); eventuali task successivi aggiungono una meccanica alla volta.'],
  [/\b(sito|pagina web|landing|pagina html|portfolio)\b/i, 'Pagina o sito: una pagina = UN task [pagina] che crea index.html completo (CSS e JS inclusi); un sito con più pagine = un task [pagina] per pagina, il primo con lo stile comune.'],
  [/\b(script|riga di comando|cli|programma|bot|automazione|api|server)\b/i, 'Script o programma: task [codice] che costruiscono il programma una funzione alla volta, ognuno con i suoi test (tests/test_*.py o tests/*.test.js), poi un task [testo] per il README con gli esempi d\'uso.'],
  [/\b(analizza|analisi|dati|csv|excel|log|report|statistiche)\b/i, 'Analisi di dati: un task [lettura] che legge i file e scrive report.md con i risultati; se servono calcoli ripetibili, prima un task [codice] con lo script e i test, poi il task [lettura] che lo esegue e commenta.'],
];
export const recipeFor = (goal) => RECIPES.find(([re]) => re.test(String(goal || '')))?.[1] || '';

/** Prompt per far scrivere il piano a un modello locale a partire dall'obiettivo (notes: pacchetto della memoria, se c'è). */
export function planPrompt(goal, files, notes = '') {
  return [
    { role: 'system', content: `Scrivi il piano di lavoro di un progetto software che verrà eseguito da modelli AI locali, un task alla volta, in una cartella del PC (Windows). Ogni task deve essere piccolo, autonomo e verificabile: chi lo esegue vede solo il piano, i task già fatti e i file della cartella.
Formato (Markdown, in italiano, niente altro):
# Obiettivo
una o due frasi

- [tipo] cosa fare, con nomi di file concreti
  eventuali dettagli rientrati di due spazi

Tipi: [pagina] per pagine web e giochi nel browser (index.html con CSS e JS inclusi; niente librerie esterne, tranne quando serve una cosa che il browser non fa ovunque, come leggere i codici a barre dalla fotocamera: allora una libreria vera, es. @zxing/browser, installata con npm install e inclusa da node_modules); [codice] per script e logica, con i test automatici (Python unittest in tests/test_*.py, JavaScript node:test in tests/*.test.js); [lettura] per analizzare file, log o dati esistenti; [testo] per README, capitoli, articoli e testi.
Quanti task: un progetto piccolo (una pagina web, uno script, un testo breve, un'analisi) è UN SOLO task, completo: chi lo esegue lavora come in una chat e lo finisce da solo. Un progetto più grande va in 3-8 tappe vere, in ordine di esecuzione, ognuna con un risultato che si può verificare: la prima crea qualcosa che funziona già, le successive aggiungono una cosa alla volta. Non spezzare in task separati cose che stanno in un file solo.
Se il progetto è soprattutto testo (libro, guida, raccolta di articoli): un task [testo] per ogni capitolo o file, anche più di 8 task. Chi esegue un task scrive al massimo circa 4000 parole: dividi il testo in file e task di questa misura. In ogni task di testo indica il file e la lunghezza come «almeno N parole» (1 pagina = 250 parole): LocalAI conta le parole e rimanda indietro i file troppo corti. Lo script che assembla il libro (PDF o altro) prende solo i file del libro, nell'ordine giusto (es. introduzione.md e cap_*.md), non il piano, il README o gli appunti.
Strumenti che chi esegue i task ha già, senza installare niente: html_to_pdf (stampa una pagina HTML in PDF con il browser, CSS di stampa compreso) e html_to_word (HTML → documento Word). Preferiscili alle librerie da installare. Per libri, guide e documenti impaginati in PDF: un task [pagina] che crea book.html dai file del testo (copertina, indice con link ai capitoli, CSS di stampa con @page per formato e margini, break-before: page all'inizio di ogni capitolo) e lo converte con html_to_pdf; niente librerie PDF come fpdf o reportlab, che costringono a calcolare a mano righe e pagine (libro mindfulness 2026-10-12: un'ora di tentativi falliti con fpdf2).
Se l'obiettivo dà una lunghezza totale (pagine o parole), la somma degli «almeno N parole» dei task deve raggiungerla: per esempio 125 pagine = circa 31000 parole = 11-12 task da 2500-3000 parole. Non ridurre il progetto e non tralasciare nessuna parte chiesta dall'obiettivo (copertina, PDF, esercizi…): ognuna ha il suo task.
Lingua: il piano è in italiano, ma se l'obiettivo chiede il risultato in un'altra lingua (es. «libro in inglese») scrivilo nelle Regole, come prima regola, e ripetilo nei task che producono testo.

Prima dei task, dopo l'obiettivo, scrivi una sezione «# Regole» con le regole concrete che il risultato deve rispettare, una per riga di elenco: chi esegue i task non può chiedere. Se l'obiettivo è il clone di un gioco o di un programma noto, elenca le sue meccaniche essenziali come nell'originale (es. per Space Invaders: alieni in formazione a griglia che si muove in blocco di lato, scende di un passo a ogni bordo e accelera quando ne restano pochi; gli alieni sparano; ripari che si consumano; si perde se la formazione arriva in basso). Usa numeri concreti dove servono (righe, colonne, velocità, vite).
In ogni task aggiungi una riga rientrata «Fatto quando: …» con il comportamento da verificare (anche nei test).
Dopo le regole scrivi «# Task» e poi l'elenco dei task.` },
    { role: 'user', content: `${notes ? `${notes}\n\n` : ''}${recipeFor(goal) ? `Ricetta per questo tipo di progetto (struttura che funziona con i modelli locali): ${recipeFor(goal)}\n\n` : ''}Obiettivo del progetto: ${String(goal).slice(0, 3000)}${files ? `\n\nFile già presenti nella cartella:\n${files}` : ''}` },
  ];
}

/** Aggiunge i task del piano che non ci sono già (stesso testo). */
export async function tasksFromPlan(user, p) {
  const plan = await readPlan(user, p);
  const items = parsePlan(plan);
  if (!plan.trim()) throw new ProjectError('Il piano è vuoto (il testo in grigio è solo un esempio): scrivilo, oppure scrivi l\'obiettivo e premi «Scrivi il piano con l\'AI»');
  if (!items.length) throw new ProjectError('Nel piano non ci sono punti di elenco da trasformare in task (righe che iniziano con «-» o «1.»)');
  const have = new Set(p.tasks.map((t) => t.text));
  const added = items.map((it) => newTask(it.text)).filter((t) => !have.has(t.text));
  p.tasks.push(...added);
  if (added.length) addLog(p, `${added.length} task creati dal piano`);
  await save(p);
  return added;
}

/**
 * Fine di un turno di chat (prova torrent-cli del 2026-10-19): il modello ha scritto PIANO.md ma non ha chiamato
 * add_project_tasks, così il piano restava lì e la coda vuota. I task si creano dal piano.
 * Chat del progetto (project): solo se il progetto non aveva task, perché in un progetto avviato un ritocco al piano
 * non deve rimettere in coda niente. Chat normale: PIANO.md di una cartella il cui progetto non ha ancora task.
 */
export async function tasksAfterChatPlan(user, steps, { project = null, hadTasks = false } = {}) {
  const done = (s) => s.type === 'file' && s.status === 'done';
  if (steps.some((s) => done(s) && s.action === 'tasks')) return null;
  for (const s of steps) {
    if (!done(s) || !['write', 'append', 'edit', 'restore'].includes(s.action)) continue;
    const parts = String(s.path || '').replace(/\\/g, '/').split('/');
    if (parts.at(-1).toLowerCase() !== PLAN_FILE.toLowerCase()) continue;
    const p = project ? (parts.length === 1 && !hadTasks ? project : null) : parts.length === 2 ? get(user, parts[0]) : null;
    if (!p || (!project && p.tasks.length)) continue;
    const added = await tasksFromPlan(user, p).catch(() => []);
    if (added.length) return { p, added };
  }
  return null;
}

/** Comando di test del progetto: quello impostato, altrimenti dedotto dai file presenti. */
export async function testCommand(user, p) {
  if (p.testCommand) return p.testCommand;
  const files = (await workspace.listFiles(user, '', { limit: 2000 })).filter((f) => !f.dir).map((f) => f.path);
  let pkg = null;
  try { if (files.includes('package.json')) pkg = JSON.parse(fs.readFileSync(workspace.resolve(user, 'package.json').abs, 'utf8')); } catch {}
  if (pkg?.scripts?.test && !/no test specified/.test(pkg.scripts.test)) return 'npm test';
  if (files.some((f) => /(^|\/)(test[-_][^/]*|[^/]*[._-]test|[^/]*\.spec)\.(c|m)?js$/.test(f) || /(^|\/)test\/[^/]+\.(c|m)?js$/.test(f))) return 'node --test';
  const py = files.filter((f) => /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(f));
  if (py.length) {
    const hasPytest = (await workspace.runCommand(user, 'python -c "import pytest"', { timeout: 20000 })).exitCode === 0;
    if (hasPytest) return 'python -m pytest -q';
    const dir = path.posix.dirname(py[0]);
    // i test aggiungono da soli la cartella del progetto a sys.path (vedi taskPrompt in runner.js)
    return dir === '.' ? 'python -m unittest discover -v' : `python -m unittest discover -v -s ${dir}`;
  }
  return null;
}

/**
 * Comando per i soli test scritti o modificati dal task (JavaScript con node --test, Python con unittest), oppure null
 * se il task non ne ha toccati o sono misti. Libreria 2026-10-13: il task di books.js eseguiva tutta la suite, compreso
 * un vecchio test che simulava la fotocamera, e il modello passava i tentativi a sistemare quello.
 */
export function taskTestCommand(files) {
  const safe = (f) => /^[\w./-]+$/.test(f) && !f.includes('..');
  const js = files.filter((f) => safe(f) && /(^|\/)(tests?\/[^/]+|[^/]*[._-]test)\.(c|m)?js$/.test(f));
  const py = files.filter((f) => safe(f) && /(^|\/)tests?\/test_[^/]+\.py$/.test(f));
  if (js.length && !py.length) return `node --test ${js.join(' ')}`;
  if (py.length && !js.length) return `python -m unittest ${py.map((f) => f.replace(/\.py$/, '').replaceAll('/', '.')).join(' ')}`;
  return null;
}

/**
 * Task aggiunti da una chat del progetto (strumento add_project_tasks). items: [{ text, type }].
 * I testi già presenti tra i task non ancora fatti non si ripetono.
 */
export async function addTasks(p, items, { from } = {}) {
  const pending = new Set(p.tasks.filter((t) => t.status !== 'done').map((t) => t.text));
  const added = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, 12)) {
    const text = String(it?.text || '').trim().slice(0, 4000);
    if (!stripTag(text)) continue;
    const t = newTask(text, it?.type);
    if (pending.has(t.text)) continue;
    if (from) t.fromChat = from;
    pending.add(t.text);
    added.push(t);
  }
  p.tasks.push(...added);
  if (added.length) addLog(p, `${added.length === 1 ? `Task aggiunto dalla chat: «${added[0].title}»` : `${added.length} task aggiunti dalla chat`}`);
  await save(p);
  return added;
}

/**
 * Stato del progetto per la chat del progetto: piano, task con esito e ultime voci della cronologia.
 * Si ricalcola a ogni messaggio, così il modello vede anche quello che la coda ha fatto nel frattempo.
 */
export async function chatContext(user, p) {
  const plan = (await readPlan(user, p)).trim();
  const STATUS = { queued: 'in coda', running: 'IN CORSO', testing: 'IN VERIFICA', done: 'fatto', failed: 'non riuscito', error: 'errore', cancelled: 'fermato' };
  const tasks = p.tasks.map((t, i) => `${i + 1}. [${STATUS[t.status] || t.status}] (${TYPES[t.type] || t.type}) ${t.title}${t.summary && t.status === 'done' ? ` — ${t.summary.slice(0, 160)}` : ''}${t.error ? ` — ${t.error.slice(0, 120)}` : ''}`);
  const log = p.log.slice(-6).map((l) => `- ${new Date(l.at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}: ${l.text}`);
  return {
    busy: p.tasks.some((t) => t.status === 'running' || t.status === 'testing'),
    active: !!p.active,
    text: [
      plan ? `Piano (${PLAN_FILE}):\n<piano>\n${plan.slice(0, 3000)}${plan.length > 3000 ? '\n[…]' : ''}\n</piano>`
        : p.tasks.length ? `Piano: ${PLAN_FILE} è vuoto.`
        // progetto appena creato: alla prima richiesta di cosa realizzare servono piano e task, non i file scritti a mano
        : `Progetto nuovo: ${PLAN_FILE} è vuoto e non ci sono task. Quando l'utente dice cosa realizzare, scrivi PIANO.md per «${p.name}» e crea i task con add_project_tasks nello stesso turno.`,
      tasks.length ? `Task del progetto (coda ${p.active ? 'attiva' : 'in pausa'}):\n${tasks.slice(-30).join('\n')}` : 'Nessun task.',
      log.length ? `Ultime voci della cronologia:\n${log.join('\n')}` : '',
    ].filter(Boolean).join('\n\n'),
  };
}

/**
 * All'avvio: i task rimasti a metà tornano in coda. La coda del progetto va in pausa, tranne che nei progetti
 * con «riprendi dopo un riavvio» (autoResume): lì riparte da sola (server.js chiama runner.kick).
 */
export function recoverInterrupted() {
  let dirs = [];
  try { dirs = fs.readdirSync(config.paths.projects); } catch { return; }
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(config.paths.projects, d)).filter((x) => x.endsWith('.json'))) {
      const p = read(d, decodeURIComponent(f.slice(0, -5)));
      if (!p) continue;
      const stuck = p.tasks.filter((t) => t.status === 'running' || t.status === 'testing');
      if (!stuck.length && !p.active) continue;
      // riavvio durante la verifica: il lavoro del modello c'è già, alla ripresa si rifà solo la verifica
      // (prova torrent-cli del 2026-10-19: test superati, poi riavvio, e il task sarebbe ripartito da zero)
      const verifying = stuck.filter((t) => t.status === 'testing');
      for (const t of stuck) Object.assign(t, { status: 'queued', attempts: 0 }, t.status === 'testing' ? { verifyOnly: true, fixedBy: 'restart' } : {});
      if (verifying.length) addLog(p, 'LocalAI riavviato durante la verifica: il task è tornato in coda e alla ripresa rifà solo la verifica');
      else if (stuck.length) addLog(p, 'LocalAI riavviato: il task in corso è tornato in coda');
      if (p.active && p.autoResume) addLog(p, 'LocalAI riavviato: la coda riparte da sola');
      else if (p.active) { p.active = false; addLog(p, 'Coda in pausa dopo il riavvio: premi «Avvia» per riprendere'); }
      save(p, { touch: false });
    }
  }
}

/** Tutti i progetti già letti dal disco (all'avvio recoverInterrupted li legge tutti). */
export function loadedProjects() {
  return [...cache.values()];
}

/** Tutti i progetti in memoria con coda attiva (per la coda globale). */
export function activeProjects() {
  return [...cache.values()].filter((p) => p.active);
}

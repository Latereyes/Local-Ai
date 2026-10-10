import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import config from './config.js';
import * as ollama from './ollama.js';
import * as workspace from './workspace.js';

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
  if (/\b(pagin[ae]|html|sito|gioc[ho]i?|videogioco|game|canvas|css|landing|interfaccia web)\b/.test(t)) return 'page';
  if (/\b(codice|script|funzion[ei]|test|python|javascript|typescript|node|programma|implementa|bug|refactor|classe|modulo|libreria|api|cli)\b|\.(py|js|ts|ps1|bat)\b/.test(t)) return 'code';
  if (/\b(riassum|riassunt|sintesi|analizz|log|estra[ei]|json|classific|elenc|confront|report|document[oi])/.test(t)) return 'read';
  return 'chat';
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
  for (const raw of String(text || '').split(/\r?\n/)) {
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

function blank(ownerId, folder, name) {
  const now = Date.now();
  return { id: folder, ownerId, name: name || folder, folder, createdAt: now, updatedAt: now, active: false, autoTest: true, testCommand: '', tasks: [], log: [] };
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
  return [...out.values()].map(summary).sort((a, b) => b.active - a.active || b.updatedAt - a.updatedAt);
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

export async function readPlan(user, p) {
  try { return (await workspace.readFile(scoped(user, p), PLAN_FILE)).text || ''; } catch { return ''; }
}

export async function writePlan(user, p, text) {
  await workspace.writeFile(scoped(user, p), PLAN_FILE, String(text || ''));
  addLog(p, 'Piano aggiornato');
  await save(p);
}

export function newTask(text, type) {
  const body = stripTag(text);
  return {
    id: randomUUID(),
    type: TYPES[type] ? type : classify(text),
    text: body,
    title: body.split('\n')[0].slice(0, 100),
    status: 'queued',
    attempts: 0,
    checks: [],
    createdAt: Date.now(),
  };
}

/** Prompt per far scrivere il piano a un modello locale a partire dall'obiettivo. */
export function planPrompt(goal, files) {
  return [
    { role: 'system', content: `Scrivi il piano di lavoro di un progetto software che verrà eseguito da modelli AI locali, un task alla volta, in una cartella del PC (Windows). Ogni task deve essere piccolo, autonomo e verificabile: chi lo esegue vede solo il piano, i task già fatti e i file della cartella.
Formato (Markdown, in italiano, niente altro):
# Obiettivo
una o due frasi

- [tipo] cosa fare, con nomi di file concreti
  eventuali dettagli rientrati di due spazi

Tipi: [pagina] per pagine web e giochi nel browser (index.html con CSS e JS inclusi, niente librerie esterne); [codice] per script e logica, con i test automatici (Python unittest in tests/test_*.py, JavaScript node:test in tests/*.test.js); [lettura] per analizzare file, log o dati esistenti; [testo] per README e testi.
Da 3 a 8 task, in ordine di esecuzione. Il primo crea qualcosa che funziona già; i successivi aggiungono una cosa alla volta.` },
    { role: 'user', content: `Obiettivo del progetto: ${String(goal).slice(0, 3000)}${files ? `\n\nFile già presenti nella cartella:\n${files}` : ''}` },
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

/** All'avvio: i task rimasti a metà tornano in coda, con la coda del progetto in pausa. */
export function recoverInterrupted() {
  let dirs = [];
  try { dirs = fs.readdirSync(config.paths.projects); } catch { return; }
  for (const d of dirs) {
    for (const f of fs.readdirSync(path.join(config.paths.projects, d)).filter((x) => x.endsWith('.json'))) {
      const p = read(d, decodeURIComponent(f.slice(0, -5)));
      if (!p) continue;
      const stuck = p.tasks.filter((t) => t.status === 'running' || t.status === 'testing');
      if (!stuck.length && !p.active) continue;
      for (const t of stuck) { t.status = 'queued'; t.attempts = 0; }
      if (stuck.length) addLog(p, 'LocalAI riavviato: il task in corso è tornato in coda');
      if (p.active) { p.active = false; addLog(p, 'Coda in pausa dopo il riavvio: premi «Avvia» per riprendere'); }
      save(p, { touch: false });
    }
  }
}

/** Tutti i progetti in memoria con coda attiva (per la coda globale). */
export function activeProjects() {
  return [...cache.values()].filter((p) => p.active);
}

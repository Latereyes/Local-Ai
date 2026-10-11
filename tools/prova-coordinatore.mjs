// Prova del coordinatore della coda con i modelli veri: crea 4 progetti con un problema apposta,
// avvia le code, aspetta che coda e coordinatore abbiano finito e scrive un resoconto.
//
// Da lanciare sul PC di LocalAI, con LocalAI acceso, dalla cartella di LocalAI:
//   node tools/prova-coordinatore.mjs --utente andrea --password LA_TUA_PASSWORD
// Opzioni: --url http://localhost:3000   --solo test-sbagliato,pagina-rotta   --minuti 90
//          --tentativi 1 (tentativi per task prima del coordinatore: con 1 interviene alla prima verifica fallita)
// Serve un utente amministratore (i test girano solo per gli amministratori).
// I progetti si chiamano «prova-coord-…»: rilanciando, quelli vecchi vengono cancellati e ricreati.
// Il resoconto finisce in prova-coordinatore-<data>.md, nella cartella da cui lanci lo script.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { userRoot } from '../src/workspace.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const BASE = arg('url', 'http://localhost:3000').replace(/\/$/, '');
const USER = arg('utente', process.env.LOCALAI_USER);
const PASS = arg('password', process.env.LOCALAI_PASSWORD);
const MAX_MIN = Number(arg('minuti', 90));
const ONLY = arg('solo', '') ? arg('solo').split(',') : null;
if (!USER || !PASS) { console.error('Uso: node tools/prova-coordinatore.mjs --utente <nome> --password <password>'); process.exit(1); }

/**
 * Scenari: file di partenza, task e cosa ci si aspetta dal coordinatore.
 * check(dir) → { ok, note }: controllo finale fatto dallo script sulla cartella.
 */
const SCENARIOS = [
  {
    id: 'test-sbagliato',
    what: 'Un test già presente è sbagliato (si aspetta 2+2=5): il task aggiunge una funzione, i test falliscono per colpa del test.',
    expect: 'Il modello del task o il coordinatore corregge il test sbagliato (non il codice giusto); alla fine i test passano.',
    files: {
      'math.js': "export function somma(a, b) {\n  return a + b;\n}\n",
      'tests/math.test.js': "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { somma } from '../math.js';\n\ntest('somma', () => {\n  assert.equal(somma(2, 2), 5);\n});\n",
      'package.json': '{ "type": "module", "scripts": { "test": "node --test" } }\n',
    },
    tasks: ['[codice] In math.js aggiungi ed esporta la funzione sottrai(a, b). Aggiungi il suo test in tests/math.test.js.'],
    check: (dir) => {
      const r = run('node', ['--test'], dir);
      const src = read(dir, 'math.js');
      const ok = r.ok && /return a \+ b/.test(src) && /sottrai/.test(src);
      return { ok, note: r.ok ? (ok ? 'test passano, somma intatta, sottrai presente' : 'test passano ma somma è stata cambiata o manca sottrai') : `test ancora rossi:\n${r.out.slice(-800)}` };
    },
  },
  {
    id: 'pagina-rotta',
    what: 'index.html ha già un errore JavaScript al caricamento: il task chiede solo un titolo, la verifica della pagina fallisce per l\'errore vecchio.',
    expect: 'Il coordinatore trova e toglie l\'errore (funzione inesistente) e il task risulta fatto.',
    files: {
      'index.html': '<!doctype html>\n<html lang="it">\n<head><meta charset="utf-8"><title>Prova</title></head>\n<body>\n<button id="b">Premi</button>\n<script>\n  document.getElementById("b").onclick = () => alert("ciao");\n  avviaAnimazione();\n</script>\n</body>\n</html>\n',
    },
    tasks: ['[pagina] In index.html aggiungi un titolo <h1>Benvenuto</h1> sopra il pulsante.'],
    check: (dir) => {
      const html = read(dir, 'index.html');
      const ok = /<h1[^>]*>\s*Benvenuto/i.test(html) && !/^\s*avviaAnimazione\(\);/m.test(html);
      return { ok, note: ok ? 'titolo presente, chiamata rotta tolta o definita' : 'manca il titolo o la chiamata a avviaAnimazione() è ancora lì' };
    },
  },
  {
    id: 'task-vago',
    what: 'Task vaghissimo («rendi tutto migliore») su uno script senza test: la verifica chiede i test.',
    expect: 'Il coordinatore riscrive il task in modo concreto (o lo divide) e la coda lo completa, oppure chiede all\'utente cosa intende.',
    files: {
      'saluti.js': "export function saluta(nome) {\n  return 'ciao ' + nome;\n}\n",
      'package.json': '{ "type": "module" }\n',
    },
    tasks: ['[codice] Rendi tutto migliore.'],
    check: (dir) => {
      // senza file di test node --test passa lo stesso: prima si controlla che ci siano
      const tests = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => !f.includes('node_modules') && /(\.test\.m?js|test_[^/\\]*\.py)$/.test(f));
      if (!tests.length) return { ok: false, note: 'nessun file di test' };
      const r = tests.some((f) => f.endsWith('.py')) ? run('python', ['-m', 'pytest', '-q'], dir) : run('node', ['--test'], dir);
      return { ok: r.ok, note: r.ok ? `ci sono test (${tests.join(', ')}) e passano` : `test rossi:\n${r.out.slice(-600)}` };
    },
  },
  {
    id: 'libreria-inesistente',
    what: 'Il task chiede una libreria Python che non esiste: non si può fare così com\'è.',
    expect: 'La verifica delle librerie boccia il codice (la libreria non esiste su PyPI); il modello o il coordinatore lo riscrivono senza (con un\'alternativa reale) oppure il coordinatore lascia la coda in pausa e spiega all\'utente.',
    files: {},
    tasks: ['[codice] Scrivi meteo.py che usa la libreria Python meteo_super_pro_xyz (da installare con pip) per stampare il meteo di Roma, con i test in tests/test_meteo.py.'],
    check: (dir, p) => {
      const src = read(dir, 'meteo.py');
      const fake = /^\s*(import|from)\s+meteo_super_pro_xyz/m.test(src);
      const done = p.tasks.length && p.tasks.every((t) => t.status === 'done');
      if (fake) return { ok: false, note: 'meteo.py importa ancora la libreria inesistente' };
      if (src) return { ok: true, note: 'meteo.py riscritto senza la libreria inesistente' };
      // nessun meteo.py: va bene solo se il task NON risulta fatto (coda in pausa, decisione all'utente)
      return done ? { ok: false, note: 'task segnato come fatto ma meteo.py non esiste' } : { ok: true, note: 'meteo.py non creato e coda in pausa: decisione lasciata all\'utente' };
    },
  },
].filter((s) => !ONLY || ONLY.includes(s.id));

function run(cmd, args, cwd) {
  try { return { ok: true, out: execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 120000 }) }; }
  catch (e) { return { ok: false, out: `${e.stdout || ''}${e.stderr || ''}${e.message}` }; }
}
const read = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch { return ''; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cookie = '';
async function api(p, { method, body } = {}) {
  const res = await fetch(BASE + p, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${p} → ${res.status} ${data.error || ''}`);
  return data;
}

const { user } = await api('/api/auth/login', { body: { username: USER, password: PASS } });
if (user.mustChangePassword) { console.error('Prima cambia la password temporanea dall\'interfaccia.'); process.exit(1); }
if (user.role !== 'admin') console.warn('⚠ L\'utente non è amministratore: i test non girano e la prova dice poco.');

// Senza Ollama i task falliscono subito e la prova non dice niente del coordinatore
const status = await api('/api/status');
// dopo un git pull LocalAI va riavviato: se gira con codice vecchio la prova misura la versione sbagliata
let local = null;
try { local = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}
if (!status.version || (local && status.version !== local)) {
  console.error(`✖ LocalAI gira con una versione diversa da quella della cartella (${status.version ? status.version.slice(0, 7) : 'vecchia, senza numero di versione'} invece di ${local ? local.slice(0, 7) : '?'}): chiudi e riavvia LocalAI dopo il git pull, poi rilancia la prova.`);
  process.exit(1);
}
if (!status.ollama) { console.error('✖ Ollama non risponde: avvialo (o controlla OLLAMA_URL di LocalAI) e rilancia la prova.'); process.exit(1); }
const { models } = await api('/api/config');
console.log(`Modelli con strumenti installati: ${models.map((m) => m.name.replace(/:latest$/, '')).join(', ') || 'nessuno'}`);

const projectsList = await api('/api/projects');
for (const s of SCENARIOS) {
  const name = `prova-coord-${s.id}`;
  if (projectsList.some((p) => p.id === name)) await api(`/api/projects/${name}`, { method: 'DELETE' });
  const created = await api('/api/projects', { body: { name } });
  const p = await api(`/api/projects/${created.id}`);
  s.project = p.id;
  s.dir = userRoot({ ...user, project: p.folder });
  for (const [f, text] of Object.entries(s.files)) {
    fs.mkdirSync(path.dirname(path.join(s.dir, f)), { recursive: true });
    fs.writeFileSync(path.join(s.dir, f), text);
  }
  // un solo tentativo per task: alla prima verifica fallita interviene il coordinatore (è lui che si vuole provare)
  const set = await api(`/api/projects/${p.id}`, { method: 'PATCH', body: { coordinator: true, autoTest: true, maxAttempts: Number(arg('tentativi', 1)) } });
  if (set.maxAttempts !== Number(arg('tentativi', 1))) { console.error('✖ LocalAI non ha accettato il numero di tentativi: è una versione vecchia, riavvialo.'); process.exit(1); }
  for (const t of s.tasks) await api(`/api/projects/${p.id}/tasks`, { body: { text: t } });
  await api(`/api/projects/${p.id}/start`, { method: 'POST' });
  if (s === SCENARIOS[0]) console.log(`Modelli dei task: codice e pagine → ${p.models?.code || '?'}, lettura → ${p.models?.read || '?'}`);
  console.log(`▶ ${name}: avviato`);
}

// Fine: nessuna coda attiva, nessun task in corso, nessuna chat del coordinatore che risponde, per 40 secondi di fila
const t0 = Date.now();
let quiet = 0;
const state = new Map();
while (Date.now() - t0 < MAX_MIN * 60000) {
  await sleep(10000);
  let busy = false;
  for (const s of SCENARIOS) {
    const p = await api(`/api/projects/${s.project}`);
    state.set(s.id, p);
    if (p.active || p.tasks.some((t) => ['running', 'testing'].includes(t.status)) || p.chats.some((c) => c.running)) busy = true;
  }
  quiet = busy ? 0 : quiet + 1;
  const mins = Math.round((Date.now() - t0) / 60000);
  process.stdout.write(`\r  ${mins} min · ${[...state.values()].map((p) => `${p.name.replace('prova-coord-', '')}: ${p.done}/${p.total}${p.active ? ' ▶' : ''}`).join(' · ')}      `);
  if (quiet >= 4) break;
}
console.log('\n');

const minutes = Math.max(1, Math.round((Date.now() - t0) / 60000));
const lines = [`# Prova del coordinatore — ${new Date().toLocaleString('it-IT')}`, '', `LocalAI: ${BASE} · durata ${minutes} ${minutes === 1 ? 'minuto' : 'minuti'}`, ''];
let passed = 0, unclear = 0;
// errori di collegamento (Ollama spento o caduto a metà): lo scenario non dice niente sul coordinatore
const SERVICE = /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|Ollama non risponde/i;
for (const s of SCENARIOS) {
  const p = state.get(s.id) || await api(`/api/projects/${s.project}`);
  const interventions = p.log.filter((l) => /^Coordinatore: analizzo/.test(l.text)).length;
  const result = s.check(s.dir, p);
  if (p.waiting || p.tasks.some((t) => SERVICE.test(t.error || '')) || p.log.some((l) => SERVICE.test(l.text))) {
    result.ok = null;
    result.note = `NON VALUTABILE: Ollama non ha risposto durante la prova (${result.note})`;
  }
  if (result.ok) passed++;
  if (result.ok === null) unclear++;
  let reply = '';
  const chat = p.chats[0];
  if (chat) {
    const c = await api(`/api/conversations/${chat.id}`);
    reply = c.messages.filter((m) => m.role === 'assistant' && m.content).map((m) => m.content.trim()).join('\n\n---\n\n');
  }
  const mark = result.ok === null ? '⚠️' : result.ok ? '✅' : '❌';
  lines.push(`## ${mark} ${s.id}`, '', `**Problema:** ${s.what}`, '', `**Atteso:** ${s.expect}`, '',
    `**Esito:** ${result.note}`, '',
    `- Task: ${p.tasks.map((t) => `«${t.title}» → ${t.status}${t.skipped ? ' (segnato a mano)' : ''}${t.attempts ? `, ${t.attempts} tentativi` : ''}${t.error ? ` — ${t.error}` : ''}`).join('; ')}`,
    `- Interventi del coordinatore: ${interventions}`,
    `- Coda alla fine: ${p.active ? 'attiva' : 'in pausa'}`, '',
    '<details><summary>Cronologia</summary>', '', ...p.log.map((l) => `- ${new Date(l.at).toLocaleTimeString('it-IT')} ${l.text}`), '', '</details>', '',
    ...(reply ? ['<details><summary>Risposte nella chat del progetto</summary>', '', reply, '', '</details>', ''] : []));
  console.log(`${mark} ${s.id}: ${result.note} (interventi: ${interventions})`);
}
lines.splice(3, 0, `**Riusciti: ${passed} di ${SCENARIOS.length}**${unclear ? ` · ${unclear} non valutabili (Ollama non ha risposto)` : ''}`, '');
const out = `prova-coordinatore-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.md`;
fs.writeFileSync(out, lines.join('\n'));
console.log(`\nResoconto: ${path.resolve(out)}`);

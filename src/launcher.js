import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import config from './config.js';
import * as workspace from './workspace.js';
import * as deps from './deps.js';

/**
 * Tasto «Apri» dei progetti (richiesta dell'utente, 2026-10-19): capisce che cosa è il progetto.
 * - Server web (Flask, FastAPI, http.server, Node con express o http): LocalAI lo avvia sul PC, aspetta la porta
 *   che apre davvero e il browser va a http://<indirizzo dell'app, anche Tailscale>:<porta>/.
 * - Pagina statica (index.html): come prima, dal server dei file della cartella di lavoro.
 * I server avviati restano accesi finché non si preme «Ferma» (o si chiude LocalAI).
 */

const IS_WIN = process.platform === 'win32';
const PYTHON = IS_WIN ? 'python' : 'python3';
const SKIP = new Set(['node_modules', '.git', '__pycache__', 'venv', '.venv', 'env', 'tests', 'test']);
// porte che si guardano se il server non stampa il suo indirizzo (solo quelle che si aprono dopo l'avvio)
const COMMON_PORTS = [5000, 8000, 8080, 3000, 5001, 8888, 8501, 7860, 4000];
const MAX_LOG = 8000;

const running = new Map(); // `${ownerId}/${projectId}` -> { proc, command, port, url, startedAt, log, forward }

/** File sorgente della cartella (radice e un livello sotto, niente test né ambienti virtuali). */
async function sources(dir, exts) {
  const out = [];
  for (const sub of ['', ...(await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])).filter((e) => e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')).map((e) => e.name)]) {
    for (const e of await fsp.readdir(path.join(dir, sub), { withFileTypes: true }).catch(() => [])) {
      if (!e.isFile() || !exts.includes(path.extname(e.name).toLowerCase()) || /^test_|_test\.py$|\.test\.|\.spec\./.test(e.name)) continue;
      const rel = sub ? `${sub}/${e.name}` : e.name;
      const st = await fsp.stat(path.join(dir, rel)).catch(() => null);
      if (st && st.size < 300000) out.push({ rel, text: await fsp.readFile(path.join(dir, rel), 'utf8').catch(() => '') });
      if (out.length >= 40) return out;
    }
  }
  return out;
}

/** Porta scritta nel codice (app.run(port=…), uvicorn.run(…, port=…), HTTPServer(('', 8000)), PORT = 8000, listen(3000)). */
export function portInCode(text) {
  const s = String(text || '');
  const m = /\bport\s*=\s*(?:int\(\s*)?(?:os\.environ\.get\(\s*['"]PORT['"]\s*,\s*['"]?)?(\d{2,5})/i.exec(s)
    || /\bPORT\s*(?:=|\|\|)\s*(?:process\.env\.PORT\s*\|\|\s*)?['"]?(\d{2,5})/.exec(s)
    || /(?:HTTPServer|TCPServer|ThreadingHTTPServer)\(\s*\(\s*['"][^'"]*['"]\s*,\s*(\d{2,5})/.exec(s)
    || /\.run\([^)]*?\b(\d{4,5})\b/.exec(s)
    || /\.listen\(\s*(\d{2,5})/.exec(s)
    || /process\.env\.PORT\s*(?:\|\||\?\?)\s*(\d{2,5})/.exec(s);
  const n = m ? Number(m[1]) : 0;
  return n >= 80 && n <= 65535 ? n : null;
}

/**
 * Che cosa si apre e come. Restituisce { kind: 'python'|'node'|'static'|null, entry, command, args, port, framework, index }.
 * index: c'è index.html nella radice (se il server non risponde su «/» si apre quella).
 */
export async function detect(dir) {
  const index = fs.existsSync(path.join(dir, 'index.html'));
  const py = await sources(dir, ['.py']);
  const web = py.map((f) => {
    const t = f.text;
    const framework = /\bfrom\s+flask\s+import|\bimport\s+flask\b/.test(t) && /\bFlask\s*\(/.test(t) ? 'flask'
      : /\bFastAPI\s*\(/.test(t) ? 'fastapi'
      : /\b(?:HTTPServer|ThreadingHTTPServer|socketserver\.TCPServer|http\.server)\b/.test(t) && /serve_forever|http\.server\.test|\.test\(/.test(t) ? 'http.server'
      : /\bfrom\s+bottle\s+import|\baiohttp\.web\b|\bimport\s+tornado|\bstreamlit\b|\bgradio\b/.test(t) ? 'web' : null;
    if (!framework) return null;
    const main = /if\s+__name__\s*==\s*['"]__main__['"]/.test(t);
    const runs = /\.run\(|serve_forever|uvicorn\.run|web\.run_app|\.launch\(/.test(t);
    // preferenza: file che si avvia da solo, poi i nomi tipici
    const name = path.basename(f.rel, '.py');
    const score = (main && runs ? 10 : main ? 5 : 0) + (['app', 'server', 'main', 'run', 'wsgi', 'api'].includes(name) ? 3 : 0) + (f.rel.includes('/') ? 0 : 1);
    return { ...f, framework, main, runs, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (web.length) {
    const f = web[0];
    const mod = f.rel.replace(/\.py$/, '').replace(/\//g, '.');
    const appVar = new RegExp(`(\\w+)\\s*=\\s*${f.framework === 'fastapi' ? 'FastAPI' : 'Flask'}\\s*\\(`).exec(f.text)?.[1] || 'app';
    let args = [f.rel];
    let port = portInCode(f.text);
    // app Flask o FastAPI senza avvio nel file (si avviano con «flask run» o uvicorn)
    if (!(f.main && f.runs) && f.framework === 'flask') { port ||= 5000; args = ['-m', 'flask', '--app', `${mod}:${appVar}`, 'run', '--port', String(port)]; }
    else if (!(f.main && f.runs) && f.framework === 'fastapi') { port ||= 8000; args = ['-m', 'uvicorn', `${mod}:${appVar}`, '--port', String(port)]; }
    else if (/\bstreamlit\b/.test(f.text) && !f.runs) { port ||= 8501; args = ['-m', 'streamlit', 'run', f.rel, '--server.port', String(port), '--server.headless', 'true']; }
    port ||= { flask: 5000, fastapi: 8000, 'http.server': 8000 }[f.framework] || null;
    return { kind: 'python', framework: f.framework, entry: f.rel, command: PYTHON, args, port, index };
  }
  // Node: script «start» del package.json, oppure un file che apre un server
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch {}
  const js = await sources(dir, ['.js', '.mjs', '.cjs']);
  const server = js.filter((f) => /\.listen\(/.test(f.text) && /\bexpress\b|\bhttp\.createServer|\bcreateServer\(|\bfastify\b|\bkoa\b/.test(f.text))
    .sort((a, b) => ['server', 'app', 'index', 'main'].indexOf(path.basename(b.rel).split('.')[0]) - ['server', 'app', 'index', 'main'].indexOf(path.basename(a.rel).split('.')[0]));
  const start = pkg?.scripts?.start;
  if (server.length || (start && !/\b(vite|webpack|parcel|react-scripts|next)\b/.test(start) && /\bnode\b/.test(start))) {
    const f = server[0];
    const port = portInCode(f?.text) || 3000;
    return start ? { kind: 'node', framework: 'node', entry: 'package.json', command: 'npm', args: ['start'], port, index }
      : { kind: 'node', framework: 'node', entry: f.rel, command: process.execPath, args: [f.rel], port, index };
  }
  if (index) return { kind: 'static', entry: 'index.html', index };
  return { kind: null, index };
}

/** true se qualcuno ascolta sulla porta (sul PC). */
export function portOpen(port, host = '127.0.0.1', timeout = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    const done = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => done(false));
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
  });
}

/** Porta stampata dal server all'avvio («Running on http://127.0.0.1:5000», «Uvicorn running on…», «Serving HTTP on 0.0.0.0 port 8000»). */
export function portFromOutput(text) {
  const s = String(text || '');
  const m = /https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1?\]|[\w.-]+):(\d{2,5})/.exec(s) || /Serving HTTP on \S+ port (\d{2,5})/.exec(s) || /listening on (?:port )?:?(\d{2,5})/i.exec(s);
  return m ? Number(m[1]) : null;
}

/**
 * Dal telefono (Tailscale) e dagli altri PC: un server che ascolta solo su 127.0.0.1 (Flask di serie) non si vede.
 * LocalAI apre la stessa porta sugli altri indirizzi del PC e la gira al server. Se il server ascolta già su tutti
 * gli indirizzi la porta è occupata e non serve niente.
 */
function forward(port) {
  const servers = [];
  const addrs = Object.values(os.networkInterfaces()).flat().filter((a) => a && !a.internal && !/^fe80:/i.test(a.address));
  for (const a of addrs) {
    const srv = net.createServer((c) => {
      const up = net.connect({ port, host: '127.0.0.1' });
      c.pipe(up).pipe(c);
      c.on('error', () => up.destroy());
      up.on('error', () => c.destroy());
    });
    srv.on('error', () => {});
    srv.listen(port, a.address);
    servers.push(srv);
  }
  return () => servers.forEach((s) => s.close());
}

const key = (user, p) => `${user.id}/${p.id}`;

/** Server del progetto acceso, se c'è: { port, command, startedAt, log, framework }. */
export function status(user, p) {
  const r = running.get(key(user, p));
  return r ? { port: r.port, command: r.command, startedAt: r.startedAt, framework: r.framework, path: r.path, log: r.log.slice(-2000) } : null;
}

export function stop(user, p) {
  const r = running.get(key(user, p));
  if (!r) return false;
  running.delete(key(user, p));
  r.forward?.();
  workspace.killTree(r.proc);
  return true;
}

/** Chiude i server avviati quando LocalAI si ferma. */
process.on('exit', () => {
  for (const r of running.values()) {
    if (IS_WIN && r.proc.pid) spawnSync('taskkill', ['/PID', String(r.proc.pid), '/T', '/F'], { windowsHide: true });
    else workspace.killTree(r.proc);
  }
});

/**
 * Apre il progetto: { kind: 'static', path } oppure { kind: 'server', port, path }.
 * Per i server serve poter eseguire codice (amministratore): il chiamante lo controlla.
 */
export async function open(user, p, { dir, canRun = false, timeoutMs = 45000 } = {}) {
  const d = await detect(dir);
  const existing = running.get(key(user, p));
  if (existing && existing.proc.exitCode === null) return { kind: 'server', port: existing.port, path: existing.path, framework: existing.framework, already: true };
  if (existing) stop(user, p);
  if (d.kind === 'static' || (d.kind && !canRun && d.index)) return { kind: 'static', path: 'index.html' };
  if (!d.kind) throw new Error('Non trovo cosa aprire: né una pagina index.html né un server (Flask, FastAPI, Node…)');
  if (!canRun) throw new Error('Avviare il server del progetto è solo per l\'amministratore');

  // librerie mancanti che esistono (flask, fastapi…): si installano prima, come per i test
  if (d.kind === 'python' && config.projects.autoInstall) {
    const r = await deps.checkDependencies(dir).catch(() => null);
    const need = (r?.missing || []).filter((m) => m.exists === true);
    if (d.framework === 'fastapi' && d.args[1] === 'uvicorn') need.push({ lang: 'python', pkg: 'uvicorn' });
    if (need.length) await deps.installPackages(dir, need).catch(() => {});
  }

  const before = new Set();
  for (const port of new Set([d.port, ...COMMON_PORTS].filter(Boolean))) if (await portOpen(port)) before.add(port);

  // porta attesa già occupata (es. 3000, che è LocalAI): se ne sceglie una libera e la si passa con PORT e --port
  // (vale per i server che le leggono; uno con la porta scritta nel codice dà l'errore con il suo output)
  if (d.port && (before.has(d.port) || [config.port, config.workspace.port].includes(d.port))) {
    let free = d.port + 1;
    while (free < d.port + 50 && (await portOpen(free) || [config.port, config.workspace.port].includes(free))) free++;
    const i = d.args.findIndex((a) => a === '--port' || a === '--server.port');
    if (i >= 0) d.args[i + 1] = String(free);
    d.port = free;
  }
  const env = { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1', BROWSER: 'none' };
  // la PORT di LocalAI non deve passare al server del progetto
  if (d.port) env.PORT = String(d.port); else delete env.PORT;
  const proc = spawn(d.command, d.args, { cwd: dir, windowsHide: true, detached: !IS_WIN, shell: IS_WIN && d.command === 'npm', env });
  const r = { proc, command: [path.basename(d.command), ...d.args].join(' '), framework: d.framework, startedAt: Date.now(), log: '', port: null, path: '/' };
  const add = (b) => { r.log = (r.log + b.toString('utf8')).slice(-MAX_LOG); };
  proc.stdout.on('data', add);
  proc.stderr.on('data', add);
  let failed = null;
  proc.on('error', (e) => { failed = e.message; });
  running.set(key(user, p), r);
  proc.on('exit', () => { if (running.get(key(user, p)) === r) { running.delete(key(user, p)); r.forward?.(); } });

  // la porta giusta: quella stampata dal server, altrimenti una delle porte attese che prima era chiusa
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((res) => setTimeout(res, 400));
    if (failed || proc.exitCode !== null) break;
    const said = portFromOutput(r.log);
    if (said && await portOpen(said)) { r.port = said; break; }
    for (const port of new Set([d.port, ...COMMON_PORTS].filter(Boolean))) {
      if (!before.has(port) && await portOpen(port, '127.0.0.1', 300)) { r.port = port; break; }
    }
    if (r.port) break;
  }
  if (!r.port) {
    const out = r.log.trim().split('\n').slice(-12).join('\n');
    // la porta era già aperta prima: il server gira già (avviato a mano o da un'altra volta)
    if (d.port && before.has(d.port) && /address already in use|Only one usage of each socket address|EADDRINUSE|10048/i.test(r.log)) {
      stop(user, p);
      return { kind: 'server', port: d.port, path: '/', framework: d.framework, already: true };
    }
    stop(user, p);
    throw new Error(`Il server non è partito (${r.command})${failed ? `: ${failed}` : ''}${out ? `\n${out}` : ''}`);
  }
  r.forward = forward(r.port);
  // server che risponde 404 sulla radice (solo API) e c'è index.html: si apre la pagina, il server resta acceso
  if (d.index) {
    // il corpo va consumato (qui si annulla): prova torrent-cli sul PC del 2026-10-19, Flask risponde con
    // «Connection: close» e se il corpo resta non letto undici lancia un assert fuori dalla promessa, che chiudeva LocalAI
    const code = await fetch(`http://127.0.0.1:${r.port}/`, { signal: AbortSignal.timeout(5000) }).then(async (x) => { await x.body?.cancel().catch(() => {}); return x.status; }).catch(() => 0);
    if (code === 404 || code === 405) r.path = null;
  }
  return r.path ? { kind: 'server', port: r.port, path: r.path, framework: d.framework } : { kind: 'static', path: 'index.html', server: { port: r.port, framework: d.framework } };
}

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import config from './config.js';
import { buildDocx } from './docx.js';

/**
 * Cartella di lavoro dell'assistente: ogni utente ha workspace/<username>/, dove il modello crea progetti
 * (pagine web, giochi, script, documenti). I file si scrivono solo lì dentro; i comandi partono da lì.
 * I comandi fuori dalla lista sicura aspettano la conferma dell'utente nell'interfaccia.
 */
const ROOT = config.paths.workspace;
fs.mkdirSync(ROOT, { recursive: true });

const MAX_FILE = 2 * 1024 * 1024;      // file scritti/letti dal modello
const MAX_READ_CHARS = 30000;
const MAX_OUTPUT = 12000;              // output di un comando restituito al modello
const IS_WIN = process.platform === 'win32';

export class WorkspaceError extends Error {}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'utente';

/** Nome di cartella valido per un progetto (lettere, cifre, - e _), oppure '' se non ce n'è uno. */
export const folderName = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

/** Il nome se è una singola cartella valida (anche creata in chat, es. «Sito ristorante»), altrimenti ''. */
export const safeFolder = (s) => {
  const n = String(s || '');
  return n.length <= 100 && /^[^\\/:*?"<>|\u0000-\u001f]+$/.test(n) && !n.startsWith('.') && n.trim() === n ? n : '';
};

/**
 * Cartella dell'utente (creata se manca). Con user.project è la cartella di quel progetto:
 * così i task di un progetto vedono e scrivono solo lì dentro.
 */
export function userRoot(user) {
  const base = path.join(ROOT, slug(user.username));
  const sub = user.project ? safeFolder(user.project) : '';
  if (user.project && !sub) throw new WorkspaceError('Nome del progetto non valido');
  const dir = sub ? path.join(base, sub) : base;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Risolve un percorso relativo alla cartella dell'utente e rifiuta tutto ciò che ne esce
 * (.., percorsi assoluti, collegamenti che puntano fuori).
 */
export function resolve(user, rel = '') {
  const root = userRoot(user);
  const clean = String(rel || '').replace(/\\/g, '/').replace(/^\.?\/+/, '').trim();
  if (/^[a-zA-Z]:/.test(clean) || clean.split('/').includes('..') || clean.includes('\0')) {
    throw new WorkspaceError(`Percorso non consentito: «${rel}». Usa percorsi relativi alla cartella di lavoro, es. tetris/index.html`);
  }
  // .git è la storia dei progetti (snapshots.js): né il modello né il server dei file ci entrano
  if (clean.split('/').some((s) => s.toLowerCase() === '.git')) throw new WorkspaceError(`Percorso non consentito: «${rel}» (storia del progetto)`);
  const abs = path.resolve(root, clean);
  const realRoot = fs.realpathSync(root);
  // l'antenato più vicino che esiste deve stare dentro la cartella (niente collegamenti verso l'esterno)
  let probe = abs;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new WorkspaceError(`Percorso non consentito: «${rel}»`);
  return { abs, rel: path.relative(root, abs).split(path.sep).join('/') };
}

const human = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Elenco ricorsivo dei file (al massimo `limit`), cartelle node_modules/.git escluse. */
export async function listFiles(user, rel = '', { limit = 300 } = {}) {
  const { abs } = resolve(user, rel);
  const root = userRoot(user);
  const out = [];
  async function walk(dir, depth) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '__pycache__') continue;
      const p = path.join(dir, e.name);
      const r = path.relative(root, p).split(path.sep).join('/');
      if (e.isDirectory()) {
        out.push({ path: r, dir: true });
        if (depth < 6) await walk(p, depth + 1);
      } else if (e.isFile()) {
        const st = await fsp.stat(p);
        out.push({ path: r, size: st.size, mtime: st.mtimeMs });
      }
    }
  }
  await walk(abs, 0);
  return out;
}

/** Riassunto testuale della cartella per il prompt (solo i nomi, per orientare il modello). */
export async function overview(user, max = 60) {
  const files = await listFiles(user, '', { limit: max + 1 });
  if (!files.length) return '(vuota)';
  const lines = files.slice(0, max).map((f) => (f.dir ? `${f.path}/` : `${f.path} (${human(f.size)})`));
  if (files.length > max) lines.push('…');
  return lines.join('\n');
}

export async function readFile(user, rel) {
  const { abs, rel: r } = resolve(user, rel);
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isFile()) throw new WorkspaceError(`Il file «${r}» non esiste`);
  if (st.size > MAX_FILE) throw new WorkspaceError(`Il file «${r}» è troppo grande (${human(st.size)})`);
  const buf = await fsp.readFile(abs);
  if (buf.subarray(0, 8000).includes(0)) return { path: r, size: st.size, mtime: st.mtimeMs, text: null };
  let text = buf.toString('utf8');
  const truncated = text.length > MAX_READ_CHARS;
  if (truncated) text = text.slice(0, MAX_READ_CHARS);
  return { path: r, size: st.size, mtime: st.mtimeMs, text, truncated };
}

// ---- Scritture protette ----
// Prova del 2026-10-11 (Missile Command): il modello copiava nei file il segnaposto con cui LocalAI accorcia
// le sue scritture precedenti nella cronologia («[N caratteri scritti nel file…]»), così game.js e synth_gen.py
// diventavano una riga sola; la verifica falliva, il task ripartiva e riscriveva lo stesso segnaposto.
// Ora i segnaposti si rifiutano, un file pieno non si svuota e la versione precedente resta in una copia.

const PLACEHOLDER = /\[\d+ caratteri scritti nel file|«omessi \d+ caratteri|<<omesso|\[contenuto omesso/i;
// segnaposto «pigri»: solo se il contenuto è corto (in un file vero queste frasi possono stare in un commento)
const LAZY = /\b(resto del (codice|file)|codice (invariato|precedente|di prima)|come prima|rest of (the )?(code|file)|unchanged|same as before|existing code)\b/i;

/** Motivo per cui un contenuto non è un file vero (segnaposto), oppure '' se va bene. */
export function placeholderReason(text) {
  const t = String(text ?? '');
  if (PLACEHOLDER.test(t)) return 'è il segnaposto con cui LocalAI riassume nella cronologia un file già scritto, non il codice';
  if (t.trim().length < 300 && LAZY.test(t) && t.trim().split(/\r?\n/).length <= 6) return 'è un segnaposto («resto del codice…»), non il contenuto completo';
  return '';
}

const BACKUPS = path.join(config.paths.data, 'backups');
const KEEP_BACKUPS = 5;

/** Cartella delle copie di un file (fuori dalla cartella di lavoro: test, librerie e storia non le vedono). */
function backupDir(user, r) {
  const sub = user.project ? safeFolder(user.project) : '';
  return path.join(BACKUPS, slug(user.username), sub ? folderName(sub) || '_' : '_', ...r.split('/'));
}

/** Copia la versione attuale di un file prima di cambiarlo (tiene le ultime KEEP_BACKUPS). */
async function backup(user, abs, r) {
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isFile() || !st.size) return false;
  const dir = backupDir(user, r);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.copyFile(abs, path.join(dir, `${Date.now()}`));
  const old = (await fsp.readdir(dir)).filter((f) => /^\d+$/.test(f)).sort((a, b) => Number(b) - Number(a)).slice(KEEP_BACKUPS);
  for (const f of old) await fsp.rm(path.join(dir, f), { force: true });
  return true;
}

const lines = (s) => (s ? String(s).split(/\r?\n/).length : 0);

/** Controlli comuni alle scritture: niente segnaposti, niente file pieni svuotati. */
function guard(r, text, oldSize) {
  const why = placeholderReason(text);
  if (why) throw Object.assign(new WorkspaceError(`Scrittura di «${r}» rifiutata: il contenuto ${why}. Il file su disco non è cambiato. Scrivi il contenuto vero e completo; per cambiare solo una parte usa edit_file.`), { placeholder: true });
  if (oldSize > 0 && !text.trim()) throw new WorkspaceError(`Scrittura di «${r}» rifiutata: il contenuto è vuoto e il file ne ha già uno (${human(oldSize)}). Per eliminarlo usa delete_file.`);
}

/** Scrive un file. fromUser: scritto dall'utente nell'interfaccia (es. il piano svuotato), senza i controlli sui segnaposti. */
export async function writeFile(user, rel, content, { fromUser = false } = {}) {
  const { abs, rel: r } = resolve(user, rel);
  if (!r || r.endsWith('/')) throw new WorkspaceError('Serve il nome del file');
  const text = String(content ?? '');
  if (Buffer.byteLength(text) > MAX_FILE) throw new WorkspaceError('Contenuto troppo grande (max 2 MB)');
  const st = await fsp.stat(abs).catch(() => null);
  if (st && !st.isFile()) throw new WorkspaceError(`«${r}» è una cartella`);
  if (!fromUser) guard(r, text, st?.size || 0);
  let before = null;
  if (st?.size) {
    before = await fsp.readFile(abs, 'utf8').catch(() => null);
    if (before !== text) await backup(user, abs, r);
  }
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, text, 'utf8');
  const out = { path: r, size: Buffer.byteLength(text), created: !st, lines: lines(text) };
  // riscrittura che accorcia molto un file lungo: o è la prima parte (si continua con append_file) o si è perso codice
  if (before !== null && lines(before) >= 40 && out.lines < lines(before) / 2) {
    out.previousLines = lines(before);
    out.warning = `Il file aveva ${out.previousLines} righe, ora ${out.lines}. Se è la prima parte di una riscrittura continua con append_file; se hai perso codice, la versione precedente è salvata: restore_file la rimette. Per modifiche mirate usa edit_file invece di riscrivere.`;
  }
  return out;
}

/** Aggiunge testo in fondo a un file esistente (per scrivere i file lunghi a blocchi). */
export async function appendFile(user, rel, content) {
  const { abs, rel: r } = resolve(user, rel);
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isFile()) throw new WorkspaceError(`Il file «${r}» non esiste: crealo prima con write_file`);
  const text = String(content ?? '');
  guard(r, text, 0);
  if (!text) throw new WorkspaceError('Niente da aggiungere: il contenuto è vuoto');
  if (st.size + Buffer.byteLength(text) > MAX_FILE) throw new WorkspaceError('File troppo grande (max 2 MB)');
  await fsp.appendFile(abs, text, 'utf8');
  return { path: r, size: st.size + Buffer.byteLength(text) };
}

/**
 * Modifica mirata: sostituisce un pezzo di testo esatto con un altro. Così per cambiare dieci righe
 * non si riscrive (e non si rischia di troncare) un file di trecento.
 */
export async function editFile(user, rel, oldText, newText, { all = false } = {}) {
  const { abs, rel: r } = resolve(user, rel);
  const st = await fsp.stat(abs).catch(() => null);
  if (!st?.isFile()) throw new WorkspaceError(`Il file «${r}» non esiste: crealo con write_file`);
  if (st.size > MAX_FILE) throw new WorkspaceError(`Il file «${r}» è troppo grande (${human(st.size)})`);
  const find = String(oldText ?? '');
  const repl = String(newText ?? '');
  if (!find) throw new WorkspaceError('Manca old_text: il pezzo esatto da sostituire (leggilo prima con read_file)');
  guard(r, repl, 0);
  const text = await fsp.readFile(abs, 'utf8');
  // i file scritti su Windows possono avere \r\n: si cerca anche con quelli
  const crlf = text.includes('\r\n');
  const needle = crlf && !find.includes('\r\n') && !text.includes(find) ? find.replace(/\n/g, '\r\n') : find;
  const count = text.split(needle).length - 1;
  if (!count) {
    // prova Space Invaders 2026-10-11: il modello ripeteva una modifica già fatta e riceveva sei volte «non c'è»
    if (repl.trim() && text.includes(repl)) throw new WorkspaceError(`Il testo da sostituire non c'è in «${r}», ma new_text c'è già: la modifica sembra già fatta. Non ripeterla: passa alla prossima o chiudi con il riepilogo.`);
    throw new WorkspaceError(`Il testo da sostituire non c'è in «${r}» (deve essere identico, spazi compresi): rileggi il file con read_file e copia il pezzo esatto.`);
  }
  if (count > 1 && !all) throw new WorkspaceError(`Il testo da sostituire compare ${count} volte in «${r}»: allarga old_text con le righe vicine perché sia unico, oppure usa replace_all.`);
  const value = crlf && needle !== find ? repl.replace(/\r?\n/g, '\r\n') : repl;
  const next = all ? text.split(needle).join(value) : text.replace(needle, () => value);
  if (Buffer.byteLength(next) > MAX_FILE) throw new WorkspaceError('File troppo grande (max 2 MB)');
  if (!next.trim()) throw new WorkspaceError(`La modifica svuoterebbe «${r}»: per eliminarlo usa delete_file.`);
  await backup(user, abs, r);
  await fsp.writeFile(abs, next, 'utf8');
  return { path: r, size: Buffer.byteLength(next), replaced: all ? count : 1, lines: lines(next), text: next };
}

/** Copie salvate di un file, dalla più recente: { id, at, size }. */
export async function backups(user, rel) {
  const { rel: r } = resolve(user, rel);
  const dir = backupDir(user, r);
  const names = (await fsp.readdir(dir).catch(() => [])).filter((f) => /^\d+$/.test(f)).sort((a, b) => Number(b) - Number(a));
  return Promise.all(names.map(async (f) => ({ id: f, at: Number(f), size: (await fsp.stat(path.join(dir, f))).size })));
}

/**
 * Rimette la copia più recente di un file diversa dalla versione attuale (o quella indicata).
 * La versione attuale, se è buona, diventa a sua volta una copia: così anche il ripristino si annulla.
 */
export async function restoreFile(user, rel, id) {
  const { abs, rel: r } = resolve(user, rel);
  const list = await backups(user, r);
  if (!list.length) throw new WorkspaceError(`Non ci sono copie salvate di «${r}»`);
  const current = await fsp.readFile(abs).catch(() => null);
  const dir = backupDir(user, r);
  let pick = null;
  for (const b of list) {
    if (id && b.id !== String(id)) continue;
    const data = await fsp.readFile(path.join(dir, b.id));
    if (!id && current && data.equals(current)) continue;
    if (!id && placeholderReason(data.toString('utf8'))) continue;
    pick = { ...b, data };
    break;
  }
  if (!pick) throw new WorkspaceError(id ? 'Copia non trovata' : `Le copie salvate di «${r}» sono uguali al file attuale`);
  if (current?.length && !placeholderReason(current.toString('utf8'))) await backup(user, abs, r);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, pick.data);
  return { path: r, size: pick.data.length, from: pick.at, lines: lines(pick.data.toString('utf8')) };
}

/** Copia nella cartella un file dell'app (es. un'immagine generata in chat); aggiunge l'estensione se manca. */
export async function copyIn(user, srcAbs, rel, ext = '') {
  let { abs, rel: r } = resolve(user, rel);
  if (!r || r.endsWith('/')) throw new WorkspaceError('Serve il nome del file');
  if (ext && !path.extname(r)) ({ abs, rel: r } = resolve(user, r + ext));
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.copyFile(srcAbs, abs);
  return { path: r, size: (await fsp.stat(abs)).size };
}

export async function deleteFile(user, rel) {
  const { abs, rel: r } = resolve(user, rel);
  if (!r) throw new WorkspaceError('Non si può eliminare la cartella di lavoro');
  const st = await fsp.stat(abs).catch(() => null);
  if (!st) throw new WorkspaceError(`«${r}» non esiste`);
  // anche un file eliminato si può riavere con restore_file
  if (st.isFile()) await backup(user, abs, r);
  await fsp.rm(abs, { recursive: true, force: true });
  return { path: r, dir: st.isDirectory() };
}

/**
 * Converte una pagina HTML della cartella in documento Word (.docx).
 * Su Windows con Word installato usa Word stesso (documento nativo); altrimenti crea un .docx
 * che contiene l'HTML (Word lo converte all'apertura).
 */
export async function htmlToWord(user, htmlRel, docxRel) {
  const src = resolve(user, htmlRel);
  if (!/\.html?$/i.test(src.rel)) throw new WorkspaceError('Serve un file .html');
  if (!fs.existsSync(src.abs)) throw new WorkspaceError(`Il file «${src.rel}» non esiste`);
  const dst = resolve(user, docxRel || src.rel.replace(/\.html?$/i, '.docx'));
  if (!/\.docx$/i.test(dst.rel)) throw new WorkspaceError('Il file di destinazione deve finire in .docx');
  await fsp.mkdir(path.dirname(dst.abs), { recursive: true });
  if (IS_WIN && await wordConvert(src.abs, dst.abs)) return { path: dst.rel, method: 'Microsoft Word' };
  const html = await fsp.readFile(src.abs, 'utf8');
  await fsp.writeFile(dst.abs, buildDocx(html));
  return { path: dst.rel, method: 'convertitore interno (Word non disponibile)' };
}

/** Browser per la stampa in PDF: Edge (sempre presente su Windows) o Chrome/Chromium. PDF_BROWSER lo forza. */
export function findBrowser() {
  const env = process.env;
  const list = IS_WIN
    ? [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean).flatMap((b) => [
      path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ])
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/opt/pw-browsers/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return [env.PDF_BROWSER, ...list].find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile()) || null;
}

/** Converte una pagina HTML della cartella in PDF (A4) stampandola con il browser in modalità headless. */
export async function htmlToPdf(user, htmlRel, pdfRel) {
  const src = resolve(user, htmlRel);
  if (!/\.html?$/i.test(src.rel)) throw new WorkspaceError('Serve un file .html');
  if (!fs.existsSync(src.abs)) throw new WorkspaceError(`Il file «${src.rel}» non esiste`);
  const dst = resolve(user, pdfRel || src.rel.replace(/\.html?$/i, '.pdf'));
  if (!/\.pdf$/i.test(dst.rel)) throw new WorkspaceError('Il file di destinazione deve finire in .pdf');
  const browser = findBrowser();
  if (!browser) throw new WorkspaceError('Nessun browser trovato per creare il PDF (serve Edge o Chrome)');
  await fsp.mkdir(path.dirname(dst.abs), { recursive: true });
  await fsp.rm(dst.abs, { force: true });
  // profilo temporaneo: così non si aggancia a un Edge/Chrome già aperto
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'localai-pdf-'));
  const url = pathToFileURL(src.abs).href;
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--no-pdf-header-footer', '--run-all-compositor-stages-before-draw', '--virtual-time-budget=5000', `--print-to-pdf=${dst.abs}`, url];
  if (!IS_WIN && process.getuid?.() === 0) args.unshift('--no-sandbox');
  try {
    await new Promise((done, fail) => {
      const p = spawn(browser, args, { windowsHide: true, stdio: 'ignore' });
      const t = setTimeout(() => { killTree(p); fail(new WorkspaceError('Il browser non ha finito il PDF entro 60 secondi')); }, 60000);
      p.on('error', (e) => { clearTimeout(t); fail(e); });
      p.on('close', () => { clearTimeout(t); done(); });
    });
  } finally {
    fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  const st = await fsp.stat(dst.abs).catch(() => null);
  if (!st?.size) throw new WorkspaceError('Il PDF non è stato creato');
  return { path: dst.rel, size: st.size, method: path.basename(browser).replace(/\.exe$/i, '') };
}

function wordConvert(src, dst) {
  const q = (s) => `'${s.replace(/'/g, "''")}'`;
  const ps = `$ErrorActionPreference='Stop'; $w=New-Object -ComObject Word.Application; try { $w.Visible=$false; $w.DisplayAlerts=0; `
    + `$d=$w.Documents.Open(${q(src)}, $false, $true); $d.SaveAs2(${q(dst)}, 16); $d.Close($false) } finally { $w.Quit() }`;
  return new Promise((done) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
    const t = setTimeout(() => { killTree(p); done(false); }, 60000);
    p.on('error', () => { clearTimeout(t); done(false); });
    p.on('close', (code) => { clearTimeout(t); done(code === 0 && fs.existsSync(dst)); });
  });
}

// ---- Comandi ----

// Comandi che partono senza conferma: solo lettura/informazioni, senza percorsi fuori dalla cartella
const SAFE = new Set(['dir', 'ls', 'type', 'cat', 'echo', 'where', 'which', 'whoami', 'hostname', 'ver', 'systeminfo',
  'tasklist', 'ipconfig', 'ping', 'tree', 'findstr', 'nvidia-smi', 'pwd', 'cd']);
const SAFE_SUB = {
  node: /^(-v|--version)$/,
  python: /^(--version|-V)$/,
  npm: /^(-v|--version|ls|list)$/,
  git: /^(status|log|diff|--version)\b/,
};

/** true se il comando può partire senza conferma. */
export function isSafeCommand(command) {
  const c = String(command || '').trim();
  if (!c || c.length > 300 || /[&|<>^;`$%\r\n()]/.test(c)) return false;
  const words = c.split(/\s+/);
  const cmd = words[0].toLowerCase().replace(/\.exe$/, '');
  const args = words.slice(1);
  // niente percorsi assoluti o che risalgono la cartella
  if (args.some((a) => /^[a-zA-Z]:|^[\\/]|\.\./.test(a.replace(/^["']/, '')))) return false;
  if (SAFE.has(cmd)) return true;
  return !!SAFE_SUB[cmd] && SAFE_SUB[cmd].test(args.join(' '));
}

export function killTree(p) {
  if (!p.pid || p.exitCode !== null) return;
  if (IS_WIN) spawn('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }).on('error', () => {});
  else try { process.kill(-p.pid, 'SIGKILL'); } catch { p.kill('SIGKILL'); }
}

/** Esegue un comando nella cartella dell'utente (o in una sua sottocartella). */
export function runCommand(user, command, { cwd = '', timeout = 120000, signal } = {}) {
  const dir = resolve(user, cwd);
  if (!fs.existsSync(dir.abs)) throw new WorkspaceError(`La cartella «${dir.rel}» non esiste`);
  const started = Date.now();
  return new Promise((done) => {
    // Su Windows l'output della console è in UTF-8 solo dopo chcp 65001
    const line = IS_WIN ? `chcp 65001>nul & ${command}` : command;
    const p = spawn(line, { cwd: dir.abs, shell: true, windowsHide: true, detached: !IS_WIN, env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' } });
    let out = '';
    let cut = false;
    const add = (b) => {
      if (out.length < MAX_OUTPUT) out += b.toString('utf8');
      else cut = true;
    };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; killTree(p); }, timeout);
    const onAbort = () => killTree(p);
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (code, error) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
      if (out.length > MAX_OUTPUT) { out = out.slice(0, MAX_OUTPUT); cut = true; }
      done({ exitCode: code, output: out.replace(/\r\n/g, '\n'), truncated: cut, timedOut, error, cwd: dir.rel, ms: Date.now() - started });
    };
    p.on('error', (e) => finish(null, e.message));
    p.on('close', (code) => finish(code));
  });
}

// ---- Link per aprire i file nel browser ----

const secretFile = path.join(config.paths.data, 'workspace-secret');
let secret;
try { secret = fs.readFileSync(secretFile, 'utf8').trim(); } catch {}
if (!secret) {
  secret = randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(secretFile), { recursive: true });
  fs.writeFileSync(secretFile, secret);
}

/** Codice segreto dell'utente nell'URL dei file (il server dei file non usa i cookie dell'app). */
export const linkToken = (user) => createHmac('sha256', secret).update(`ws:${user.id}`).digest('hex').slice(0, 32);

export function userByToken(users, token) {
  return users.find((u) => linkToken(u) === token) || null;
}

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';

/**
 * Fotografie dei progetti con git: prima e dopo ogni task della coda e ogni turno della chat del progetto
 * si fa un commit della cartella (solo se è cambiato qualcosa). Così un task si può annullare, una versione
 * si può ripristinare e il coordinatore vede cosa è cambiato (il diff) invece di indovinare.
 * Il repository è locale e privato della cartella (.git), con autore «LocalAI»; senza git installato
 * tutto continua a funzionare, solo senza storia.
 */

// file che non entrano nelle fotografie (dipendenze e cache, rigenerabili)
const EXCLUDE = ['node_modules/', '__pycache__/', '*.pyc', '.venv/', 'venv/', '.pytest_cache/', '.DS_Store', 'Thumbs.db'];

function git(cwd, args, { timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=false', '-c', 'core.autocrlf=false', ...args], {
      cwd, timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
    }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err }));
  });
}

let available = null;
/** true se git è installato (si controlla una volta). */
export async function hasGit() {
  if (available === null) {
    available = (await git(process.cwd(), ['--version'])).ok;
    if (!available) console.warn('  ⚠ Git non trovato: i progetti funzionano senza storia (installa Git per annullare i task)');
  }
  return available;
}

// un'operazione alla volta per cartella (due commit insieme si pestano i piedi sull'indice)
const locks = new Map();
function locked(dir, fn) {
  const prev = locks.get(dir) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(dir, next.catch(() => {}));
  return next;
}

/** Prepara il repository della cartella: 'new' se l'ha appena creato, true se c'era già, false se git non va. */
async function ensureRepo(dir) {
  if (fs.existsSync(path.join(dir, '.git'))) return true;
  const init = await git(dir, ['init', '-q']);
  if (!init.ok) return false;
  await git(dir, ['config', 'user.name', 'LocalAI']);
  await git(dir, ['config', 'user.email', 'localai@localhost']);
  await fsp.mkdir(path.join(dir, '.git', 'info'), { recursive: true });
  await fsp.writeFile(path.join(dir, '.git', 'info', 'exclude'), `${EXCLUDE.join('\n')}\n`);
  return 'new';
}

const head = async (dir) => {
  const r = await git(dir, ['rev-parse', '--verify', '-q', 'HEAD']);
  return r.ok ? r.stdout.trim() : null;
};

async function commitAll(dir, message) {
  await git(dir, ['add', '-A']);
  const status = await git(dir, ['status', '--porcelain']);
  const before = await head(dir);
  if (!status.stdout.trim() && before) return { commit: before, changed: false };
  const r = await git(dir, ['commit', '-q', '--no-verify', '--allow-empty', '-m', String(message || 'Fotografia').slice(0, 200)]);
  if (!r.ok) throw new Error(`git commit: ${r.stderr.trim() || r.error?.message}`);
  return { commit: await head(dir), changed: !!status.stdout.trim() };
}

/**
 * Fotografia della cartella: commit di tutto se è cambiato qualcosa.
 * Restituisce { commit, changed } oppure null se git non c'è (o la cartella non esiste).
 */
export async function snapshot(dir, message) {
  if (!(await hasGit()) || !fs.existsSync(dir)) return null;
  return locked(dir, async () => {
    const repo = await ensureRepo(dir);
    if (!repo) return null;
    // la prima fotografia di una cartella che esisteva già raccoglie tutto quello che c'era
    return commitAll(dir, repo === 'new' ? 'Prima fotografia del progetto' : message);
  }).catch((e) => { console.error('[snapshots]', e.message); return null; });
}

/** Ultime fotografie (dalla più recente): { commit, short, at, message, files }. */
export async function history(dir, limit = 20) {
  if (!(await hasGit()) || !fs.existsSync(path.join(dir, '.git'))) return [];
  const r = await git(dir, ['log', `-n${limit}`, '--format=%x1e%H%x1f%ct%x1f%s', '--shortstat']);
  if (!r.ok) return [];
  return r.stdout.split('\x1e').filter((s) => s.trim()).map((chunk) => {
    const [line, ...rest] = chunk.split('\n');
    const [commit, ct, message] = line.split('\x1f');
    const files = Number(/(\d+) files? changed/.exec(rest.join(' '))?.[1] || 0);
    return { commit, short: commit.slice(0, 7), at: Number(ct) * 1000, message, files };
  });
}

/** Cosa è cambiato tra due fotografie: riepilogo dei file e diff (troncato a max caratteri). */
export async function diff(dir, from, to, max = 4000) {
  if (!from || !to || from === to || !(await hasGit())) return '';
  const stat = await git(dir, ['diff', '--stat=100', from, to]);
  if (!stat.ok || !stat.stdout.trim()) return '';
  const patch = await git(dir, ['diff', '-U2', from, to]);
  const text = patch.stdout.length > max ? `${patch.stdout.slice(0, max)}\n[…diff troncato…]` : patch.stdout;
  return `${stat.stdout.trim()}\n\n${text}`.trim();
}

const isCommit = (s) => /^[0-9a-f]{7,40}$/i.test(String(s || ''));

/**
 * Riporta la cartella a una fotografia: prima fotografa lo stato attuale (così anche il ripristino si può annullare),
 * poi rimette i file della versione scelta, elimina quelli nati dopo e fotografa il risultato.
 */
export async function restore(dir, commit, message) {
  if (!(await hasGit())) throw new Error('Git non è installato: la storia del progetto non è disponibile');
  if (!isCommit(commit)) throw new Error('Versione non valida');
  return locked(dir, async () => {
    if (!(await ensureRepo(dir))) throw new Error('Storia del progetto non disponibile');
    const exists = await git(dir, ['cat-file', '-e', `${commit}^{commit}`]);
    if (!exists.ok) throw new Error('Versione non trovata nella storia del progetto');
    const safety = await commitAll(dir, `Prima del ripristino: ${String(message || '').slice(0, 120)}`);
    // file aggiunti dopo quella versione: vanno tolti (checkout rimette solo quelli che c'erano)
    const added = await git(dir, ['diff', '-z', '--name-only', '--diff-filter=A', commit, 'HEAD']);
    for (const f of added.stdout.split('\0').filter(Boolean)) {
      await fsp.rm(path.join(dir, f), { force: true });
    }
    // una versione vuota (la prima fotografia di una cartella vuota) non ha file da rimettere
    if ((await git(dir, ['ls-tree', '--name-only', commit])).stdout.trim()) {
      const co = await git(dir, ['checkout', commit, '--', '.']);
      if (!co.ok) throw new Error(`git checkout: ${co.stderr.trim() || co.error?.message}`);
    }
    const done = await commitAll(dir, message || `Ripristinata la versione ${commit.slice(0, 7)}`);
    return { before: safety.commit, commit: done.commit };
  });
}

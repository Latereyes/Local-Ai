import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { execFile } from 'node:child_process';

/**
 * Librerie usate dal codice di un progetto: quelle importate devono essere installate o, almeno, esistere davvero.
 * Serve contro un difetto visto nella prova del coordinatore: un modello che usa una libreria inventata e la
 * simula nei test (mock), così i test passano ma il programma non può funzionare.
 * Python: import e from … import nei .py; JavaScript: import/require con nomi di pacchetto nei .js/.mjs/.cjs.
 * Le librerie mancanti si cercano su PyPI e sul registro npm: 404 = non esiste.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.pytest_cache', 'dist', 'build']);
// nome dell'import → nome del pacchetto su PyPI, quando sono diversi
const PYPI_ALIAS = {
  cv2: 'opencv-python', yaml: 'pyyaml', PIL: 'pillow', bs4: 'beautifulsoup4', sklearn: 'scikit-learn',
  dateutil: 'python-dateutil', dotenv: 'python-dotenv', serial: 'pyserial', usb: 'pyusb', win32api: 'pywin32',
  win32con: 'pywin32', win32gui: 'pywin32', pythoncom: 'pywin32', Crypto: 'pycryptodome', jwt: 'pyjwt',
  magic: 'python-magic', docx: 'python-docx', pptx: 'python-pptx', fitz: 'pymupdf', attr: 'attrs', google: 'google-api-core',
  // «import fpdf» è anche fpdf2, l'unico mantenuto: il pacchetto «fpdf» (1.7.2, del 2017) non ha new_x/new_y, FontFace,
  // fpdf.enums… (libro mindfulness 2026-10-12: installato fpdf, lo script scritto per fpdf2 falliva a ogni tentativo)
  fpdf: 'fpdf2',
};

async function sourceFiles(dir, exts, max = 400) {
  const out = [];
  async function walk(d, depth) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= max) return;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.') && depth < 6) await walk(p, depth + 1); }
      else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
  }
  await walk(dir, 0);
  return out;
}

/** Nomi di primo livello importati dai file Python (esclusi gli import relativi). */
export function pythonImports(text) {
  const names = new Set();
  for (const line of String(text).split(/\r?\n/)) {
    let m = /^\s*import\s+(.+)$/.exec(line);
    if (m) {
      for (const part of m[1].split('#')[0].split(',')) {
        const name = part.trim().split(/\s+as\s+/)[0].split('.')[0];
        if (/^[A-Za-z_]\w*$/.test(name)) names.add(name);
      }
      continue;
    }
    m = /^\s*from\s+([A-Za-z_][\w.]*)\s+import\s/.exec(line);
    if (m) names.add(m[1].split('.')[0]);
  }
  return [...names];
}

/** Pacchetti npm importati dai file JavaScript (esclusi percorsi relativi, moduli di Node e URL). */
export function jsImports(text) {
  const names = new Set();
  const re = /(?:\bimport\s+(?:[^'"]*?\s+from\s+)?|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
  for (const m of String(text).matchAll(re)) {
    const spec = m[1];
    if (/^(\.|\/|node:|https?:|data:)/.test(spec)) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!builtinModules.includes(name)) names.add(name);
  }
  return [...names];
}

function run(cmd, args, timeout = 20000) {
  return new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    (err, stdout) => resolve(err ? null : String(stdout))));
}

/** Quali moduli Python non sono importabili (né libreria standard né installati). null se Python non c'è. */
async function missingPython(names, cwd) {
  if (!names.length) return [];
  // find_spec non esegue il modulo: cerca solo se esiste
  const code = 'import sys,json,importlib.util\nsys.path.insert(0, sys.argv[2])\nnames=json.loads(sys.argv[1])\n'
    + 'std=getattr(sys,"stdlib_module_names",set())|set(sys.builtin_module_names)\n'
    + 'print(json.dumps([n for n in names if n not in std and importlib.util.find_spec(n) is None]))';
  for (const py of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
    const out = await run(py, ['-c', code, JSON.stringify(names), cwd]);
    if (out !== null) { try { return JSON.parse(out.trim().split('\n').pop()); } catch {} }
  }
  return null;
}

/** true se il pacchetto esiste sul registro, false se non esiste (404), null se non si sa (rete). */
async function existsOn(url) {
  try {
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
    if (r.status === 404) return false;
    return r.ok ? true : null;
  } catch { return null; }
}

/** Moduli del progetto stesso (file .py e cartelle-pacchetto): non sono librerie esterne. */
export async function localModules(dir) {
  const local = new Set();
  for (const f of await sourceFiles(dir, ['.py'])) {
    local.add(path.basename(f, '.py'));
    let d = path.dirname(f);
    while (d.startsWith(dir) && d !== dir) { local.add(path.basename(d)); d = path.dirname(d); }
  }
  return local;
}

/**
 * Controllo delle librerie del progetto. Restituisce:
 * { checked, missing: [{ lang, name, pkg, exists }] } — exists false = non esiste (inventata),
 * true = esiste ma non è installata, null = non verificabile.
 */
export async function checkDependencies(dir) {
  const missing = [];
  const local = await localModules(dir);
  const pyFiles = await sourceFiles(dir, ['.py']);
  const pyNames = new Set();
  for (const f of pyFiles) for (const n of pythonImports(await fsp.readFile(f, 'utf8').catch(() => ''))) if (!local.has(n)) pyNames.add(n);
  const pyMissing = await missingPython([...pyNames], dir);
  for (const name of pyMissing || []) {
    const pkg = PYPI_ALIAS[name] || name;
    missing.push({ lang: 'python', name, pkg, exists: await existsOn(`https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`) });
  }

  const jsFiles = await sourceFiles(dir, ['.js', '.mjs', '.cjs']);
  const jsNames = new Set();
  for (const f of jsFiles) for (const n of jsImports(await fsp.readFile(f, 'utf8').catch(() => ''))) jsNames.add(n);
  for (const name of jsNames) {
    if (fs.existsSync(path.join(dir, 'node_modules', name))) continue;
    missing.push({ lang: 'js', name, pkg: name, exists: await existsOn(`https://registry.npmjs.org/${name.replace('/', '%2f')}`) });
  }
  return { checked: pyFiles.length + jsFiles.length, pythonAvailable: pyMissing !== null || !pyNames.size, missing };
}

/** Comando per installare le librerie che esistono ma mancano. */
export function installCommand(missing) {
  const py = missing.filter((m) => m.lang === 'python' && m.exists).map((m) => m.pkg);
  const js = missing.filter((m) => m.lang === 'js' && m.exists).map((m) => m.pkg);
  return [py.length ? `pip install ${py.join(' ')}` : '', js.length ? `npm install ${js.join(' ')}` : ''].filter(Boolean).join(' e ');
}

/**
 * Librerie mancanti lette dall'output di test e script:
 * Python «ModuleNotFoundError: No module named 'numpy'», Node «Cannot find package 'x'» / «Cannot find module 'x'».
 * Restituisce [{ lang, name, pkg }] (nome di primo livello, alias PyPI applicati).
 */
export function missingFromOutput(text) {
  const out = new Map();
  const s = String(text || '');
  for (const m of s.matchAll(/No module named ['"]?([A-Za-z_][\w.]*)['"]?/g)) {
    const name = m[1].split('.')[0];
    out.set(`python:${name}`, { lang: 'python', name, pkg: PYPI_ALIAS[name] || name });
  }
  for (const m of s.matchAll(/Cannot find (?:package|module) ['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (/^(\.|\/|[A-Za-z]:|node:)/.test(spec)) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!builtinModules.includes(name)) out.set(`js:${name}`, { lang: 'js', name, pkg: name });
  }
  // pacchetto vecchio con lo stesso nome di import: «import fpdf» riesce con fpdf 1.x, ma mancano le API di fpdf2
  // (libro mindfulness 2026-10-12: fpdf 1.7.2 rimasto sul PC, «unexpected keyword argument 'new_x'» a ogni tentativo)
  for (const [re, fix] of OUTDATED) if (re.test(s)) out.set(`python:${fix.name}`, { lang: 'python', ...fix });
  return [...out.values()];
}

const OUTDATED = [
  [/unexpected keyword argument '(new_x|new_y)'|No module named ['"]fpdf\.\w+|cannot import name '\w+' from 'fpdf'/, { name: 'fpdf', pkg: 'fpdf2', replaces: 'fpdf' }],
];

// nomi accettati: quelli dei registri (niente opzioni, percorsi o URL che pip e npm interpreterebbero)
const PYPI_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
const NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]{0,213}$/;

function runOut(cmd, args, cwd, timeout) {
  return new Promise((resolve) => execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, shell: process.platform === 'win32' && cmd === 'npm', env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONIOENCODING: 'utf-8' } },
    (err, stdout, stderr) => resolve({ ok: !err, output: `${stdout || ''}${stderr || ''}`.trim(), missing: err?.code === 'ENOENT' })));
}

/**
 * Installa librerie Python (pip, nell'ambiente Python del PC) o npm (nella cartella del progetto).
 * Solo pacchetti che esistono davvero sul registro: un nome inventato o scritto male non parte.
 * packages: [{ lang: 'python'|'js', pkg }]. Restituisce { installed, skipped: [{ pkg, why }], output }.
 */
export async function installPackages(dir, packages, { timeout = 300000 } = {}) {
  const skipped = [];
  const ok = { python: [], js: [] };
  const replaces = [];
  const seen = new Set();
  for (const p of packages) {
    const lang = p.lang === 'js' ? 'js' : 'python';
    const pkg = String(p.pkg || p.name || '').trim();
    if (!pkg || seen.has(`${lang}:${pkg}`)) continue;
    seen.add(`${lang}:${pkg}`);
    if (!(lang === 'js' ? NPM_NAME : PYPI_NAME).test(pkg)) { skipped.push({ pkg, why: 'nome non valido' }); continue; }
    const exists = await existsOn(lang === 'js' ? `https://registry.npmjs.org/${pkg.replace('/', '%2f')}` : `https://pypi.org/pypi/${encodeURIComponent(pkg)}/json`);
    if (exists === false) { skipped.push({ pkg, why: `non esiste su ${lang === 'js' ? 'npm' : 'PyPI'}` }); continue; }
    if (exists === null) { skipped.push({ pkg, why: 'registro non raggiungibile' }); continue; }
    ok[lang].push(pkg);
    if (lang === 'python' && p.replaces && PYPI_NAME.test(p.replaces)) replaces.push(p.replaces);
  }
  const outputs = [];
  const installed = [];
  if (ok.python.length) {
    let r = null;
    for (const py of process.platform === 'win32' ? ['python', 'py'] : ['python3', 'python']) {
      // il pacchetto vecchio con lo stesso nome di import va tolto prima, altrimenti i due si mescolano
      if (replaces.length) {
        const u = await runOut(py, ['-m', 'pip', 'uninstall', '-y', ...replaces], dir, timeout);
        if (u.missing) continue;
        outputs.push(u.output.slice(-1000));
      }
      r = await runOut(py, ['-m', 'pip', 'install', ...ok.python], dir, timeout);
      if (!r.missing) break;
    }
    outputs.push(r.output.slice(-2000));
    if (r.ok) installed.push(...ok.python);
    else for (const pkg of ok.python) skipped.push({ pkg, why: r.missing ? 'Python non trovato' : 'pip non è riuscito' });
  }
  if (ok.js.length) {
    const r = await runOut('npm', ['install', '--no-audit', '--no-fund', ...ok.js], dir, timeout);
    outputs.push(r.output.slice(-2000));
    if (r.ok) installed.push(...ok.js);
    else for (const pkg of ok.js) skipped.push({ pkg, why: r.missing ? 'npm non trovato' : 'npm non è riuscito' });
  }
  return { installed, skipped, output: outputs.join('\n').trim() };
}

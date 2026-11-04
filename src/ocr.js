import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';

/**
 * OCR delle scansioni con ocrmypdf + Tesseract, tutto sul PC.
 * Il risultato è un PDF «ricercabile»: la pagina resta l'immagine originale (loghi, firme, timbri, impaginazione)
 * e sotto c'è uno strato di testo invisibile che si può selezionare e cercare.
 * Per questo le opzioni che ritoccano l'immagine (--deskew, --clean-final, --remove-background, --force-ocr)
 * non si usano mai, e --optimize 0 lascia le immagini come sono.
 * Stesso metodo usato per i file di Carla il 2026-11-04 (script C:\AI\ocr\converti-ocr.ps1).
 */

const IS_WIN = process.platform === 'win32';
export const OCR_LANG = process.env.OCR_LANG || 'ita+eng';
export const PDF_EXT = /\.pdf$/i;
export const IMAGE_EXT = /\.(jpe?g|png|tiff?|bmp|gif)$/i;
const TIMEOUT = 15 * 60 * 1000;   // un PDF lungo (100+ pagine) può richiedere diversi minuti

/** Percorso di ocrmypdf: OCRMYPDF lo forza, poi il venv di C:\AI\ocr, poi il PATH. null se non c'è. */
let found;
export function findOcrmypdf({ refresh = false } = {}) {
  if (found !== undefined && !refresh) return found;
  const exe = IS_WIN ? 'ocrmypdf.exe' : 'ocrmypdf';
  const list = [
    process.env.OCRMYPDF,
    IS_WIN ? 'C:\\AI\\ocr\\venv\\Scripts\\ocrmypdf.exe' : null,
    path.join(os.homedir(), '.local', 'bin', 'ocrmypdf'),
  ].filter(Boolean);
  found = list.find((p) => fs.existsSync(p)) || null;
  if (!found) {
    const r = spawnSync(exe, ['--version'], { windowsHide: true, timeout: 20000 });
    if (r.status === 0) found = exe;
  }
  return found;
}

/**
 * Argomenti di ocrmypdf per un file.
 * image: l'ingresso è una foto/scansione (jpg, png, tif) invece di un PDF; dpi serve se il file non lo dice.
 */
export function ocrArgs(input, output, { lang = OCR_LANG, image = false, dpi = 0, rotate = true } = {}) {
  const args = ['-l', lang, '--output-type', 'pdf', '--optimize', '0'];
  // le pagine che hanno già testo restano come sono (--force-ocr le trasformerebbe in immagini)
  if (!image) args.push('--skip-text');
  if (rotate) args.push('--rotate-pages');
  if (image && dpi) args.push('--image-dpi', String(dpi));
  args.push(input, output);
  return args;
}

// Codici di uscita di ocrmypdf (https://ocrmypdf.readthedocs.io/en/latest/advanced.html#return-code-policy)
const EXIT = {
  2: 'file non supportato o opzioni non valide',
  3: 'manca un programma (Tesseract o Ghostscript)',
  4: 'il PDF creato non è valido',
  5: 'cartella di destinazione non scrivibile',
  6: 'il documento ha già il testo',
  7: 'errore di Tesseract o Ghostscript',
  8: 'PDF protetto da password',
  9: 'configurazione di Tesseract non valida (manca la lingua italiana?)',
  10: 'impossibile creare un PDF/A',
  15: 'errore imprevisto',
  130: 'interrotto',
};

/**
 * PATH per ocrmypdf: su Windows l'installer di Tesseract e quello di Ghostscript non aggiungono le loro cartelle
 * al PATH, quindi le si aggiunge qui se esistono (Ghostscript ha la versione nel nome: C:\Program Files\gs\gs10.xx\bin).
 */
export function ocrEnv(env = process.env) {
  if (!IS_WIN) return env;
  const pf = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
  const extra = pf.map((b) => path.join(b, 'Tesseract-OCR'));
  for (const b of pf) {
    const gs = path.join(b, 'gs');
    try { for (const v of fs.readdirSync(gs).sort().reverse()) extra.push(path.join(gs, v, 'bin')); } catch {}
  }
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const have = String(env[key] || '').toLowerCase().split(';');
  const add = extra.filter((d) => fs.existsSync(d) && !have.includes(d.toLowerCase()));
  return add.length ? { ...env, [key]: [env[key], ...add].filter(Boolean).join(';') } : env;
}

function runOcr(bin, args, { signal, timeout = TIMEOUT } = {}) {
  return new Promise((resolve) => {
    let err = '';
    const p = spawn(bin, args, { windowsHide: true, env: ocrEnv(), stdio: ['ignore', 'ignore', 'pipe'] });
    const stop = () => p.kill();
    const t = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, err: e.message }); });
    p.on('close', (code) => { clearTimeout(t); signal?.removeEventListener('abort', stop); resolve({ code: code ?? 130, err }); });
  });
}

const lastLine = (s) => String(s || '').trim().split(/\r?\n/).filter((l) => !/^\s*$/.test(l)).pop() || '';

/**
 * OCR di un file (PDF o immagine) in un nuovo PDF ricercabile. Non tocca mai l'originale.
 * Restituisce { ok, output, reason }.
 */
export async function ocrFile(input, output, { signal, lang } = {}) {
  const bin = findOcrmypdf();
  if (!bin) return { ok: false, reason: 'ocrmypdf non è installato sul PC (vedi README, sezione OCR)' };
  if (path.resolve(input) === path.resolve(output)) return { ok: false, reason: 'il file di uscita coinciderebbe con l\'originale' };
  const image = IMAGE_EXT.test(input);
  if (!image && !PDF_EXT.test(input)) return { ok: false, reason: 'tipo di file non supportato (solo PDF e immagini)' };
  await fsp.mkdir(path.dirname(output), { recursive: true });
  let r = await runOcr(bin, ocrArgs(input, output, { lang, image }), { signal });
  // foto senza DPI nei metadati (tipico dei telefoni): ocrmypdf rifiuta, si riprova a 300 dpi
  if (image && r.code === 2 && /dpi|resolution/i.test(r.err)) r = await runOcr(bin, ocrArgs(input, output, { lang, image, dpi: 300 }), { signal });
  if (r.code === 0 && fs.existsSync(output)) return { ok: true, output };
  await fsp.rm(output, { force: true }).catch(() => {});
  return { ok: false, reason: EXIT[r.code] || lastLine(r.err) || `errore ${r.code}`, detail: lastLine(r.err) };
}

/**
 * OCR di tutti i PDF e le immagini di una cartella (anche nelle sottocartelle), in outDir con la stessa struttura.
 * La cartella di uscita stessa viene saltata. Restituisce l'elenco { file, output?, ok, reason? }.
 */
export async function ocrFolder(srcDir, outDir, { signal, lang, max = 500, onFile = () => {} } = {}) {
  const files = [];
  const skipped = [];
  const outAbs = path.resolve(outDir);
  async function walk(d) {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (path.resolve(p) !== outAbs && !e.name.startsWith('.')) await walk(p); }
      else if (PDF_EXT.test(e.name) || IMAGE_EXT.test(e.name)) files.push(p);
      else skipped.push({ file: path.relative(srcDir, p), ok: false, reason: 'non è un PDF né un\'immagine' });
    }
  }
  await walk(srcDir);
  // prima i PDF: se c'è anche una foto con lo stesso nome, il nome pulito resta al PDF
  files.sort((a, b) => Number(IMAGE_EXT.test(a)) - Number(IMAGE_EXT.test(b)));
  const results = [];
  const used = new Set();
  for (const f of files.slice(0, max)) {
    if (signal?.aborted) break;
    const rel = path.relative(srcDir, f);
    // «lettera.pdf» e «lettera.jpg» nella stessa cartella: la foto diventa «lettera-jpg.pdf»
    let out = path.join(outDir, rel.replace(/\.[^.\\/]+$/, '') + '.pdf');
    if (used.has(out.toLowerCase())) out = path.join(outDir, rel.replace(/\.([^.\\/]+)$/, '-$1') + '.pdf');
    used.add(out.toLowerCase());
    onFile(rel, results.length, files.length);
    const r = await ocrFile(f, out, { signal, lang });
    results.push({ file: rel, ...(r.ok ? { output: path.relative(srcDir, out) } : {}), ok: r.ok, reason: r.reason });
  }
  for (const f of files.slice(max)) results.push({ file: path.relative(srcDir, f), ok: false, reason: `oltre il massimo di ${max} file` });
  return [...results, ...skipped];
}

/**
 * OCR di un PDF in memoria (allegato in chat): restituisce il PDF ricercabile o null se l'OCR non c'è o non riesce.
 * Lavora in una cartella temporanea che poi cancella.
 */
export async function ocrBuffer(buffer, { signal } = {}) {
  if (!findOcrmypdf()) return null;
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'localai-ocr-'));
  try {
    const input = path.join(dir, 'in.pdf');
    const output = path.join(dir, 'out.pdf');
    await fsp.writeFile(input, buffer);
    const r = await ocrFile(input, output, { signal });
    if (!r.ok) { console.warn(`[ocr] allegato non convertito: ${r.reason}`); return null; }
    return await fsp.readFile(output);
  } finally {
    fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

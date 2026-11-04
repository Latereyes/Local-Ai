import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import config from './config.js';
import { ocrFile, findOcrmypdf } from './ocr.js';

/**
 * Lavori sui PDF allegati in chat: unione, OCR, riduzione del peso, anche insieme (in quest'ordine).
 * Unione e riduzione le fa tools/pdf-tool.py con il Python del venv dell'OCR (ha già pikepdf e Pillow);
 * l'OCR è quello di ocr.js. Gli allegati originali non si toccano: il risultato è un file nuovo.
 */

const IS_WIN = process.platform === 'win32';
const SCRIPT = path.join(config.root, 'tools', 'pdf-tool.py');
export const OPERATIONS = ['merge', 'ocr', 'compress'];
// valori scelti da Andrea sui file di Carla (2026-11-04): -62% del peso, firme e loghi senza differenze visibili
export const LIGHT = { dpi: 200, quality: 75 };

/** Python con pikepdf: PDF_PYTHON, poi quello accanto a ocrmypdf (stesso venv), poi python/python3. */
let found;
export function findPython({ refresh = false } = {}) {
  if (found !== undefined && !refresh) return found;
  const ocr = findOcrmypdf();
  const near = ocr && path.isAbsolute(ocr) ? path.join(path.dirname(ocr), IS_WIN ? 'python.exe' : 'python') : null;
  const list = [process.env.PDF_PYTHON, near, IS_WIN ? 'C:\\AI\\ocr\\venv\\Scripts\\python.exe' : null].filter((p) => p && fs.existsSync(p));
  list.push(IS_WIN ? 'python' : 'python3');
  found = list.find((p) => spawnSync(p, ['-c', 'import pikepdf, PIL'], { windowsHide: true, timeout: 30000 }).status === 0) || null;
  return found;
}

function runTool(args, { signal, timeout = 10 * 60 * 1000 } = {}) {
  const py = findPython();
  if (!py) return Promise.reject(new Error('manca Python con pikepdf (si installa con ocrmypdf, vedi README, sezione OCR)'));
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const p = spawn(py, ['-I', SCRIPT, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = () => p.kill();
    const t = setTimeout(stop, timeout);
    signal?.addEventListener('abort', stop, { once: true });
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err = (err + d).slice(-4000); });
    p.on('error', (e) => { clearTimeout(t); reject(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      signal?.removeEventListener('abort', stop);
      let res = null;
      try { res = JSON.parse(out.trim().split(/\r?\n/).pop()); } catch {}
      if (code === 0 && res?.ok) resolve(res);
      else reject(new Error(res?.error || err.trim().split(/\r?\n/).pop() || `errore ${code}`));
    });
  });
}

export const mergePdfs = (inputs, output, opts) => runTool(['merge', output, ...inputs], opts);
export const compressPdf = (input, output, { dpi = LIGHT.dpi, quality = LIGHT.quality, ...opts } = {}) =>
  runTool(['compress', output, input, '--dpi', String(dpi), '--quality', String(quality)], opts);

/** Operazioni richieste, nell'ordine in cui vanno fatte (unione → OCR → riduzione), senza doppioni. */
export function plan(operations, files) {
  const ops = OPERATIONS.filter((o) => (operations || []).includes(o));
  if (!ops.length) throw new Error('Nessuna operazione valida (merge, ocr, compress)');
  if (ops.includes('merge') && files < 2) throw new Error('Per unire servono almeno due PDF');
  return ops;
}

/**
 * Esegue le operazioni sui PDF: inputs = [{ path, name }] (percorso assoluto e nome da mostrare).
 * Con «merge» esce un file solo (name); senza, uno per PDF. outFile(nome) dà il percorso dove scrivere ciascuno.
 * Restituisce [{ file, name, size, from }].
 */
export async function processPdfs(inputs, operations, outFile, { name = 'documento', signal, onStage = () => {} } = {}) {
  const ops = plan(operations, inputs.length);
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'localai-pdf-'));
  try {
    let items = inputs.map((d) => ({ cur: d.path, from: [d.name], name: String(d.name).replace(/\.pdf$/i, '') }));
    let n = 0;
    const tmp = () => path.join(work, `${++n}.pdf`);
    for (const op of ops) {
      if (signal?.aborted) throw new Error('Interrotto');
      onStage(op);
      if (op === 'merge') {
        const out = tmp();
        await mergePdfs(items.map((i) => i.cur), out, { signal });
        items = [{ cur: out, from: items.flatMap((i) => i.from), name }];
      } else {
        for (const it of items) {
          const out = tmp();
          if (op === 'ocr') {
            const r = await ocrFile(it.cur, out, { signal });
            if (!r.ok) throw new Error(`OCR non riuscito per «${it.from.join(', ')}»: ${r.reason}`);
          } else await compressPdf(it.cur, out, { signal });
          it.cur = out;
        }
      }
    }
    const results = [];
    for (const it of items) {
      const file = outFile(it.name);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.copyFile(it.cur, file);
      results.push({ file, name: `${it.name}.pdf`, size: (await fsp.stat(file)).size, from: it.from });
    }
    return results;
  } finally {
    fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

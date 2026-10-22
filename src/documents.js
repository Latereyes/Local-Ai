import fs from 'node:fs/promises';
import path from 'node:path';
import config from './config.js';
import * as ollama from './ollama.js';
import { charsFor } from './context.js';

/**
 * Documenti allegati (PDF, TXT, MD).
 * - All'upload si estrae il testo pagina per pagina (pdfjs) e lo si salva in un JSON accanto al file.
 * - Documenti brevi: il testo completo entra nel contesto di Gemma.
 * - Documenti lunghi: riassunto "map-reduce" fatto una volta sola (salvato nell'allegato) e, a ogni domanda,
 *   recupero dei passaggi più pertinenti (BM25) + riassunto generale.
 */

export const INLINE_LIMIT = 40000;   // caratteri: sotto questa soglia il documento va intero nel contesto
const CHUNK_CHARS = 16000;           // blocchi per il riassunto
export const DOC_BUDGET = 38000;     // caratteri massimi di documenti per turno (meno se il contesto del modello è piccolo)

let pdfjs;
async function loadPdfjs() {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs;
}

const tidy = (s) => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Estrae il testo per pagina. Restituisce { pages: [testo...], scanned } */
export async function extractText(buffer, name) {
  if (/\.(txt|md|markdown|csv)$/i.test(name)) {
    const text = buffer.toString('utf8');
    // pseudo-pagine da ~3000 caratteri per poter citare la posizione
    const pages = [];
    for (let i = 0; i < text.length; i += 3000) pages.push(tidy(text.slice(i, i + 3000)));
    return { pages: pages.length ? pages : [''], scanned: false };
  }
  const { getDocument } = await loadPdfjs();
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    pages.push(tidy(tc.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join('')));
  }
  await task.destroy();
  const chars = pages.reduce((n, p) => n + p.length, 0);
  return { pages, scanned: chars < 30 * pages.length };
}

export async function loadPages(textFile) {
  return JSON.parse(await fs.readFile(path.join(config.paths.media, textFile), 'utf8')).pages;
}

const withPageMarks = (pages, from = 1) => pages.map((t, i) => `[p. ${from + i}]\n${t}`).join('\n\n');

// ---------------- Lingua e ricerca dei passaggi (BM25) ----------------
const STOP = new Set(('il lo la i gli le un una uno di da in con su per tra fra e o ma che chi cui non si è sono era ha hanno al alla ai agli allo dei delle del della nel nella nei sul sulla come anche più questo questa quello quella cosa ' +
  'the a an of to in on at for with and or but is are was were be been it its this that these those he she they them his her their you your i we our as by from not have has had do does did what who which when where how').split(' '));
export const tokens = (s) => (s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !STOP.has(w));

export function guessLanguage(text) {
  const w = text.toLowerCase().slice(0, 20000).match(/\b\p{L}+\b/gu) || [];
  const count = (list) => w.filter((x) => list.includes(x)).length;
  const it = count(['il', 'che', 'della', 'per', 'non', 'una', 'sono', 'gli', 'nel']);
  const en = count(['the', 'and', 'of', 'to', 'was', 'that', 'with', 'his', 'you']);
  return en > it ? 'inglese' : 'italiano';
}

export function bm25(passages, query) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return passages.map(() => 0);
  const docs = passages.map((p) => tokens(p));
  const avg = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1);
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.includes(t)).length]));
  return docs.map((d) => {
    const tf = new Map();
    for (const t of d) if (df.has(t)) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * (f * 2.2) / (f + 1.2 * (1 - 0.75 + 0.75 * d.length / avg));
    }
    return s;
  });
}

// ---------------- Riassunto map-reduce (documenti lunghi) ----------------
function chunk(pages) {
  const out = [];
  let cur = { from: 1, to: 0, text: '' };
  pages.forEach((p, i) => {
    if (cur.text.length && cur.text.length + p.length > CHUNK_CHARS) { out.push(cur); cur = { from: i + 1, to: i, text: '' }; }
    cur.text += `[p. ${i + 1}]\n${p}\n\n`;
    cur.to = i + 1;
  });
  if (cur.text.trim()) out.push(cur);
  return out;
}

const norm = (n) => String(n || '').replace(/:latest$/, '');

/**
 * Modello per leggere intero un documento lungo (LFM2.5, config.documents.longModel), se è installato,
 * se il documento supera longMinChars (~30k token: sotto è più lento del riassunto a blocchi)
 * e se ci sta tutto nel suo contesto lasciando spazio alla risposta. Altrimenti null.
 */
export async function longModelFor(doc) {
  const want = config.documents.longModel;
  if (!want || (doc.chars || 0) < config.documents.longMinChars) return null;
  const found = (await ollama.listModels().catch(() => [])).find((m) => norm(m.name) === norm(want));
  if (!found) return null;
  const room = await ollama.contextSize(found.name) - (config.ollama.minPredict[norm(want)] || 4096) - 4000;
  return (doc.chars || 0) <= charsFor(room, found.name) ? found.name : null;
}

/**
 * Legge i riassunti «[pp. a-b] …» della risposta del modello per i documenti lunghi: il testo di una sezione
 * va fino al prossimo «[pp.», anche a capo (prova sul PC 2026-10-22: LFM2.5 mette l'intervallo su una riga e il testo sotto).
 */
export function parseSections(text, parts) {
  const found = new Map();
  const marks = [...String(text || '').matchAll(/^[ \t]*(?:[-*]|\d+[.)])?[ \t]*\**\[pp?\.\s*(\d+)\s*[-–]\s*(\d+)\]\**[ \t]*[:—–-]?/gm)];
  marks.forEach((m, i) => {
    const body = text.slice(m.index + m[0].length, marks[i + 1]?.index ?? text.length).replace(/\s+/g, ' ').trim();
    if (body) found.set(`${m[1]}-${m[2]}`, body);
  });
  return parts.map((p) => ({ from: p.from, to: p.to, summary: found.get(`${p.from}-${p.to}`) || '' }));
}

// Intestazione «Sintesi» o «Sezioni» in qualunque forma: «## Sintesi», «**Sintesi**», «Sintesi:» (LFM2.5 usa il grassetto)
const heading = (word) => new RegExp(`^[ \\t]*(?:#{1,4}[ \\t]*)?\\**[ \\t]*${word}\\b[^\\n*#:]{0,30}\\**[ \\t]*:?[ \\t]*\\**[ \\t]*$`, 'im');

/** Divide la risposta del modello per i documenti lunghi in sintesi e sezioni. */
export function splitWhole(out, parts) {
  out = String(out || '');
  const a = heading('Sintesi').exec(out);
  const b = heading('Sezioni').exec(out);
  const start = a ? a.index + a[0].length : 0;
  const end = b && b.index >= start ? b.index : out.length;
  // senza intestazione «Sintesi» vale il testo prima delle sezioni, solo se le sezioni ci sono
  const summary = a || b ? out.slice(start, end).trim() : '';
  return { summary, sections: parseSections(b ? out.slice(b.index + b[0].length) : out, parts) };
}

/**
 * Documento lungo letto intero in una sola richiesta: sintesi generale e una riga per ogni sezione.
 * Le sezioni sono le stesse del riassunto a blocchi (servono a trovare i passaggi pertinenti alle domande).
 */
async function digestWhole(doc, pages, parts, longModel) {
  const ranges = parts.map((p) => `[pp. ${p.from}-${p.to}]`).join(' ');
  const out = await ollama.complete({
    model: longModel, timeout: 900000,
    options: { temperature: 0.2, num_predict: 16384 + parts.length * 400 + 1600 },
    messages: [
      { role: 'system', content: 'Read the whole document and write, in Italian, two parts with exactly these headings.\n' +
        '## Sintesi\nA complete and faithful summary of the document: what kind of document it is, general theme or plot, structure, main characters or subjects, developments in order, conclusion. Markdown with short subheadings, 450-800 words, with the pages of key passages in parentheses (pp. x-y).\n' +
        '## Sezioni\nOne line for each page range listed by the user, in the same order, starting with the range exactly as written (e.g. "[pp. 1-6] ..."): 120-220 words of compact prose keeping names, places, dates, numbers, events and key passages in order. No introductions or comments.' },
      { role: 'user', content: `Documento: "${doc.name}" (${pages.length} pagine)\nSezioni da riassumere: ${ranges}\n\n${withPageMarks(pages)}` },
    ],
  });
  const whole = splitWhole(out, parts);
  if (!whole.summary) console.warn(`[documenti] ${longModel} non ha scritto la sintesi di «${doc.name}» nel formato chiesto (${out.length} caratteri): riassunto a blocchi`);
  return whole;
}

/**
 * Crea (una volta) riassunto generale e riassunti per sezione di un documento lungo.
 * Con longModel (vedi longModelFor) il documento si legge intero in una richiesta; le sezioni che mancano
 * nella risposta (o tutto, se la richiesta non riesce) si riassumono a blocchi con model.
 * onProgress(done, total) per mostrare l'avanzamento.
 */
export async function digest(doc, { model, longModel, signal, onProgress = () => {} }) {
  const pages = await loadPages(doc.textFile);
  const parts = chunk(pages);
  if (longModel) {
    onProgress(0, 1, { longModel });
    const whole = await digestWhole(doc, pages, parts, longModel).catch((e) => {
      console.warn(`[documenti] lettura intera di «${doc.name}» con ${longModel} non riuscita: ${e.message}`);
      return null;
    });
    if (whole?.summary) {
      const missing = whole.sections.filter((s) => !s.summary);
      // se manca più di metà delle sezioni si rifanno tutte a blocchi, tenendo la sintesi del documento intero
      if (missing.length <= parts.length / 2) {
        for (const [i, s] of missing.entries()) {
          if (signal?.aborted) throw new Error('Interrotto');
          onProgress(i, missing.length, { longModel, missing: true });
          s.summary = await summarizePart(doc, parts.find((p) => p.from === s.from), model);
        }
        return { summary: whole.summary, sections: whole.sections, language: guessLanguage(pages.join(' ')), digestModel: longModel };
      }
      const sections = await summarizeParts(doc, parts, model, signal, onProgress);
      return { summary: whole.summary, sections, language: guessLanguage(pages.join(' ')), digestModel: longModel };
    }
  }
  const sections = await summarizeParts(doc, parts, model, signal, onProgress);
  return { ...(await reduce(doc, pages, sections, model, onProgress, parts.length)), sections, language: guessLanguage(pages.join(' ')) };
}

async function summarizePart(doc, part, model) {
  const summary = await ollama.complete({
    model, timeout: 180000,
    options: { temperature: 0.2, num_predict: 450 },
    messages: [
      { role: 'system', content: 'Riassumi fedelmente, in italiano, la parte di documento fornita. Conserva nomi, luoghi, date, numeri, eventi e passaggi chiave nell\'ordine in cui avvengono. 120-220 parole, prosa compatta, senza introduzioni né commenti.' },
      { role: 'user', content: `Documento: "${doc.name}" — pagine ${part.from}-${part.to}\n\n${part.text}` },
    ],
  });
  return summary.trim();
}

async function summarizeParts(doc, parts, model, signal, onProgress) {
  const sections = [];
  for (const [i, part] of parts.entries()) {
    if (signal?.aborted) throw new Error('Interrotto');
    onProgress(i, parts.length + 1);
    sections.push({ from: part.from, to: part.to, summary: await summarizePart(doc, part, model) });
  }
  return sections;
}

/** Sintesi finale dai riassunti delle sezioni (riduzione a più livelli se sono troppi). */
async function reduce(doc, pages, sections, model, onProgress, n) {
  onProgress(n, n + 1);
  // riduzione (a più livelli se i riassunti parziali sono troppi): la sintesi finale deve stare nel contesto del modello
  const maxNotes = Math.min(45000, Math.floor(charsFor(await ollama.contextSize(model) - 2600, model) * 0.9));
  let notes = sections.map((s) => `[pp. ${s.from}-${s.to}] ${s.summary}`);
  while (notes.join('\n').length > maxNotes && notes.length > 1) {
    const merged = [];
    for (let i = 0; i < notes.length; i += 12) {
      merged.push(await ollama.complete({ model, timeout: 180000, options: { temperature: 0.2, num_predict: 900 }, messages: [
        { role: 'system', content: 'Unisci questi riassunti consecutivi in un unico riassunto fedele in italiano (300-450 parole), mantenendo i riferimenti di pagina e i fatti principali.' },
        { role: 'user', content: notes.slice(i, i + 12).join('\n\n') },
      ] }));
    }
    notes = merged;
  }
  const overall = await ollama.complete({
    model, timeout: 300000, options: { temperature: 0.3, num_predict: 1600 },
    messages: [
      { role: 'system', content: 'Scrivi in italiano una sintesi completa e fedele del documento a partire dai riassunti delle sue parti: di che tipo di documento si tratta, tema/trama generale, struttura, personaggi o soggetti principali, sviluppi in ordine, conclusione. Usa Markdown con titoletti brevi. 450-800 parole. Indica tra parentesi le pagine dei passaggi chiave (pp. x-y).' },
      { role: 'user', content: `Documento: "${doc.name}" (${pages.length} pagine)\n\n${notes.join('\n\n')}` },
    ],
  });
  onProgress(n + 1, n + 1);
  return { summary: overall.trim() };
}

/**
 * Testo da dare a Gemma per i documenti della conversazione, entro il budget.
 * keywords: parole chiave aggiuntive (es. tradotte nella lingua del documento) per il recupero dei passaggi.
 * budget: caratteri disponibili (dipende dalla finestra di contesto del modello).
 * Restituisce { text, used: [{ docId, name, pages: [...] }] }
 */
export async function buildContext(docs, question, keywords = '', budget = DOC_BUDGET) {
  const blocks = [];
  const used = [];
  for (const d of docs) {
    if (budget < 2000) break;
    const pages = await loadPages(d.textFile).catch(() => null);
    if (!pages) continue;
    const head = `### Documento: ${d.name} (${pages.length} pagine)`;
    if (d.chars <= INLINE_LIMIT && d.chars <= budget - 500) {
      blocks.push(`${head} — testo completo\n${withPageMarks(pages)}`);
      used.push({ docId: d.id, name: d.name, pages: 'tutte' });
      budget -= d.chars + 500;
      continue;
    }
    // documento lungo: riassunto + sezioni e pagine più pertinenti
    const parts = [head];
    if (d.summary) parts.push(`Riassunto generale del documento:\n${d.summary}`);
    const q = `${question} ${keywords}`;
    if (d.sections?.length) {
      const sScores = bm25(d.sections.map((s) => s.summary), q);
      const topS = d.sections.map((s, i) => [s, sScores[i]]).filter(([, sc]) => sc > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s)
        .sort((a, b) => a.from - b.from);
      if (topS.length) parts.push('Riassunti delle sezioni più pertinenti:\n' + topS.map((s) => `[pp. ${s.from}-${s.to}] ${s.summary}`).join('\n'));
    }
    const pScores = bm25(pages, q);
    let room = Math.min(16000, budget - parts.join('\n\n').length - 1000);
    const picked = [];
    for (const [i] of pScores.map((s, i) => [i, s]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])) {
      if (pages[i].length > room) continue;
      picked.push(i);
      room -= pages[i].length + 20;
      if (picked.length >= 6 || room < 1500) break;
    }
    picked.sort((a, b) => a - b);
    if (picked.length) parts.push('Passaggi originali più pertinenti alla domanda:\n' + picked.map((i) => `[p. ${i + 1}]\n${pages[i]}`).join('\n\n'));
    const block = parts.join('\n\n');
    blocks.push(block);
    used.push({ docId: d.id, name: d.name, pages: picked.map((i) => i + 1) });
    budget -= block.length;
  }
  return { text: blocks.join('\n\n---\n\n'), used };
}

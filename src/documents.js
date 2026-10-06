import fs from 'node:fs/promises';
import path from 'node:path';
import config from './config.js';
import * as ollama from './ollama.js';

/**
 * Documenti allegati (PDF, TXT, MD).
 * - All'upload si estrae il testo pagina per pagina (pdfjs) e lo si salva in un JSON accanto al file.
 * - Documenti brevi: il testo completo entra nel contesto di Gemma.
 * - Documenti lunghi: riassunto "map-reduce" fatto una volta sola (salvato nell'allegato) e, a ogni domanda,
 *   recupero dei passaggi più pertinenti (BM25) + riassunto generale.
 */

export const INLINE_LIMIT = 40000;   // caratteri: sotto questa soglia il documento va intero nel contesto
const CHUNK_CHARS = 16000;           // blocchi per il riassunto
const DOC_BUDGET = 38000;            // caratteri massimi di documenti per turno

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
const tokens = (s) => (s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[\p{L}\p{N}]{2,}/gu) || []).filter((w) => !STOP.has(w));

export function guessLanguage(text) {
  const w = text.toLowerCase().slice(0, 20000).match(/\b\p{L}+\b/gu) || [];
  const count = (list) => w.filter((x) => list.includes(x)).length;
  const it = count(['il', 'che', 'della', 'per', 'non', 'una', 'sono', 'gli', 'nel']);
  const en = count(['the', 'and', 'of', 'to', 'was', 'that', 'with', 'his', 'you']);
  return en > it ? 'inglese' : 'italiano';
}

function bm25(passages, query) {
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

/**
 * Crea (una volta) riassunto generale e riassunti per sezione di un documento lungo.
 * onProgress(done, total) per mostrare l'avanzamento.
 */
export async function digest(doc, { model, signal, onProgress = () => {} }) {
  const pages = await loadPages(doc.textFile);
  const parts = chunk(pages);
  const sections = [];
  for (const [i, part] of parts.entries()) {
    if (signal?.aborted) throw new Error('Interrotto');
    onProgress(i, parts.length + 1);
    const summary = await ollama.complete({
      model, timeout: 180000,
      options: { temperature: 0.2, num_predict: 450 },
      messages: [
        { role: 'system', content: 'Riassumi fedelmente, in italiano, la parte di documento fornita. Conserva nomi, luoghi, date, numeri, eventi e passaggi chiave nell\'ordine in cui avvengono. 120-220 parole, prosa compatta, senza introduzioni né commenti.' },
        { role: 'user', content: `Documento: "${doc.name}" — pagine ${part.from}-${part.to}\n\n${part.text}` },
      ],
    });
    sections.push({ from: part.from, to: part.to, summary: summary.trim() });
  }
  onProgress(parts.length, parts.length + 1);
  // riduzione (a più livelli se i riassunti parziali sono troppi)
  let notes = sections.map((s) => `[pp. ${s.from}-${s.to}] ${s.summary}`);
  while (notes.join('\n').length > 45000) {
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
  onProgress(parts.length + 1, parts.length + 1);
  return { summary: overall.trim(), sections, language: guessLanguage(pages.join(' ')) };
}

/**
 * Testo da dare a Gemma per i documenti della conversazione, entro il budget.
 * keywords: parole chiave aggiuntive (es. tradotte nella lingua del documento) per il recupero dei passaggi.
 * Restituisce { text, used: [{ docId, name, pages: [...] }] }
 */
export async function buildContext(docs, question, keywords = '') {
  let budget = DOC_BUDGET;
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

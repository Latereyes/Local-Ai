import fsp from 'node:fs/promises';
import path from 'node:path';
import * as comfy from './comfy.js';
import { gpu } from './gpu.js';
import { getWorkflow, buildGraph, randomSeed } from './workflows.js';
import * as workspace from './workspace.js';

/**
 * Musica ed effetti sonori con ComfyUI (workflow di tipo "audio"):
 *   music → ACE-Step 1.5 (brani con o senza voce, BPM e tonalità)
 *   sfx   → Stable Audio 3 Medium (effetti, ambienti, suoni da videogioco)
 * In chat il brano passa dalla coda di jobs.js come foto e video; in modalità Computer e nei progetti
 * il file va direttamente nella cartella di lavoro, generato a fine turno (la GPU della chat è di Ollama).
 */

export const KIND_LABEL = { music: 'musica', sfx: 'effetto sonoro' };

const NOTES = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
// lingue del testo accettate da TextEncodeAceStepAudio1.5 (ComfyUI, comfy_extras/nodes_ace.py)
const LANGS = new Set(['ar', 'az', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hr', 'ht', 'hu', 'id', 'is', 'it', 'ja', 'ko', 'la', 'lt', 'ms', 'ne', 'nl', 'no', 'pa', 'pl', 'pt', 'ro', 'ru', 'sa', 'sk', 'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tl', 'tr', 'uk', 'ur', 'vi', 'yue', 'zh']);
const INSTRUMENTAL = '[Instrumental]';

export const audioWorkflow = (kind) => getWorkflow(null, 'audio', kind);

/** Durata in secondi entro i limiti del workflow. */
export function audioSeconds(w, value) {
  const d = w?.duration || { min: 1, max: 60, default: 10 };
  const s = Math.round(Number(value) || d.default);
  return Math.min(d.max, Math.max(d.min, s));
}

/** «A minor», «am», «F#m», «Bb major» → valore del menu di ACE-Step («A minor»); altrimenti null. */
export function keyscale(value) {
  const m = /^\s*([A-Ga-g])\s*(#|b|♯|♭)?\s*(major|maj|minor|min|m)?\s*$/i.exec(String(value || ''));
  if (!m) return null;
  const note = m[1].toUpperCase() + (m[2] ? (/[#♯]/.test(m[2]) ? '#' : 'b') : '');
  if (!NOTES.includes(note)) return null;
  return `${note} ${m[3] && /^m(in(or)?)?$/i.test(m[3]) ? 'minor' : 'major'}`;
}

/**
 * Impostazioni del brano dagli argomenti dello strumento: durata e, per la musica, testo, BPM, tonalità e lingua.
 * Senza testo il brano è strumentale.
 */
export function audioSettings(kind, args = {}, w = audioWorkflow(kind)) {
  const seconds = audioSeconds(w, args.duration ?? args.seconds);
  if (kind !== 'music') return { seconds };
  const text = String(args.lyrics || '').trim();
  const lyrics = !text || args.instrumental === true || /^\[?\s*(instrumental|strumentale|inst)\s*\]?$/i.test(text) ? INSTRUMENTAL : text;
  const bpm = Math.round(Number(args.bpm)) || 0;
  const lang = String(args.language || '').toLowerCase().slice(0, 3);
  return {
    seconds,
    lyrics,
    bpm: bpm >= 40 && bpm <= 240 ? bpm : 120,
    keyscale: keyscale(args.key) || 'C major',
    language: lyrics !== INSTRUMENTAL && LANGS.has(lang) ? lang : 'en',
  };
}

/**
 * Prompt finale. Gli effetti finiscono con «Length: N seconds.»: è la forma dei prompt d'esempio di Stable Audio 3
 * (workflow ufficiale di ComfyUI); il prompt engineer a volte la dimentica o mette una durata diversa.
 */
export function finalPrompt(kind, prompt, seconds) {
  const text = String(prompt || '').trim();
  if (kind !== 'sfx' || !seconds) return text;
  return `${text.replace(/\s*Length:\s*[\d.]+\s*seconds?\.?\s*$/i, '')} Length: ${seconds} seconds.`;
}

/** Valori da iniettare nel grafo per un media audio della chat (gli altri tipi non ne hanno). */
export function audioValues(media) {
  if (media?.type !== 'audio') return {};
  const { seconds, lyrics, bpm, keyscale: key, language } = media;
  return { prompt: finalPrompt(media.mode, media.prompt, seconds), seconds, lyrics, bpm, keyscale: key, language };
}

/**
 * Genera un audio e restituisce il file. Prende la GPU per ComfyUI: va chiamata fuori da gpu.run('ollama').
 * onEvent riceve gli eventi di comfy.run (progresso, nodo in esecuzione).
 */
export async function renderAudio({ kind, prompt, settings, seed = randomSeed(), signal, onEvent, priority = 'normal' }) {
  const w = audioWorkflow(kind);
  if (!w) throw new Error(`Nessun modello per ${KIND_LABEL[kind] || kind} installato su ComfyUI`);
  return gpu.run('comfy', kind === 'sfx' ? 'Generazione effetto sonoro' : 'Generazione musica', async () => {
    if (signal?.aborted) throw Object.assign(new Error('Annullato'), { aborted: true });
    const { files } = await comfy.run(buildGraph(w, { prompt: finalPrompt(kind, prompt, settings?.seconds), seed, ...settings }), { signal, onEvent });
    const out = files.find((f) => /\.(mp3|wav|flac|ogg|opus)$/i.test(f.filename)) || files[0];
    if (!out) throw new Error('ComfyUI non ha restituito alcun file audio');
    return { buffer: await comfy.fetchFile(out), ext: path.extname(out.filename).toLowerCase(), workflow: w };
  }, { priority });
}

/** Percorso di destinazione nella cartella di lavoro, sempre con l'estensione del file prodotto (.mp3). */
export function audioPath(user, rel, ext = '.mp3') {
  const { rel: r } = workspace.resolve(user, rel);
  if (!r || r.endsWith('/')) throw new workspace.WorkspaceError('Serve il nome del file, es. tetris/audio/musica.mp3');
  return r.replace(/\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|webm)$/i, '') + ext;
}

/**
 * Modalità Computer: genera gli audio chiesti nel turno (passaggi «audio» in attesa) e li scrive nella cartella di lavoro.
 * Si chiama a turno di chat finito, così la GPU passa da Ollama a ComfyUI. emitStep aggiorna l'interfaccia.
 */
export async function renderPendingAudio(steps, user, { signal, emitStep, priority }) {
  for (const step of steps) {
    if (step.action !== 'audio' || step.status !== 'running' || !step.pending) continue;
    delete step.pending;
    try {
      if (signal?.aborted) throw Object.assign(new Error('Interrotto'), { aborted: true });
      const { buffer, ext } = await renderAudio({
        kind: step.kind, prompt: step.prompt, settings: step.settings, signal, priority,
        onEvent: (e) => {
          if (e.type !== 'progress') return;
          step.progress = Math.round((e.value / Math.max(1, e.max)) * 100);
          emitStep(step);
        },
      });
      const rel = audioPath(user, step.path, ext);
      const { abs } = workspace.resolve(user, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, buffer);
      Object.assign(step, { path: rel, size: buffer.length, status: 'done' });
    } catch (e) {
      step.status = 'error';
      step.error = e.aborted ? 'Interrotto' : e.message;
      if (!e.aborted) console.error(`[audio] ${step.path}: ${e.message}`);
    }
    delete step.progress;
    step.finishedAt = Date.now();
    emitStep(step);
  }
}

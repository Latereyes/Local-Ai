import { buildGraph } from './workflows.js';

/**
 * Video lunghi e «continua» per MiniMax H3 (nodi di ComfyUI, verificati sul sorgente di ComfyUI 2026-10-09).
 *
 * - Fino a SINGLE secondi il video è un pezzo solo (il modello è addestrato su ~5-15 s).
 * - Oltre, si fa in pezzi da PART secondi: ogni pezzo continua il precedente. Il pezzo nuovo parte dagli ultimi
 *   fotogrammi del precedente (MiniMaxH3AddGuide con una clip di OVERLAP fotogrammi, audio compreso; se il nodo
 *   non c'è, solo dall'ultimo fotogramma come first_frame) e viene incollato in coda: immagini (ImageBatch) e audio
 *   (AudioConcat), togliendo i fotogrammi ripetuti. Ogni pezzo salva il video intero fin lì.
 * - «Continua» sotto un video fa la stessa cosa a partire da quel video.
 */
export const SINGLE = 15;
export const PART = 10;
export const MAX = 30;
export const OVERLAP = 22;    // fotogrammi del pezzo precedente che guidano il nuovo (clip valide: 5, 22, 39… = 17k+5)
const FPS = 24;

/** Pezzi di un video di `seconds` secondi: [15] fino a 15 s, poi [10, 10, …] con l'ultimo di almeno 4 s. */
export function planSegments(seconds) {
  const s = Math.max(2, Math.min(MAX, Math.round(Number(seconds) || 5)));
  if (s <= SINGLE) return [s];
  const parts = [];
  let left = s;
  while (left > 0) { const p = Math.min(PART, left); parts.push(p); left -= p; }
  if (parts.length > 1 && parts.at(-1) < 4) { const last = parts.pop(); parts[parts.length - 1] += last; }
  return parts;
}

/** Secondi chiesti a parole («un video di 20 secondi», «mezzo minuto», «20s»), o null. */
export function secondsFrom(text) {
  const t = String(text || '').toLowerCase();
  if (/\bmezzo minuto\b|\bhalf a minute\b/.test(t)) return 30;
  if (/\b(?:un|1|one) minut[oe]\b|\ba minute\b/.test(t)) return MAX;
  const m = t.match(/\b(\d{1,2})\s*(?:s\b|sec\w*|second\w*)/);
  return m ? Math.min(MAX, Number(m[1])) : null;
}

const align = (n) => { let f = Math.max(5, Math.round(n)); while (f % 17 !== 5) f++; return f; };

/** Fotogrammi da generare per un pezzo che continua: la parte nuova più quelli ripetuti all'inizio. */
export const continueFrames = (seconds, guide) => align((guide ? OVERLAP : 1) + Math.round(seconds * FPS));

/** Nodi che servono per continuare un video (i più recenti di ComfyUI). */
export const CONTINUE_NODES = ['LoadVideo', 'GetVideoComponents', 'ImageFromBatch', 'ImageBatch', 'AudioConcat', 'TrimAudioDuration'];
export const GUIDE_NODE = 'MiniMaxH3AddGuide';

/**
 * Grafo «continua»: parte dal workflow image to video di MiniMax H3 (stesse LoRA, stesso sampler) e al posto della
 * foto di partenza carica il video precedente (`video`, già caricato nella cartella input di ComfyUI).
 * guide: true = clip di OVERLAP fotogrammi (e il suo audio) con MiniMaxH3AddGuide; false = ultimo fotogramma.
 */
export function continueGraph(w, { video, prompt, seed, seconds, guide }) {
  const frames = continueFrames(seconds, guide);
  const overlap = guide ? OVERLAP : 1;
  const graph = buildGraph(w, { prompt, seed, frames, image: '__continua__' });
  const ids = Object.keys(graph);
  const find = (type) => ids.find((id) => graph[id].class_type === type);
  const i2v = find('MiniMaxH3ImageToVideo'), guider = find('BasicGuider'), create = find('CreateVideo');
  const decode = find('VAEDecode'), decodeAudio = find('VAEDecodeAudio');
  const vae = graph[i2v]?.inputs.vae, audioVae = graph[decodeAudio]?.inputs.vae;
  if (!i2v || !guider || !create || !decode) throw new Error('Workflow video senza i nodi attesi di MiniMax H3');
  // via la foto di partenza (LoadImage → ridimensiona → misure)
  for (const id of ids) if (['LoadImage', 'ImageScaleToTotalPixels', 'GetImageSize'].includes(graph[id].class_type)) delete graph[id];
  let n = Math.max(0, ...Object.keys(graph).map(Number).filter(Number.isFinite)) + 100;
  const node = (class_type, inputs, title) => { const id = String(++n); graph[id] = { class_type, inputs, ...(title ? { _meta: { title } } : {}) }; return id; };
  const load = node('LoadVideo', { file: video }, 'Video da continuare');
  const parts = node('GetVideoComponents', { video: [load, 0] });
  const size = node('GetImageSize', { image: [parts, 0] });
  const tail = node('ImageFromBatch', { image: [parts, 0], batch_index: -overlap, length: overlap }, 'Ultimi fotogrammi');
  Object.assign(graph[i2v].inputs, { width: [size, 0], height: [size, 1], length: frames });
  delete graph[i2v].inputs.first_frame;
  if (guide) {
    // la coda del video precedente (immagini e audio) guida l'inizio del pezzo nuovo
    const tailAudio = node('TrimAudioDuration', { audio: [parts, 1], start_index: -overlap / FPS, duration: overlap / FPS });
    const g = node(GUIDE_NODE, { positive: [i2v, 0], vae, audio_vae: audioVae, latent: [i2v, 1], image: [tail, 0], audio: [tailAudio, 0], frame_idx: 0 }, 'Continua da qui');
    graph[guider].inputs.conditioning = [g, 0];
  } else {
    graph[i2v].inputs.first_frame = [tail, 0];
  }
  // pezzo nuovo senza i fotogrammi ripetuti, in coda al video precedente (immagini e audio)
  const fresh = node('ImageFromBatch', { image: [decode, 0], batch_index: overlap, length: 4096 }, 'Parte nuova');
  const all = node('ImageBatch', { image1: [parts, 0], image2: [fresh, 0] }, 'Video intero');
  graph[create].inputs.images = [all, 0];
  if (decodeAudio && graph[create].inputs.audio) {
    const freshAudio = node('TrimAudioDuration', { audio: [decodeAudio, 0], start_index: overlap / FPS, duration: 3600 });
    const allAudio = node('AudioConcat', { audio1: [parts, 1], audio2: [freshAudio, 0], direction: 'after' });
    graph[create].inputs.audio = [allAudio, 0];
  }
  return graph;
}

/**
 * Video lungo: dopo il primo pezzo (first), i pezzi che lo continuano. Ognuno parte dalla fine del precedente
 * (continueOfId) e salva il video intero fin lì; si generano in ordine nella coda della GPU. wi = workflow image to video.
 */
export function addParts(first, segs, wi, { newId, seed }) {
  if (!first) return [];
  if (segs.length < 2 || !wi) return [first];
  const out = [{ ...first, part: { index: 1, total: segs.length } }];
  let total = first.seconds;
  for (let i = 1; i < segs.length; i++) {
    total += segs[i];
    out.push({ ...first, id: newId(), mode: 'continue', workflow: wi.id, workflowName: wi.name, seconds: segs[i], totalSeconds: total, frames: null,
      sourceMediaId: undefined, sourceFile: undefined, sourceUrl: undefined, seed: seed(), continueOfId: out.at(-1).id, part: { index: i + 1, total: segs.length } });
  }
  return out;
}

/** Riga per il prompt engineer di un pezzo che continua un video. */
export function partLine(part, seconds) {
  return (part?.total > 1
    ? `This is part ${part.index} of ${part.total} of ONE continuous video. It starts exactly where the previous part ends (its last moments are the starting frames, described below): continue the same action, place, people, clothes and light with no cut, and write only what happens in the next ${seconds} seconds.`
    : `This video CONTINUES an existing one: it starts exactly where the previous video ends (its last moments are the starting frames, described below). Continue the same scene with no cut and write only what happens in the next ${seconds} seconds.`)
    + ` There is NO starting picture here: do not mention <Picture 1> and do not recap the scene. Use this first line instead: "${CONTINUE_HEAD}" and begin the description with "[Shot 1] The shot continues with no cut:" followed by what happens next.`;
}

const CONTINUE_HEAD = 'For the target video, the shot continues exactly from the last moments of the previous video.';

/**
 * Prompt di un pezzo che continua: via i rimandi alla foto di partenza, che qui non c'è (c'è la coda del video).
 * Prova sul PC 2026-10-10: con la guida del workflow image to video Gemma scriveva «<Picture 1> is fully referenced» e
 * «the shot begins exactly from <Picture 1>», e ripartiva da capo con la descrizione della scena.
 */
export function continuePrompt(prompt) {
  return String(prompt || '')
    .replace(/^For the target video,[^\n]*<Picture 1>[^\n]*$/m, CONTINUE_HEAD)
    .replace(/,?\s*the shot (?:begins|starts) exactly from <Picture 1>\s*:?/gi, ', the shot continues with no cut:')
    .replace(/<Picture 1>/g, 'the previous video');
}

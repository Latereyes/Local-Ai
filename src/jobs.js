import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import config from './config.js';
import * as comfy from './comfy.js';
import * as store from './store.js';
import { gpu } from './gpu.js';
import { getWorkflow, buildGraph } from './workflows.js';
import { audioValues } from './audio.js';
import { melodyForComfy } from './melody.js';
import { applyKeepFace } from './faces.js';
import { continueGraph, continueFrames, CONTINUE_NODES, GUIDE_NODE } from './videochain.js';

/** Bus globale degli eventi verso il frontend (SSE). */
export const bus = new EventEmitter();
bus.setMaxListeners(100);
export const emit = (conversationId, evt) => bus.emit('event', { conversationId, ...evt });

const controllers = new Map(); // mediaId -> AbortController

/**
 * Grafo «continua» (videochain.js, da ChatBz): il video da continuare va nella cartella input di ComfyUI; con
 * MiniMaxH3AddGuide il pezzo nuovo parte dagli ultimi fotogrammi (e dall'audio), senza solo dall'ultimo fotogramma.
 */
async function continueGraphFor(w, media) {
  const has = await comfy.hasNodes([...CONTINUE_NODES, GUIDE_NODE]);
  const missing = CONTINUE_NODES.filter((n) => !has[n]);
  if (missing.length) throw new Error(`Per continuare un video serve un ComfyUI più recente (mancano i nodi: ${missing.join(', ')})`);
  const video = await comfy.uploadImage(await fs.readFile(path.join(config.paths.media, media.sourceFile)), `localai_${path.basename(media.sourceFile)}`);
  media.continueGuide = !!has[GUIDE_NODE];
  media.frames = continueFrames(media.seconds, media.continueGuide);
  return continueGraph(w, { video, prompt: media.prompt, seed: media.seed, seconds: media.seconds, guide: media.continueGuide });
}

export function mediaUrl(file) { return file ? `/media/${file}` : null; }

export function emitMedia(conv, msg, media) {
  emit(conv.id, { type: 'media', messageId: msg.id, media: { ...media, url: mediaUrl(media.file) } });
}

/** Mette in coda la generazione di un media già preparato (prompt pronto). */
export function enqueue(conv, msg, media) {
  const ac = new AbortController();
  controllers.set(media.id, ac);
  media.status = 'queued';
  emitMedia(conv, msg, media);
  store.save(conv);

  // un pezzo che continua un video usa il workflow image to video (il grafo lo cambia videochain.js)
  const w = getWorkflow(media.workflow, media.type, media.mode === 'continue' ? 'img2video' : media.mode);
  const label = media.type === 'video' ? 'Generazione video' : media.type === 'audio' ? (media.mode === 'sfx' ? 'Generazione effetto sonoro' : 'Generazione musica') : 'Generazione immagine';

  return gpu.run('comfy', label, async () => {
    if (ac.signal.aborted) throw Object.assign(new Error('Annullato'), { aborted: true });
    media.status = 'running';
    media.startedAt = Date.now();
    emitMedia(conv, msg, media);

    // Pezzo di un video lungo: parte dal pezzo precedente dello stesso messaggio (la coda della GPU è in ordine)
    if (media.continueOfId && !media.sourceFile) {
      const src = msg.media.find((x) => x.id === media.continueOfId);
      if (!src?.file || src.status !== 'done') throw new Error('La parte precedente del video non è riuscita');
      media.sourceFile = src.file;
      media.sourceUrl = mediaUrl(src.file);
    }

    // Immagine di partenza (image to image / image to video): va caricata su ComfyUI
    const upload = async (file) => comfy.uploadImage(await fs.readFile(path.join(config.paths.media, file)), `localai_${path.basename(file)}`);
    const image = media.sourceFile && media.mode !== 'continue' ? await upload(media.sourceFile) : undefined;
    const [image2, image3] = await Promise.all((media.extraSources || []).slice(0, 2).map(upload));
    // Melodia canticchiata: ripulita e ripetuta fino alla durata del brano (melody.js), poi caricata su ComfyUI
    const melody = media.melodyFile
      ? await comfy.uploadImage(melodyForComfy(await fs.readFile(path.join(config.paths.media, media.melodyFile)), media.seconds).buffer, `localai_melody_${media.id}.wav`)
      : undefined;

    const values = {
      prompt: media.prompt, seed: media.seed,
      width: media.width, height: media.height, frames: media.frames,
      image, image2, image3, denoise: media.denoise,
      // audio (audio.js): durata, testo della canzone, BPM, tonalità e lingua
      ...audioValues(media), melody,
    };
    let graph = media.mode === 'continue' ? await continueGraphFor(w, media) : buildGraph(w, values);
    const keepFace = media.keepFace && applyKeepFace(graph, w.keepFace);

    let lastPreview = 0;
    const render = (g) => comfy.run(g, {
      signal: ac.signal,
      onEvent: (e) => {
        if (e.type === 'progress') emit(conv.id, { type: 'progress', mediaId: media.id, value: e.value, max: e.max });
        else if (e.type === 'node') emit(conv.id, { type: 'progress', mediaId: media.id, phase: e.title });
        else if (e.type === 'preview' && Date.now() - lastPreview > 350) {
          lastPreview = Date.now();
          emit(conv.id, { type: 'preview', mediaId: media.id, dataUrl: e.dataUrl });
        }
      },
    });
    let files;
    try {
      ({ files } = await render(graph));
      media.faceKept = keepFace || undefined;
    } catch (e) {
      // Nodi dell'Impact Pack mancanti o diversi sul PC: si rifà la modifica come prima, senza ricucire il volto
      if (!keepFace || e.aborted || ac.signal.aborted) throw e;
      console.warn(`[job ${media.id}] volto originale non rimesso, rifaccio senza: ${e.message}`);
      graph = buildGraph(w, values);
      ({ files } = await render(graph));
      media.faceKept = false;
    }

    const out = files.find((f) => /\.(mp4|webm|mov|gif)$/i.test(f.filename)) || files[0];
    if (!out) throw new Error('ComfyUI non ha restituito alcun file');
    const buf = await comfy.fetchFile(out);
    const name = `${conv.ownerId}/${media.id}${path.extname(out.filename).toLowerCase()}`;
    await fs.mkdir(path.join(config.paths.media, conv.ownerId), { recursive: true });
    await fs.writeFile(path.join(config.paths.media, name), buf);
    media.file = name;
    media.status = 'done';
    media.finishedAt = Date.now();
  }, { priority: 'normal' }).catch((e) => {
    media.status = e.aborted || ac.signal.aborted ? 'cancelled' : 'error';
    media.error = media.status === 'cancelled' ? null : e.message;
    if (media.status === 'error') console.error(`[job ${media.id}]`, e.message);
  }).finally(() => {
    controllers.delete(media.id);
    emitMedia(conv, msg, media);
    store.save(conv, { touch: false });
  });
}

export function cancel(mediaId) {
  const ac = controllers.get(mediaId);
  if (!ac) return false;
  ac.abort();
  return true;
}

/** All'avvio: i lavori rimasti a metà (server riavviato) vengono marcati come interrotti. */
export function recoverInterrupted() {
  for (const { id } of store.list()) {
    const c = store.get(id);
    let dirty = false;
    for (const m of c.messages) {
      if (m.status === 'streaming' || m.status === 'pending') { m.status = 'stopped'; dirty = true; }
      for (const md of m.media || []) {
        if (['queued', 'running', 'engineering'].includes(md.status)) {
          md.status = 'error'; md.error = 'Interrotto (server riavviato)'; dirty = true;
        }
      }
    }
    if (dirty) store.save(c, { touch: false });
  }
}

/** Richiesta di descrizione di un'immagine allegata (la usano Qwen3-VL su ComfyUI e i modelli Ollama che vedono). */
export function describePrompt(question) {
  return `Analizza questa immagine per un assistente che non può vederla. Descrivi in italiano, in modo oggettivo e completo: tipo di immagine (foto, screenshot, illustrazione, documento…), soggetti (aspetto, età apparente, abbigliamento, espressione, posa), oggetti, ambiente, colori, luce, stile, composizione e inquadratura. Trascrivi fedelmente tutto il testo visibile.${question ? ` Includi in particolare i dettagli utili per rispondere a questa richiesta dell'utente: «${question.slice(0, 500)}»` : ''}`;
}

/**
 * Lettura di un'immagine con il modello visivo di ComfyUI (Qwen3-VL).
 * Va chiamata con la GPU già assegnata a ComfyUI (dentro gpu.run('comfy', ...)).
 */
export async function describeImage(file, question) {
  const w = getWorkflow(null, 'vision');
  if (!w) throw new Error('Nessun workflow di lettura immagini installato');
  const buf = await fs.readFile(path.join(config.paths.media, file));
  const image = await comfy.uploadImage(buf, `localai_${path.basename(file)}`);
  const prompt = describePrompt(question);
  const { texts } = await comfy.run(buildGraph(w, { image, prompt }));
  const text = (texts[0] || '').trim();
  if (!text) throw new Error('Il modello visivo non ha restituito testo');
  return text;
}

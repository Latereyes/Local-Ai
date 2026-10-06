import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import config from './config.js';
import * as comfy from './comfy.js';
import * as store from './store.js';
import { gpu } from './gpu.js';
import { getWorkflow, buildGraph } from './workflows.js';

/** Bus globale degli eventi verso il frontend (SSE). */
export const bus = new EventEmitter();
bus.setMaxListeners(100);
export const emit = (conversationId, evt) => bus.emit('event', { conversationId, ...evt });

const controllers = new Map(); // mediaId -> AbortController

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

  const w = getWorkflow(media.workflow, media.type, media.mode);
  const label = media.type === 'video' ? 'Generazione video' : 'Generazione immagine';

  return gpu.run('comfy', label, async () => {
    if (ac.signal.aborted) throw Object.assign(new Error('Annullato'), { aborted: true });
    media.status = 'running';
    media.startedAt = Date.now();
    emitMedia(conv, msg, media);

    // Immagine di partenza (image to image / image to video): va caricata su ComfyUI
    const upload = async (file) => comfy.uploadImage(await fs.readFile(path.join(config.paths.media, file)), `localai_${path.basename(file)}`);
    const image = media.sourceFile ? await upload(media.sourceFile) : undefined;
    const [image2, image3] = await Promise.all((media.extraSources || []).slice(0, 2).map(upload));

    const graph = buildGraph(w, {
      prompt: media.prompt, seed: media.seed,
      width: media.width, height: media.height, frames: media.frames,
      image, image2, image3, denoise: media.denoise,
    });

    let lastPreview = 0;
    const { files } = await comfy.run(graph, {
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

    const out = files.find((f) => /\.(mp4|webm|mov|gif)$/i.test(f.filename)) || files[0];
    if (!out) throw new Error('ComfyUI non ha restituito alcun file');
    const buf = await comfy.fetchFile(out);
    const name = `${conv.ownerId}/${media.id}${path.extname(out.filename).toLowerCase()}`;
    await fs.mkdir(path.join(config.paths.media, conv.ownerId), { recursive: true });
    await fs.writeFile(path.join(config.paths.media, name), buf);
    media.file = name;
    media.status = 'done';
    media.finishedAt = Date.now();
  }).catch((e) => {
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

/**
 * Lettura di un'immagine con il modello visivo di ComfyUI (Qwen3-VL).
 * Va chiamata con la GPU già assegnata a ComfyUI (dentro gpu.run('comfy', ...)).
 */
export async function describeImage(file, question) {
  const w = getWorkflow(null, 'vision');
  if (!w) throw new Error('Nessun workflow di lettura immagini installato');
  const buf = await fs.readFile(path.join(config.paths.media, file));
  const image = await comfy.uploadImage(buf, `localai_${path.basename(file)}`);
  const prompt = `Analizza questa immagine per un assistente che non può vederla. Descrivi in italiano, in modo oggettivo e completo: tipo di immagine (foto, screenshot, illustrazione, documento…), soggetti (aspetto, età apparente, abbigliamento, espressione, posa), oggetti, ambiente, colori, luce, stile, composizione e inquadratura. Trascrivi fedelmente tutto il testo visibile.${question ? ` Includi in particolare i dettagli utili per rispondere a questa richiesta dell'utente: «${question.slice(0, 500)}»` : ''}`;
  const { texts } = await comfy.run(buildGraph(w, { image, prompt }));
  const text = (texts[0] || '').trim();
  if (!text) throw new Error('Il modello visivo non ha restituito testo');
  return text;
}

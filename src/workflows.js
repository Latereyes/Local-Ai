import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

/**
 * Ogni workflow vive in workflows/<id>/ con:
 *   manifest.json  – metadati e mappatura dei parametri sui nodi
 *   workflow.json  – grafo ComfyUI in formato API ("Export (API)")
 *   guide.md       – istruzioni per il prompt engineer specifiche del modello
 */

export const ASPECTS = {
  '1:1': 1, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3,
  '16:9': 16 / 9, '9:16': 9 / 16, '21:9': 21 / 9,
};

let cache = null;

export function loadWorkflows() {
  const dir = config.paths.workflows;
  const list = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const folder = path.join(dir, entry.name);
    const manifestPath = path.join(folder, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const graph = JSON.parse(fs.readFileSync(path.join(folder, 'workflow.json'), 'utf8'));
      const guidePath = path.join(folder, 'guide.md');
      const guide = fs.existsSync(guidePath) ? fs.readFileSync(guidePath, 'utf8') : '';
      const mode = manifest.mode || (manifest.type === 'image' ? 'text2img' : manifest.type === 'video' ? 'text2video' : manifest.type);
      // i workflow con modelli richiesti restano disattivi finché checkAvailability non ne conferma la presenza
      list.push({ ...manifest, mode, id: manifest.id || entry.name, graph, guide, available: !manifest.requires?.length });
    } catch (e) {
      console.error(`[workflows] ${entry.name}: ${e.message}`);
    }
  }
  cache = list;
  return list;
}

/** Workflow per tipo (image/video/vision) e modalità (default: da testo). */
export function workflows(type, mode) {
  const list = cache || loadWorkflows();
  if (!type) return list;
  const m = mode || (type === 'image' ? 'text2img' : type === 'video' ? 'text2video' : type);
  return list.filter((w) => w.type === type && w.mode === m && w.available !== false);
}

export function getWorkflow(id, type, mode) {
  const list = workflows(type, mode);
  return list.find((w) => w.id === id) || list.find((w) => w.base && w.base === id) || list.find((w) => w.default) || list[0];
}

export function publicInfo(w) {
  return {
    id: w.id, name: w.name, type: w.type, mode: w.mode, base: w.base || null, description: w.description,
    default: !!w.default, duration: w.duration || null,
    available: w.available !== false, missing: w.missing || [],
  };
}

export function dimensions(w, aspect) {
  return dimensionsForRatio(w, ASPECTS[aspect] || 1);
}

/** Dimensioni per un rapporto larghezza/altezza qualsiasi (es. quello di un'immagine di partenza). */
export function dimensionsForRatio(w, ratio) {
  const { megapixels = 1, multiple = 16, maxShortEdge } = w.resolution || {};
  const area = megapixels * 1024 * 1024;
  let width = Math.sqrt(area * ratio);
  let height = width / ratio;
  if (maxShortEdge) {
    const k = Math.min(1, maxShortEdge / Math.min(width, height));
    width *= k; height *= k;
  }
  const snap = (v) => Math.max(multiple, Math.round(v / multiple) * multiple);
  return { width: snap(width), height: snap(height) };
}

/** Numero di frame valido per la durata richiesta (es. griglia 17k+5 di MiniMax H3). */
export function frameCount(w, seconds) {
  const d = w.duration || {};
  const fps = d.fps || 24, step = d.frameStep || 1, offset = d.frameOffset || 0;
  const secs = Math.min(d.max || 10, Math.max(d.min || 1, Number(seconds) || d.default || 5));
  const raw = Math.max(offset || 1, Math.round(secs * fps));
  const rem = (((raw - offset) % step) + step) % step;
  return { seconds: secs, frames: rem ? raw + (step - rem) : raw };
}

export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 48);
}

/** Costruisce il grafo finale iniettando i parametri. */
export function buildGraph(w, values) {
  const graph = structuredClone(w.graph);
  for (const [param, targets] of Object.entries(w.params || {})) {
    const v = values[param];
    if (v === undefined || v === null || v === '') {
      // parametro opzionale non fornito (es. immagine 2/3): il nodo viene staccato dal grafo
      for (const t of targets) if (t.optional) pruneNode(graph, t.node);
      continue;
    }
    for (const { node, input } of targets) {
      if (!graph[node]) throw new Error(`Workflow ${w.id}: nodo ${node} inesistente`);
      graph[node].inputs[input] = values[param];
    }
  }
  return graph;
}

function pruneNode(graph, id) {
  delete graph[id];
  for (const n of Object.values(graph)) {
    for (const [k, val] of Object.entries(n.inputs || {})) if (Array.isArray(val) && String(val[0]) === String(id)) delete n.inputs[k];
  }
}

/**
 * Segna come disponibili solo i workflow i cui file (manifest "requires") esistono su ComfyUI.
 * listModels(folder) → elenco file della cartella modelli di ComfyUI.
 */
export async function checkAvailability(listModels) {
  const list = cache || loadWorkflows();
  const folders = new Map();
  for (const wf of list) {
    if (!wf.requires?.length) { wf.available = true; continue; }
    const missing = [];
    for (const { folder, file } of wf.requires) {
      if (!folders.has(folder)) folders.set(folder, await listModels(folder).catch(() => null));
      const files = folders.get(folder);
      // ComfyUI su Windows elenca le sottocartelle con \ (es. bbox\face_yolov8m.pt)
      if (files && !files.some((f) => f.replace(/\\/g, '/') === file)) missing.push(`${folder}/${file}`);
      if (!files) missing.push(`${folder}/? (ComfyUI non raggiungibile)`);
    }
    wf.available = missing.length === 0;
    wf.missing = missing;
  }
  return list;
}

/**
 * Volto invariato nelle modifiche a istruzioni (Qwen-Image-Edit).
 * Qwen ridisegna tutta la foto e il FaceDetailer (Juggernaut) ridisegna di nuovo il volto: la persona cambia un po'.
 * Qui, dopo la modifica, si rimette il volto ORIGINALE (pixel della foto di partenza) dove YOLO (face_yolov8m)
 * lo trova sia prima sia dopo nello stesso punto. Stessa tecnica del workflow qwen-scene-real (ImageCompositeMasked
 * con maschera sfumata) e dei ritocchi dei volti di ChatBz (Impact Pack).
 */

// La modifica riguarda il volto, la testa, la luce o lo stile di tutta la foto: lì il volto originale stonerebbe
// (o è proprio quello che l'utente vuole cambiare). Italiano e inglese.
// WORDS: parole intere («cap» non deve prendere «cappotto»); STEMS: inizi di parola («sorrid» → sorride, sorridente).
const WORDS = [
  'viso', 'visi', 'volto', 'volti', 'faccia', 'facce', 'faces?', 'facial', 'lineamenti', 'features',
  'espressione', 'espressioni', 'expressions?', 'sorriso', 'sorrisi', 'smile', 'smiles', 'smiling', 'ridere', 'risata', 'laugh(ing)?', 'grin',
  'serio', 'seria', 'triste', 'sad', 'angry', 'occhiolino', 'wink', 'cry', 'crying',
  'occhi', 'eyes?', 'sguardo', 'gaze', 'bocca', 'mouth', 'labbra', 'lips?', 'denti', 'teeth', 'naso', 'nose',
  'sopracciglia', 'eyebrows?', 'ciglia', 'eyelash(es)?', 'guance', 'cheeks?', 'mento', 'chin', 'forehead', 'orecchie', 'ears?',
  'make-?up', 'rossetto', 'lipstick', 'mascara', 'ombretto', 'eyeshadow', 'freckles?', 'neo', 'rughe', 'wrinkles?', 'acne', 'pimples?', 'scars?',
  'barba', 'beard', 'baffi', 'must?ache', 'shaved?',
  'capelli', 'hair', 'haircut', 'hairstyle', 'pettinatura', 'frangia', 'bangs', 'calvo', 'calva', 'bald', 'bruna', 'redhead',
  'occhiali', 'glasses', 'sunglasses', 'cappello', 'cappelli', 'hats?', 'caps?', 'beanie', 'casco', 'helmet', 'maschera', 'masks?',
  'velo', 'veil', 'corona', 'crown', 'bandana', 'cuffie', 'headphones', 'earrings?', 'piercing',
  'età', 'anni', 'older', 'younger', 'aging', 'age', 'anziano', 'anziana',
  'pelle', 'skin', 'tan', 'tanned', 'pallido', 'pallida', 'pale',
  'stile', 'style', 'anime', 'manga', 'cartoon', 'fumetto', 'drawing', 'painting', 'pittura', 'sketch', 'schizzo', '3d', 'pixel art', 'lego', 'claymation', 'ghibli', 'pixar', 'disney',
  'luce', 'luci', 'lighting', 'notte', 'night', 'tramonto', 'sunset', 'alba', 'sunrise', 'buio',
  'bianco e nero', 'black and white', 'b/n', 'seppia', 'sepia', 'vintage', 'filtro', 'filter', 'color grading', 'neon', 'controluce', 'backlit',
  'zoom', 'inquadratura', 'crop', 'ritaglia', 'angolazione', 'angle', 'prospettiva', 'perspective', 'ruota', 'rotate', 'capovolgi', 'flip', 'specchia',
];
const STEMS = [
  'sorrid', 'arrabbiat', 'piang', 'trucc', 'lentiggin', 'brufol', 'cicatric', 'rasat', 'biond', 'berrett', 'orecchin',
  'invecchi', 'ringiovan', 'più giovan', 'più vecchi', 'abbronzat', 'disegn', 'dipint', 'acquerell', 'watercolo', 'illustra',
  'realistic', 'fotorealistic', 'photorealistic', 'illumin', 'face ?swap', 'scambi[ao] (di )?(volto|faccia)',
];
const FACE_WORDS = [
  new RegExp(`(^|[^\\p{L}\\d])(${WORDS.join('|')})(?![\\p{L}\\d])`, 'iu'),
  new RegExp(`(^|[^\\p{L}\\d])(${STEMS.join('|')})`, 'iu'),
  // «sostituisci la persona», «replace the man with…»
  /\b(sostituisci|scambia|replace|swap)\b.{0,30}\b(persona|person|uomo|donna|man|woman|ragazz[oa]|guy|girl)\b/i,
];

/** La richiesta tocca il volto (o la luce/lo stile di tutta la foto)? Allora il volto originale non si rimette. */
export function touchesFace(text) {
  const t = String(text || '');
  return FACE_WORDS.some((re) => re.test(t));
}

// Valori della ricucitura (provati sul workflow qwen-scene-real: dilatazione 10, sfumatura 31/12).
// ioa: quanta parte del riquadro del volto originale deve coincidere con un volto trovato dopo la modifica
// (sotto questa soglia la persona si è spostata o non c'è più, e incollare il volto vecchio lo sdoppierebbe).
export const KEEP_FACE = { threshold: 0.5, dilation: 10, ioa: 0.9, blur: 31, sigma: 12 };

/**
 * Aggiunge al grafo la ricucitura del volto originale. spec (dal manifest «keepFace»):
 *   source: nodo con la foto di partenza alla stessa risoluzione dell'uscita (es. FluxKontextImageScale)
 *   edited: nodo con la foto modificata prima della rifinitura (per ritrovare i volti)
 *   image: nodo con la foto finale su cui incollare (es. FaceDetailer)
 *   save: nodo SaveImage
 *   detector: UltralyticsDetectorProvider con bbox/face_yolov8m.pt
 * Restituisce false se il grafo non ha i nodi attesi.
 */
export function applyKeepFace(graph, spec, values = KEEP_FACE) {
  const { source, edited, image, save, detector } = spec || {};
  if (![source, edited, image, save, detector].every((id) => graph[id])) return false;
  let next = Math.max(0, ...Object.keys(graph).map(Number).filter(Number.isFinite)) + 1;
  const node = (class_type, inputs, title) => {
    const id = String(next++);
    graph[id] = { class_type, inputs, _meta: { title } };
    return id;
  };
  const detect = (img, title) => node('BboxDetectorSEGS', {
    bbox_detector: [detector, 0], image: [img, 0], threshold: values.threshold, dilation: values.dilation,
    crop_factor: 1.2, drop_size: 10, labels: 'all',
  }, title);
  const before = detect(source, 'Volti nella foto di partenza');
  const after = detect(edited, 'Volti nella foto modificata');
  // Il filtro «intersection» TOGLIE i segmenti che si sovrappongono: prima si trovano i volti spariti o spostati,
  // poi si tolgono quelli dai volti di partenza. Restano i volti rimasti al loro posto.
  const moved = node('ImpactSEGSIntersectionFilter', { segs1: [before, 0], segs2: [after, 0], ioa_threshold: values.ioa }, 'Volti spostati o spariti');
  const kept = node('ImpactSEGSIntersectionFilter', { segs1: [before, 0], segs2: [moved, 0], ioa_threshold: 0.99 }, 'Volti rimasti al loro posto');
  const mask = node('SegsToCombinedMask', { segs: [kept, 0] }, 'Maschera dei volti');
  const soft = node('ImpactGaussianBlurMask', { mask: [mask, 0], kernel_size: values.blur, sigma: values.sigma }, 'Maschera sfumata');
  const paste = node('ImageCompositeMasked', {
    destination: [image, 0], source: [source, 0], x: 0, y: 0, resize_source: false, mask: [soft, 0],
  }, 'Volto originale sulla foto modificata');
  graph[save].inputs.images = [paste, 0];
  return true;
}

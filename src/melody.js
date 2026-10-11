/**
 * Melodia canticchiata: il browser registra e manda un WAV; qui si legge, si stimano tonalità e tempo
 * (aiutano ACE-Step a non «litigare» con la melodia) e si prepara il file per ComfyUI:
 * senza silenzi all'inizio e alla fine, normalizzato, stereo, ripetuto fino alla durata del brano.
 * In ACE-Step 1.5 (modalità cover, nodo ReferenceTimbreAudio) la parte dopo la fine dell'audio
 * di riferimento diventa silenzio: per un brano più lungo della melodia la melodia si ripete.
 */

export const MAX_SECONDS = 60;      // registrazione massima accettata
export const MIN_VOICED = 1.5;      // secondi di voce intonata sotto cui non c'è una melodia

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
// profili tonali di Krumhansl-Kessler (peso di ogni grado della scala)
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Legge un WAV PCM (8/16/24/32 bit) o float a 32 bit e restituisce il canale mono. */
export function parseWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Il file non è un WAV valido');
  }
  let fmt = null, data = null;
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    const body = p + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
      if (fmt.format === 0xfffe && size >= 26) fmt.format = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE
    } else if (id === 'data') {
      data = buf.subarray(body, Math.min(buf.length, body + size));
    }
    p = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('Il file WAV è incompleto');
  const { format, channels, sampleRate, bits } = fmt;
  const pcm = format === 1 && [8, 16, 24, 32].includes(bits);
  const float = format === 3 && bits === 32;
  if ((!pcm && !float) || !channels || sampleRate < 8000 || sampleRate > 192000) throw new Error('Formato WAV non supportato');
  const step = (bits / 8) * channels;
  const n = Math.floor(data.length / step);
  const read = float ? (o) => data.readFloatLE(o)
    : bits === 8 ? (o) => (data[o] - 128) / 128
    : bits === 16 ? (o) => data.readInt16LE(o) / 32768
    : bits === 24 ? (o) => data.readIntLE(o, 3) / 8388608
    : (o) => data.readInt32LE(o) / 2147483648;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let c = 0; c < channels; c++) s += read(i * step + c * (bits / 8));
    samples[i] = s / channels;
  }
  return { samples, sampleRate };
}

/** WAV PCM a 16 bit dai canali dati (Float32Array, stessa lunghezza). */
export function encodeWav(channels, sampleRate) {
  const n = channels[0].length, ch = channels.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + n * ch * 2, 4);
  buf.write('WAVEfmt ', 8, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  return buf;
}

/** Media a blocchi di `factor` campioni: basta come passa-basso per la voce (fondamentale sotto 1 kHz). */
function downsample(x, factor) {
  if (factor <= 1) return x;
  const out = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    for (let j = 0; j < factor; j++) s += x[i * factor + j];
    out[i] = s / factor;
  }
  return out;
}

function rmsAt(x, start, len) {
  let s = 0;
  const end = Math.min(x.length, start + len);
  for (let i = start; i < end; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, end - start));
}

/**
 * Altezza di un frame con YIN (de Cheveigné e Kawahara): frequenza in Hz, o 0 se il frame non è intonato.
 * minLag/maxLag limitano la ricerca alla voce (circa 70-1000 Hz).
 */
function yin(x, start, win, minLag, maxLag, sr) {
  const d = new Float32Array(maxLag + 2);
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let s = 0;
    for (let j = 0; j < win; j++) { const v = x[start + j] - x[start + j + tau]; s += v * v; }
    d[tau] = s;
  }
  // differenza normalizzata cumulativa: il primo minimo sotto soglia è il periodo
  let running = 0;
  const cmnd = new Float32Array(maxLag + 2);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxLag + 1; tau++) { running += d[tau]; cmnd[tau] = running ? (d[tau] * tau) / running : 1; }
  let tau = -1;
  for (let t = minLag; t <= maxLag; t++) {
    if (cmnd[t] < 0.2) {
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) return 0;
  // interpolazione parabolica attorno al minimo
  const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
  const den = a + c - 2 * b;
  const shift = den ? (a - c) / (2 * den) : 0;
  return sr / (tau + Math.max(-1, Math.min(1, shift)));
}

/** Tonalità dal profilo delle note cantate (correlazione con i profili di Krumhansl-Kessler). */
export function estimateKey(midiNotes, weights) {
  if (midiNotes.length < 8) return null;
  const hist = new Array(12).fill(0);
  midiNotes.forEach((m, i) => { hist[((Math.round(m) % 12) + 12) % 12] += weights?.[i] ?? 1; });
  const corr = (profile, root) => {
    const xs = hist, ys = NAMES.map((_, i) => profile[(i - root + 12) % 12]);
    const mx = xs.reduce((a, b) => a + b) / 12, my = ys.reduce((a, b) => a + b) / 12;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < 12; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  };
  let best = null;
  for (let root = 0; root < 12; root++) {
    for (const [mode, profile] of [['major', MAJOR], ['minor', MINOR]]) {
      const r = corr(profile, root);
      if (!best || r > best.r) best = { r, key: `${NAMES[root]} ${mode}` };
    }
  }
  return best.r >= 0.5 ? best.key : null;
}

/**
 * Tempo in BPM dall'inviluppo degli attacchi (energia che sale e cambi di nota), con l'autocorrelazione
 * e una preferenza per i tempi comuni (attorno a 110). null se non c'è un ritmo riconoscibile.
 */
export function estimateTempo(onsets, hopSeconds) {
  const n = onsets.length;
  if (n * hopSeconds < 3) return null;
  const mean = onsets.reduce((a, b) => a + b, 0) / n;
  const o = onsets.map((v) => v - mean);
  const ac = (lag) => { let s = 0; for (let i = 0; i + lag < n; i++) s += o[i] * o[i + lag]; return s / (n - lag); };
  const zero = ac(0);
  if (!zero) return null;
  const minLag = Math.max(1, Math.floor(60 / (200 * hopSeconds)));
  const maxLag = Math.min(n - 2, Math.ceil(60 / (50 * hopSeconds)));
  let best = null;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 / (lag * hopSeconds);
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 110) / 0.9) ** 2);
    const v = ac(lag);
    if (!best || v * prior > best.score) best = { score: v * prior, lag, v };
  }
  if (!best || best.v / zero < 0.08) return null;
  // interpolazione parabolica del picco
  const a = ac(best.lag - 1), b = best.v, c = best.lag + 1 <= maxLag ? ac(best.lag + 1) : b;
  const den = a + c - 2 * b;
  const lag = best.lag + (den < 0 ? Math.max(-0.5, Math.min(0.5, (a - c) / (2 * den))) : 0);
  let bpm = 60 / (lag * hopSeconds);
  while (bpm < 70) bpm *= 2;
  while (bpm > 170) bpm /= 2;
  return Math.round(bpm);
}

/**
 * Analisi della registrazione: durata utile (senza i silenzi ai bordi), secondi di voce intonata,
 * tonalità e tempo stimati. start/end (in secondi) delimitano la parte utile.
 */
export function analyze({ samples, sampleRate }) {
  const factor = Math.max(1, Math.round(sampleRate / 12000));
  const x = downsample(samples, factor);
  const sr = sampleRate / factor;
  const hop = Math.round(sr * 0.01);               // inviluppo ogni 10 ms
  const frame = Math.round(sr * 0.04);
  const env = [];
  for (let i = 0; i + frame <= x.length; i += hop) env.push(rmsAt(x, i, frame));
  const peak = env.reduce((a, b) => Math.max(a, b), 0);
  const total = samples.length / sampleRate;
  const empty = { seconds: total, voicedSeconds: 0, key: null, bpm: null, start: 0, end: total };
  if (peak < 1e-3) return empty;
  const floor = Math.max(peak * 0.08, 2e-3);

  // bordi: primo e ultimo frame sopra la soglia del silenzio, con un margine di 0,1 s
  const first = env.findIndex((v) => v > floor);
  const last = env.length - 1 - [...env].reverse().findIndex((v) => v > floor);
  const start = Math.max(0, (first * hop) / sr - 0.1);
  const end = Math.min(total, ((last * hop + frame) / sr) + 0.1);

  // altezza ogni 4 frame dell'inviluppo (40 ms) con YIN
  const minLag = Math.floor(sr / 1000), maxLag = Math.ceil(sr / 70);
  const win = Math.round(sr * 0.03);
  const notes = [], weights = [];
  const onsets = new Array(env.length).fill(0);
  let prevMidi = null, voiced = 0;
  for (let k = 0; k < env.length; k += 4) {
    const i = k * hop;
    if (env[k] <= floor || i + win + maxLag + 2 > x.length) { prevMidi = null; continue; }
    const f = yin(x, i, win, minLag, maxLag, sr);
    if (!f) { prevMidi = null; continue; }
    const midi = 69 + 12 * Math.log2(f / 440);
    notes.push(midi);
    weights.push(env[k]);
    voiced++;
    // un cambio di nota conta come attacco anche se il volume non cambia (il canticchiato è legato)
    if (prevMidi !== null && Math.abs(midi - prevMidi) > 0.7) onsets[k] += 0.5 * env[k];
    prevMidi = midi;
  }
  for (let k = 1; k < env.length; k++) onsets[k] += Math.max(0, env[k] - env[k - 1]);

  const hopSeconds = hop / sr;
  return {
    seconds: Math.round((end - start) * 10) / 10,
    voicedSeconds: Math.round(voiced * 4 * hopSeconds * 10) / 10,
    key: estimateKey(notes, weights),
    bpm: estimateTempo(onsets.slice(Math.floor(start / hopSeconds), Math.ceil(end / hopSeconds)), hopSeconds),
    start: Math.round(start * 1000) / 1000,
    end: Math.round(end * 1000) / 1000,
  };
}

/**
 * File per ComfyUI: la parte utile della registrazione, normalizzata (-1 dBFS), con dissolvenze di 15 ms
 * ai bordi (niente click) e ripetuta fino a coprire `seconds`. Stereo, come il VAE di ACE-Step.
 */
export function melodyForComfy(wav, seconds) {
  const { samples, sampleRate } = parseWav(wav);
  const info = analyze({ samples, sampleRate });
  const a = Math.floor(info.start * sampleRate), b = Math.max(a + 1, Math.floor(info.end * sampleRate));
  const part = samples.slice(a, b);
  let peak = 0;
  for (const v of part) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 1e-4 ? 0.89 / peak : 1;
  const fade = Math.min(Math.floor(sampleRate * 0.015), Math.floor(part.length / 2));
  for (let i = 0; i < part.length; i++) {
    const edge = Math.min(i, part.length - 1 - i);
    part[i] *= gain * (edge < fade ? edge / fade : 1);
  }
  const total = Math.max(part.length, Math.ceil(Number(seconds) * sampleRate) || 0);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) out[i] = part[i % part.length];
  return { buffer: encodeWav([out, out], sampleRate), repeats: Math.ceil(total / part.length), info };
}

/**
 * Controlla una registrazione caricata dall'utente: WAV leggibile, non più lunga di MAX_SECONDS
 * e con abbastanza voce intonata. Restituisce durata utile, tonalità e tempo stimati.
 */
export function checkMelody(wav) {
  const audio = parseWav(wav);
  const total = audio.samples.length / audio.sampleRate;
  if (total > MAX_SECONDS + 1) throw new Error(`Registrazione troppo lunga (massimo ${MAX_SECONDS} secondi)`);
  const info = analyze(audio);
  if (info.voicedSeconds < MIN_VOICED) throw new Error('Non sento una melodia: canticchia più forte o più vicino al microfono e riprova');
  return { seconds: info.seconds, key: info.key, bpm: info.bpm };
}

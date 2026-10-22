// LocalAI — conversazione a voce: microfono con rilevamento della voce, trascrizione sul PC (Whisper)
// e risposta letta frase per frase mentre Gemma la scrive (Piper). Il server fa da tramite: /api/voice/*.

const MIN_CHUNK = 24;      // caratteri minimi di una frase da leggere (le brevissime si uniscono alla successiva)
const MAX_CHUNK = 240;     // oltre, si spezza a una virgola o a uno spazio per non far aspettare
const RATE = 16000;        // Whisper lavora a 16 kHz: si riduce qui, l'invio pesa un terzo

/**
 * Prossimo pezzo da leggere della risposta che sta arrivando: { text, pos } (pos = fin dove è consumata).
 * Si ferma alla fine di una frase; i blocchi di codice non si leggono ma si annunciano. final = risposta finita.
 */
export function nextSpeech(content, pos, final = false) {
  const rest = content.slice(pos);
  const fence = rest.indexOf('```');
  if (fence === 0) {
    const close = rest.indexOf('```', 3);
    if (close < 0) return { text: '', pos: final ? content.length : pos };
    return { text: '(codice sullo schermo)', pos: pos + close + 3 };
  }
  const prose = fence > 0 ? rest.slice(0, fence) : rest;
  // fine frase: punteggiatura seguita da spazio o a capo (così «3.5» e «www.sito.it» non spezzano)
  const re = /[.!?…;:]+["»)\]]*(?=\s)|\n+/g;
  let m;
  while ((m = re.exec(prose))) {
    const end = m.index + m[0].length;
    if (end >= MIN_CHUNK || /\n/.test(m[0]) && prose.slice(0, end).trim()) return { text: prose.slice(0, end), pos: pos + end };
  }
  if (fence > 0 || final) return { text: prose, pos: pos + prose.length };
  if (prose.length > MAX_CHUNK) {
    const cut = Math.max(prose.lastIndexOf(', ', MAX_CHUNK), prose.lastIndexOf(' ', MAX_CHUNK));
    if (cut > MIN_CHUNK) return { text: prose.slice(0, cut + 1), pos: pos + cut + 1 };
  }
  return { text: '', pos };
}

/** Riduce a 16 kHz mono (media dei campioni) e scrive un WAV a 16 bit. */
export function encodeWav(frames, sampleRate) {
  const total = frames.reduce((n, f) => n + f.length, 0);
  const ratio = sampleRate / RATE;
  const n = Math.floor(total / ratio);
  const all = new Float32Array(total);
  let o = 0;
  for (const f of frames) { all.set(f, o); o += f.length; }
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (off, s) => [...s].forEach((ch, i) => out.setUint8(off + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, RATE, true); out.setUint32(28, RATE * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.max(a + 1, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b && j < total; j++) s += all[j];
    out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s / (b - a))) * 32767, true);
  }
  return new Blob([out], { type: 'audio/wav' });
}

/**
 * Modalità voce. hooks: send(text) → Promise (manda il messaggio in chat), stop() (ferma la risposta),
 * onState(state, info) per l'interfaccia. Stati: listening, recording, transcribing, thinking, speaking.
 */
export class VoiceMode {
  constructor(hooks) {
    this.hooks = hooks;
    this.active = false;
    this.voice = '';
    this.bargeIn = false;
  }

  async start() {
    const AC = window.AudioContext || window.webkitAudioContext;
    // creato dal tocco sul tasto: su iPhone è l'unico modo per poter poi riprodurre l'audio
    this.ctx = new AC();
    await this.ctx.resume();
    // qui (al contrario della melodia) cancellazione dell'eco e del rumore servono: la voce dell'IA esce dagli altoparlanti
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.proc = this.ctx.createScriptProcessor(2048, 1, 1);
    this.proc.onaudioprocess = (e) => this.#frame(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(this.proc);
    this.proc.connect(this.ctx.destination); // senza collegarlo all'uscita alcuni browser non lo fanno girare (esce silenzio)
    this.active = true;
    this.floor = 0.005;
    this.#listen();
  }

  stopAll() {
    this.active = false;
    this.#silence();
    this.proc?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close?.();
    this.ctx = this.proc = this.stream = null;
  }

  #set(state, info = {}) { this.state = state; this.hooks.onState?.(state, info); }

  #listen() {
    this.frames = []; this.pre = []; this.loud = 0; this.quiet = 0; this.msgId = null;
    this.#set('listening');
  }

  // rilevamento della voce sul volume (RMS) rispetto al rumore di fondo, che si aggiorna da solo
  #frame(f) {
    if (!this.active) return;
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    const ms = (f.length / this.ctx.sampleRate) * 1000;
    this.hooks.onLevel?.(rms);
    const speaking = this.state === 'speaking' || this.state === 'thinking';
    // mentre parla l'IA serve una voce più forte e più lunga, così la sua eco non la interrompe
    const thr = speaking ? Math.max(0.05, this.floor * 6) : Math.max(0.012, this.floor * 2.5);
    if (rms < thr) this.floor = this.floor * 0.97 + rms * 0.03;

    if (speaking) {
      if (!this.bargeIn) return;
      this.loud = rms > thr ? this.loud + ms : 0;
      if (this.loud >= 350) { this.interrupt(); this.loud = 120; this.#set('recording'); }
      else return;
    }
    if (this.state === 'listening') {
      this.pre.push(f);
      if (this.pre.length * ms > 400) this.pre.shift(); // l'inizio della parola arriva prima della soglia
      this.loud = rms > thr ? this.loud + ms : 0;
      if (this.loud >= 120) { this.frames = [...this.pre]; this.quiet = 0; this.#set('recording'); }
      return;
    }
    if (this.state !== 'recording') return;
    this.frames.push(f);
    this.quiet = rms > thr ? 0 : this.quiet + ms;
    const total = this.frames.length * ms;
    if (this.quiet >= 850 || total >= 30000) this.#finish(total - this.quiet);
  }

  async #finish(voiced) {
    const frames = this.frames;
    this.frames = [];
    if (voiced < 300) return this.#listen(); // un colpo o un rumore, non una frase
    this.#set('transcribing');
    try {
      const res = await fetch('/api/voice/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeWav(frames, this.ctx.sampleRate) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Trascrizione non riuscita');
      const text = (data.text || '').trim();
      // Whisper sul silenzio a volte inventa frasi fatte dei sottotitoli
      if (!this.active || !text || /^(grazie( per la visione)?|sottotitoli .*|thank you\.?|\.+)[.!]?$/i.test(text)) return this.active && this.#listen();
      this.#set('thinking', { heard: text });
      this.spoken = 0; this.queue = []; this.final = false;
      await this.hooks.send(text);
    } catch (e) {
      this.#set('error', { error: e.message });
      setTimeout(() => this.active && this.#listen(), 2500);
    }
  }

  /** Il messaggio dell'assistente da leggere (arriva dal server dopo l'invio). */
  follow(messageId) { if (this.state === 'thinking' && !this.msgId) this.msgId = messageId; }

  /** Nuovo testo della risposta seguita: si leggono le frasi complete. */
  update(messageId, content, final = false) {
    if (!this.active || messageId !== this.msgId) return;
    this.final = final;
    for (;;) {
      const r = nextSpeech(content, this.spoken, final);
      if (r.pos === this.spoken) break;
      this.spoken = r.pos;
      if (r.text.trim()) this.#enqueue(r.text);
    }
    if (final && !this.queue.length && !this.playing) this.#listen();
  }

  // ogni frase si chiede subito al server (le prossime si preparano mentre suona questa), poi si suonano in ordine
  #enqueue(text) {
    const job = fetch('/api/voice/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: this.voice || undefined }) })
      .then((r) => (r.status === 200 ? r.arrayBuffer() : null))
      .then((buf) => (buf && this.ctx ? this.ctx.decodeAudioData(buf) : null))
      .catch(() => null);
    this.queue.push(job);
    if (!this.playing) this.#play();
  }

  async #play() {
    this.playing = true;
    while (this.active && this.queue.length) {
      const audio = await this.queue[0];
      if (!this.active || !this.queue.length) break;
      this.queue.shift();
      if (!audio) continue;
      this.#set('speaking');
      await new Promise((resolve) => {
        const node = this.ctx.createBufferSource();
        node.buffer = audio;
        node.connect(this.ctx.destination);
        node.onended = resolve;
        this.node = node;
        node.start();
      });
      this.node = null;
    }
    this.playing = false;
    if (this.active && this.final && this.state !== 'recording') this.#listen();
    else if (this.active && this.state === 'speaking') this.#set('thinking');
  }

  #silence() {
    this.queue = [];
    try { this.node?.stop(); } catch {}
    this.node = null;
  }

  /** Tocco sul cerchio (o voce dell'utente con «interrompi parlando»): smette di leggere e ferma la risposta. */
  interrupt() {
    if (this.state !== 'speaking' && this.state !== 'thinking') return;
    this.#silence();
    if (this.msgId) this.hooks.stop?.();
    this.msgId = null;
    this.#listen();
  }
}

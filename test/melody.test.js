import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-melody-'));
const { parseWav, encodeWav, analyze, melodyForComfy, checkMelody, estimateKey } = await import('../src/melody.js');
const { loadWorkflows, checkAvailability, workflows, buildGraph } = await import('../src/workflows.js');
const { audioSettings, audioValues } = await import('../src/audio.js');
const { tools, systemPrompt } = await import('../src/prompts.js');

const ACE = ['acestep_v1.5_turbo.safetensors', 'qwen_0.6b_ace15.safetensors', 'qwen_1.7b_ace15.safetensors', 'ace_1.5_vae.safetensors'];

/** Canticchiato finto: note (MIDI) di un battito ciascuna, con armoniche, vibrato, attacchi morbidi e un po' di rumore. */
function hum(notes, bpm, { sr = 48000, lead = 1, legato = false } = {}) {
  const beat = 60 / bpm;
  const x = new Float32Array(Math.round((lead + notes.length * beat + 1) * sr));
  let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / sr - lead;
    if (t < 0 || t >= notes.length * beat) { x[i] = 0.002 * (Math.random() - 0.5); continue; }
    const k = Math.floor(t / beat), tt = t - k * beat;
    ph += (2 * Math.PI * 440 * 2 ** ((notes[k] - 69) / 12) * (1 + 0.004 * Math.sin(2 * Math.PI * 5.5 * t))) / sr;
    const env = legato ? 1 : Math.min(1, tt / 0.03) * Math.min(1, (beat - tt) / 0.06) * (0.6 + 0.4 * Math.exp(-tt * 4));
    x[i] = 0.3 * env * (Math.sin(ph) + 0.5 * Math.sin(2 * ph) + 0.25 * Math.sin(3 * ph)) + 0.002 * (Math.random() - 0.5);
  }
  return x;
}
const A_MINOR = [57, 60, 64, 62, 60, 59, 57, 64, 65, 64, 62, 60, 59, 57, 59, 60, 64, 69, 67, 65, 64, 62, 60, 57, 57, 59, 60, 62, 64, 60, 57, 57];
const C_MAJOR = [60, 62, 64, 65, 67, 65, 64, 62, 60, 64, 67, 72, 71, 67, 65, 62, 60, 60, 64, 67, 69, 67, 65, 64, 62, 60, 62, 64, 60, 59, 60, 60];

test('WAV: andata e ritorno, anche stereo (diventa mono)', () => {
  const l = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 10) * 0.5);
  const r = Float32Array.from(l, (v) => -v);
  const back = parseWav(encodeWav([l, l], 48000));
  assert.equal(back.sampleRate, 48000);
  assert.equal(back.samples.length, 480);
  assert.ok(Math.abs(back.samples[100] - l[100]) < 1e-3);
  // canali opposti: la media è silenzio
  assert.ok(parseWav(encodeWav([l, r], 44100)).samples.every((v) => Math.abs(v) < 1e-3));
  assert.throws(() => parseWav(Buffer.from('non sono un wav, davvero no, proprio per niente!')), /WAV valido/);
});

test('analisi: tonalità e tempo di melodie canticchiate', () => {
  const cases = [
    [hum(A_MINOR, 100), 48000, 'A minor', 100],
    [hum(C_MAJOR, 132), 48000, 'C major', 132],
    [hum(A_MINOR, 84, { legato: true }), 48000, 'A minor', 84],
    [hum(C_MAJOR.map((n) => n + 2), 72, { sr: 44100 }), 44100, 'D major', 72],
  ];
  for (const [x, sr, key, bpm] of cases) {
    const info = analyze(parseWav(encodeWav([x], sr)));
    assert.equal(info.key, key);
    assert.ok(Math.abs(info.bpm - bpm) <= 2, `tempo ${info.bpm}, atteso ${bpm}`);
    // il silenzio iniziale (1 s) e finale (1 s) non conta nella durata utile
    assert.ok(info.start > 0.8 && info.start < 1.1, `inizio ${info.start}`);
  }
});

test('analisi: il silenzio non è una melodia', () => {
  const silent = encodeWav([new Float32Array(48000 * 3)], 48000);
  assert.deepEqual(analyze(parseWav(silent)), { seconds: 3, voicedSeconds: 0, key: null, bpm: null, start: 0, end: 3 });
  assert.throws(() => checkMelody(silent), /Non sento una melodia/);
  assert.throws(() => checkMelody(encodeWav([new Float32Array(48000 * 62)], 48000)), /troppo lunga/);
  assert.equal(estimateKey([60, 62]), null);
});

test('checkMelody: durata utile, tonalità e tempo', () => {
  const info = checkMelody(encodeWav([hum(A_MINOR, 100)], 48000));
  assert.equal(info.key, 'A minor');
  assert.ok(Math.abs(info.seconds - (32 * 0.6 + 0.2)) < 0.5, `durata ${info.seconds}`);
});

test('file per ComfyUI: senza silenzi, normalizzato, stereo e ripetuto fino alla durata del brano', () => {
  const wav = encodeWav([hum(A_MINOR, 100)], 48000);
  const { buffer, repeats, info } = melodyForComfy(wav, 60);
  const out = parseWav(buffer);
  assert.equal(buffer.readUInt16LE(22), 2);
  assert.equal(out.samples.length, 60 * 48000);
  assert.equal(repeats, Math.ceil(60 / (info.end - info.start)));
  const peak = out.samples.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak > 0.85 && peak <= 0.9, `picco ${peak}`);
  // nessuna durata (o più corta della melodia): resta la melodia intera
  assert.equal(parseWav(melodyForComfy(wav, 0).buffer).samples.length, Math.floor(info.end * 48000) - Math.floor(info.start * 48000));
});

test('workflow dalla melodia: disponibile solo con i nodi su ComfyUI', async () => {
  loadWorkflows();
  await checkAvailability(async () => ACE, async (name) => name !== 'ReferenceTimbreAudio');
  assert.equal(workflows('audio', 'melody').length, 0);
  assert.equal(workflows('audio', 'music').length, 1);
  await checkAvailability(async () => ACE, async () => true);
  assert.equal(workflows('audio', 'melody').length, 1);
});

test('grafo cover: melodia nel LoadAudio, riferimento collegato al campionatore, niente codici dell\'LM', async () => {
  loadWorkflows();
  await checkAvailability(async () => ACE, async () => true);
  const [w] = workflows('audio', 'melody');
  const settings = audioSettings('melody', { duration: 30, key: 'A minor', bpm: 100, lyrics: '[verse]\nCiao' }, w);
  assert.deepEqual(settings, { seconds: 30, lyrics: '[verse]\nCiao', bpm: 100, keyscale: 'A minor', language: 'en' });
  const media = { type: 'audio', mode: 'melody', prompt: 'warm piano ballad', seed: 5, ...settings };
  const g = buildGraph(w, { prompt: media.prompt, seed: 5, ...audioValues(media), melody: 'localai_melody_x.wav' });
  assert.equal(g['11'].inputs.audio, 'localai_melody_x.wav');
  assert.equal(g['13'].class_type, 'ReferenceTimbreAudio');
  assert.deepEqual(g['8'].inputs.positive, ['13', 0]);
  assert.equal(g['5'].inputs.generate_audio_codes, false);
  assert.equal(g['5'].inputs.tags, 'warm piano ballad');
  assert.equal(g['7'].inputs.seconds, 30);
  for (const n of Object.values(g)) for (const v of Object.values(n.inputs)) if (Array.isArray(v)) assert.ok(g[v[0]], `nodo ${v[0]} mancante`);
});

test('strumenti: il parametro melody c\'è solo con una melodia nella chat', async () => {
  loadWorkflows();
  await checkAvailability(async () => ACE, async () => true);
  const music = (opts) => tools({ web: false, ...opts }).find((t) => t.function.name === 'generate_music').function.parameters;
  assert.equal(music({}).properties.melody, undefined);
  assert.deepEqual(music({}).required, ['description', 'duration']);
  const p = music({ melody: { seconds: 18.4, key: 'A minor', bpm: 96 } });
  assert.match(p.properties.melody.description, /18 s, tonalità stimata A minor, tempo stimato 96 BPM/);
  assert.deepEqual(p.required, ['description']);
  assert.match(systemPrompt('Gemma', { melody: true }), /Melodie canticchiate/);
  assert.doesNotMatch(systemPrompt('Gemma', { melody: false }), /Melodie canticchiate/);
});

test.after(() => fs.rmSync(process.env.WORKSPACE_DIR, { recursive: true, force: true }));

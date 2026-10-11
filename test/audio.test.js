import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// cartella di lavoro temporanea: il test non tocca quella vera (config la legge all'import)
process.env.WORKSPACE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-audio-'));
const { loadWorkflows, checkAvailability, workflows, buildGraph } = await import('../src/workflows.js');
const { audioSettings, audioValues, keyscale, finalPrompt, audioPath } = await import('../src/audio.js');
const { tools, computerTools, promptEngineerUser } = await import('../src/prompts.js');

// ComfyUI finto con tutti i modelli installati: i workflow audio diventano disponibili
loadWorkflows();
await checkAvailability(async () => [
  'acestep_v1.5_turbo.safetensors', 'qwen_0.6b_ace15.safetensors', 'qwen_1.7b_ace15.safetensors', 'ace_1.5_vae.safetensors',
  'stable_audio_3_medium.safetensors', 't5gemma_b_b_ul2.safetensors',
]);

test('tonalità: forme brevi e lunghe diventano il valore del menu di ACE-Step', () => {
  assert.equal(keyscale('A minor'), 'A minor');
  assert.equal(keyscale('am'), 'A minor');
  assert.equal(keyscale('F#m'), 'F# minor');
  assert.equal(keyscale('bb major'), 'Bb major');
  assert.equal(keyscale('C'), 'C major');
  assert.equal(keyscale('La minore'), null);
  assert.equal(keyscale('E#'), null);
});

test('musica: senza testo è strumentale, valori fuori scala tornano ai default', () => {
  const [w] = workflows('audio', 'music');
  assert.deepEqual(audioSettings('music', { duration: 90 }, w), { seconds: 90, lyrics: '[Instrumental]', bpm: 120, keyscale: 'C major', language: 'en' });
  const s = audioSettings('music', { duration: 9999, lyrics: '[verse]\nCiao', language: 'IT', bpm: 150, key: 'Dm' }, w);
  assert.deepEqual(s, { seconds: 240, lyrics: '[verse]\nCiao', bpm: 150, keyscale: 'D minor', language: 'it' });
  assert.equal(audioSettings('music', { lyrics: 'strumentale', language: 'it' }, w).lyrics, '[Instrumental]');
});

test('effetti: solo la durata, entro 1-30 s, e il prompt finisce con la durata', () => {
  const [w] = workflows('audio', 'sfx');
  assert.deepEqual(audioSettings('sfx', { duration: 0.2 }, w), { seconds: 1 });
  assert.deepEqual(audioSettings('sfx', {}, w), { seconds: 3 });
  assert.equal(finalPrompt('sfx', 'Coin pickup blip. Length: 4 seconds.', 2), 'Coin pickup blip. Length: 2 seconds.');
  assert.equal(finalPrompt('music', 'Chiptune theme', 60), 'Chiptune theme');
});

test('grafo ACE-Step: stile, testo, durata, BPM, tonalità e seed finiscono nei nodi giusti', () => {
  const [w] = workflows('audio', 'music');
  const media = { type: 'audio', mode: 'music', prompt: 'upbeat chiptune', seed: 7, ...audioSettings('music', { duration: 45, bpm: 150, key: 'A minor' }, w) };
  const g = buildGraph(w, { prompt: media.prompt, seed: media.seed, ...audioValues(media) });
  assert.equal(g['5'].inputs.tags, 'upbeat chiptune');
  assert.equal(g['5'].inputs.lyrics, '[Instrumental]');
  assert.equal(g['5'].inputs.duration, 45);
  assert.equal(g['7'].inputs.seconds, 45);
  assert.equal(g['5'].inputs.bpm, 150);
  assert.equal(g['5'].inputs.keyscale, 'A minor');
  assert.equal(g['5'].inputs.seed, 7);
  assert.equal(g['8'].inputs.seed, 7);
  assert.equal(g['10'].class_type, 'SaveAudioMP3');
});

test('grafo Stable Audio 3: descrizione con durata, latente della stessa durata', () => {
  const [w] = workflows('audio', 'sfx');
  const media = { type: 'audio', mode: 'sfx', prompt: 'Retro coin pickup', seed: 3, seconds: 2 };
  const g = buildGraph(w, { prompt: media.prompt, seed: media.seed, ...audioValues(media) });
  assert.equal(g['3'].inputs.text, 'Retro coin pickup Length: 2 seconds.');
  assert.equal(g['5'].inputs.seconds, 2);
  assert.equal(g['6'].inputs.seed, 3);
  // ogni collegamento punta a un nodo che esiste
  for (const n of Object.values(g)) for (const v of Object.values(n.inputs)) if (Array.isArray(v)) assert.ok(g[v[0]], `nodo ${v[0]} mancante`);
});

test('strumenti: musica ed effetti in chat, create_audio_file in modalità Computer', () => {
  const names = tools({ web: false }).map((t) => t.function.name);
  assert.ok(names.includes('generate_music') && names.includes('generate_sound_effect'));
  const audioTool = computerTools({ project: true }).find((t) => t.function.name === 'create_audio_file');
  assert.ok(audioTool);
  const p = audioTool.function.parameters.properties;
  assert.deepEqual(p.kind.enum, ['music', 'sfx']);
  // la durata copre sia gli effetti brevi sia la musica lunga
  assert.equal(p.duration.minimum, 1);
  assert.equal(p.duration.maximum, 240);
});

test('percorso dei file audio: sempre .mp3 e dentro la cartella di lavoro', () => {
  const user = { id: 'test-audio', username: 'prova' };
  assert.equal(audioPath(user, 'tetris/audio/musica.ogg'), 'tetris/audio/musica.mp3');
  assert.equal(audioPath(user, 'tetris/riga'), 'tetris/riga.mp3');
  assert.throws(() => audioPath(user, '../fuori.mp3'));
});

test('prompt engineer: per l\'audio niente dimensioni in pixel', () => {
  const [w] = workflows('audio', 'sfx');
  const text = promptEngineerUser({ userRequest: 'suono di moneta', description: 'coin', workflow: w, seconds: 2 });
  assert.match(text, /Output format: audio, duration 2 seconds\./);
});

test.after(() => fs.rmSync(process.env.WORKSPACE_DIR, { recursive: true, force: true }));

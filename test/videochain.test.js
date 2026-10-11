import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planSegments, secondsFrom, continueGraph, continueFrames, addParts, continuePrompt, OVERLAP } from '../src/videochain.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (id) => ({ id, ...JSON.parse(fs.readFileSync(path.join(root, 'workflows', id, 'manifest.json'), 'utf8')), graph: JSON.parse(fs.readFileSync(path.join(root, 'workflows', id, 'workflow.json'), 'utf8')) });
const I2V = load('minimax-h3-i2v');
const of = (g, type) => Object.entries(g).filter(([, n]) => n.class_type === type);
const refsOk = (g) => { for (const [id, n] of Object.entries(g)) for (const v of Object.values(n.inputs || {})) if (Array.isArray(v)) assert.ok(g[v[0]], `${id} → ${v[0]} mancante`); };

test('pezzi: fino a 15 s uno solo, poi da 10 s; durata detta a parole', () => {
  assert.deepEqual(planSegments(5), [5]);
  assert.deepEqual(planSegments(15), [15]);
  assert.deepEqual(planSegments(20), [10, 10]);
  assert.deepEqual(planSegments(30), [10, 10, 10]);
  assert.deepEqual(planSegments(22), [10, 12]);
  assert.deepEqual(planSegments(99), [10, 10, 10]);
  assert.equal(secondsFrom('mandami un video di 20 secondi'), 20);
  assert.equal(secondsFrom('un video di mezzo minuto'), 30);
  assert.equal(secondsFrom('un video'), null);
});

test('continua con la clip guida: video precedente caricato, coda come guida, parte nuova incollata con l\'audio', () => {
  const g = continueGraph(I2V, { video: 'localai_x.mp4', prompt: 'p', seed: 3, seconds: 5, guide: true });
  refsOk(g);
  assert.equal(of(g, 'LoadImage').length, 0);
  assert.equal(of(g, 'LoadVideo')[0][1].inputs.file, 'localai_x.mp4');
  const [[gid, guide]] = of(g, 'MiniMaxH3AddGuide');
  assert.equal(g[guide.inputs.image[0]].inputs.length, OVERLAP);
  assert.equal(of(g, 'BasicGuider')[0][1].inputs.conditioning[0], gid);
  const i2v = of(g, 'MiniMaxH3ImageToVideo')[0][1].inputs;
  assert.equal(i2v.first_frame, undefined);
  assert.equal(i2v.length, continueFrames(5, true));
  assert.equal(i2v.length % 17, 5);
  const create = of(g, 'CreateVideo')[0][1].inputs;
  assert.equal(g[create.images[0]].class_type, 'ImageBatch');
  assert.equal(g[create.audio[0]].class_type, 'AudioConcat');
  assert.equal(g[g[create.images[0]].inputs.image2[0]].inputs.batch_index, OVERLAP);   // senza i fotogrammi ripetuti
});

test('continua senza MiniMaxH3AddGuide: ultimo fotogramma come first_frame', () => {
  const g = continueGraph(I2V, { video: 'v.mp4', prompt: 'p', seed: 3, seconds: 5, guide: false });
  refsOk(g);
  assert.equal(of(g, 'MiniMaxH3AddGuide').length, 0);
  const i2v = of(g, 'MiniMaxH3ImageToVideo')[0][1].inputs;
  assert.equal(g[i2v.first_frame[0]].inputs.length, 1);
});

test('video lungo: pezzi in catena, ognuno continua il precedente', () => {
  let n = 0;
  const parts = addParts({ id: 'a', type: 'video', mode: 'img2video', seconds: 10, sourceFile: 'foto.png' }, [10, 10, 10], { id: 'minimax-h3-i2v', name: 'i2v' }, { newId: () => `p${++n}`, seed: () => 1 });
  assert.deepEqual(parts.map((p) => [p.id, p.mode, p.continueOfId, p.part.index, p.totalSeconds]), [['a', 'img2video', undefined, 1, undefined], ['p1', 'continue', 'a', 2, 20], ['p2', 'continue', 'p1', 3, 30]]);
  assert.equal(parts[1].sourceFile, undefined);
  assert.deepEqual(addParts({ id: 'a' }, [5], null, { newId: () => 'x', seed: () => 1 }).length, 1);
});

test('pezzo che continua: niente rimandi alla foto di partenza nel prompt', () => {
  const p = continuePrompt('For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.\n\nintegrated_multimodal_description: [Shot 1] Cinematic live-action, the shot begins exactly from <Picture 1>: boats at sunset. The boats rock.\n\nnon_diegetic_music: N/A');
  assert.ok(!p.includes('<Picture 1>'));
  assert.match(p, /^For the target video, the shot continues exactly from the last moments of the previous video\.$/m);
  assert.match(p, /the shot continues with no cut: boats at sunset/);
  assert.match(p, /non_diegetic_music: N\/A/);
});

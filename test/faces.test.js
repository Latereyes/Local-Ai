import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { touchesFace, applyKeepFace } from '../src/faces.js';

test('le richieste che non toccano il volto lo tengono', () => {
  for (const t of ['cambia il cappotto in rosso', 'metti un tavolo di fronte a lei', 'cambia lo sfondo con una spiaggia', 'mettile un vestito da sera blu', 'togli la macchina', 'replace the shirt with a black hoodie', 'add a cappuccino on the table', 'ridimensiona la borsa']) {
    assert.equal(touchesFace(t), false, t);
  }
});

test('viso, testa, luce e stile: il volto non si rimette', () => {
  for (const t of ['fallo sorridere', 'make her smile', 'cambia colore dei capelli', 'trasformala in stile anime', 'rendila di notte', 'aggiungi gli occhiali da sole', 'make him older', 'sostituisci la donna con un uomo', 'Replace the red cap with a beanie', 'mettile il rossetto', 'più giovane di 10 anni', 'in bianco e nero']) {
    assert.equal(touchesFace(t), true, t);
  }
});

test('ricucitura del volto sul grafo di qwen-image-edit', () => {
  const dir = new URL('../workflows/qwen-image-edit/', import.meta.url);
  const graph = JSON.parse(fs.readFileSync(new URL('workflow.json', dir), 'utf8'));
  const { keepFace } = JSON.parse(fs.readFileSync(new URL('manifest.json', dir), 'utf8'));
  assert.equal(applyKeepFace(graph, keepFace), true);
  const paste = graph[graph[keepFace.save].inputs.images[0]];
  assert.equal(paste.class_type, 'ImageCompositeMasked');
  assert.deepEqual(paste.inputs.destination, [keepFace.image, 0]);
  assert.deepEqual(paste.inputs.source, [keepFace.source, 0]);
  // ogni collegamento punta a un nodo che esiste
  for (const n of Object.values(graph)) {
    for (const v of Object.values(n.inputs)) if (Array.isArray(v) && typeof v[0] === 'string') assert.ok(graph[v[0]], `${n.class_type} → ${v[0]}`);
  }
  assert.equal(applyKeepFace({}, keepFace), false);
});

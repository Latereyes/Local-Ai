import { test } from 'node:test';
import assert from 'node:assert/strict';

const { nextSpeech, encodeWav } = await import('../public/voice.js');
const { speakable } = await import('../src/voice.js');
const { systemPrompt } = await import('../src/prompts.js');

/** Tutti i pezzi letti di una risposta che arriva un carattere alla volta, come dallo streaming. */
function spokenChunks(text) {
  const out = [];
  let pos = 0;
  for (let i = 1; i <= text.length; i++) {
    const final = i === text.length;
    for (;;) {
      const r = nextSpeech(text.slice(0, i), pos, final);
      if (r.pos === pos) break;
      pos = r.pos;
      if (r.text.trim()) out.push(r.text.trim());
    }
  }
  return out;
}

test('voce: la risposta si legge frase per frase mentre arriva', () => {
  const chunks = spokenChunks('Ciao! Oggi a Roma ci sono 20 gradi e il sole. Domani invece arriva la pioggia, porta l\'ombrello.');
  assert.deepEqual(chunks, [
    'Ciao! Oggi a Roma ci sono 20 gradi e il sole.',
    'Domani invece arriva la pioggia, porta l\'ombrello.',
  ]);
});

test('voce: numeri decimali e indirizzi non spezzano la frase', () => {
  const chunks = spokenChunks('Costa 3.50 euro sul sito www.esempio.it e arriva in due giorni lavorativi. Va bene?');
  assert.equal(chunks[0], 'Costa 3.50 euro sul sito www.esempio.it e arriva in due giorni lavorativi.');
  assert.equal(chunks[1], 'Va bene?');
});

test('voce: il codice non si legge, si annuncia', () => {
  const chunks = spokenChunks('Ecco lo script che ti serve:\n```python\nprint("ciao. mondo.")\n```\nLancialo dal terminale.');
  assert.deepEqual(chunks, ['Ecco lo script che ti serve:', '(codice sullo schermo)', 'Lancialo dal terminale.']);
});

test('voce: una frase lunghissima senza punti si spezza a una virgola', () => {
  const long = 'Allora vediamo un po\' ' + 'e poi ancora, '.repeat(30);
  const r = nextSpeech(long, 0, false);
  assert.ok(r.text.length > 20 && r.text.length <= 241, `pezzo di ${r.text.length} caratteri`);
  assert.ok(r.text.endsWith(', ') || r.text.endsWith(' '));
});

test('voce: il testo letto perde Markdown, link ed emoji', () => {
  assert.equal(speakable('**Attenzione**: leggi [la guida](https://x.it/guida) 😀'), 'Attenzione: leggi la guida');
  assert.equal(speakable('## Passi\n- primo\n- secondo'), 'Passi primo secondo');
  assert.equal(speakable('Usa `npm start` e poi https://localhost:3000'), 'Usa npm start e poi');
  assert.equal(speakable('```js\nx()\n```'), '(codice sullo schermo)');
  assert.equal(speakable('il file nome_file_lungo.txt'), 'il file nome_file_lungo.txt');
});

test('voce: il WAV per Whisper è a 16 kHz mono', async () => {
  const frames = [new Float32Array(48000).fill(0.5)]; // 1 s a 48 kHz
  const blob = encodeWav(frames, 48000);
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(40, true), 16000 * 2);
  assert.ok(Math.abs(view.getInt16(44, true) - 16383) <= 1);
});

test('voce: il prompt chiede risposte brevi e senza Markdown solo in modalità voce', () => {
  assert.match(systemPrompt('Gemma', { voice: true }), /Conversazione a voce/);
  assert.doesNotMatch(systemPrompt('Gemma'), /Conversazione a voce/);
});

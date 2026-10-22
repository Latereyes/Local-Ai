import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Ollama finto: LFM2.5 installato, risponde con la sintesi e solo alcune sezioni; il modello della chat
// riassume i pezzi che mancano
const LFM = 'hf.co/LiquidAI/LFM2.5-24B-A2B-GGUF:QAD-Q4_0';
const calls = [];
let lfmReply = '';
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools', 'thinking'], parameters: '' }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: LFM, digest: 'lfm' }, { name: 'gemma4-12b-uncensored:latest', digest: 'g12' }] }));
    if (req.url !== '/api/chat') return res.end('{}');
    const j = JSON.parse(body);
    calls.push(j);
    const content = j.model === LFM ? lfmReply : `riassunto a blocchi ${calls.length}`;
    res.end(JSON.stringify({ message: { role: 'assistant', content } }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-documenti-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.GPU_ARBITER = '0';

const config = (await import('../src/config.js')).default;
const documents = await import('../src/documents.js');
const ollama = await import('../src/ollama.js');

// documento finto di 40 pagine da ~6000 caratteri (~240.000): 20 sezioni da due pagine
fs.mkdirSync(config.paths.media, { recursive: true });
const pages = Array.from({ length: 40 }, (_, i) => `Pagina ${i + 1}. ${'testo '.repeat(1000)}`);
fs.writeFileSync(path.join(config.paths.media, 'libro.json'), JSON.stringify({ pages }));
const doc = { name: 'libro.pdf', textFile: 'libro.json', pages: 40, chars: pages.join('').length };

test('LFM2.5 solo per i documenti oltre la soglia e che stanno nel suo contesto', async () => {
  assert.equal(await documents.longModelFor({ ...doc, chars: 50000 }), null);
  assert.equal(await documents.longModelFor(doc), LFM);
  assert.equal(await documents.longModelFor({ ...doc, chars: 400000 }), null);
});

test('num_predict almeno 16384 per i modelli che ragionano sempre', () => {
  assert.equal(ollama.withMinPredict(LFM, { num_predict: 450 }).num_predict, 16384);
  assert.equal(ollama.withMinPredict(LFM, { num_predict: 20000 }).num_predict, 20000);
  assert.equal(ollama.withMinPredict('gemma4-12b-uncensored:latest', { num_predict: 450 }).num_predict, 450);
});

test('parseSections: righe [pp. a-b], anche in elenco o con il trattino lungo', () => {
  const parts = [{ from: 1, to: 3 }, { from: 4, to: 6 }, { from: 7, to: 9 }];
  const s = documents.parseSections('## Sezioni\n- [pp. 1-3] inizio\n[pp. 4–6]: centro\naltro', parts);
  assert.deepEqual(s.map((x) => x.summary), ['inizio', 'centro altro', '']);
});

test('digest con LFM2.5: sintesi dal documento intero, sezioni mancanti dal modello della chat', async () => {
  calls.length = 0;
  lfmReply = '## Sintesi\nUn libro di prova.\n\n## Sezioni\n[pp. 1-2] uno\n[pp. 3-4] due\n[pp. 5-6] tre\n[pp. 7-8] quattro\n[pp. 9-10] cinque\n[pp. 11-12] sei\n[pp. 13-14] sette\n[pp. 15-16] otto\n[pp. 17-18] nove\n[pp. 19-20] dieci\n[pp. 21-22] undici\n[pp. 23-24] dodici\n[pp. 25-26] tredici\n[pp. 27-28] quattordici\n[pp. 29-30] quindici\n[pp. 31-32] sedici\n[pp. 33-34] diciassette';
  const dg = await documents.digest(doc, { model: 'gemma4-12b-uncensored:latest', longModel: LFM });
  assert.equal(dg.summary, 'Un libro di prova.');
  assert.equal(dg.digestModel, LFM);
  assert.equal(dg.sections.length, 20);
  assert.equal(dg.sections[0].summary, 'uno');
  assert.match(dg.sections[19].summary, /riassunto a blocchi/);
  // una richiesta a LFM2.5 con tutto il testo e il contesto pieno, poi solo le 3 sezioni mancanti
  assert.equal(calls[0].model, LFM);
  assert.match(calls[0].messages[1].content, /Pagina 40\./);
  assert.equal(calls[0].options.num_ctx, 131072);
  assert.ok(calls[0].options.num_predict >= 16384);
  assert.equal(calls.length, 4);
});

test('splitWhole: intestazioni in grassetto e intervallo su una riga con il testo sotto (risposta vera di LFM2.5)', () => {
  const parts = [{ from: 1, to: 5 }, { from: 6, to: 10 }, { from: 41, to: 42 }];
  const out = '**Sintesi**\n\nUn libro.\n### Struttura\nCapitoli.\n\n**Sezioni**\n\n[pp. 1-5]\nInizio del\nlibro.\n\n- **[pp. 6-10]** — centro\n\n[pp. 41-42]\nfine';
  const w = documents.splitWhole(out, parts);
  assert.equal(w.summary, 'Un libro.\n### Struttura\nCapitoli.');
  assert.deepEqual(w.sections.map((x) => x.summary), ['Inizio del libro.', 'centro', 'fine']);
  assert.equal(documents.splitWhole('## Sintesi del documento\nX\n## Sezioni\n[pp. 1-5] a', parts).summary, 'X');
  assert.equal(documents.splitWhole('Sintesi: breve, poi altro', parts).summary, '');
});

test('digest con LFM2.5 che non risponde come chiesto: riassunto a blocchi completo', async () => {
  calls.length = 0;
  lfmReply = 'non ho capito';
  const dg = await documents.digest(doc, { model: 'gemma4-12b-uncensored:latest', longModel: LFM });
  assert.equal(dg.digestModel, undefined);
  assert.ok(dg.sections.every((s) => /riassunto a blocchi/.test(s.summary)));
  assert.ok(calls.slice(1).every((c) => c.model === 'gemma4-12b-uncensored:latest'));
});

test.after(() => fake.close());

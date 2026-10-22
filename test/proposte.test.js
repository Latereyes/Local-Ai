import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Ollama finto: Gemma 26B installato; la risposta alle richieste delle note si decide nel test
const GEMMA = 'hf.co/HauhauCS/Gemma4-26B-A4B-Uncensored-HauhauCS-Balanced:IQ4_XS';
const asked = [];
let answer = '{"notes":[]}';
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion'], parameters: 'num_ctx 32768' }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: GEMMA }] }));
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
    if (req.url !== '/api/chat') return res.end('{"version":"0.0.0"}');
    asked.push(JSON.parse(body));
    res.end(JSON.stringify({ message: { role: 'assistant', content: answer } }));
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-proposte-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.GPU_ARBITER = '0';
process.env.COMFY_URL = 'http://127.0.0.1:1';

const memory = await import('../src/memory.js');
const proposte = await import('../src/proposte.js');
const projects = await import('../src/projects.js');
const store = await import('../src/store.js');
const { adminUser } = await import('../src/auth.js');
const owner = adminUser();
after(() => {
  fake.close();
  memory.close();
  try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {}
});

const failedTask = (title = 'Server Flask') => ({
  ...projects.newTask(`[codice] ${title}: app.py risponde su /api/status`), status: 'failed', attempts: 3, model: 'qwen3.8-coder:latest',
  error: 'La verifica non passa dopo tutti i tentativi', finishedAt: Date.now() + 1000,
  checks: [{ kind: 'test', attempt: 3, ok: false, summary: 'Test falliti (uscita 1): ModuleNotFoundError: flask' }],
});

test('parseProposals: JSON anche con testo intorno, tipi e ambiti controllati, al massimo 5, niente doppioni', () => {
  const raw = 'Ecco le note:\n```json\n{"notes":[' +
    '{"text":"Andrea preferisce i test con unittest, non pytest","type":"Preferenza","scope":"generale","why":"lo ha scritto in chat"},' +
    '{"text":"Su questo PC Flask va installato con pip prima dei test","type":"procedura","scope":"progetto"},' +
    '{"text":"corto","type":"fatto"},' +
    '{"text":"andrea preferisce i test con UNITTEST, non pytest!","type":"preferenza"},' +
    '{"text":"Nota con tipo inventato e ambito strano","type":"opinione","scope":"altro"},' +
    '"non è un oggetto",' +
    '{"text":"Quarta nota valida da tenere","type":"fatto"},{"text":"Quinta nota valida da tenere","type":"fatto"},{"text":"Sesta nota valida da tenere","type":"fatto"},{"text":"Settima nota oltre il limite","type":"fatto"}' +
    ']}\n```\nFine.';
  const out = proposte.parseProposals(raw, { project: 'server-flask', known: ['Quarta nota valida, da tenere'] });
  assert.equal(out.length, 5);
  assert.match(out[4].text, /^Sesta/);
  assert.deepEqual(out[0], { text: 'Andrea preferisce i test con unittest, non pytest', type: 'preferenza', scope: '', why: 'lo ha scritto in chat' });
  assert.equal(out[1].scope, 'server-flask');
  assert.equal(out[2].type, 'fatto');
  assert.equal(out[2].scope, '');
  assert.ok(!out.some((n) => /Quarta/.test(n.text)), 'già nelle note dell\'utente');
  // senza progetto l'ambito è sempre generale
  assert.equal(proposte.parseProposals('[{"text":"Nota di progetto senza progetto","scope":"progetto"}]')[0].scope, '');
  for (const bad of ['', 'nessuna nota', '{"notes":"no"}', '{rotto']) assert.deepEqual(proposte.parseProposals(bad), [], bad);
  const many = JSON.stringify({ notes: Array.from({ length: 9 }, (_, i) => ({ text: `Nota numero ${i} abbastanza lunga` })) });
  assert.equal(proposte.parseProposals(many).length, proposte.MAX_PROPOSALS);
  assert.equal(proposte.parseProposals(JSON.stringify({ notes: [{ text: 'x'.repeat(500) }] }))[0].text.length, proposte.MAX_NOTE);
});

test('resoconto del task: esito, verifiche e messaggi dell\'utente scritti mentre lavorava (non quelli automatici)', async () => {
  const p = await projects.create(owner, 'Resoconto');
  const task = failedTask();
  task.createdAt = Date.now() - 1000;
  const chatConv = store.create(owner.id);
  chatConv.messages.push(
    { role: 'user', content: 'Usa unittest, non pytest', createdAt: Date.now() },
    { role: 'user', content: '[Queue coordinator — automatic message]', auto: true, createdAt: Date.now() },
    { role: 'user', content: 'Messaggio di prima del task', createdAt: task.createdAt - 60000 },
  );
  p.chats = [chatConv.id];
  const r = proposte.taskReport(p, task);
  assert.deepEqual(r.user, ['Usa unittest, non pytest']);
  assert.equal(r.task.model, 'qwen3.8-coder');
  const text = proposte.reportText(r);
  assert.match(text, /failed after 3 attempts/);
  assert.match(text, /NOT passed — Test falliti/);
  assert.match(text, /«Usa unittest, non pytest»/);
  // un task riuscito al primo colpo senza messaggi non ha niente da insegnare
  const easy = { ...projects.newTask('[codice] facile'), status: 'done', attempts: 1, checks: [{ kind: 'test', attempt: 1, ok: true, summary: 'Test superati' }], finishedAt: Date.now() };
  assert.equal(proposte.worthReading(proposte.taskReport({ ...p, chats: [] }, easy)), false);
  assert.equal(proposte.worthReading(r), true);
});

test('interruttori: memoria spenta per l\'utente o per il progetto, niente resoconti; lo stesso task non entra due volte', async () => {
  const p = await projects.create(owner, 'Interruttori');
  const task = failedTask();
  memory.setEnabled(owner.id, false);
  assert.equal(proposte.queueTask(owner, p, task), false);
  memory.setEnabled(owner.id, true);
  p.memory = false;
  assert.equal(proposte.queueTask(owner, p, task), false);
  assert.equal(proposte.queueProject(owner, p), false);
  p.memory = true;
  const before = memory.jobCount();
  assert.equal(proposte.queueTask(owner, p, task), true);
  assert.equal(proposte.queueTask(owner, p, task), false);
  assert.equal(memory.jobCount(), before + 1);
  // task fermato dall'utente: niente
  assert.equal(proposte.queueTask(owner, p, { ...failedTask('fermato'), status: 'cancelled' }), false);
  // svuota la fila per il test dopo
  for (let j = memory.nextJob(); j; j = memory.nextJob()) memory.jobDone(j.id);
});

test('note proposte: Gemma legge il resoconto, le note nascono «da confermare» senza segreti e non entrano nel prompt finché non sono confermate', async () => {
  const p = await projects.create(owner, 'Server Flask');
  p.tasks.push(failedTask());
  projects.save(p);
  memory.add(owner.id, { text: 'Rispondi sempre in italiano', type: 'preferenza' });
  answer = JSON.stringify({ notes: [
    { text: 'Nel progetto Server Flask i test richiedono flask installato con pip (token: abc123segreto)', type: 'procedura', scope: 'progetto', why: 'ModuleNotFoundError: flask' },
    { text: 'Rispondi sempre in italiano.', type: 'preferenza', scope: 'generale' },
  ] });
  assert.equal(proposte.queueTask(owner, p, p.tasks[0]), true);
  const job = memory.nextJob();
  const saved = await proposte.processJob(job);
  assert.equal(memory.nextJob(), null, 'resoconto letto e tolto dalla fila');

  // la richiesta: Gemma 26B, JSON, note già note da non ripetere, resoconto come dati
  const req = asked.at(-1);
  assert.equal(req.model, GEMMA);
  assert.equal(req.format, 'json');
  assert.equal(req.think, false);
  assert.match(req.messages[1].content, /Notes the user already has[\s\S]*Rispondi sempre in italiano/);
  assert.match(req.messages[1].content, /<report>[\s\S]*ModuleNotFoundError: flask[\s\S]*<\/report>/);

  // la seconda è un doppione di una nota che c'è già
  assert.equal(saved.length, 1);
  const n = saved[0];
  assert.equal(n.status, memory.PROPOSED);
  assert.equal(n.scope, p.id);
  assert.equal(n.type, 'procedura');
  assert.match(n.source, /^proposta da Gemma4 · task «Server Flask/);
  assert.ok(!n.text.includes('abc123segreto'), 'segreto tolto');
  assert.ok(p.log.some((l) => /1 nota proposta da confermare/.test(l.text || l)));

  // da confermare: non va nel prompt
  assert.equal(memory.pack(owner.id, 'test flask pip', { project: p.id }).notes.length, 0);
  memory.update(owner.id, n.id, { status: 'attiva' });
  assert.deepEqual(memory.pack(owner.id, 'test flask pip', { project: p.id }).notes.map((x) => x.id), [n.id]);
});

test('memoria spenta dopo che il resoconto è entrato in fila: si butta senza chiamare il modello', async () => {
  const p = await projects.create(owner, 'Spenta dopo');
  assert.equal(proposte.queueTask(owner, p, failedTask()), true);
  memory.setEnabled(owner.id, false);
  const calls = asked.length;
  assert.deepEqual(await proposte.processJob(memory.nextJob()), []);
  assert.equal(asked.length, calls);
  assert.equal(memory.nextJob(), null);
  memory.setEnabled(owner.id, true);
});

test('tick: niente modello mentre la coda dei progetti lavora; a coda ferma e GPU libera legge il resoconto', async () => {
  const p = await projects.create(owner, 'Tick');
  answer = '{"notes":[]}';
  assert.equal(proposte.queueTask(owner, p, failedTask()), true);
  let busy = true;
  proposte.start({ isBusy: () => busy, every: 3600000 });
  try {
    const calls = asked.length;
    assert.equal(await proposte.tick(), false);
    assert.equal(asked.length, calls);
    busy = false;
    assert.equal(await proposte.tick(), true);
    assert.equal(asked.length, calls + 1);
    assert.equal(memory.nextJob(), null);
  } finally { proposte.stop(); }
});

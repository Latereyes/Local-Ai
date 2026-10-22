import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Ollama finto che risponde solo con testo e si inventa la nota delle azioni (prova torrent-cli 2026-10-20:
// Gemma 26B scriveva «[Azioni eseguite nella cartella di lavoro: … modificato index.html]» senza chiamare strumenti)
const requests = [];
// chiamate di strumenti da restituire prima del testo (una per richiesta)
let script = [];
const reply = 'Ho sistemato index.html e avviato la coda.\n\n[Azioni eseguite nella cartella di lavoro: letto index.html; modificato index.html (aggiunta protezione `location.protocol`); verificato progetto con `check_project`]';
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools'], parameters: 'num_ctx 32768' }));
    if (req.url === '/api/tags' || req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
    if (req.url !== '/api/chat') return res.end('{"version":"0.0.0"}');
    requests.push(JSON.parse(body));
    const next = script.shift();
    if (next) return res.end(`${JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: next }] }, done: false })}\n${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 5, prompt_eval_count: 100 })}\n`);
    res.end(`${JSON.stringify({ message: { role: 'assistant', content: reply }, done: true, done_reason: 'stop', eval_count: 5, prompt_eval_count: 100 })}\n`);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-chatcoda-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.GPU_ARBITER = '0';

const store = await import('../src/store.js');
const chat = await import('../src/chat.js');
const projects = await import('../src/projects.js');
const { adminUser } = await import('../src/auth.js');
after(() => fake.close());
// le richieste del turno (non quella per il titolo della chat, senza strumenti)
const turn = () => requests.filter((r) => r.tools?.length).at(-1);

test('richiesta di avviare la coda: italiano e inglese, non le domande sulla coda', () => {
  for (const t of ['Sistema le task e avvia la coda allora', 'riavvia la coda', 'fai ripartire la coda', 'Coda: riparti', 'start the queue', 'please resume the queue']) {
    assert.ok(chat.asksQueueStart(t), t);
  }
  for (const t of ['la coda è ferma?', 'avvia il server', 'cosa c\'è in coda?', 'pause the queue']) assert.ok(!chat.asksQueueStart(t), t);
});

test('nota delle azioni inventata dal modello: tolta dalla risposta e dalla cronologia; coda vuota detta', async () => {
  const owner = adminUser();
  const p = await projects.create(owner, 'Torrent');
  p.tasks.push({ ...projects.newTask('[pagina] index.html'), status: 'done' });
  const conv = store.create(owner.id);
  Object.assign(conv, { computer: true, projectChat: true, project: { id: p.id, folder: p.folder, name: p.name } });
  const msg = await (await chat.send(conv, { text: 'Sistema le task e avvia la coda', model: 'finto:latest', computer: true })).finished;
  assert.equal(msg.status, 'done');
  assert.doesNotMatch(msg.content, /Azioni eseguite/);
  assert.match(msg.content, /Nessuna azione eseguita in questo turno/);
  // il modello sa che la coda la avvia LocalAI; senza task in coda non parte, e lo si dice
  assert.match(turn().messages.findLast((m) => m.role === 'user').content, /LocalAI avvia la coda alla fine/);
  assert.match(msg.content, /Coda non avviata: Nessun task in coda/);
  assert.equal(p.active, false);
  // nel turno dopo il modello non rivede la nota finta come se fosse vera
  await (await chat.send(conv, { text: 'Grazie', model: 'finto:latest', computer: true })).finished;
  const past = turn().messages.filter((m) => m.role === 'assistant').map((m) => m.content).join('\n');
  assert.doesNotMatch(past, /Azioni eseguite/);
});

test('«Stop server»: il server si ferma con project_server, un taskkill che chiuderebbe LocalAI non parte', async () => {
  const owner = adminUser();
  const p = await projects.create(owner, 'Server');
  const conv = store.create(owner.id);
  Object.assign(conv, { computer: true, projectChat: true, project: { id: p.id, folder: p.folder, name: p.name } });
  script = [
    { name: 'run_command', arguments: { command: 'for /f "tokens=5" %a in (\'netstat -aon ^| findstr :5000\') do taskkill /F /PID %a' } },
    { name: 'project_server', arguments: { action: 'stop' } },
  ];
  const msg = await (await chat.send(conv, { text: 'Stop server', model: 'finto:latest', computer: true })).finished;
  assert.equal(msg.status, 'done');
  const [cmd, srv] = msg.steps;
  assert.equal(cmd.status, 'error');
  assert.match(cmd.error, /Comando rifiutato.*project_server/);
  assert.equal(srv.action, 'server');
  assert.match(srv.what, /non era acceso/);
});

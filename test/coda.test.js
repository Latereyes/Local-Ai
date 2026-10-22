import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Ollama finto che si può «spegnere»: spento risponde 503 a tutto
let up = false;
const fake = http.createServer((req, res) => {
  if (!up) { res.writeHead(503); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(req.url === '/api/version' ? '{"version":"0.0.0"}' : '{"models":[]}');
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-coda-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.GPU_ARBITER = '0';

const projects = await import('../src/projects.js');
const runner = await import('../src/runner.js');
const { adminUser } = await import('../src/auth.js');
const owner = adminUser();
const wait = async (cond) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 20)); };

test('Ollama spento: il task resta in coda senza tentativi, la coda aspetta e riparte quando Ollama torna', async () => {
  const p = await projects.create(owner, 'Attesa');
  const task = projects.newTask('[codice] qualcosa');
  p.tasks.push(task);
  const notes = [];
  projects.bus.on('notify', (n) => notes.push(n.title));

  runner.setActive(p, true);
  await wait(() => p.waitingService);
  assert.equal(p.waitingService, 'ollama');
  assert.equal(p.active, false);
  assert.deepEqual([task.status, task.attempts, task.error], ['queued', 0, null]);
  assert.ok(notes.includes('Ollama non risponde'));

  // Ollama ancora spento: niente cambia
  await runner.watchServices();
  assert.equal(p.waitingService, 'ollama');

  // Ollama torna: la coda riparte (qui il task viene tolto prima, per non far partire una vera risposta)
  p.tasks = [];
  up = true;
  await runner.watchServices();
  assert.equal(p.waitingService, null);
  assert.match(p.log.at(-1).text, /Ollama di nuovo raggiungibile/);
  assert.ok(notes.includes('la coda riparte'));
  await projects.save(p, { touch: false });
});

test('errori di collegamento riconosciuti (non vanno al coordinatore)', () => {
  assert.ok(runner.isServiceError('fetch failed'));
  assert.ok(runner.isServiceError('connect ECONNREFUSED 127.0.0.1:11434'));
  assert.ok(!runner.isServiceError('I test non passano'));
});

test.after(() => { fake.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('passo della verifica che non risponde: si chiude con un errore che dice quale passo era', async () => {
  // prova torrent-cli del 2026-10-19: la verifica della pagina restava ferma e con lei tutta la coda
  await assert.rejects(runner.within(30, new Promise(() => {}), 'apertura della pagina nel browser'),
    (e) => e instanceof runner.StepTimeout && /apertura della pagina nel browser/.test(e.message));
  assert.equal(await runner.within(1000, Promise.resolve('ok'), 'x'), 'ok');
});

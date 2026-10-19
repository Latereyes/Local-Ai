import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Ollama finto: il modello dei task risponde «Fatto.» senza correggere niente (i test restano rossi);
// le richieste non in streaming sono quelle del consigliere e ricevono un consiglio numerato
const advice = [];
const turns = [];
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools'], parameters: 'num_ctx 32768' }));
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [] }));
    if (req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
    if (req.url !== '/api/chat') return res.end('{"version":"0.0.0"}');
    const j = JSON.parse(body);
    if (j.stream === false && /senior software engineer/.test(j.messages[0]?.content || '')) {
      advice.push(j);
      return res.end(JSON.stringify({ message: { role: 'assistant', content: `## Cause\nconsiglio ${advice.length}: somma() restituisce una stringa\n## What to do\n1. return a + b\n## Avoid\nnon toccare i test` } }));
    }
    if (j.stream === false) return res.end(JSON.stringify({ message: { role: 'assistant', content: 'Titolo' } }));
    turns.push(j);
    res.end(`${JSON.stringify({ message: { role: 'assistant', content: 'Fatto.' }, done: true, done_reason: 'stop', eval_count: 5, prompt_eval_count: 100 })}\n`);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-consigli-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.GPU_ARBITER = '0';
process.env.TASK_AUTO_INSTALL = '0';

const projects = await import('../src/projects.js');
const runner = await import('../src/runner.js');
const workspace = await import('../src/workspace.js');
const { adminUser } = await import('../src/auth.js');
const owner = adminUser();
const wait = async (cond, n = 400) => { for (let i = 0; i < n && !cond(); i++) await new Promise((r) => setTimeout(r, 25)); };

test('failureFocus: dagli errori di unittest in poi, non le righe «... ok»', () => {
  const out = `${'test_a (t.T.test_a) ... ok\n'.repeat(400)}======================================================================\nFAIL: test_somma (t.T.test_somma)\nAssertionError: '12' != 3\n\nRan 401 tests\nFAILED (failures=1)\n`;
  const f = runner.failureFocus(out, 3500);
  assert.match(f, /^=+\nFAIL: test_somma/);
  assert.match(f, /AssertionError/);
  assert.doesNotMatch(f, /\.\.\. ok/);
  // senza segni di errore: la fine
  assert.equal(runner.failureFocus('a\nb\nc', 3), '…b\nc');
});

test('runCommand tiene la fine dell\'output lungo (dove ci sono gli errori dei test)', async () => {
  const user = { ...owner };
  const r = await workspace.runCommand(user, `node -e "for (let i = 0; i < 3000; i++) console.log('riga ' + i + ' ok'); console.log('FAIL: in fondo')"`);
  assert.equal(r.truncated, true);
  assert.match(r.output, /^riga 0 ok/);
  assert.match(r.output, /output intermedio omesso/);
  assert.match(r.output, /FAIL: in fondo\s*$/);
  assert.ok(r.output.length < 12200);
});

test('task incastrato: dopo 2 verifiche fallite arrivano i consigli, finiscono in CONSIGLI.md e nel tentativo dopo; giri limitati', async () => {
  const p = await projects.create(owner, 'Consigli');
  const user = projects.scoped(owner, p);
  await workspace.writeFile(user, 'somma.py', 'def somma(a, b):\n    return str(a + b)\n', { fromUser: true });
  p.testCommand = 'node -e "console.log(\'FAIL: test_somma\'); console.log(\'  File /home/x/consigli/somma.py, line 2\'); process.exit(1)"';
  p.coordinator = false;
  const task = projects.newTask('[codice] somma.py: somma(a, b) restituisce il numero');
  p.tasks.push(task);
  runner.setActive(p, true);
  await wait(() => task.status === 'failed' || task.status === 'error');

  assert.equal(task.status, 'failed');
  // 3 tentativi + 1 per mettere in pratica l'ultimo consiglio, 2 consigli (dopo il 2° e il 3° tentativo)
  assert.equal(task.attempts, 4);
  assert.equal(advice.length, 2);
  assert.equal(task.advice.length, 2);
  // il consigliere vede l'errore e il file citato; il secondo sa che il primo consiglio non è bastato
  assert.match(advice[0].messages[1].content, /FAIL: test_somma/);
  assert.match(advice[0].messages[1].content, /--- somma\.py ---/);
  assert.doesNotMatch(advice[0].messages[1].content, /did NOT solve/);
  assert.match(advice[1].messages[1].content, /did NOT solve[\s\S]*consiglio 1/);

  // il modello del task riceve i consigli nel messaggio del tentativo 3 e 4, non nel 2
  const userTexts = turns.map((t) => t.messages.filter((m) => m.role === 'user').at(-1).content);
  assert.equal(userTexts.length, 4);
  assert.doesNotMatch(userTexts[1], /<advice>/);
  assert.match(userTexts[2], /<advice>\n## Cause\nconsiglio 1/);
  assert.match(userTexts[3], /consiglio 2/);

  const file = fs.readFileSync(path.join(projects.dirOf(owner, p), runner.ADVICE_FILE), 'utf8');
  assert.match(file, /^# Consigli per i task/);
  // il più recente in alto
  assert.ok(file.indexOf('consiglio 2') < file.indexOf('consiglio 1'));
  assert.ok(task.checks.some((c) => c.kind === 'advice' && /CONSIGLI\.md/.test(c.summary)));
  runner.setActive(p, false);
});

test.after(() => { fake.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

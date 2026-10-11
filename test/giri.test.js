import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Ollama finto «testardo»: a ogni richiesta chiama read_file sullo stesso file, anche quando non gli si danno strumenti
// (prova Space Invaders 2026-10-11: Qwen ha riletto game.js 70 volte in un turno di 33 minuti)
const requests = [];
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
    requests.push(j);
    const call = { function: { name: 'read_file', arguments: { path: 'game.js' } } };
    res.end(`${JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [call] }, done: false })}\n${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 5, prompt_eval_count: 100 })}\n`);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-giri-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.GPU_ARBITER = '0';

const store = await import('../src/store.js');
const chat = await import('../src/chat.js');
const projects = await import('../src/projects.js');
const workspace = await import('../src/workspace.js');
const { adminUser } = await import('../src/auth.js');

test('un modello che rilegge sempre lo stesso file: avviso alla terza lettura, ultimo giro senza strumenti alla quinta', async () => {
  const owner = adminUser();
  const p = await projects.create(owner, 'Giri');
  await workspace.writeFile(projects.scoped(owner, p), 'game.js', 'export const x = 1;\n');
  const conv = store.create(owner.id);
  Object.assign(conv, { computer: true, project: { id: p.id, folder: p.folder, name: p.name }, taskId: 't1' });
  const out = await chat.send(conv, { text: 'Fai il task', model: 'testardo:latest', computer: true, priority: 'low' });
  const msg = await out.finished;
  assert.equal(msg.status, 'done');
  // 5 letture, poi un giro senza strumenti: la chiamata in più viene ignorata e il turno finisce
  assert.equal(msg.steps.filter((s) => s.action === 'read').length, 5);
  assert.equal(requests.length, 6);
  assert.ok(requests.slice(0, 5).every((r) => r.tools?.length));
  assert.equal(requests[5].tools, undefined);
  const toolTexts = requests[5].messages.filter((m) => m.role === 'tool').map((m) => m.content);
  assert.match(toolTexts[2], /already read game\.js 2 times/);
  assert.match(toolTexts[4], /Stop using tools now/);
  fake.close();
});

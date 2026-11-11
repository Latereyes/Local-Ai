import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

// Prova torrent-cli del 2026-10-19: la pagina di un progetto Flask chiama fetch('/api/status'). Aperta dal server
// dei file di LocalAI dava 404 a ogni tentativo; ora la verifica avvia il server del progetto e la apre da lì.
let calls = 0;
const writeCall = (n) => `${JSON.stringify({ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'write_file', arguments: { path: `nota${n}.txt`, content: 'ok' } } }] }, done: false })}\n${JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', eval_count: 5, prompt_eval_count: 100 })}\n`;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/api/show') return res.end(JSON.stringify({ capabilities: ['completion', 'tools'], parameters: 'num_ctx 32768' }));
    if (req.url === '/api/tags' || req.url === '/api/ps') return res.end(JSON.stringify({ models: [] }));
    if (req.url !== '/api/chat') return res.end('{"version":"0.0.0"}');
    const j = JSON.parse(body);
    if (j.stream === false) return res.end(JSON.stringify({ message: { role: 'assistant', content: 'Titolo' } }));
    // il task deve cambiare almeno un file: scrive una nota e poi risponde
    if (j.messages.at(-1)?.role === 'user') return res.end(writeCall(++calls));
    res.end(`${JSON.stringify({ message: { role: 'assistant', content: 'Fatto.' }, done: true, done_reason: 'stop', eval_count: 5, prompt_eval_count: 100 })}\n`);
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-verifica-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
process.env.GPU_ARBITER = '0';
// niente ComfyUI vero: sul PC c'è, e il giudizio dello screenshot con Qwen3-VL bloccava il test (prova del 2026-10-19)
process.env.COMFY_URL = 'http://127.0.0.1:1';
process.env.TASK_AUTO_INSTALL = '0';
process.env.TASK_ADVICE_ROUNDS = '0';
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
process.env.WORKSPACE_PORT = String(await freePort());

const workspace = await import('../src/workspace.js');
const PY = process.platform === 'win32' ? 'python' : 'python3';
let skip = !workspace.findBrowser() && 'nessun browser per aprire la pagina';
try { execFileSync(PY, ['--version']); } catch { skip ||= 'Python non installato'; }

test('pagina di un progetto con server: la verifica avvia il server e la apre da lì', { skip }, async () => {
  const projects = await import('../src/projects.js');
  const runner = await import('../src/runner.js');
  const launcher = await import('../src/launcher.js');
  const { adminUser } = await import('../src/auth.js');
  // il server dei file di LocalAI (in server.js): qui basta un server che dà 404 a /api/…, come quello vero
  const files = http.createServer((req, res) => {
    if (/index\.html$/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(page); }
    res.writeHead(404); res.end();
  });
  await new Promise((r) => files.listen(Number(process.env.WORKSPACE_PORT), '127.0.0.1', r));
  const owner = adminUser();
  const p = await projects.create(owner, 'Server');
  p.autoTest = false;
  p.coordinator = false;
  p.maxAttempts = 1;
  const port = await freePort();
  const page = "<!doctype html><title>Torrent</title><h1 id=s>...</h1><script>fetch('/api/status').then((r) => { if (!r.ok) throw new Error('status ' + r.status); return r.json(); }).then((j) => { document.getElementById('s').textContent = j.ok; }).catch((e) => console.error(e.message));</script>";
  const user = projects.scoped(owner, p);
  await workspace.writeFile(user, 'index.html', page, { fromUser: true });
  await workspace.writeFile(user, 'server.py', `import json
from http.server import HTTPServer, BaseHTTPRequestHandler

PAGE = open('index.html', encoding='utf-8').read()

class H(BaseHTTPRequestHandler):
    def do_GET(self):
        body, kind = (json.dumps({'ok': 'pronto'}), 'application/json') if self.path == '/api/status' else (PAGE, 'text/html')
        self.send_response(200)
        self.send_header('Content-Type', kind)
        self.end_headers()
        self.wfile.write(body.encode())

if __name__ == '__main__':
    HTTPServer(('127.0.0.1', ${port}), H).serve_forever()
`, { fromUser: true });
  const task = projects.newTask('[pagina] index.html mostra lo stato del server');
  p.tasks.push(task);
  try {
    runner.setActive(p, true);
    for (let i = 0; i < 600 && !['done', 'failed', 'error'].includes(task.status); i++) await new Promise((r) => setTimeout(r, 50));
    const pageCheck = task.checks.find((c) => c.kind === 'page');
    assert.equal(task.status, 'done', JSON.stringify(task.checks));
    assert.match(pageCheck.page, new RegExp(`server\\.py → http://127\\.0\\.0\\.1:${port}/`));
    // spento dopo la verifica
    assert.equal(launcher.status(owner, p), null);
  } finally {
    runner.setActive(p, false);
    files.close();
  }
});

// su Windows il server Python appena chiuso tiene ancora la cartella per un attimo
test.after(() => { fake.close(); try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch {} });

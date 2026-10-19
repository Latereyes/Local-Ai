import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-apri-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.TASK_AUTO_INSTALL = '0';
const launcher = await import('../src/launcher.js');

const folder = (name, files) => {
  const dir = path.join(tmp, name);
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
  return dir;
};
const freePort = () => new Promise((r) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => r(port)); }); });
const PY = process.platform === 'win32' ? 'python' : 'python3';
let hasPython = true;
try { execFileSync(PY, ['--version']); } catch { hasPython = false; }

test('Apri: riconosce Flask, FastAPI, http.server, Node e le pagine statiche', async () => {
  const flask = await launcher.detect(folder('flask', {
    'app.py': "from flask import Flask\napp = Flask(__name__)\n\nif __name__ == '__main__':\n    app.run(debug=True, port=5050)\n",
    'tests/test_app.py': 'import app\n', 'index.html': '<p>x</p>',
  }));
  assert.deepEqual([flask.kind, flask.framework, flask.entry, flask.port, flask.index], ['python', 'flask', 'app.py', 5050, true]);
  assert.deepEqual(flask.args, ['app.py']);

  // Flask senza app.run: si avvia con «python -m flask»
  const bare = await launcher.detect(folder('flask-bare', { 'web/routes.py': 'from flask import Flask\nserver = Flask(__name__)\n' }));
  assert.deepEqual(bare.args, ['-m', 'flask', '--app', 'web.routes:server', 'run', '--port', '5000']);

  const api = await launcher.detect(folder('fastapi', { 'main.py': 'from fastapi import FastAPI\napp = FastAPI()\n' }));
  assert.deepEqual([api.framework, api.args.slice(0, 3), api.port], ['fastapi', ['-m', 'uvicorn', 'main:app'], 8000]);

  const node = await launcher.detect(folder('node', { 'server.js': "import express from 'express';\nconst app = express();\nconst PORT = process.env.PORT || 4100;\napp.listen(PORT);\n" }));
  assert.deepEqual([node.kind, node.entry, node.port], ['node', 'server.js', 4100]);

  const page = await launcher.detect(folder('pagina', { 'index.html': '<p>x</p>', 'game.js': 'console.log(1)' }));
  assert.equal(page.kind, 'static');
  // un programma da riga di comando non ha niente da aprire
  assert.equal((await launcher.detect(folder('cli', { 'torrent.py': 'import argparse\nprint(1)\n' }))).kind, null);
});

test('Apri: porta dal codice e dall\'output del server', () => {
  assert.equal(launcher.portInCode("app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5001)))"), 5001);
  assert.equal(launcher.portInCode("HTTPServer(('', 8001), Handler).serve_forever()"), 8001);
  assert.equal(launcher.portInCode('PORT = 9000\n'), 9000);
  assert.equal(launcher.portInCode('report = 12\nsupport = 3'), null);
  assert.equal(launcher.portFromOutput(' * Running on http://127.0.0.1:5000\nPress CTRL+C'), 5000);
  assert.equal(launcher.portFromOutput('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...'), 8000);
  assert.equal(launcher.portFromOutput('INFO:     Uvicorn running on http://127.0.0.1:8123 (Press CTRL+C to quit)'), 8123);
});

test('Apri: avvia il server Python, trova la porta e lo ferma', { skip: !hasPython && 'Python non installato' }, async () => {
  const port = await freePort();
  const dir = folder('http-server', {
    'server.py': `from http.server import HTTPServer, SimpleHTTPRequestHandler\nif __name__ == '__main__':\n    HTTPServer(('127.0.0.1', ${port}), SimpleHTTPRequestHandler).serve_forever()\n`,
    'index.html': '<h1>ciao</h1>',
  });
  const user = { id: 'u1', role: 'admin' };
  const p = { id: 'http-server' };
  // chi non può eseguire codice apre la pagina statica
  assert.equal((await launcher.open(user, p, { dir, canRun: false })).kind, 'static');
  const out = await launcher.open(user, p, { dir, canRun: true });
  assert.deepEqual([out.kind, out.port, out.path], ['server', port, '/']);
  assert.match(await (await fetch(`http://127.0.0.1:${port}/`)).text(), /ciao/);
  assert.equal(launcher.status(user, p).port, port);
  // la seconda volta riusa quello acceso
  assert.equal((await launcher.open(user, p, { dir, canRun: true })).already, true);
  assert.equal(launcher.stop(user, p), true);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await launcher.portOpen(port), false);
  assert.equal(launcher.status(user, p), null);
});

test('Apri: un server che si chiude subito dà l\'errore con il suo output', { skip: !hasPython && 'Python non installato' }, async () => {
  const dir = folder('rotto', { 'app.py': "from flask import Flask\napp = Flask(__name__)\nraise SystemExit('porta occupata, prova')\nif __name__ == '__main__':\n    app.run()\n" });
  await assert.rejects(launcher.open({ id: 'u1' }, { id: 'rotto' }, { dir, canRun: true, timeoutMs: 5000 }), /non è partito[\s\S]*(porta occupata|flask)/i);
});

test('Apri: un server Node sulla porta di LocalAI (3000) parte su una porta libera letta da PORT', async () => {
  const dir = folder('node-3000', { 'server.js': "const http = require('http');\nconst PORT = process.env.PORT || 3000;\nhttp.createServer((q, r) => r.end('node ok')).listen(PORT, '127.0.0.1');\n" });
  const busy = net.createServer().listen(3000, '127.0.0.1');
  await new Promise((r) => busy.once('listening', r).once('error', r));
  const user = { id: 'u2' };
  const p = { id: 'node-3000' };
  try {
    const out = await launcher.open(user, p, { dir, canRun: true });
    assert.equal(out.kind, 'server');
    assert.notEqual(out.port, 3000);
    assert.equal(await (await fetch(`http://127.0.0.1:${out.port}/`)).text(), 'node ok');
  } finally {
    launcher.stop(user, p);
    busy.close();
  }
});

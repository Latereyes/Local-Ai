import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// ntfy finto: raccoglie le notifiche pubblicate (config legge NTFY_URL all'import)
const received = [];
const ntfy = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => { b += d; }).on('end', () => { received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b) }); res.end('{}'); });
});
await new Promise((r) => ntfy.listen(0, '127.0.0.1', r));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-snap-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.NTFY_URL = `http://127.0.0.1:${ntfy.address().port}/localai-segreto`;
process.env.NTFY_TOKEN = 'tk_prova';
process.env.APP_URL = 'https://pc.esempio.ts.net/';

const snapshots = await import('../src/snapshots.js');
const projects = await import('../src/projects.js');
const workspace = await import('../src/workspace.js');
const hasGit = await snapshots.hasGit();
const user = { id: 'u1', username: 'prova', role: 'admin' };

test('fotografie: commit solo se cambia qualcosa, diff, ripristino annullabile, node_modules intatta', { skip: !hasGit && 'git non installato' }, async () => {
  const p = await projects.create(user, 'Gioco');
  const dir = projects.dirOf(user, p);
  const first = await projects.snap(user, p, 'Inizio');
  fs.writeFileSync(path.join(dir, 'index.html'), 'v1');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'lib.js'), 'x');
  const a = await projects.snap(user, p, 'Task 1');
  assert.equal(a.changed, true);
  assert.deepEqual(await projects.snap(user, p, 'niente'), { commit: a.commit, changed: false });
  fs.writeFileSync(path.join(dir, 'index.html'), 'v2');
  fs.writeFileSync(path.join(dir, 'gioco è.js'), 'nuovo');
  const b = await projects.snap(user, p, 'Task 2');
  assert.match(await snapshots.diff(dir, a.commit, b.commit), /index\.html[\s\S]*-v1[\s\S]*\+v2/);

  // annullare il task 2: torna v1, sparisce il file nuovo, le dipendenze restano
  await snapshots.restore(dir, a.commit, 'Annullato task 2');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'v1');
  assert.ok(!fs.existsSync(path.join(dir, 'gioco è.js')));
  assert.ok(fs.existsSync(path.join(dir, 'node_modules', 'lib.js')));
  const h = await snapshots.history(dir);
  // niente di nuovo dopo il task 2: la fotografia di sicurezza prima del ripristino coincide con «Task 2»
  assert.deepEqual(h.slice(0, 2).map((x) => x.message), ['Annullato task 2', 'Task 2']);
  // anche il ripristino si annulla: si torna allo stato del task 2
  await snapshots.restore(dir, h[1].commit, 'Rifatto');
  assert.equal(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), 'v2');
  // fino alla cartella vuota della prima fotografia
  await snapshots.restore(dir, first.commit, 'Da capo');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['.git', 'node_modules']);
  await assert.rejects(snapshots.restore(dir, 'nonvalida', 'x'), /non valida/);
});

test('la storia (.git) è fuori dalla portata del modello e del server dei file', () => {
  const scoped = { ...user, project: 'gioco' };
  assert.throws(() => workspace.resolve(scoped, '.git/config'), /storia del progetto/);
  assert.throws(() => workspace.resolve(scoped, 'sub/.GIT/HEAD'), /storia del progetto/);
  assert.ok(workspace.resolve(scoped, 'gitignore.txt'));
});

test('notifiche: evento per l\'interfaccia e pubblicazione JSON su ntfy con link al progetto', async () => {
  const p = await projects.create(user, 'Notifiche');
  const seen = [];
  projects.bus.on('notify', (n) => seen.push(n));
  projects.notify(p, { title: 'serve il tuo aiuto', body: 'Il task «à» non riesce', level: 'warn' });
  for (let i = 0; i < 50 && !received.length; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(seen[0].projectId, 'notifiche');
  assert.equal(seen[0].level, 'warn');
  const [n] = received;
  assert.equal(n.url, '/');
  assert.equal(n.auth, 'Bearer tk_prova');
  assert.deepEqual(n.body, {
    topic: 'localai-segreto', title: 'Notifiche: serve il tuo aiuto', message: 'Il task «à» non riesce',
    tags: ['warning'], priority: 4, click: 'https://pc.esempio.ts.net/progetti/notifiche',
  });
});

test('riavvio: la coda resta attiva solo nei progetti con «riprendi dopo un riavvio»', async () => {
  const a = await projects.create(user, 'Riprende');
  const b = await projects.create(user, 'Si ferma');
  for (const p of [a, b]) {
    p.active = true;
    p.tasks.push({ ...projects.newTask('[codice] qualcosa'), status: 'running' });
  }
  a.autoResume = true;
  await projects.save(a);
  await projects.save(b);
  projects.recoverInterrupted();
  // i salvataggi di recoverInterrupted sono in coda: si aspettano prima che la pulizia cancelli la cartella
  await Promise.all([projects.save(a, { touch: false }), projects.save(b, { touch: false })]);
  assert.equal(a.active, true);
  assert.equal(b.active, false);
  assert.equal(a.tasks[0].status, 'queued');
  assert.match(a.log.at(-1).text, /riparte da sola/);
});

test.after(() => { ntfy.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

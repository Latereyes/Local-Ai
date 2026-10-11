import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// dati e cartella di lavoro temporanei: config li legge all'import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-pjchat-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
const projects = await import('../src/projects.js');
const { computerTools, computerPrompt } = await import('../src/prompts.js');

const user = { id: 'u1', username: 'prova', role: 'admin' };

test('task dalla chat: tipo, origine, niente doppioni tra quelli non ancora fatti', async () => {
  const p = await projects.create(user, 'Tetris');
  p.tasks.push({ ...projects.newTask('[pagina] index.html con la griglia'), status: 'done' });
  const added = await projects.addTasks(p, [
    { text: 'Aggiungi un tasto pausa in index.html', type: 'page' },
    { text: '[codice] punteggio in game.js con i test' },
    { text: '   ' },
    { text: 'Aggiungi un tasto pausa in index.html', type: 'page' },
  ], { from: 'conv1' });
  assert.deepEqual(added.map((t) => [t.title, t.type, t.status, t.fromChat]), [
    ['Aggiungi un tasto pausa in index.html', 'page', 'queued', 'conv1'],
    ['punteggio in game.js con i test', 'code', 'queued', 'conv1'],
  ]);
  // già in coda: non si ripete; un task già fatto con lo stesso testo invece si può rifare
  assert.equal((await projects.addTasks(p, [{ text: 'Aggiungi un tasto pausa in index.html' }])).length, 0);
  assert.equal((await projects.addTasks(p, [{ text: '[pagina] index.html con la griglia' }])).length, 1);
  assert.match(p.log.at(-1).text, /Task aggiunto dalla chat/);
});

test('contesto della chat: piano, task con esito, cronologia e lavoro in corso', async () => {
  const p = await projects.create(user, 'Sito');
  await projects.writePlan(user, p, '# Obiettivo\nUn sito\n\n- [pagina] home');
  p.tasks.push({ ...projects.newTask('[pagina] home'), status: 'done', summary: 'Creato index.html' });
  p.tasks.push({ ...projects.newTask('[codice] form contatti'), status: 'running' });
  const ctx = await projects.chatContext(user, p);
  assert.equal(ctx.busy, true);
  assert.match(ctx.text, /<piano>\n# Obiettivo/);
  assert.match(ctx.text, /1\. \[fatto\] \(Pagina o gioco\) home — Creato index\.html/);
  assert.match(ctx.text, /2\. \[IN CORSO\] \(Codice\) form contatti/);
  assert.match(ctx.text, /Piano aggiornato/);
});

test('strumenti e prompt: coda e verifica solo nella chat del progetto', () => {
  const names = (o) => computerTools(o).map((t) => t.function.name);
  assert.ok(!names({ project: true }).includes('add_project_tasks'));
  assert.ok(names({ project: true, projectChat: true }).includes('add_project_tasks'));
  assert.ok(names({ project: true, projectChat: true }).includes('check_project'));
  const project = { id: 'x', name: 'Tetris', folder: 'tetris' };
  const base = { files: '(vuota)', canRun: false, project };
  assert.doesNotMatch(computerPrompt(base), /chat del progetto/);
  const calm = computerPrompt({ ...base, projectChat: { text: 'Nessun task.', busy: false } });
  assert.match(calm, /Questa è la chat del progetto «Tetris»/);
  assert.match(calm, /per verificare il lavoro usa check_project/);
  assert.doesNotMatch(calm, /ADESSO un task/);
  assert.match(computerPrompt({ ...base, projectChat: { text: '', busy: true } }), /ADESSO un task della coda sta lavorando/);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

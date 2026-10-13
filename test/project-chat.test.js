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
  // modifiche mirate e ripristino ovunque; librerie solo per l'amministratore nella chat del progetto
  assert.ok(['edit_file', 'restore_file'].every((n) => names({ project: true }).includes(n)));
  assert.ok(!names({ project: true, projectChat: true }).includes('install_packages'));
  assert.ok(names({ project: true, projectChat: true, canRun: true }).includes('install_packages'));
  assert.ok(!names({ project: true, canRun: true }).includes('install_packages'));
  // il coordinatore guida da solo: piano, task e coda nello stesso turno, librerie installate senza chiedere
  const admin = computerPrompt({ ...base, canRun: true, projectChat: { text: '', busy: false } });
  assert.match(admin, /fai tutti i passi nello stesso turno/);
  assert.match(admin, /installale tu con install_packages/);
  assert.doesNotMatch(calm, /install_packages/);
  assert.doesNotMatch(calm, /riscrivilo intero/);
});

test('coordinatore: spento o oltre il limite di interventi non apre turni e lascia la decisione all\'utente', async () => {
  const { adminUser } = await import('../src/auth.js');
  const runner = await import('../src/runner.js');
  const owner = adminUser();
  const p = await projects.create(owner, 'Coordinato');
  const task = { ...projects.newTask('[pagina] index.html'), status: 'failed' };
  p.tasks.push(task);
  p.coordinator = false;
  await runner.coordinate(p, task);
  assert.equal(task.coordinated, undefined);
  p.coordinator = true;
  task.coordinated = 2;
  await runner.coordinate(p, task);
  assert.equal(task.coordinated, 3);
  // domanda chiara all'utente: cosa non va, cosa è stato provato, cosa può fare
  assert.match(p.log.at(-1).text, /Domanda per te: .* non riesce: .*Cosa faccio\?/);
  assert.match(task.question, /Rispondi nella chat del progetto/);
  assert.deepEqual(p.chats, []);
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('piano: la sezione «Regole» è riferimento per i task, non un elenco di task', () => {
  const plan = '# Obiettivo\nClone di Space Invaders\n\n# Regole\n- alieni in griglia 5x11 che si muove in blocco\n- scendono a ogni bordo\n\n# Task\n- [pagina] index.html con il canvas\n  Fatto quando: si vede la formazione\n- [codice] logica in game.js';
  assert.deepEqual(projects.parsePlan(plan).map((t) => t.text), ['[pagina] index.html con il canvas\nFatto quando: si vede la formazione', '[codice] logica in game.js']);
});

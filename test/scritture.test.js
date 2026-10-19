import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// dati e cartella di lavoro temporanei: config li legge all'import
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-scritture-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.GPU_ARBITER = '0';
const ws = await import('../src/workspace.js');
const { missingFromOutput, installPackages } = await import('../src/deps.js');
const chat = await import('../src/chat.js');

const user = { id: 'u1', username: 'prova', role: 'admin', project: 'missile' };
const codice = Array.from({ length: 60 }, (_, i) => `function f${i}() { return ${i}; }`).join('\n');

test('il segnaposto della cronologia non finisce mai in un file (prova Missile Command 2026-10-11)', async () => {
  await ws.writeFile(user, 'game.js', codice);
  for (const fake of ['[8123 caratteri scritti nel file: usa read_file per rileggerlo]', '«omessi 8123 caratteri: sono già salvati in game.js; per rivederli usa read_file»', '// ... resto del codice invariato']) {
    await assert.rejects(ws.writeFile(user, 'game.js', fake), (e) => e.placeholder && /rifiutata/.test(e.message));
    await assert.rejects(ws.appendFile(user, 'game.js', fake), /rifiutata/);
  }
  // nemmeno in un file nuovo, e nemmeno dentro una modifica
  await assert.rejects(ws.writeFile(user, 'synth_gen.py', '[234 caratteri scritti nel file: usa read_file per rileggerlo]'), /segnaposto/);
  await assert.rejects(ws.editFile(user, 'game.js', 'return 1;', '[99 caratteri scritti nel file: usa read_file per rileggerlo]'), /segnaposto/);
  assert.equal(fs.readFileSync(ws.resolve(user, 'game.js').abs, 'utf8'), codice);
  assert.equal(fs.existsSync(ws.resolve(user, 'synth_gen.py').abs), false);
  // un commento vero in un file lungo resta permesso
  await ws.writeFile(user, 'nota.js', `${codice}\n// il resto del codice è in utils.js`);
});

test('un file pieno non si svuota; un file nuovo vuoto sì (es. __init__.py)', async () => {
  await assert.rejects(ws.writeFile(user, 'game.js', '  \n'), /vuoto/);
  const r = await ws.writeFile(user, 'pkg/__init__.py', '');
  assert.equal(r.created, true);
});

test('copia della versione precedente: restore_file la rimette, anche dopo delete_file', async () => {
  const r = await ws.writeFile(user, 'game.js', 'function f() {}\n');
  assert.match(r.warning, /aveva 60 righe, ora 2/);
  const back = await ws.restoreFile(user, 'game.js');
  assert.equal(back.lines, 60);
  assert.equal(fs.readFileSync(ws.resolve(user, 'game.js').abs, 'utf8'), codice);
  // il ripristino si annulla: la versione corta è diventata una copia
  assert.equal((await ws.restoreFile(user, 'game.js')).lines, 2);
  await ws.restoreFile(user, 'game.js');
  await ws.deleteFile(user, 'game.js');
  await ws.restoreFile(user, 'game.js');
  assert.equal(fs.readFileSync(ws.resolve(user, 'game.js').abs, 'utf8'), codice);
  // le copie stanno fuori dal progetto (test, librerie e storia non le vedono) e sono al massimo 5
  assert.ok(!(await ws.listFiles(user)).some((f) => /backup/.test(f.path)));
  for (let i = 0; i < 8; i++) await ws.writeFile(user, 'conta.txt', `versione ${i}`);
  assert.equal((await ws.backups(user, 'conta.txt')).length, 5);
});

test('edit_file: sostituzione esatta e unica, anche con a capo di Windows', async () => {
  await ws.editFile(user, 'game.js', 'function f3() { return 3; }', 'function f3() { return 33; }');
  assert.match(fs.readFileSync(ws.resolve(user, 'game.js').abs, 'utf8'), /return 33;/);
  await assert.rejects(ws.editFile(user, 'game.js', 'non c\'è', 'x'), /non c'è/);
  await assert.rejects(ws.editFile(user, 'game.js', 'function', 'fn'), /compare 60 volte/);
  assert.equal((await ws.editFile(user, 'game.js', '() {', '( ) {', { all: true })).replaced, 60);
  fs.writeFileSync(ws.resolve(user, 'win.py').abs, 'a = 1\r\nb = 2\r\nc = 3\r\n');
  await ws.editFile(user, 'win.py', 'a = 1\nb = 2', 'a = 10\nb = 20');
  assert.equal(fs.readFileSync(ws.resolve(user, 'win.py').abs, 'utf8'), 'a = 10\r\nb = 20\r\nc = 3\r\n');
  await assert.rejects(ws.editFile(user, 'win.py', fs.readFileSync(ws.resolve(user, 'win.py').abs, 'utf8'), ''), /svuoterebbe/);
});

test('ciclo di riscrittura: segnaposto ripetuto, stesso contenuto o troppe riscritture fermano il turno', () => {
  const conv = { id: 'c-ciclo' };
  const err = Object.assign(new Error('x'), { placeholder: true });
  assert.equal(chat.trackWrite(conv, 'write_file', 'game.js', '[1 caratteri…]', err), null);
  assert.match(chat.trackWrite(conv, 'write_file', 'game.js', '[1 caratteri…]', err).reason, /2 volte .* segnaposto/);
  assert.match(chat.takeLoop('c-ciclo').path, /game\.js/);
  assert.equal(chat.takeLoop('c-ciclo'), null);

  const c2 = { id: 'c-uguale' };
  chat.trackWrite(c2, 'write_file', 'synth_gen.py', 'A');
  chat.trackWrite(c2, 'write_file', 'synth_gen.py', 'B');
  chat.trackWrite(c2, 'write_file', 'synth_gen.py', 'A');
  assert.equal(chat.trackWrite(c2, 'write_file', 'synth_gen.py', 'B'), null);
  assert.match(chat.trackWrite(c2, 'write_file', 'synth_gen.py', 'A').reason, /3 volte synth_gen\.py allo stesso contenuto/);
  chat.takeLoop('c-uguale');

  const c3 = { id: 'c-tante' };
  let loop = null;
  for (let i = 0; i < 12 && !loop; i++) loop = chat.trackWrite(c3, 'write_file', 'index.html', `v${i}`);
  assert.match(loop.reason, /riscritto da capo index\.html 11 volte/);
  // modifiche fatte e disfatte con edit_file (prova Space Invaders: game.js avanti e indietro)
  const c5 = { id: 'c-avanti-indietro' };
  for (const v of ['A', 'B', 'A', 'B']) assert.equal(chat.trackWrite(c5, 'edit_file', 'game.js', v), null);
  assert.match(chat.trackWrite(c5, 'edit_file', 'game.js', 'A').reason, /modifiche fatte e disfatte/);
  chat.takeLoop('c-avanti-indietro');
  // append non è una riscrittura intera
  const c4 = { id: 'c-blocchi' };
  for (let i = 0; i < 20; i++) assert.equal(chat.trackWrite(c4, 'append_file', 'index.html', `blocco ${i}`), null);
  chat.takeLoop('c-tante');
  chat.takeLoop('c-blocchi');
});

test('edit_file: una modifica già fatta lo dice, invece di «non c\'è»', async () => {
  await ws.writeFile(user, 'gia.js', 'const a = 2;\nconst b = 3;\n');
  await ws.editFile(user, 'gia.js', 'const a = 2;', 'const a = 20;');
  await assert.rejects(ws.editFile(user, 'gia.js', 'const a = 2;', 'const a = 20;'), /sembra già fatta/);
  await assert.rejects(ws.editFile(user, 'gia.js', 'const c = 2;', 'const c = 5;'), /rileggi il file/);
});

test('librerie mancanti lette dall\'output di test e script', () => {
  const out = `Traceback (most recent call last):\n  File "synth_gen.py", line 3\nModuleNotFoundError: No module named 'numpy'\nImportError: No module named yaml.loader\nError [ERR_MODULE_NOT_FOUND]: Cannot find package 'cheerio' imported from x.js\nError: Cannot find module './locale'\nError: Cannot find module 'node:fs'`;
  assert.deepEqual(missingFromOutput(out), [
    { lang: 'python', name: 'numpy', pkg: 'numpy' },
    { lang: 'python', name: 'yaml', pkg: 'pyyaml' },
    { lang: 'js', name: 'cheerio', pkg: 'cheerio' },
  ]);
});

test('installazione: nomi che pip o npm leggerebbero come opzioni o percorsi non partono', async () => {
  const r = await installPackages(tmp, [
    { lang: 'python', pkg: '--index-url=http://x' }, { lang: 'python', pkg: '../evil' }, { lang: 'js', pkg: 'https://x/y.tgz' }, { lang: 'js', pkg: 'Maiuscole' },
  ]);
  assert.deepEqual(r.installed, []);
  assert.deepEqual(r.skipped.map((x) => x.why), ['nome non valido', 'nome non valido', 'nome non valido', 'nome non valido']);
});

test('chat normale: niente scritture in un\'altra cartella che l\'utente non ha nominato (prova torrent-cli 2026-10-19)', () => {
  const conv = { folder: 'torrent-cli', messages: [{ role: 'user', content: 'per completare il progetto e renderlo robusto crea piano.md' }] };
  const exists = () => true;
  assert.throws(() => chat.requireOwnFolder(conv, 'clone-missile-command/PIANO.md', exists), /sta lavorando nella cartella «torrent-cli\/»/);
  chat.requireOwnFolder(conv, 'torrent-cli/PIANO.md', exists);
  chat.requireOwnFolder(conv, 'nuova-cartella/app.py', () => false); // una cartella nuova si può creare
  chat.requireOwnFolder(conv, 'PIANO.md', exists); // file alla radice: nessuna cartella
  chat.requireOwnFolder({ ...conv, folder: undefined }, 'clone-missile-command/PIANO.md', exists);
  chat.requireOwnFolder({ ...conv, project: { folder: 'x' } }, 'clone-missile-command/PIANO.md', exists);
  // l'utente nomina l'altra cartella (anche con spazi al posto dei trattini): si può
  chat.requireOwnFolder({ ...conv, messages: [{ role: 'user', content: 'aggiorna il piano di clone missile command' }] }, 'clone-missile-command/PIANO.md', exists);
});

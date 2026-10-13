import test from 'node:test';
import assert from 'node:assert/strict';
import { taskCommand, TASK_COMMANDS_HELP } from '../src/taskcmd.js';

test('esporta TASK_COMMANDS_HELP come stringa non vuota', () => {
  assert.equal(typeof TASK_COMMANDS_HELP, 'string');
  assert.ok(TASK_COMMANDS_HELP.length > 0);
});

test('python script valido', () => {
  assert.deepEqual(taskCommand('python script.py'), { ok: true, kind: 'run' });
});

test('python script con argomenti valido', () => {
  assert.deepEqual(taskCommand('python script.py --verbose'), { ok: true, kind: 'run' });
});

test('python3 script valido', () => {
  assert.deepEqual(taskCommand('python3 script.py'), { ok: true, kind: 'run' });
});

test('py script valido', () => {
  assert.deepEqual(taskCommand('py script.py'), { ok: true, kind: 'run' });
});

test('python.exe script valido', () => {
  assert.deepEqual(taskCommand('python.exe script.py'), { ok: true, kind: 'run' });
});

test('python script con estensione sbagliata fallisce', () => {
  assert.deepEqual(taskCommand('python script.js'), { ok: false, reason: 'formato python non ammesso' });
});

test('python unittest valido', () => {
  assert.deepEqual(taskCommand('python -m unittest'), { ok: true, kind: 'run' });
});

test('python unittest con argomenti valido', () => {
  assert.deepEqual(taskCommand('python -m unittest test_module'), { ok: true, kind: 'run' });
});

test('python3 unittest valido', () => {
  assert.deepEqual(taskCommand('python3 -m unittest'), { ok: true, kind: 'run' });
});

test('py unittest valido', () => {
  assert.deepEqual(taskCommand('py -m unittest'), { ok: true, kind: 'run' });
});

test('python pytest valido', () => {
  assert.deepEqual(taskCommand('python -m pytest'), { ok: true, kind: 'run' });
});

test('python pytest con argomenti valido', () => {
  assert.deepEqual(taskCommand('python -m pytest -v'), { ok: true, kind: 'run' });
});

test('pytest diretto valido', () => {
  assert.deepEqual(taskCommand('pytest'), { ok: true, kind: 'run' });
});

test('pytest con argomenti valido', () => {
  assert.deepEqual(taskCommand('pytest -v'), { ok: true, kind: 'run' });
});

test('node script js valido', () => {
  assert.deepEqual(taskCommand('node script.js'), { ok: true, kind: 'run' });
});

test('node script mjs valido', () => {
  assert.deepEqual(taskCommand('node script.mjs'), { ok: true, kind: 'run' });
});

test('node script cjs valido', () => {
  assert.deepEqual(taskCommand('node script.cjs'), { ok: true, kind: 'run' });
});

test('node script con argomenti valido', () => {
  assert.deepEqual(taskCommand('node script.js --flag'), { ok: true, kind: 'run' });
});

test('node --test valido', () => {
  assert.deepEqual(taskCommand('node --test'), { ok: true, kind: 'run' });
});

test('node --test con argomenti valido', () => {
  assert.deepEqual(taskCommand('node --test --coverage'), { ok: true, kind: 'run' });
});

test('node script con estensione sbagliata fallisce', () => {
  assert.deepEqual(taskCommand('node script.py'), { ok: false, reason: 'formato node non ammesso' });
});

test('npm test valido', () => {
  assert.deepEqual(taskCommand('npm test'), { ok: true, kind: 'run' });
});

test('npm run con nome valido', () => {
  assert.deepEqual(taskCommand('npm run build'), { ok: true, kind: 'run' });
});

test('npm run con nome e argomenti valido', () => {
  assert.deepEqual(taskCommand('npm run build -- --verbose'), { ok: true, kind: 'run' });
});

test('npm run senza nome fallisce', () => {
  assert.deepEqual(taskCommand('npm run'), { ok: false, reason: 'nome script mancante' });
});

test('npm install pacchetto valido', () => {
  assert.deepEqual(taskCommand('npm install lodash'), { ok: true, kind: 'install', lang: 'js', packages: ['lodash'] });
});

test('npm install più pacchetti valido', () => {
  assert.deepEqual(taskCommand('npm install lodash express'), { ok: true, kind: 'install', lang: 'js', packages: ['lodash', 'express'] });
});

test('npm i pacchetto valido', () => {
  assert.deepEqual(taskCommand('npm i lodash'), { ok: true, kind: 'install', lang: 'js', packages: ['lodash'] });
});

test('npm install senza pacchetti fallisce', () => {
  assert.deepEqual(taskCommand('npm install'), { ok: false, reason: 'almeno un pacchetto richiesto' });
});

test('npm install con opzione fallisce', () => {
  assert.deepEqual(taskCommand('npm install --save lodash'), { ok: false, reason: 'opzioni non ammesse in install' });
});

test('npm install pacchetto non valido fallisce', () => {
  // la specifica non ammette la forma pacchetto@versione di npm
  assert.equal(taskCommand('npm install lodash@1.0.0').ok, false);
});

test('pip install pacchetto valido', () => {
  assert.deepEqual(taskCommand('python -m pip install requests'), { ok: true, kind: 'install', lang: 'python', packages: ['requests'] });
});

test('pip install più pacchetti valido', () => {
  assert.deepEqual(taskCommand('python -m pip install requests flask'), { ok: true, kind: 'install', lang: 'python', packages: ['requests', 'flask'] });
});

test('python3 pip install valido', () => {
  assert.deepEqual(taskCommand('python3 -m pip install requests'), { ok: true, kind: 'install', lang: 'python', packages: ['requests'] });
});

test('py pip install valido', () => {
  assert.deepEqual(taskCommand('py -m pip install requests'), { ok: true, kind: 'install', lang: 'python', packages: ['requests'] });
});

test('pip install senza pacchetti fallisce', () => {
  assert.deepEqual(taskCommand('python -m pip install'), { ok: false, reason: 'almeno un pacchetto richiesto' });
});

test('pip install con opzione fallisce', () => {
  assert.deepEqual(taskCommand('python -m pip install --upgrade requests'), { ok: false, reason: 'opzioni non ammesse in install' });
});

test('comando vuoto fallisce', () => {
  assert.deepEqual(taskCommand(''), { ok: false, reason: 'comando vuoto o troppo lungo' });
});

test('comando troppo lungo fallisce', () => {
  const longCmd = 'python ' + 'a'.repeat(300) + '.py';
  assert.deepEqual(taskCommand(longCmd), { ok: false, reason: 'comando vuoto o troppo lungo' });
});

test('comando con carattere vietato & fallisce', () => {
  assert.deepEqual(taskCommand('python script.py & echo hi'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato | fallisce', () => {
  assert.deepEqual(taskCommand('python script.py | grep ok'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato < fallisce', () => {
  assert.deepEqual(taskCommand('python script.py < input.txt'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato > fallisce', () => {
  assert.deepEqual(taskCommand('python script.py > output.txt'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato ^ fallisce', () => {
  assert.deepEqual(taskCommand('python script.py ^ echo hi'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato ; fallisce', () => {
  assert.deepEqual(taskCommand('python script.py; echo hi'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato ` fallisce', () => {
  assert.deepEqual(taskCommand('python `script.py`'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato $ fallisce', () => {
  assert.deepEqual(taskCommand('python $script.py'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato % fallisce', () => {
  assert.deepEqual(taskCommand('python script.py %s'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato ( fallisce', () => {
  assert.deepEqual(taskCommand('python (script.py)'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con carattere vietato ) fallisce', () => {
  assert.deepEqual(taskCommand('python script.py)'), { ok: false, reason: 'caratteri non ammessi' });
});

test('comando con newline fallisce', () => {
  assert.deepEqual(taskCommand('python script.py\necho hi'), { ok: false, reason: 'caratteri non ammessi' });
});

test('percorso assoluto unix fallisce', () => {
  assert.deepEqual(taskCommand('python /usr/bin/script.py'), { ok: false, reason: 'percorso non sicuro' });
});

test('percorso assoluto windows fallisce', () => {
  assert.deepEqual(taskCommand('python C:\\Users\\script.py'), { ok: false, reason: 'percorso non sicuro' });
});

test('percorso con .. fallisce', () => {
  assert.deepEqual(taskCommand('python ../script.py'), { ok: false, reason: 'percorso non sicuro' });
});

test('comando non riconosciuto fallisce', () => {
  assert.deepEqual(taskCommand('ls -la'), { ok: false, reason: 'comando non riconosciuto' });
});

test('npm sottocomando non ammesso fallisce', () => {
  assert.deepEqual(taskCommand('npm list'), { ok: false, reason: 'sottocomando npm non ammesso' });
});

test('python sottocomando pip non ammesso fallisce', () => {
  assert.deepEqual(taskCommand('python -m pip list'), { ok: false, reason: 'sottocomando pip non ammesso' });
});

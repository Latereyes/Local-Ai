import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-libro-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
process.env.GPU_ARBITER = '0';
const projects = await import('../src/projects.js');
const { missingFromOutput } = await import('../src/deps.js');
const chat = await import('../src/chat.js');

test('classify: identifica correttamente i tipi di task', () => {
  // Task di scrittura di capitoli: deve essere 'chat'
  assert.equal(
    projects.classify("Scrivi i capitoli 3 e 4 del libro in cap_03.md e cap_04.md. Fatto quando: i test passano"),
    'chat'
  );
  // Task di scrittura in inglese: deve essere 'chat'
  assert.equal(
    projects.classify("Write chapter 2 in chapter_02.md, at least 3000 words"),
    'chat'
  );
  // Task di scrittura di script Python: deve essere 'code'
  assert.equal(
    projects.classify("Scrivi uno script Python per impaginare il libro"),
    'code'
  );
  // Task di creazione pagina HTML: deve essere 'page'
  assert.equal(
    projects.classify("Scrivi la pagina index.html del libro"),
    'page'
  );
  // Task con tag esplicito [codice]: deve essere 'code'
  assert.equal(
    projects.classify("[codice] Scrivi il capitolo del parser"),
    'code'
  );
});

test('wordTarget: estrae il target di parole corretto', () => {
  // Formato italiano con punto come separatore migliaia
  assert.equal(projects.wordTarget("almeno 3.000 parole"), 3000);
  // Formato inglese con virgola come separatore migliaia
  assert.equal(projects.wordTarget("at least 2,500 words"), 2500);
  // Conversione da pagine a parole (1 pagina = 250 parole)
  assert.equal(projects.wordTarget("almeno 10 pagine"), 10 * projects.WORDS_PER_PAGE);
  // Se non c'è "almeno" o simile, il target è 0
  assert.equal(projects.wordTarget("obiettivo delle 125 pagine"), 0);
  // Prende il massimo se ci sono più target
  assert.equal(projects.wordTarget("almeno 500 parole ... almeno 4 pagine"), 1000);
});

test('textFiles: trova i file di testo menzionati', () => {
  const text = "Scrivi cap_03.md e testi/a.txt. Ignora app.py. Rivedi ./cap_03.md";
  const files = projects.textFiles(text);
  assert.deepEqual(files, ['cap_03.md', 'testi/a.txt']);
});

test('countWords: conta le parole ignorando punteggiatura e trattini', () => {
  // "Ciao, l'amica è qui — 3 volte" -> Ciao, l'amica, è, qui, 3, volte (6 parole)
  assert.equal(projects.countWords("Ciao, l'amica è qui — 3 volte"), 6);
});

test('textCheck: verifica la lunghezza dei file scritti', () => {
  const targetWords = 1000;
  const taskText = `Scrivi il capitolo in cap_01.md. Almeno ${targetWords} parole.`;
  
  // a) File scritto e abbastanza lungo
  {
    const content = 'parola '.repeat(targetWords);
    const read = (f) => f === 'cap_01.md' ? content : null;
    const res = projects.textCheck(taskText, ['cap_01.md'], read);
    assert.equal(res.problems.length, 0);
    assert.equal(res.checks[0].ok, true);
  }

  // b) File troppo corto
  {
    const content = 'parola '.repeat(100);
    const read = (f) => f === 'cap_01.md' ? content : null;
    const res = projects.textCheck(taskText, ['cap_01.md'], read);
    assert.equal(res.problems.length, 1);
    assert.match(res.problems[0], /cap_01\.md/);
    assert.match(res.problems[0], /100 words/);
    assert.match(res.problems[0], new RegExp(`at least ${targetWords}`));
    assert.match(res.problems[0], /append_file/);
    assert.equal(res.checks[0].ok, false);
  }

  // c) File menzionato ma non creato
  {
    const read = (f) => null;
    const res = projects.textCheck(taskText, [], read);
    assert.equal(res.problems.length, 1);
    assert.match(res.problems[0], /was not created/);
  }

  // d) File menzionato che esiste ma non è stato scritto dal task (input)
  {
    const inputContent = 'parola '.repeat(10);
    const read = (f) => f === 'struttura_libro.md' ? inputContent : null;
    // Il task menziona struttura_libro.md ma non lo ha scritto
    const res = projects.textCheck("Scrivi cap_01.md. Usa struttura_libro.md. Almeno 1000 parole.", ['cap_01.md'], read);
    // struttura_libro.md non deve essere nei checks perché non è in written e read(f) != null
    assert.equal(res.checks.length, 1);
    assert.equal(res.checks[0].file, 'cap_01.md');
  }

  // e) PIANO.md non viene mai controllato
  {
    const content = 'parola '.repeat(10);
    const read = (f) => f === 'PIANO.md' ? content : null;
    const res = projects.textCheck("Scrivi PIANO.md. Almeno 1000 parole.", ['PIANO.md'], read);
    assert.equal(res.checks.length, 0);
    assert.equal(res.problems.length, 0);
  }

  // f) Senza target, qualsiasi lunghezza passa
  {
    const content = 'parola '.repeat(10);
    const read = (f) => f === 'cap_01.md' ? content : null;
    const res = projects.textCheck("Scrivi cap_01.md.", ['cap_01.md'], read);
    assert.equal(res.problems.length, 0);
    assert.equal(res.checks[0].ok, true);
  }
});

test('planPrompt: genera il prompt di pianificazione corretto', () => {
  const goal = 'Libro sulla mindfulness in inglese, 125 pagine';
  const prompts = projects.planPrompt(goal, '');
  
  // Il system content deve menzionare le regole di lunghezza e lingua
  const systemContent = prompts[0].content;
  assert.match(systemContent, /almeno N parole/);
  assert.match(systemContent, /un task \[testo\] per ogni capitolo/);
  assert.match(systemContent, /Lingua/);
  // la lunghezza totale e tutte le parti chieste (il primo piano in inglese era di 6 file da 2000 parole, senza copertina)
  assert.match(systemContent, /lunghezza totale/);
  assert.match(systemContent, /copertina/);

  // Il user content deve contenere l'obiettivo
  const userContent = prompts[1].content;
  assert.match(userContent, /Libro sulla mindfulness in inglese, 125 pagine/);
});

test('compactCall: comprime il contenuto dei file scritti', () => {
  // write_file con contenuto lungo
  const longContent = 'x'.repeat(1000);
  const call1 = {
    function: {
      name: 'write_file',
      arguments: JSON.stringify({ path: 'test.md', content: longContent })
    }
  };
  const compacted1 = chat.compactCall(call1);
  assert.ok(compacted1.function.arguments.content.startsWith('«omessi 1000 caratteri'));
  assert.match(compacted1.function.arguments.content, /test\.md/);

  // write_file con contenuto corto
  const shortContent = 'y'.repeat(100);
  const call2 = {
    function: {
      name: 'write_file',
      arguments: JSON.stringify({ path: 'test.md', content: shortContent })
    }
  };
  const compacted2 = chat.compactCall(call2);
  assert.equal(compacted2.function.arguments.content, shortContent);

  // read_file non viene modificato
  const call3 = {
    function: {
      name: 'read_file',
      arguments: JSON.stringify({ path: 'test.md' })
    }
  };
  const compacted3 = chat.compactCall(call3);
  assert.deepEqual(compacted3.function.arguments, { path: 'test.md' });

  // Argomenti come oggetto
  const call4 = {
    function: {
      name: 'write_file',
      arguments: { path: 'test.md', content: longContent }
    }
  };
  const compacted4 = chat.compactCall(call4);
  assert.ok(compacted4.function.arguments.content.startsWith('«omessi 1000 caratteri'));
});

test('missingFromOutput: identifica i pacchetti mancanti', () => {
  const result = missingFromOutput("ModuleNotFoundError: No module named 'fpdf'");
  assert.equal(result.length, 1);
  assert.equal(result[0].pkg, 'fpdf2');
});
test('singleFile: il file da scrivere di un task, se è uno solo (Gemma manda write_file senza path)', () => {
  assert.equal(chat.singleFile('[testo] Scrivere il Capitolo 3 in `03_relationships.md` (almeno 2000 parole)\n  Fatto quando: il file `03_relationships.md` è presente'), '03_relationships.md');
  assert.equal(chat.singleFile('Leggi PIANO.md e scrivi ./intro.md'), 'intro.md');
  assert.equal(chat.singleFile('Scrivi cap_01.md e cap_02.md'), null);
  assert.equal(chat.singleFile('Scrivi un capitolo'), null);
});

test('textCheck: il solo file nominato dal task si controlla anche se lo ha scritto la chat del progetto', () => {
  const read = (f) => (f === '03_relationships.md' ? 'word '.repeat(1374) : null);
  const r = projects.textCheck('Scrivere il Capitolo 3 in `03_relationships.md` (almeno 2000 parole)', [], read);
  assert.equal(r.checks.length, 1);
  assert.equal(r.checks[0].ok, false);
  assert.match(r.problems[0], /1374 words/);
});

test('compactWrites: le scritture restano intere finché stanno nel budget, poi si accorciano le più vecchie', () => {
  const w = (path, n) => ({ function: { name: 'write_file', arguments: { path, content: 'x'.repeat(n) } } });
  const convo = [
    { role: 'user', content: 'scrivi' },
    { role: 'assistant', content: '', tool_calls: [w('a.md', 3000)] },
    { role: 'tool', content: 'ok' },
    { role: 'assistant', content: '', tool_calls: [w('b.md', 3000)] },
    { role: 'tool', content: 'ok' },
    { role: 'assistant', content: '', tool_calls: [w('c.md', 3000)] },
  ];
  chat.compactWrites(convo, 10000);
  assert.ok(convo.every((m) => !m.tool_calls || m.tool_calls[0].function.arguments.content.length === 3000), 'nel budget: tutto intero');
  chat.compactWrites(convo, 5000);
  assert.match(convo[1].tool_calls[0].function.arguments.content, /^«omessi 3000 caratteri/);
  assert.match(convo[3].tool_calls[0].function.arguments.content, /^«omessi 3000 caratteri/);
  assert.equal(convo[5].tool_calls[0].function.arguments.content.length, 3000, 'l\'ultima resta intera');
});

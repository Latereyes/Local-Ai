import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-plancheck-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');

import { test } from 'node:test';
import assert from 'node:assert/strict';
const { checkPlan, goalWords, pdfPages, namedFiles } = await import('../src/plancheck.js');

test('goalWords: calcola parole da pagine', () => {
  assert.equal(goalWords('125 pagine'), 125 * 250);
  assert.equal(goalWords('125 pages'), 125 * 250);
});

test('goalWords: calcola parole da conteggio diretto', () => {
  assert.equal(goalWords('30000 parole'), 30000);
  assert.equal(goalWords('30.000 words'), 30000);
  assert.equal(goalWords("30,000 words"), 30000);
});

test('goalWords: prende il massimo se ci sono più valori', () => {
  assert.equal(goalWords('100 pagine e 50000 parole'), 50000);
});

test('goalWords: restituisce 0 se non trova nulla', () => {
  assert.equal(goalWords('Scrivi un libro'), 0);
  assert.equal(goalWords(''), 0);
});

test('pdfPages: estrae intervallo tra X e Y', () => {
  assert.deepEqual(pdfPages('tra 110 e 170 pagine'), { min: 110, max: 170 });
  assert.deepEqual(pdfPages('between 110 and 170 pages'), { min: 110, max: 170 });
});

test('pdfPages: estrae minimo con almeno', () => {
  assert.deepEqual(pdfPages('almeno 100 pagine'), { min: 100, max: Infinity });
  assert.deepEqual(pdfPages('at least 100 pages'), { min: 100, max: Infinity });
});

test('pdfPages: restituisce null se non trova pagine', () => {
  assert.equal(pdfPages('Scrivi il capitolo'), null);
  assert.equal(pdfPages(''), null);
});

test('namedFiles: estrae file con estensioni valide', () => {
  assert.deepEqual(namedFiles('Salva in `01.md` e `02.txt`'), ['01.md', '02.txt']);
  assert.deepEqual(namedFiles('Genera `book.html`'), ['book.html']);
});

test('namedFiles: rimuove ./ iniziale', () => {
  assert.deepEqual(namedFiles('Salva in ./out/Mindfulness_Book.pdf'), ['out/Mindfulness_Book.pdf']);
});

test('namedFiles: ignora file dentro URL', () => {
  assert.deepEqual(namedFiles('Scarica da http://example.com/file.pdf'), []);
});

test('namedFiles: rimuove duplicati', () => {
  assert.deepEqual(namedFiles('Salva in `01.md` e poi di nuovo in `01.md`'), ['01.md']);
});

test('checkPlan: piano vuoto restituisce errore specifico', () => {
  const plan = '# Obiettivo\n# Regole\n# Task';
  const problems = checkPlan(plan, '100 pagine');
  assert.deepEqual(problems, ['Il piano non ha task.']);
});

test('checkPlan: piano valido senza problemi', () => {
  const plan = `# Obiettivo
# Regole
# Task
- [testo] Scrivi il capitolo 1 in \`01.md\` (almeno 3000 parole)
- [testo] Scrivi il capitolo 2 in \`02.md\` (almeno 3000 parole)
- [pdf] Genera il PDF finale
- [word] Genera il documento Word
- [copertina] Crea la copertina`;
  const goal = '6000 parole, PDF, Word, copertina';
  const problems = checkPlan(plan, goal);
  assert.deepEqual(problems, []);
});

test('checkPlan: totale parole insufficiente', () => {
  const plan = `# Obiettivo
# Regole
# Task
- [testo] Scrivi il capitolo 1 in \`01.md\` (almeno 1000 parole)`;
  const goal = '10000 parole';
  const problems = checkPlan(plan, goal);
  assert.ok(problems.some(p => p.includes('I task di testo sommano 1000 parole')));
});

test('checkPlan: manca la copertina', () => {
  const plan = `# Obiettivo
# Regole
# Task
- [testo] Scrivi il capitolo 1 in \`01.md\` (almeno 3000 parole)`;
  const goal = 'Copertina e 3000 parole';
  const problems = checkPlan(plan, goal);
  assert.ok(problems.some(p => p.includes('L\'obiettivo chiede la copertina ma nessun task la prepara')));
});

test('checkPlan: manca il PDF', () => {
  const plan = `# Obiettivo
# Regole
# Task
- [testo] Scrivi il capitolo 1 in \`01.md\` (almeno 3000 parole)`;
  const goal = 'PDF e 3000 parole';
  const problems = checkPlan(plan, goal);
  assert.ok(problems.some(p => p.includes('L\'obiettivo chiede il PDF ma nessun task lo prepara')));
});

test('checkPlan: manca il documento Word', () => {
  const plan = `# Obiettivo
# Regole
# Task
- [testo] Scrivi il capitolo 1 in \`01.md\` (almeno 3000 parole)`;
  const goal = 'Word e 3000 parole';
  const problems = checkPlan(plan, goal);
  assert.ok(problems.some(p => p.includes('L\'obiettivo chiede il documento Word ma nessun task lo prepara')));
});

test('checkPlan: usa libreria Python invece di LocalAI', () => {
  const plan = `# Obiettivo
# Regole
# Task
- [testo] Usa reportlab per generare il PDF`;
  const goal = 'PDF';
  const problems = checkPlan(plan, goal);
  assert.ok(problems.some(p => p.includes('usa reportlab: usa invece lo strumento html_to_pdf')));
});

test('checkPlan: task troppo grande in parole', () => {
  const plan = `# Obiettivo
# Regole
# Task
- [testo] Scrivi il capitolo 1 in \`01.md\` (almeno 5000 parole)`;
  const goal = '5000 parole';
  const problems = checkPlan(plan, goal);
  assert.ok(problems.some(p => p.includes('chiede 5000 parole: dividilo in task da al massimo 4000 parole')));
});

test('checkPlan: task scrive troppi file', () => {
  const plan = `# Obiettivo
# Regole
# Task
- [testo] Scrivi \`01.md\`, \`02.md\`, \`03.md\`, \`04.md\` (almeno 100 parole)`;
  const goal = '100 parole';
  const problems = checkPlan(plan, goal);
  assert.ok(problems.some(p => p.includes('scrive troppi file: un file per task')));
});

test('namedFiles: un URL nel testo non nasconde i file nominati dopo', () => {
  assert.deepEqual(namedFiles('Vedi https://esempio.it/guida.html poi crea `book.html` e ./out/libro.pdf'), ['book.html', 'out/libro.pdf']);
});

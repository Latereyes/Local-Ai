import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-memoria-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
const memory = await import('../src/memory.js');

test('redact: rimuove vari tipi di segreti e conta le rimozioni', () => {
  const input = `password: Segreta99 token=abc123xyz sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz ghp_1234567890123456789012345678901234567890 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc AKIAIOSFODNN7EXAMPLE https://user:pass@example.com abcdefghijklmnopqrstuvwxyz1234567890`;
  const { text, removed } = memory.redact(input);
  
  assert.ok(!text.includes('Segreta99'));
  assert.ok(!text.includes('abc123xyz'));
  assert.ok(!text.includes('sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz'));
  assert.ok(!text.includes('ghp_1234567890123456789012345678901234567890'));
  assert.ok(!text.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc'));
  assert.ok(!text.includes('AKIAIOSFODNN7EXAMPLE'));
  assert.ok(!text.includes('user:pass@'));
  assert.ok(text.includes('https://'));
  assert.ok(text.includes('example.com'));
  assert.ok(!text.includes('abcdefghijklmnopqrstuvwxyz1234567890'));
  
  assert.ok(removed > 0);
});

test('redact: lascia invariato il testo normale italiano', () => {
  const input = 'Oggi ho comprato il pane e il latte al mercato.';
  const { text, removed } = memory.redact(input);
  assert.equal(text, input);
  assert.equal(removed, 0);
});

test('add: salva la nota con valori predefiniti e rimuove i segreti', () => {
  const owner = 'user-add-1';
  const note = memory.add(owner, {
    text: 'La mia password è TopSecret123 e il token è abcdef123456',
    type: 'fatto'
  });
  
  assert.equal(note.type, 'fatto');
  assert.equal(note.source, 'manuale');
  assert.equal(note.status, 'attiva');
  assert.ok(note.removed > 0);
  assert.ok(!note.text.includes('TopSecret123'));
  assert.ok(!note.text.includes('abcdef123456'));
});

test('add: genera errori per input invalidi', () => {
  const owner = 'user-add-2';
  
  assert.throws(() => memory.add(owner, { text: '', type: 'fatto' }), memory.MemoryError);
  
  assert.throws(() => memory.add(owner, { text: 'x'.repeat(1001), type: 'fatto' }), memory.MemoryError);
  
  assert.throws(() => memory.add(owner, { text: 'Testo valido', type: 'tipo-invalido' }), memory.MemoryError);
  
  assert.throws(() => memory.add(owner, { text: 'Testo valido', type: 'fatto', scope: 'progetto/invalido' }), memory.MemoryError);
  
  assert.throws(() => memory.add(owner, { text: 'ghp_1234567890123456789012345678901234567890', type: 'fatto' }), memory.MemoryError);
});

test('le note sono separate per utente', () => {
  const owner1 = 'user-sep-1';
  const owner2 = 'user-sep-2';
  
  const note1 = memory.add(owner1, { text: 'Nota di User1', type: 'fatto' });
  
  assert.equal(memory.get(owner2, note1.id), null);
  assert.equal(memory.update(owner2, note1.id, { text: 'Cambiata' }), null);
  assert.equal(memory.remove(owner2, note1.id), false);
  
  const list2 = memory.list(owner2);
  assert.equal(list2.length, 0);
  
  const list1 = memory.list(owner1);
  assert.equal(list1.length, 1);
  assert.equal(list1[0].id, note1.id);
});

test('update modifica testo, tipo e stato; la ricerca FTS riflette i cambiamenti', () => {
  const owner = 'user-update-1';
  const note = memory.add(owner, { text: 'Testo originale', type: 'fatto' });
  
  const updated = memory.update(owner, note.id, {
    text: 'Testo modificato con nuova parola',
    type: 'preferenza',
    status: 'archiviata'
  });
  
  assert.equal(updated.text, 'Testo modificato con nuova parola');
  assert.equal(updated.type, 'preferenza');
  assert.equal(updated.status, 'archiviata');
  
  // archiviata: la pagina la trova, il prompt (search) no
  const found = memory.list(owner, { q: 'nuova parola' });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, note.id);
  assert.equal(memory.search(owner, 'nuova parola').length, 0);
  assert.equal(memory.list(owner, { q: 'originale' }).length, 0);
  memory.update(owner, note.id, { status: 'attiva' });
  assert.equal(memory.search(owner, 'nuova parola').length, 1);
  
  const removed = memory.remove(owner, note.id);
  assert.equal(removed, true);
  
  const afterRemove = memory.list(owner, { q: 'nuova parola' });
  assert.equal(afterRemove.length, 0);
});

test('list: filtra per ambito, stato e parola chiave (insensibile agli accenti)', () => {
  const owner = 'user-list-1';
  
  memory.add(owner, { text: 'Caffè amaro', type: 'fatto', scope: '' });
  memory.add(owner, { text: 'Tè dolce', type: 'fatto', scope: 'progetto-1' });
  memory.add(owner, { text: 'Acqua fresca', type: 'fatto', scope: '', status: 'archiviata' });
  
  const all = memory.list(owner);
  assert.equal(all.length, 3);
  
  const general = memory.list(owner, { scope: '' });
  assert.equal(general.length, 2);
  
  const project = memory.list(owner, { scope: 'progetto-1' });
  assert.equal(project.length, 1);
  
  const active = memory.list(owner, { status: 'attiva' });
  assert.equal(active.length, 2);
  
  const caffe = memory.list(owner, { q: 'caffe' });
  assert.equal(caffe.length, 1);
  assert.equal(caffe[0].text, 'Caffè amaro');
});

test('search: trova solo note attive, generali o del progetto specificato, con varianti di parola', () => {
  const owner = 'user-search-1';
  
  memory.add(owner, { text: 'Risposte brevi e concise', type: 'fatto', scope: '' });
  memory.add(owner, { text: 'Risposte lunghe e dettagliate', type: 'fatto', scope: 'progetto-1' });
  memory.add(owner, { text: 'Risposte medie', type: 'fatto', scope: 'progetto-2' });
  memory.add(owner, { text: 'Risposte archiviate', type: 'fatto', scope: '', status: 'archiviata' });
  
  const results = memory.search(owner, 'risposta breve', { project: 'progetto-1' });
  
  assert.equal(results.length, 2);
  const ids = results.map(r => r.id);
  const texts = results.map(r => r.text);
  
  assert.ok(texts.includes('Risposte brevi e concise'));
  assert.ok(texts.includes('Risposte lunghe e dettagliate'));
  assert.ok(!texts.includes('Risposte medie'));
  assert.ok(!texts.includes('Risposte archiviate'));
});

test('pack: restituisce testo vuoto in vari casi e rispetta i limiti di lunghezza', () => {
  const owner = 'user-pack-1';
  
  const empty1 = memory.pack(owner, 'domanda senza risultati');
  assert.equal(empty1.text, '');
  assert.equal(empty1.notes.length, 0);
  
  memory.setEnabled(owner, false);
  const empty2 = memory.pack(owner, 'domanda');
  assert.equal(empty2.text, '');
  memory.setEnabled(owner, true);
  
  const empty3 = memory.pack(owner, 'domanda', { projectOn: false });
  assert.equal(empty3.text, '');
  
  for (let i = 0; i < 10; i++) {
    memory.add(owner, { text: `Nota lunga numero ${i} con molto testo per superare i limiti di caratteri nel pacchetto finale`, type: 'fatto', scope: '' });
  }
  
  const packed = memory.pack(owner, 'nota lunga', { maxChars: 600 });
  assert.ok(packed.text.startsWith('<memoria>'));
  assert.ok(packed.text.includes('nota #'));
  assert.ok(packed.text.includes('manuale'));
  assert.ok(packed.text.length <= 650);
  assert.ok(packed.notes.length < 10);
  
  const firstNote = memory.get(owner, packed.notes[0].id);
  assert.ok(firstNote.uses >= 1);
});
test('pack: interruttori generale e del progetto anche con note pertinenti; note del progetto nel piano', async () => {
  const owner = 'user-pack-2';
  memory.add(owner, { text: 'Il gioco usa sempre la tastiera italiana', type: 'preferenza', scope: 'tetris' });
  assert.equal(memory.pack(owner, 'tastiera del gioco').text, '', 'nota di un progetto fuori dal progetto');
  const on = memory.pack(owner, 'tastiera del gioco', { project: 'tetris' });
  assert.match(on.text, /preferenza · progetto/);
  assert.equal(memory.pack(owner, 'tastiera del gioco', { project: 'tetris', projectOn: false }).text, '');
  memory.setEnabled(owner, false);
  assert.equal(memory.isEnabled(owner), false);
  assert.equal(memory.pack(owner, 'tastiera del gioco', { project: 'tetris' }).text, '');
  memory.setEnabled(owner, true);
  const { planPrompt } = await import('../src/projects.js');
  const msgs = planPrompt('un gioco con la tastiera', '', on.text);
  assert.ok(msgs[1].content.startsWith('<memoria>'));
  assert.ok(!planPrompt('un gioco', '')[1].content.includes('<memoria>'));
});

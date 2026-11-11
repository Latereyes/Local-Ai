import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ocrmypdf finto: copia l'ingresso nell'uscita (gli ultimi due argomenti) e registra le opzioni ricevute
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-test-'));
const log = path.join(tmp, 'args.log');
// su Windows lo script .js stesso (Node non lancia .cmd senza shell), altrove un wrapper sh
const fake = path.join(tmp, process.platform === 'win32' ? 'fake.js' : 'ocrmypdf');
fs.writeFileSync(path.join(tmp, 'fake.js'), `const fs = require('fs'); const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + '\\n');
const [i, o] = a.slice(-2); if (i.includes('rotto')) { console.error('PriorOcrFoundError'); process.exit(7); }
fs.copyFileSync(i, o);`);
if (process.platform !== 'win32') fs.writeFileSync(fake, `#!/bin/sh\nexec node "${path.join(tmp, 'fake.js')}" "$@"\n`, { mode: 0o755 });
process.env.OCRMYPDF = fake;
const { ocrArgs, ocrFile, ocrFolder, findOcrmypdf } = await import('../src/ocr.js');

test('opzioni: niente ritocchi all\'immagine (loghi e firme restano come sono)', () => {
  const pdf = ocrArgs('a.pdf', 'b.pdf');
  for (const bad of ['--deskew', '--clean', '--clean-final', '--remove-background', '--force-ocr', '--redo-ocr']) assert.ok(!pdf.includes(bad), bad);
  assert.deepEqual(pdf.slice(pdf.indexOf('--optimize'), pdf.indexOf('--optimize') + 2), ['--optimize', '0']);
  assert.ok(pdf.includes('--skip-text'));
  assert.ok(pdf.includes('ita+eng'));
  assert.deepEqual(pdf.slice(-2), ['a.pdf', 'b.pdf']);
  const img = ocrArgs('a.jpg', 'b.pdf', { image: true, dpi: 300 });
  assert.ok(!img.includes('--skip-text'));
  assert.deepEqual(img.slice(img.indexOf('--image-dpi'), img.indexOf('--image-dpi') + 2), ['--image-dpi', '300']);
});

test('un file: l\'originale non si sovrascrive mai', async () => {
  assert.equal(findOcrmypdf(), fake);
  const f = path.join(tmp, 'doc.pdf');
  fs.writeFileSync(f, '%PDF-1.4 finto');
  const same = await ocrFile(f, f);
  assert.equal(same.ok, false);
  const r = await ocrFile(f, path.join(tmp, 'OCR', 'doc.pdf'));
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(f, 'utf8'), '%PDF-1.4 finto');
  const no = await ocrFile(path.join(tmp, 'nota.docx'), path.join(tmp, 'OCR', 'nota.pdf'));
  assert.match(no.reason, /non supportato/);
});

test('una cartella: struttura mantenuta, cartella OCR saltata, errori riportati', async () => {
  const src = path.join(tmp, 'carla');
  fs.mkdirSync(path.join(src, 'banca'), { recursive: true });
  fs.mkdirSync(path.join(src, 'OCR'), { recursive: true });
  fs.writeFileSync(path.join(src, 'lettera.pdf'), '%PDF');
  fs.writeFileSync(path.join(src, 'lettera.jpg'), 'jpg');
  fs.writeFileSync(path.join(src, 'banca', 'estratto.PDF'), '%PDF');
  fs.writeFileSync(path.join(src, 'banca', 'rotto.pdf'), '%PDF');
  fs.writeFileSync(path.join(src, 'note.docx'), 'x');
  fs.writeFileSync(path.join(src, 'OCR', 'vecchio.pdf'), '%PDF');
  const res = await ocrFolder(src, path.join(src, 'OCR'));
  const by = Object.fromEntries(res.map((r) => [r.file.split(path.sep).join('/'), r]));
  assert.equal(by['lettera.pdf'].output.split(path.sep).join('/'), 'OCR/lettera.pdf');
  assert.equal(by['lettera.jpg'].output.split(path.sep).join('/'), 'OCR/lettera-jpg.pdf');
  assert.equal(by['banca/estratto.PDF'].output.split(path.sep).join('/'), 'OCR/banca/estratto.pdf');
  assert.equal(by['banca/rotto.pdf'].ok, false);
  assert.match(by['banca/rotto.pdf'].reason, /Tesseract o Ghostscript/);
  assert.equal(by['note.docx'].ok, false);
  assert.ok(!by['OCR/vecchio.pdf']);
  assert.ok(fs.existsSync(path.join(src, 'OCR', 'banca', 'estratto.pdf')));
  assert.ok(!fs.existsSync(path.join(src, 'OCR', 'banca', 'rotto.pdf')));
});

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

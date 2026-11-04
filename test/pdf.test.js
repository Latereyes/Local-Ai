import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { plan, findPython, processPdfs } from '../src/pdf.js';

test('operazioni sempre in ordine: unione, OCR, riduzione', () => {
  assert.deepEqual(plan(['compress', 'merge', 'ocr', 'merge'], 3), ['merge', 'ocr', 'compress']);
  assert.deepEqual(plan(['compress'], 1), ['compress']);
  assert.throws(() => plan(['merge'], 1), /almeno due/);
  assert.throws(() => plan(['zip'], 2), /Nessuna operazione/);
});

// Prova vera solo dove c'è Python con pikepdf e Pillow (sul PC: il venv dell'OCR)
const py = findPython();
test('unione e riduzione di due scansioni', { skip: !py && 'manca Python con pikepdf' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-'));
  try {
    // due «scansioni» A4 a 300 dpi fatte con Pillow
    const code = `import sys\nfrom PIL import Image, ImageDraw\nfor i, f in enumerate(sys.argv[1:]):\n    im = Image.new('RGB', (2480, 3508), 'white'); d = ImageDraw.Draw(im)\n    d.ellipse((150, 150, 450, 450), fill=(200, 30, 30))\n    for y in range(600, 3000, 40): d.line([(200, y), (2200, y + (i * 7) % 30)], fill=(30, 30, 30), width=3)\n    im.save(f, resolution=300)`;
    const a = path.join(tmp, 'a.pdf');
    const b = path.join(tmp, 'b.pdf');
    assert.equal(spawnSync(py, ['-c', code, a, b]).status, 0);
    const before = fs.statSync(a).size + fs.statSync(b).size;
    const out = await processPdfs([{ path: a, name: 'a.pdf' }, { path: b, name: 'b.pdf' }], ['compress', 'merge'], (n) => path.join(tmp, 'out', `${n}.pdf`), { name: 'uniti' });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'uniti.pdf');
    assert.deepEqual(out[0].from, ['a.pdf', 'b.pdf']);
    assert.ok(out[0].size < before, `${out[0].size} < ${before}`);
    const pages = spawnSync(py, ['-c', 'import pikepdf,sys; print(len(pikepdf.open(sys.argv[1]).pages))', out[0].file]).stdout.toString().trim();
    assert.equal(pages, '2');
    // gli originali restano come erano
    assert.equal(fs.statSync(a).size + fs.statSync(b).size, before);
    // senza unione: un file per PDF, con il nome dell'allegato
    const each = await processPdfs([{ path: a, name: 'lettera.pdf' }], ['compress'], (n) => path.join(tmp, 'out2', `${n}.pdf`));
    assert.equal(each[0].name, 'lettera.pdf');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

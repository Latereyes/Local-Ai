import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pythonImports, jsImports, checkDependencies, installCommand } from '../src/deps.js';

test('import Python: nomi di primo livello, niente import relativi', () => {
  const src = 'import os, sys as s\nimport xml.etree.ElementTree as ET\nfrom meteo_super_pro_xyz import Client\nfrom . import util\nfrom .x import y\n    import requests  # dentro una funzione\n';
  assert.deepEqual(pythonImports(src).sort(), ['meteo_super_pro_xyz', 'os', 'requests', 'sys', 'xml']);
});

test('import JavaScript: pacchetti npm, non moduli di Node né percorsi', () => {
  const src = "import fs from 'node:fs';\nimport path from 'path';\nimport { x } from './x.js';\nimport express from 'express';\nconst a = require('lodash/fp');\nconst b = await import('@scope/pkg/sub');\nimport 'side-effect';\n";
  assert.deepEqual(jsImports(src).sort(), ['@scope/pkg', 'express', 'lodash', 'side-effect']);
});

test('comando di installazione solo per le librerie che esistono', () => {
  assert.equal(installCommand([
    { lang: 'python', name: 'yaml', pkg: 'pyyaml', exists: true },
    { lang: 'python', name: 'fake', pkg: 'fake', exists: false },
    { lang: 'js', name: 'express', pkg: 'express', exists: true },
  ]), 'pip install pyyaml e npm install express');
  assert.equal(installCommand([]), '');
});

test('progetto con libreria standard, moduli propri e pacchetti in node_modules: niente da segnalare', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-deps-'));
  fs.writeFileSync(path.join(dir, 'app.py'), 'import json, os\nfrom util import aiuto\n');
  fs.writeFileSync(path.join(dir, 'util.py'), 'def aiuto():\n    return 1\n');
  fs.mkdirSync(path.join(dir, 'node_modules', 'express'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server.js'), "import express from 'express';\nimport fs from 'node:fs';\n");
  const r = await checkDependencies(dir);
  assert.equal(r.checked, 3);
  assert.deepEqual(r.missing, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

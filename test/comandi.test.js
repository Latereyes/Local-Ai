import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'localai-comandi-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.WORKSPACE_DIR = path.join(tmp, 'ws');
const { killsLocalAI } = await import('../src/workspace.js');
const { computerTools } = await import('../src/prompts.js');

// prova torrent-cli del 2026-10-22: «Stop server» nella chat del progetto e LocalAI si è chiuso di colpo
test('comandi che chiuderebbero LocalAI: rifiutati, gli altri no', () => {
  const me = { pids: [7400, 1464], ports: [3000, 3001] };
  for (const c of [
    'taskkill /F /IM node.exe',
    'taskkill /PID 7400 /F',
    'taskkill /PID 1464 /T /F',
    'for /f "tokens=5" %a in (\'netstat -aon ^| findstr :5000\') do taskkill /F /PID %a',
    'powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 5000 | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"',
    'powershell -NoProfile -Command "Stop-Process -Name node -Force"',
    'npx kill-port 3000',
    // il comando vero del 22/10 alle 20:48 (registro eventi di PowerShell sul PC)
    "powershell -NoProfile -Command Get-Process -Name python, pythonw, py -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*torrent*' } | Stop-Process -Force; Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Write-Host 'Fatto'",
  ]) assert.ok(killsLocalAI(c, me), c);
  for (const c of ['taskkill /PID 5123 /F', 'python -m unittest discover -v -s tests', 'python run.py', 'netstat -ano', 'tasklist'])
    assert.equal(killsLocalAI(c, me), null, c);
});

test('chat del progetto: lo strumento per il server solo per chi può eseguire codice', () => {
  const names = (o) => computerTools(o).map((t) => t.function.name);
  assert.ok(names({ project: true, projectChat: true, canRun: true }).includes('project_server'));
  assert.ok(!names({ project: true, projectChat: true }).includes('project_server'));
  assert.ok(!names({ project: true, canRun: true }).includes('project_server'));
});

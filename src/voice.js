import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import config from './config.js';

/**
 * Conversazione a voce: il browser registra una frase, qui diventa testo (riconoscimento vocale) e la risposta
 * di Gemma torna voce frase per frase (sintesi vocale) mentre arriva. I due modelli stanno nel servizio voce
 * locale (voice/server.py, Python), che gira sul PC accanto a Ollama e ComfyUI. Se è spento il tasto non compare.
 */

const base = () => config.voice.url.replace(/\/$/, '');

async function call(path, { body, type = 'application/json', timeoutMs = 60000, raw = false } = {}) {
  const res = await fetch(base() + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': type },
    body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || `servizio voce ${path} → ${res.status}`), { status: res.status >= 500 ? 502 : res.status });
  }
  return raw ? Buffer.from(await res.arrayBuffer()) : res.json();
}

let cached = null; // { at, info }

/** Stato del servizio voce (modelli e voci), ricontrollato al massimo ogni 30 s. null se è spento. */
export async function status({ fresh = false } = {}) {
  if (!config.voice.url) return null;
  if (!fresh && cached && Date.now() - cached.at < 30000) return cached.info;
  let info = null;
  try { info = await call('/health', { timeoutMs: 3000 }); } catch {}
  cached = { at: Date.now(), info };
  return info;
}

/** WAV (mono, qualsiasi frequenza) → testo. La lingua vuota la riconosce Whisper. */
export async function transcribe(wav, { language = config.voice.language } = {}) {
  const q = language ? `?language=${encodeURIComponent(language)}` : '';
  return call(`/stt${q}`, { body: wav, type: 'audio/wav', timeoutMs: 120000 });
}

/** Testo → WAV con la voce scelta (vuota = quella predefinita del servizio). */
export async function speak(text, { voice = config.voice.voice, speed = config.voice.speed } = {}) {
  const clean = speakable(text);
  if (!clean) return null;
  return call('/tts', { body: { text: clean, voice, speed, language: config.voice.language }, raw: true, timeoutMs: 120000 });
}

/** Libera la VRAM del servizio voce (prima dei lavori pesanti di ComfyUI, come i video). */
export async function unload() {
  if (!config.voice.url) return;
  await call('/unload', { body: {}, timeoutMs: 10000 }).catch(() => {});
}

/**
 * Testo da leggere ad alta voce: via il Markdown, il codice, le formule e i link, che letti suonano male.
 * Un blocco di codice diventa «(codice sullo schermo)», così chi ascolta sa che c'è.
 */
export function speakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?(```|$)/g, ' (codice sullo schermo) ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' (formula sullo schermo) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\|?[-:\s|]+\|[-:\s|]*$/gm, '')
    .replace(/\|/g, ', ')
    // grassetto e corsivo solo a inizio parola: «nome_file_lungo» resta com'è
    .replace(/(^|[\s(«"])(\*\*|__|\*|_|~~)(?=\S)([^\n]*?\S)\2(?=[\s.,;:!?)»"]|$)/g, '$1$3')
    .replace(/[*#>]+/g, ' ')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let child = null;

/**
 * Avvia il servizio voce se è installato (voice/.venv, da tools/installa-voce.ps1) e non risponde già.
 * Si chiude con LocalAI. Con VOICE_URL verso un altro PC non si avvia niente.
 */
export async function start() {
  if (!config.voice.url || child) return;
  const url = new URL(config.voice.url);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return;
  const dir = path.join(config.root, 'voice');
  const py = path.join(dir, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(py) || await status({ fresh: true })) return;
  child = spawn(py, ['server.py', '--port', url.port || '8190'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = (d) => { for (const line of String(d).split(/\r?\n/)) if (line.trim()) console.log(`  ${line}`); };
  child.stdout.on('data', out);
  child.stderr.on('data', out);
  child.on('exit', (code) => { if (code) console.warn(`  [voce] servizio chiuso (codice ${code})`); child = null; cached = null; });
  process.once('exit', () => { try { child?.kill(); } catch {} });
  // risponde appena il server HTTP è su (i modelli si caricano dopo, in sottofondo)
  for (let i = 0; i < 30 && child && !(await status({ fresh: true })); i++) await new Promise((r) => setTimeout(r, 500));
}

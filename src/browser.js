import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { findBrowser, killTree } from './workspace.js';

/**
 * Apre una pagina con Edge/Chrome headless (lo stesso browser dei PDF) attraverso il protocollo DevTools:
 * raccoglie gli errori della console e le eccezioni JavaScript e fa uno screenshot.
 * Serve al controllo automatico delle pagine e dei giochi creati dai task dei progetti.
 */

const IS_WIN = process.platform === 'win32';

/** Legge la porta DevTools che il browser scrive nel profilo appena è pronto. */
async function devtoolsUrl(profile, proc, timeoutMs = 20000) {
  const file = path.join(profile, 'DevToolsActivePort');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`Il browser si è chiuso subito (codice ${proc.exitCode})`);
    const txt = await fsp.readFile(file, 'utf8').catch(() => '');
    const [port, wsPath] = txt.split(/\r?\n/);
    if (port && wsPath) return `ws://127.0.0.1:${port}${wsPath}`;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Il browser non ha aperto DevTools in tempo');
}

/** Connessione DevTools minima: comandi con risposta e ascolto degli eventi. */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let seq = 0;
    const waiting = new Map();
    const listeners = new Set();
    ws.onopen = () => resolve({
      send(method, params = {}, sessionId) {
        const id = ++seq;
        ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
        return new Promise((ok, ko) => waiting.set(id, { ok, ko, method }));
      },
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      close() { try { ws.close(); } catch {} },
    });
    ws.onerror = () => reject(new Error('Connessione DevTools non riuscita'));
    ws.onmessage = (e) => {
      const msg = JSON.parse(typeof e.data === 'string' ? e.data : Buffer.from(e.data).toString('utf8'));
      if (msg.id && waiting.has(msg.id)) {
        const w = waiting.get(msg.id);
        waiting.delete(msg.id);
        if (msg.error) w.ko(new Error(`${w.method}: ${msg.error.message}`));
        else w.ok(msg.result);
      } else if (msg.method) {
        for (const fn of listeners) fn(msg);
      }
    };
    ws.onclose = () => { for (const w of waiting.values()) w.ko(new Error('DevTools chiuso')); waiting.clear(); };
  });
}

const valueText = (a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : a.description || a.type);

/**
 * Apre url e restituisce { screenshot: Buffer PNG, errors: [testo], title, ms }.
 * waitMs: attesa dopo il caricamento (giochi e animazioni che partono dopo l'evento load).
 */
export async function checkPage(url, { width = 1280, height = 800, waitMs = 2500, timeoutMs = 30000 } = {}) {
  const browser = findBrowser();
  if (!browser) throw new Error('Nessun browser trovato per controllare la pagina (serve Edge o Chrome)');
  const started = Date.now();
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'localai-check-'));
  const args = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', `--window-size=${width},${height}`, 'about:blank'];
  if (!IS_WIN && process.getuid?.() === 0) args.unshift('--no-sandbox');
  const proc = spawn(browser, args, { windowsHide: true, stdio: 'ignore', detached: !IS_WIN });
  proc.on('error', () => {});
  let cdp;
  const timer = setTimeout(() => killTree(proc), timeoutMs + 10000);
  try {
    cdp = await connect(await devtoolsUrl(profile, proc));
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const s = (method, params) => cdp.send(method, params, sessionId);

    const errors = [];
    const add = (t) => { if (errors.length < 30 && !errors.includes(t)) errors.push(t.slice(0, 600)); };
    let loaded;
    const onLoad = new Promise((r) => { loaded = r; });
    cdp.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Page.loadEventFired') loaded();
      else if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        const where = d.url ? ` (${d.url.split('/').pop()}:${(d.lineNumber ?? 0) + 1})` : '';
        add(`${d.exception?.description?.split('\n')[0] || d.text || 'Eccezione'}${where}`);
      } else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'assert')) {
        add(`console.error: ${(m.params.args || []).map(valueText).join(' ')}`);
      } else if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') {
        const e = m.params.entry;
        if (/\/favicon\.ico(\?|$)/.test(e.url || '')) return; // la favicon mancante non è un errore della pagina
        add(`${e.text}${e.url ? ` (${e.url.split('/').pop()})` : ''}`);
      }
    });
    await Promise.all([s('Page.enable'), s('Runtime.enable'), s('Log.enable')]);
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const nav = await s('Page.navigate', { url });
    if (nav.errorText) throw new Error(`La pagina non si apre: ${nav.errorText}`);
    const loadTimeout = await Promise.race([onLoad.then(() => false), new Promise((r) => setTimeout(() => r(true), timeoutMs))]);
    if (loadTimeout) add(`La pagina non ha finito di caricarsi entro ${Math.round(timeoutMs / 1000)} secondi`);
    await new Promise((r) => setTimeout(r, waitMs));
    const { result } = await s('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
    const shot = await s('Page.captureScreenshot', { format: 'png' });
    await cdp.send('Browser.close').catch(() => {});
    return { screenshot: Buffer.from(shot.data, 'base64'), errors, title: result?.value || '', ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
    cdp?.close();
    killTree(proc);
    // Su Windows il profilo resta bloccato per un attimo dopo la chiusura del browser
    setTimeout(() => fsp.rm(profile, { recursive: true, force: true }).catch(() => {}), 2000);
  }
}

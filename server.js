import express from 'express';
import os from 'node:os';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import config from './src/config.js';
import * as auth from './src/auth.js';
import * as store from './src/store.js';
import * as ollama from './src/ollama.js';
import * as comfy from './src/comfy.js';
import * as chat from './src/chat.js';
import { gpu } from './src/gpu.js';
import { bus, cancel, mediaUrl, recoverInterrupted } from './src/jobs.js';
import { workflows, loadWorkflows, publicInfo, checkAvailability } from './src/workflows.js';
import { extractText } from './src/documents.js';

const app = express();
app.set('trust proxy', false);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(config.paths.public, { index: 'index.html' }));
app.use('/vendor', express.static(path.join(config.root, 'node_modules', 'marked', 'lib')));
app.use('/vendor', express.static(path.join(config.root, 'node_modules', 'dompurify', 'dist')));
app.use('/vendor/katex', express.static(path.join(config.root, 'node_modules', 'katex', 'dist'), { maxAge: '30d' }));
app.use(auth.session);

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  res.status(e.status || 500).json({ error: e.message });
});
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Conversazione dell'utente corrente (404 se non esiste o è di un altro utente). */
function ownConv(req) {
  const c = store.get(req.params.id);
  if (!c || c.ownerId !== req.user.id) throw httpError(404, 'Conversazione non trovata');
  return c;
}

const withUrls = (c) => ({
  ...c,
  running: chat.isRunning(c.id),
  messages: c.messages.map((m) => ({
    ...m,
    ...(m.media ? { media: m.media.map((md) => ({ ...md, url: mediaUrl(md.file), sourceUrl: mediaUrl(md.sourceFile) })) } : {}),
    ...(m.attachments ? { attachments: m.attachments.map((a) => ({ ...a, url: mediaUrl(a.file) })) } : {}),
  })),
});

// ---- Autenticazione ----
app.post('/api/auth/login', wrap(async (req, res) => {
  const { username, password } = req.body || {};
  const { token, user } = auth.login(username, password, req.socket.remoteAddress);
  auth.setSessionCookie(res, token);
  res.json({ user: auth.publicUser(user) });
}));

app.post('/api/auth/logout', (req, res) => {
  auth.logout(req.token);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Accesso richiesto', code: 'auth_required' });
  res.json({ user: auth.publicUser(req.user) });
});

app.post('/api/auth/password', wrap(async (req, res) => {
  if (!req.user) throw httpError(401, 'Accesso richiesto');
  const { current, next } = req.body || {};
  auth.changePassword(req.user, current, next, req.token);
  res.json({ user: auth.publicUser(req.user) });
}));

// Tutto ciò che segue richiede un utente autenticato con password definitiva
app.use('/api', auth.requireUser);

// ---- Amministrazione utenti ----
app.get('/api/users', auth.requireAdmin, (req, res) => res.json(auth.listUsers()));
app.post('/api/users', auth.requireAdmin, wrap(async (req, res) => res.json(auth.createUser(req.body || {}))));
app.post('/api/users/:id/reset-password', auth.requireAdmin, wrap(async (req, res) => {
  res.json(auth.resetPassword(req.params.id, req.body?.password));
}));

// ---- Stato e configurazione ----
app.get('/api/status', wrap(async (req, res) => {
  const [o, c] = await Promise.all([ollama.isUp(), comfy.isUp()]);
  res.json({ ollama: o, comfy: c, gpu: gpu.state() });
}));

app.get('/api/config', wrap(async (req, res) => {
  let models = [];
  try { models = (await ollama.listModels()).filter((m) => m.tools); } catch {}
  res.json({
    assistantName: config.assistantName,
    defaultModel: config.ollama.model,
    models,
    workflows: workflows().map(publicInfo),
  });
}));

app.post('/api/workflows/reload', auth.requireAdmin, wrap(async (req, res) => {
  loadWorkflows();
  res.json((await checkAvailability(comfy.listModels)).map(publicInfo));
}));

app.post('/api/gpu/release', wrap(async (req, res) => { await gpu.release(); res.json(gpu.state()); }));

// ---- Eventi in tempo reale (SSE), solo quelli delle proprie conversazioni ----
app.get('/api/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  const userId = req.user.id;
  const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
  const onEvent = (evt) => { if (store.get(evt.conversationId)?.ownerId === userId) send(evt); };
  const onGpu = (state) => send({ type: 'gpu', state });
  send({ type: 'gpu', state: gpu.state() });
  bus.on('event', onEvent);
  gpu.on('state', onGpu);
  const ping = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(ping); bus.off('event', onEvent); gpu.off('state', onGpu); });
});

// ---- Conversazioni ----
app.get('/api/conversations', (req, res) => res.json(store.list(req.user.id)));

app.post('/api/conversations', wrap(async (req, res) => {
  const c = store.create(req.user.id);
  await store.save(c);
  res.json(withUrls(c));
}));

app.get('/api/conversations/:id', wrap(async (req, res) => res.json(withUrls(ownConv(req)))));

app.patch('/api/conversations/:id', wrap(async (req, res) => {
  const c = ownConv(req);
  if (typeof req.body.title === 'string') c.title = req.body.title.trim().slice(0, 80) || c.title;
  if (typeof req.body.pinned === 'boolean') c.pinned = req.body.pinned;
  await store.save(c, { touch: false });
  res.json({ ok: true });
}));

app.delete('/api/conversations/:id', wrap(async (req, res) => {
  const c = ownConv(req);
  chat.stop(c.id);
  for (const m of c.messages) for (const md of m.media || []) cancel(md.id);
  await store.remove(c.id);
  res.json({ ok: true });
}));

app.post('/api/conversations/:id/messages', wrap(async (req, res) => {
  const c = ownConv(req);
  const { text, tool, imageModel, aspect, duration, think, model, attachments } = req.body || {};
  res.json(await chat.send(c, { text, tool, imageModel, aspect, duration, think, model, attachments }));
}));

app.post('/api/conversations/:id/stop', wrap(async (req, res) => { chat.stop(ownConv(req).id); res.json({ ok: true }); }));

// ---- Immagini allegate (già ridimensionate dal browser) ----
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const looksLikeImage = (b) => (b[0] === 0xff && b[1] === 0xd8) // JPEG
  || (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) // PNG
  || (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP');

const DOC_TYPES = { 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/markdown': 'md' };

app.post('/api/uploads', express.raw({ type: [...Object.keys(IMAGE_TYPES), ...Object.keys(DOC_TYPES)], limit: '60mb' }), wrap(async (req, res) => {
  const ctype = (req.headers['content-type'] || '').split(';')[0];
  if (DOC_TYPES[ctype]) return res.json(await saveDocument(req, DOC_TYPES[ctype]));
  if (req.body?.length > 15 * 1024 * 1024) throw httpError(413, 'Immagine troppo grande (max 15 MB)');
  const ext = IMAGE_TYPES[ctype];
  if (!ext || !Buffer.isBuffer(req.body) || req.body.length < 16 || !looksLikeImage(req.body)) {
    throw httpError(400, 'Formato non supportato: servono immagini JPEG, PNG o WebP');
  }
  const file = `${req.user.id}/up-${randomUUID()}.${ext}`;
  await fs.mkdir(path.join(config.paths.media, req.user.id), { recursive: true });
  await fs.writeFile(path.join(config.paths.media, file), req.body);
  res.json({ file, url: mediaUrl(file), width: Number(req.query.w) || 0, height: Number(req.query.h) || 0 });
}));

/** Salva un documento e ne estrae subito il testo (pagina per pagina). */
async function saveDocument(req, ext) {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) throw httpError(400, 'File vuoto');
  if (ext === 'pdf' && buf.toString('ascii', 0, 5) !== '%PDF-') throw httpError(400, 'Il file non è un PDF valido');
  let name = 'documento';
  try { name = decodeURIComponent(req.headers['x-filename'] || name); } catch {}
  name = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 120);
  let extracted;
  try { extracted = await extractText(buf, `x.${ext}`); }
  catch (e) { throw httpError(400, `Impossibile leggere il documento (${e.message.includes('password') ? 'protetto da password' : 'file danneggiato o non supportato'})`); }
  const id = randomUUID();
  const base = `${req.user.id}/doc-${id}`;
  await fs.mkdir(path.join(config.paths.media, req.user.id), { recursive: true });
  await fs.writeFile(path.join(config.paths.media, `${base}.${ext}`), buf);
  await fs.writeFile(path.join(config.paths.media, `${base}.json`), JSON.stringify({ name, pages: extracted.pages }));
  const chars = extracted.pages.reduce((n, p) => n + p.length, 0);
  return { kind: 'document', file: `${base}.${ext}`, textFile: `${base}.json`, url: mediaUrl(`${base}.${ext}`), name, pages: extracted.pages.length, chars, scanned: extracted.scanned };
}

// ---- Media ----
app.post('/api/conversations/:id/media/:mediaId/cancel', wrap(async (req, res) => {
  ownConv(req);
  res.json({ ok: cancel(req.params.mediaId) });
}));

app.post('/api/conversations/:id/messages/:messageId/media/:mediaId/regenerate', wrap(async (req, res) => {
  res.json(chat.regenerate(ownConv(req), req.params.messageId, req.params.mediaId, { prompt: req.body?.prompt }));
}));

app.get('/api/media', (req, res) => res.json(store.allMedia(req.user.id).map((m) => ({ ...m, url: mediaUrl(m.file) }))));

// I file generati sono visibili solo al proprietario
app.get('/media/:owner/:file', (req, res) => {
  if (!req.user || req.user.mustChangePassword || req.user.id !== req.params.owner) return res.sendStatus(404);
  if (!/^[\w-]+\.\w+$/.test(req.params.file)) return res.sendStatus(404);
  res.sendFile(path.join(config.paths.media, req.params.owner, req.params.file), { maxAge: '7d', immutable: true }, (err) => {
    if (err && !res.headersSent) res.sendStatus(404);
  });
});

app.get('/{*path}', (req, res) => res.sendFile(path.join(config.paths.public, 'index.html')));

const adopted = store.adoptOwnerless(auth.adminUser().id);
if (adopted) console.log(`  ${adopted} conversazioni esistenti assegnate all'utente ${auth.adminUser().displayName}`);
recoverInterrupted();
const server = app.listen(config.port, config.host, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i?.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  LocalAI pronto`);
  console.log(`  → su questo PC:     http://localhost:${config.port}`);
  for (const ip of ips) console.log(`  → telefono/tablet: http://${ip}:${config.port}   (stessa rete Wi-Fi)`);
  console.log(`\n  Ollama:  ${config.ollama.url}  (${config.ollama.model})`);
  console.log(`  ComfyUI: ${config.comfy.url}`);
  console.log(`  Workflow: ${workflows().map((w) => `${w.name} [${w.type}]`).join(', ')}\n`);
  comfy.connect().catch(() => console.warn('  ⚠ ComfyUI non raggiungibile per ora'));
  // Workflow utilizzabili = quelli con tutti i modelli presenti su ComfyUI (ricontrollo ogni 5 minuti)
  const refresh = () => checkAvailability(comfy.listModels).then((list) => {
    const off = list.filter((w) => w.available === false);
    if (off.length) console.log(`  Workflow non disponibili (modelli mancanti): ${off.map((w) => `${w.name} → ${w.missing.join(', ')}`).join(' | ')}`);
  });
  refresh();
  setInterval(refresh, 5 * 60 * 1000);
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  ⚠ La porta ${config.port} è già in uso: LocalAI è probabilmente già avviato in un'altra finestra.\n    Chiudi quella finestra oppure usa un'altra porta (set PORT=3001 prima di avviare).\n`);
  else console.error(e);
  process.exit(1);
});

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import config from './config.js';

/**
 * Conversazioni salvate come file JSON in data/conversations.
 * Gli oggetti restano in memoria (unica fonte di verità) e vengono scritti su disco a ogni modifica.
 */
const dir = config.paths.conversations;
fs.mkdirSync(dir, { recursive: true });
fs.mkdirSync(config.paths.media, { recursive: true });

const cache = new Map();
const writing = new Map();

const file = (id) => path.join(dir, `${id}.json`);
const validId = (id) => /^[a-zA-Z0-9-]{8,64}$/.test(id || '');

export function newId() { return randomUUID(); }

/** Conversazioni di un utente (tutte se ownerId non è indicato). */
export function list(ownerId) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5);
    const c = cache.get(id) || safeRead(id);
    if (c && (!ownerId || c.ownerId === ownerId)) out.push({ id: c.id, title: c.title, updatedAt: c.updatedAt, pinned: !!c.pinned });
  }
  return out.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
}

function safeRead(id) {
  try { return JSON.parse(fs.readFileSync(file(id), 'utf8')); } catch { return null; }
}

export function get(id) {
  if (!validId(id)) return null;
  if (cache.has(id)) return cache.get(id);
  const c = safeRead(id);
  if (c) cache.set(id, c);
  return c;
}

export function create(ownerId) {
  const now = Date.now();
  const c = { id: newId(), ownerId, title: 'Nuova chat', createdAt: now, updatedAt: now, messages: [] };
  cache.set(c.id, c);
  return c;
}

/** Scrittura atomica e serializzata per conversazione. */
export function save(c, { touch = true } = {}) {
  if (touch) c.updatedAt = Date.now();
  cache.set(c.id, c);
  const prev = writing.get(c.id) || Promise.resolve();
  const next = prev.then(async () => {
    const tmp = file(c.id) + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(c));
    await fsp.rename(tmp, file(c.id));
  }).catch((e) => console.error('[store] save', e.message));
  writing.set(c.id, next);
  return next;
}

export async function remove(id) {
  const c = get(id);
  if (!c) return;
  cache.delete(id);
  await fsp.rm(file(id), { force: true });
  for (const m of c.messages) {
    for (const md of m.media || []) if (md.file) await fsp.rm(path.join(config.paths.media, md.file), { force: true });
    for (const a of m.attachments || []) for (const f of [a.file, a.textFile]) if (f) await fsp.rm(path.join(config.paths.media, f), { force: true });
  }
}

/** Tutti i media generati da un utente, dal più recente. */
export function allMedia(ownerId) {
  const out = [];
  for (const { id } of list(ownerId)) {
    const c = get(id);
    for (const m of c?.messages || []) for (const md of m.media || []) {
      if (md.status === 'done' && md.file) out.push({ ...md, conversationId: c.id, conversationTitle: c.title });
    }
  }
  return out.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
}

/** Le conversazioni create prima dei profili vengono assegnate a un utente (l'amministratore). */
export function adoptOwnerless(ownerId) {
  let moved = 0;
  for (const { id } of list()) {
    const c = get(id);
    if (c.ownerId) continue;
    c.ownerId = ownerId;
    for (const m of c.messages) for (const md of m.media || []) {
      if (!md.file || md.file.includes('/')) continue;
      const from = path.join(config.paths.media, md.file);
      const rel = `${ownerId}/${md.file}`;
      fs.mkdirSync(path.join(config.paths.media, ownerId), { recursive: true });
      if (fs.existsSync(from)) fs.renameSync(from, path.join(config.paths.media, rel));
      md.file = rel;
    }
    save(c, { touch: false });
    moved++;
  }
  return moved;
}

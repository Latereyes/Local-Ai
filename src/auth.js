import fs from 'node:fs';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import config from './config.js';

/**
 * Utenti e sessioni.
 * - Utenti in data/users.json, password con scrypt + salt.
 * - Sessioni in data/sessions.json (si salva solo l'hash del token), cookie HttpOnly.
 * - Una password impostata da un amministratore è temporanea: al primo accesso va cambiata.
 */

const COOKIE = 'localai_sid';
const SESSION_DAYS = 30;
const DEFAULT_PASSWORD = '1234';
const MIN_PASSWORD = 6;

fs.mkdirSync(config.paths.data, { recursive: true });

let users = load(config.paths.users, null);
let sessions = load(config.paths.sessions, {}); // tokenHash -> { userId, expires }

function load(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function persist(file, data) {
  fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(file + '.tmp', file);
}
const saveUsers = () => persist(config.paths.users, users);
const saveSessions = () => persist(config.paths.sessions, sessions);

function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt:${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [, salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const a = scryptSync(String(pw), Buffer.from(salt, 'hex'), 64);
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
const tokenHash = (t) => createHash('sha256').update(t).digest('hex');
const normalize = (u) => String(u || '').trim().toLowerCase();

function makeUser({ username, displayName, role = 'user', password = DEFAULT_PASSWORD }) {
  return {
    id: randomUUID(),
    username: normalize(username),
    displayName: displayName?.trim() || username.trim(),
    role,
    passwordHash: hashPassword(password),
    mustChangePassword: true,
    createdAt: Date.now(),
  };
}

// Primo avvio: utenti iniziali con password temporanea da cambiare al primo accesso
if (!users) {
  users = [
    makeUser({ username: 'andrea', displayName: 'Andrea', role: 'admin' }),
    makeUser({ username: 'claudia', displayName: 'Claudia', role: 'user' }),
  ];
  saveUsers();
  console.log('  Creati gli utenti iniziali: andrea (admin), claudia — password temporanea da cambiare al primo accesso');
}

export const publicUser = (u) => u && ({
  id: u.id, username: u.username, displayName: u.displayName, role: u.role,
  mustChangePassword: !!u.mustChangePassword, createdAt: u.createdAt,
});

export const listUsers = () => users.map(publicUser);
export const getUser = (id) => users.find((u) => u.id === id);
export const adminUser = () => users.find((u) => u.role === 'admin');

// ---- Protezione da tentativi ripetuti ----
const failures = new Map(); // ip -> { count, until }
function tooManyAttempts(ip) {
  const f = failures.get(ip);
  return f && f.until > Date.now();
}
function registerFailure(ip) {
  const f = failures.get(ip) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count >= 5) { f.until = Date.now() + 60_000; f.count = 0; }
  failures.set(ip, f);
}

const httpError = (status, message) => Object.assign(new Error(message), { status });

export function login(username, password, ip) {
  if (tooManyAttempts(ip)) throw httpError(429, 'Troppi tentativi, riprova tra un minuto');
  const u = users.find((x) => x.username === normalize(username));
  if (!u || !checkPassword(password, u.passwordHash)) {
    registerFailure(ip);
    throw httpError(401, 'Nome utente o password non corretti');
  }
  failures.delete(ip);
  const token = randomBytes(32).toString('base64url');
  sessions[tokenHash(token)] = { userId: u.id, expires: Date.now() + SESSION_DAYS * 86400_000 };
  saveSessions();
  return { token, user: u };
}

export function logout(token) {
  if (!token) return;
  delete sessions[tokenHash(token)];
  saveSessions();
}

function dropSessionsOf(userId, keepToken) {
  const keep = keepToken && tokenHash(keepToken);
  for (const [h, s] of Object.entries(sessions)) if (s.userId === userId && h !== keep) delete sessions[h];
  saveSessions();
}

function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) throw httpError(400, `La password deve avere almeno ${MIN_PASSWORD} caratteri`);
  if (pw === DEFAULT_PASSWORD) throw httpError(400, 'Scegli una password diversa da quella iniziale');
}

/** L'utente cambia la propria password (le altre sessioni vengono chiuse). */
export function changePassword(user, current, next, token) {
  if (!checkPassword(current, user.passwordHash)) throw httpError(400, 'La password attuale non è corretta');
  validatePassword(next);
  if (current === next) throw httpError(400, 'La nuova password deve essere diversa da quella attuale');
  user.passwordHash = hashPassword(next);
  user.mustChangePassword = false;
  saveUsers();
  dropSessionsOf(user.id, token);
}

/** Admin: crea un utente con password temporanea. */
export function createUser({ username, displayName, role, password }) {
  const name = normalize(username);
  if (!/^[a-z0-9._-]{2,32}$/.test(name)) throw httpError(400, 'Nome utente non valido (2-32 caratteri: lettere, numeri, . _ -)');
  if (users.some((u) => u.username === name)) throw httpError(409, 'Esiste già un utente con questo nome');
  if (!['admin', 'user'].includes(role || 'user')) throw httpError(400, 'Ruolo non valido');
  const temp = password || DEFAULT_PASSWORD;
  if (temp.length < 4) throw httpError(400, 'La password temporanea deve avere almeno 4 caratteri');
  const u = makeUser({ username: name, displayName: displayName || username, role: role || 'user', password: temp });
  users.push(u);
  saveUsers();
  return publicUser(u);
}

/** Admin: reimposta la password di un utente a una temporanea e lo disconnette. */
export function resetPassword(userId, password) {
  const u = getUser(userId);
  if (!u) throw httpError(404, 'Utente non trovato');
  const temp = password || DEFAULT_PASSWORD;
  if (temp.length < 4) throw httpError(400, 'La password temporanea deve avere almeno 4 caratteri');
  u.passwordHash = hashPassword(temp);
  u.mustChangePassword = true;
  saveUsers();
  dropSessionsOf(u.id);
  return publicUser(u);
}

// ---- Middleware Express ----
function readCookie(req) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** Popola req.user / req.token se la sessione è valida. */
export function session(req, res, next) {
  const token = readCookie(req);
  const s = token && sessions[tokenHash(token)];
  if (s && s.expires > Date.now()) {
    const u = getUser(s.userId);
    if (u) { req.user = u; req.token = token; }
  } else if (s) {
    delete sessions[tokenHash(token)];
    saveSessions();
  }
  next();
}

/** Richiede un utente autenticato che abbia già scelto la propria password. */
export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Accesso richiesto', code: 'auth_required' });
  if (req.user.mustChangePassword) return res.status(403).json({ error: 'Devi prima cambiare la password', code: 'password_change_required' });
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Solo per amministratori' });
  next();
}

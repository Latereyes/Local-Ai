import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import config from '../config.js';

// Ensure data directory exists
const dbDir = path.dirname(config.db.path);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new DatabaseSync(config.db.path);

// Enable WAL mode for better concurrent performance
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS generated_images (
    id TEXT PRIMARY KEY,
    conversation_id TEXT,
    message_id TEXT,
    prompt TEXT,
    enhanced_prompt TEXT,
    filename TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_images_conversation ON generated_images(conversation_id);
`);

// Prepared statements
const stmts = {
  createConversation: db.prepare(
    "INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))"
  ),
  getConversations: db.prepare(
    'SELECT * FROM conversations ORDER BY updated_at DESC'
  ),
  getConversation: db.prepare('SELECT * FROM conversations WHERE id = ?'),
  updateConversationTitle: db.prepare(
    "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?"
  ),
  updateConversationTimestamp: db.prepare(
    "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?"
  ),
  deleteConversation: db.prepare('DELETE FROM conversations WHERE id = ?'),
  addMessage: db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))"
  ),
  getMessages: db.prepare(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ),
  addGeneratedImage: db.prepare(
    "INSERT INTO generated_images (id, conversation_id, message_id, prompt, enhanced_prompt, filename, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
  ),
  getGeneratedImages: db.prepare(
    'SELECT * FROM generated_images WHERE conversation_id = ? ORDER BY created_at DESC'
  ),
  getAllGeneratedImages: db.prepare(
    'SELECT * FROM generated_images ORDER BY created_at DESC'
  ),
};

export function createConversation(title = 'Nuova conversazione') {
  const id = uuidv4();
  stmts.createConversation.run(id, title);
  return { id, title };
}

export function getConversations() {
  return stmts.getConversations.all();
}

export function getConversation(id) {
  return stmts.getConversation.get(id);
}

export function updateConversationTitle(id, title) {
  stmts.updateConversationTitle.run(title, id);
}

export function touchConversation(id) {
  stmts.updateConversationTimestamp.run(id);
}

export function deleteConversation(id) {
  stmts.deleteConversation.run(id);
}

export function addMessage(conversationId, role, content, metadata = null) {
  const id = uuidv4();
  const metaStr = metadata ? JSON.stringify(metadata) : null;
  stmts.addMessage.run(id, conversationId, role, content, metaStr);
  touchConversation(conversationId);
  return id;
}

export function getMessages(conversationId) {
  return stmts.getMessages.all(conversationId).map((msg) => ({
    ...msg,
    metadata: msg.metadata ? JSON.parse(msg.metadata) : null,
  }));
}

export function addGeneratedImage(conversationId, messageId, prompt, enhancedPrompt, filename) {
  const id = uuidv4();
  stmts.addGeneratedImage.run(id, conversationId, messageId, prompt, enhancedPrompt, filename);
  return id;
}

export function getGeneratedImages(conversationId) {
  if (conversationId) {
    return stmts.getGeneratedImages.all(conversationId);
  }
  return stmts.getAllGeneratedImages.all();
}

export function deleteLastMessage(conversationId) {
  const lastMsg = db.prepare('SELECT id FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 1').get(conversationId);
  if (lastMsg) {
    db.prepare('DELETE FROM messages WHERE id = ?').run(lastMsg.id);
  }
}

export function truncateHistoryFrom(conversationId, messageId) {
  const msg = db.prepare('SELECT created_at FROM messages WHERE id = ? AND conversation_id = ?').get(messageId, conversationId);
  if (msg) {
    db.prepare('DELETE FROM messages WHERE conversation_id = ? AND created_at >= ?').run(conversationId, msg.created_at);
  }
}

export default db;

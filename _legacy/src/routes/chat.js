import { Router } from 'express';
import * as ollamaClient from '../utils/ollamaClient.js';
import * as db from '../db/database.js';

const router = Router();

// GET /api/models - List available Ollama models
router.get('/api/models', async (req, res) => {
  try {
    const models = await ollamaClient.listModels();
    res.json({ models });
  } catch (err) {
    console.error('Errore caricamento modelli:', err.message);
    res.status(502).json({ error: 'Impossibile connettersi a Ollama', details: err.message });
  }
});

// GET /api/conversations - List all conversations
router.get('/api/conversations', (req, res) => {
  try {
    const conversations = db.getConversations();
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/conversations - Create new conversation
router.post('/api/conversations', (req, res) => {
  try {
    const title = req.body?.title || 'Nuova conversazione';
    const conversation = db.createConversation(title);
    res.status(201).json(conversation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/conversations/:id/messages - Get messages for a conversation
router.get('/api/conversations/:id/messages', (req, res) => {
  try {
    const conversation = db.getConversation(req.params.id);
    if (!conversation) {
      return res.status(404).json({ error: 'Conversazione non trovata' });
    }
    const messages = db.getMessages(req.params.id);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/conversations/:id - Update conversation title
router.put('/api/conversations/:id', (req, res) => {
  try {
    const { title } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Titolo richiesto' });
    }
    db.updateConversationTitle(req.params.id, title);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/conversations/:id - Delete conversation
router.delete('/api/conversations/:id', (req, res) => {
  try {
    db.deleteConversation(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

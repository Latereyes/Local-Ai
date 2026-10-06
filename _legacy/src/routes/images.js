import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import mime from 'mime-types';
import * as db from '../db/database.js';
import config from '../config.js';

const router = Router();

// GET /api/images - List generated images
router.get('/api/images', (req, res) => {
  try {
    const conversationId = req.query.conversationId || null;
    const images = db.getGeneratedImages(conversationId);
    res.json(images);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/images/:filename - Serve a generated image
router.get('/api/images/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    // Security: prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Nome file non valido' });
    }

    const filePath = path.join(config.images.dir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Immagine non trovata' });
    }

    const mimeType = mime.lookup(filePath) || 'image/png';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

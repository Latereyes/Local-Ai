import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import mime from 'mime-types';
import { listDirectory, getAllowedRoots, isPathAllowed, getFileInfo } from '../agents/fileAgent.js';

const router = Router();

// GET /api/files/list - List directory contents
router.get('/api/files/list', (req, res) => {
  try {
    const targetPath = req.query.path;

    // If no path provided, return the root allowed directories
    if (!targetPath) {
      const roots = getAllowedRoots();
      return res.json({
        path: 'root',
        isRoot: true,
        entries: roots,
      });
    }

    if (!isPathAllowed(targetPath)) {
      return res.status(403).json({ error: 'Accesso non autorizzato a questa cartella' });
    }

    const entries = listDirectory(targetPath);
    res.json({
      path: targetPath,
      isRoot: false,
      parent: path.dirname(targetPath),
      entries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/preview - Preview an image file
router.get('/api/files/preview', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Percorso file richiesto' });
    }

    if (!isPathAllowed(filePath)) {
      return res.status(403).json({ error: 'Accesso non autorizzato' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File non trovato' });
    }

    const mimeType = mime.lookup(filePath);
    if (!mimeType || (!mimeType.startsWith('image/') && mimeType !== 'application/pdf' && !mimeType.startsWith('video/'))) {
      return res.status(400).json({ error: 'Il file non è supportato per la preview' });
    }

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/read - Read text file content
router.get('/api/files/read', (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Percorso file richiesto' });
    }

    if (!isPathAllowed(filePath)) {
      return res.status(403).json({ error: 'Accesso non autorizzato' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File non trovato' });
    }

    const stat = fs.statSync(filePath);
    if (stat.size > 1024 * 1024) {
      return res.status(413).json({ error: 'File troppo grande (max 1MB)' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const info = getFileInfo(filePath);
    res.json({ content, ...info });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;

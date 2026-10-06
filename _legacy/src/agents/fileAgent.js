import fs from 'fs';
import path from 'path';
import os from 'os';
import * as ollamaClient from '../utils/ollamaClient.js';
import { addMessage } from '../db/database.js';
import config from '../config.js';

function wsSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Check if a path is within allowed directories
 */
export function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  return config.fileAgent.allowedPaths.some((allowed) => {
    const allowedResolved = path.resolve(allowed);
    return resolved.startsWith(allowedResolved);
  });
}

/**
 * List contents of a directory
 */
export function listDirectory(dirPath) {
  const resolved = path.resolve(dirPath);
  if (!isPathAllowed(resolved)) {
    throw new Error('Accesso non autorizzato a questa cartella');
  }

  if (!fs.existsSync(resolved)) {
    throw new Error('Cartella non trovata');
  }

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith('.')) // Hide hidden files
    .map((entry) => {
      const fullPath = path.join(resolved, entry.name);
      const isDir = entry.isDirectory();

      let size = 0;
      let modified = '';
      try {
        const stat = fs.statSync(fullPath);
        size = stat.size;
        modified = stat.mtime.toISOString();
      } catch {
        // Skip if stat fails
      }

      return {
        name: entry.name,
        type: isDir ? 'directory' : 'file',
        size: isDir ? 0 : size,
        modified,
        extension: isDir ? '' : path.extname(entry.name).toLowerCase(),
        path: fullPath,
      };
    })
    .sort((a, b) => {
      // Directories first, then by name
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name, 'it');
    });
}

/**
 * Get allowed root directories for browsing
 */
export function getAllowedRoots() {
  return config.fileAgent.allowedPaths
    .filter((p) => fs.existsSync(p))
    .map((p) => ({
      name: path.basename(p),
      path: p,
      type: 'directory',
    }));
}

/**
 * Get file metadata
 */
export function getFileInfo(filePath) {
  const resolved = path.resolve(filePath);
  if (!isPathAllowed(resolved)) {
    throw new Error('Accesso non autorizzato');
  }

  const stat = fs.statSync(resolved);
  return {
    name: path.basename(resolved),
    path: resolved,
    size: stat.size,
    modified: stat.mtime.toISOString(),
    created: stat.birthtime.toISOString(),
    isDirectory: stat.isDirectory(),
    extension: path.extname(resolved).toLowerCase(),
  };
}

/**
 * Handle a file-related user request
 */
export async function handleFileRequest(userMessage, conversationId, model, ws) {
  try {
    // Get available root directories
    const roots = getAllowedRoots();

    if (roots.length === 0) {
      const msg = '⚠️ Nessuna cartella accessibile trovata sul sistema.';
      addMessage(conversationId, 'assistant', msg);
      wsSend(ws, { type: 'chat_chunk', content: msg, done: false });
      wsSend(ws, { type: 'chat_done', content: '', fullContent: msg, messageId: null });
      return;
    }

    // Use LLM to understand what the user wants
    const systemPrompt = `You are a file management assistant. The user wants to browse or view files on their device.

Available root directories:
${roots.map((r) => `- ${r.name}: ${r.path}`).join('\n')}

Based on the user's request, determine which directory to list. Respond ONLY with a JSON object:
{"action": "list", "path": "full path to list"}

If the user's request is vague, use the most relevant directory. If they mention photos/images, use Pictures. If they mention documents, use Documents. If they mention videos, use Videos. If they just want to browse, use the home directory root.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    let targetPath;
    try {
      const response = await ollamaClient.chatNoStream(messages, model, 'json');
      const parsed = JSON.parse(response);
      targetPath = parsed.path || roots[0].path;
    } catch {
      targetPath = roots[0].path;
    }

    // Verify the path is allowed
    if (!isPathAllowed(targetPath)) {
      targetPath = roots[0].path;
    }

    // List the directory
    let entries;
    try {
      entries = listDirectory(targetPath);
    } catch {
      targetPath = roots[0].path;
      entries = listDirectory(targetPath);
    }

    // Format response
    const fileIcons = {
      directory: '📁',
      '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️', '.webp': '🖼️', '.svg': '🖼️', '.bmp': '🖼️',
      '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬', '.mov': '🎬', '.wmv': '🎬',
      '.mp3': '🎵', '.wav': '🎵', '.flac': '🎵', '.aac': '🎵', '.ogg': '🎵',
      '.pdf': '📄', '.doc': '📄', '.docx': '📄', '.txt': '📝', '.md': '📝',
      '.zip': '📦', '.rar': '📦', '.7z': '📦', '.tar': '📦', '.gz': '📦',
      '.js': '💻', '.py': '💻', '.html': '💻', '.css': '💻', '.json': '💻',
    };

    function getIcon(entry) {
      if (entry.type === 'directory') return '📁';
      return fileIcons[entry.extension] || '📋';
    }

    function formatSize(bytes) {
      if (bytes === 0) return '';
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }

    let content = `📂 **Contenuto di:** \`${targetPath}\`\n\n`;

    if (entries.length === 0) {
      content += '*Cartella vuota*\n';
    } else {
      const dirs = entries.filter((e) => e.type === 'directory');
      const files = entries.filter((e) => e.type === 'file');

      if (dirs.length > 0) {
        content += `**Cartelle** (${dirs.length}):\n`;
        dirs.forEach((d) => {
          content += `${getIcon(d)} ${d.name}\n`;
        });
        content += '\n';
      }

      if (files.length > 0) {
        content += `**File** (${files.length}):\n`;
        files.slice(0, 50).forEach((f) => {
          const size = formatSize(f.size);
          content += `${getIcon(f)} ${f.name}${size ? ` — ${size}` : ''}\n`;
        });
        if (files.length > 50) {
          content += `\n*...e altri ${files.length - 50} file*\n`;
        }
      }
    }

    // Save to database and send
    const messageId = addMessage(conversationId, 'assistant', content, {
      type: 'file_listing',
      path: targetPath,
      entryCount: entries.length,
    });

    wsSend(ws, { type: 'chat_chunk', content, done: false });
    wsSend(ws, { type: 'chat_done', content: '', fullContent: content, messageId });
  } catch (err) {
    console.error('Errore file agent:', err);
    const errorContent = `❌ Errore nell'esplorazione dei file: ${err.message}`;
    addMessage(conversationId, 'assistant', errorContent);
    wsSend(ws, { type: 'error', message: errorContent });
    wsSend(ws, { type: 'chat_done', content: '', fullContent: errorContent, messageId: null });
  }
}

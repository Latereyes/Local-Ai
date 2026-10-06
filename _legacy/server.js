import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'os';
import fs from 'fs';
import config from './src/config.js';
import chatRoutes from './src/routes/chat.js';
import imageRoutes from './src/routes/images.js';
import fileRoutes from './src/routes/files.js';
import healthRoutes from './src/routes/health.js';
import { routeMessage, abortGeneration } from './src/agents/agentRouter.js';
import { createConversation, addMessage, getConversation, updateConversationTitle, deleteLastMessage, truncateHistoryFrom } from './src/db/database.js';

// Ensure data directories exist
const dirs = ['./data', './data/images'];
for (const dir of dirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));

// Serve static files
app.use(express.static('public'));

// API Routes
app.use(chatRoutes);
app.use(imageRoutes);
app.use(fileRoutes);
app.use('/api/health', healthRoutes);

// Fallback to index.html for SPA routing
app.use((req, res) => {
  res.sendFile('index.html', { root: 'public' });
});

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('📱 Nuovo client connesso');

  ws.on('message', async (rawData) => {
    let data;
    try {
      data = JSON.parse(rawData.toString());
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Messaggio non valido' }));
      return;
    }

    if (data.type === 'abort') {
      const { conversationId } = data;
      if (conversationId) {
        abortGeneration(conversationId);
      }
      return;
    }

    if (data.type === 'chat') {
      const { conversationId, message, model, regenerate, editMessageId, systemPrompt } = data;

      if (!message || !message.trim()) {
        ws.send(JSON.stringify({ type: 'error', message: 'Messaggio vuoto' }));
        return;
      }

      if (!model) {
        ws.send(JSON.stringify({ type: 'error', message: 'Nessun modello selezionato' }));
        return;
      }

      let activeConvId = conversationId;

      // Auto-create conversation if needed
      if (!activeConvId || !getConversation(activeConvId)) {
        const title = message.substring(0, 50).trim() + (message.length > 50 ? '...' : '');
        const conv = createConversation(title);
        activeConvId = conv.id;
        ws.send(JSON.stringify({
          type: 'conversation_created',
          conversationId: activeConvId,
          title: conv.title,
        }));
      } else {
        // Update title if it's the first message (title is still "Nuova conversazione")
        const conv = getConversation(activeConvId);
        if (conv && conv.title === 'Nuova conversazione') {
          const newTitle = message.substring(0, 50).trim() + (message.length > 50 ? '...' : '');
          updateConversationTitle(activeConvId, newTitle);
        }
      }

      let userMsgId;
      if (regenerate) {
        deleteLastMessage(activeConvId);
      } else if (editMessageId) {
        truncateHistoryFrom(activeConvId, editMessageId);
        userMsgId = addMessage(activeConvId, 'user', message);
      } else {
        userMsgId = addMessage(activeConvId, 'user', message);
      }

      if (userMsgId) {
        ws.send(JSON.stringify({ type: 'user_message_id', messageId: userMsgId }));
      }

      // Route to appropriate agent
      try {
        await routeMessage(message, activeConvId, model, ws, systemPrompt);
      } catch (err) {
        console.error('Errore routing messaggio:', err);
        ws.send(JSON.stringify({
          type: 'error',
          message: `Errore interno: ${err.message}`,
        }));
      }
    }
  });

  ws.on('close', () => {
    console.log('📴 Client disconnesso');
  });

  ws.on('error', (err) => {
    console.error('WebSocket errore:', err.message);
  });
});

// Start server
const { port, host } = config.server;

server.listen(port, host, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║           ⚡ LocalAI Chat Server             ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Server:    http://localhost:${port}             ║`);
  console.log(`║  Ollama:    ${config.ollama.host}    ║`);
  console.log(`║  ComfyUI:   ${config.comfyui.host}   ║`);
  console.log(`║  SearXNG:   ${config.search.host}       ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  Indirizzi di rete per accesso mobile:       ║');

  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const addr = `http://${net.address}:${port}`;
        console.log(`║  📱 ${addr.padEnd(40)} ║`);
      }
    }
  }

  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});

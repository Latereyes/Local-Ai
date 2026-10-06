import * as ollamaClient from '../utils/ollamaClient.js';
import { handleImageRequest } from './imageAgent.js';
import { handleSearchRequest } from './searchAgent.js';
import { handleFileRequest } from './fileAgent.js';
import { addMessage, getMessages } from '../db/database.js';

const activeControllers = new Map();

export function abortGeneration(conversationId) {
  if (activeControllers.has(conversationId)) {
    const controller = activeControllers.get(conversationId);
    controller.abort();
    activeControllers.delete(conversationId);
  }
}

function wsSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Route an incoming user message to the appropriate agent
 */
export async function routeMessage(userMessage, conversationId, model, ws, systemPrompt) {
  try {
    // 1. Notify thinking
    wsSend(ws, { type: 'thinking', message: 'Sto analizzando la tua richiesta...' });

    // 2. Classify intent
    let intentResult;
    try {
      intentResult = await ollamaClient.classifyIntent(userMessage, model);
    } catch (err) {
      console.error('Errore classificazione intent:', err.message);
      intentResult = { intent: 'chat', reason: 'fallback on error' };
    }

    const { intent } = intentResult;

    // 3. Send intent info
    const intentMessages = {
      chat: '💬 Rispondo alla tua domanda...',
      image: '🎨 Preparo la generazione dell\'immagine...',
      search: '🔍 Cerco informazioni sul web...',
      file: '📁 Esploro i tuoi file...',
    };
    wsSend(ws, {
      type: 'intent',
      intent,
      message: intentMessages[intent] || intentMessages.chat,
    });

    // 4. Get conversation history for context
    const history = getMessages(conversationId);
    
    // Auto-generate title for new conversations
    if (history.length === 0) {
      generateTitleInBackground(userMessage, conversationId, model, ws);
    }

    const conversationContext = history
      .slice(-10)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    // Create AbortController for this generation
    const abortController = new AbortController();
    activeControllers.set(conversationId, abortController);
    const signal = abortController.signal;

    // 5. Route to appropriate agent
    switch (intent) {
      case 'image':
        await handleImageRequest(userMessage, conversationId, model, ws);
        break;

      case 'search':
        await handleSearchRequest(userMessage, conversationId, model, ws, conversationContext);
        break;

      case 'file':
        await handleFileRequest(userMessage, conversationId, model, ws);
        break;

      case 'chat':
      default:
        await handleChatRequest(userMessage, conversationId, model, ws, history, signal, systemPrompt);
        break;
    }
    
    // Clean up controller after success
    activeControllers.delete(conversationId);
  } catch (err) {
    if (err.name === 'AbortError') {
      console.log(`Generazione interrotta per la conversazione: ${conversationId}`);
      return;
    }
    console.error('Errore agente:', err);
    wsSend(ws, {
      type: 'error',
      message: `Si è verificato un errore: ${err.message}`,
    });
  }
}

/**
 * Handle a regular chat request with streaming
 */
async function handleChatRequest(userMessage, conversationId, model, ws, history, signal, systemPrompt) {
  // Build messages array for Ollama
  const systemMsg = {
    role: 'system',
    content: systemPrompt || `You are a helpful, knowledgeable AI assistant. Respond in the same language the user uses. Be concise but thorough. Use markdown formatting when appropriate (headers, lists, code blocks, bold, etc.).`,
  };

  const ollamaMessages = [systemMsg];

  // Add conversation history (last 20 messages for context)
  const recentHistory = history.slice(-20);
  for (const msg of recentHistory) {
    ollamaMessages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  // Add current message
  ollamaMessages.push({ role: 'user', content: userMessage });

  // Stream response
  const fullContent = await ollamaClient.chat(ollamaMessages, model, (chunk) => {
    wsSend(ws, { type: 'chat_chunk', content: chunk, done: false });
  }, signal);

  // Save assistant message to database
  const messageId = addMessage(conversationId, 'assistant', fullContent);

  // Send completion
  wsSend(ws, {
    type: 'chat_done',
    content: '',
    fullContent,
    messageId,
  });
}

/**
 * Generate a short title in the background
 */
async function generateTitleInBackground(userMessage, conversationId, model, ws) {
  try {
    const prompt = `Genera un titolo molto breve (massimo 4 parole) per una conversazione che inizia con questo messaggio: "${userMessage}". Rispondi SOLO con il titolo, senza virgolette o testo aggiuntivo.`;
    
    const response = await ollamaClient.chat([{ role: 'user', content: prompt }], model, () => {});
    const title = response.trim().replace(/^"|"$/g, '');
    
    if (title) {
      const { updateConversationTitle } = await import('../db/database.js');
      updateConversationTitle(conversationId, title);
      wsSend(ws, { type: 'title_updated', conversationId, title });
    }
  } catch (err) {
    console.error('Errore generazione titolo:', err);
  }
}

import * as ollamaClient from '../utils/ollamaClient.js';
import * as comfyClient from '../utils/comfyClient.js';
import { addMessage, addGeneratedImage } from '../db/database.js';

function wsSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Handle image generation request
 */
export async function handleImageRequest(userMessage, conversationId, model, ws) {
  try {
    // 1. Enhance prompt with Ollama
    wsSend(ws, { type: 'chat_chunk', content: '🎨 *Sto elaborando il prompt per la generazione dell\'immagine...*\n\n', done: false });

    const enhancedPrompt = await ollamaClient.enhanceImagePrompt(userMessage, model);

    wsSend(ws, {
      type: 'chat_chunk',
      content: `**Prompt ottimizzato:** _${enhancedPrompt}_\n\n⏳ Generazione in corso...\n`,
      done: false,
    });

    // 2. Generate image with progress updates
    wsSend(ws, { type: 'image_progress', value: 0, max: 8, message: 'Avvio generazione...' });

    const result = await comfyClient.generateImage(enhancedPrompt, (value, max) => {
      wsSend(ws, {
        type: 'image_progress',
        value,
        max,
        message: `Step ${value}/${max}...`,
      });
    });

    // 3. Save to database
    const imageUrl = `/api/images/${result.filename}`;
    const content = `Ho generato l'immagine richiesta!\n\n**Prompt originale:** ${userMessage}\n**Prompt ottimizzato:** ${enhancedPrompt}\n\n![Immagine generata](${imageUrl})`;

    const messageId = addMessage(conversationId, 'assistant', content, {
      type: 'image',
      imageUrl,
      prompt: userMessage,
      enhancedPrompt,
      filename: result.filename,
    });

    addGeneratedImage(conversationId, messageId, userMessage, enhancedPrompt, result.filename);

    // 4. Send completion
    wsSend(ws, {
      type: 'image_complete',
      url: imageUrl,
      prompt: userMessage,
      enhancedPrompt,
      messageId,
    });

    wsSend(ws, {
      type: 'chat_done',
      content: '',
      fullContent: content,
      messageId,
    });
  } catch (err) {
    console.error('Errore generazione immagine:', err);

    const errorContent = `❌ Errore durante la generazione dell'immagine: ${err.message}`;
    addMessage(conversationId, 'assistant', errorContent);

    wsSend(ws, { type: 'error', message: `Errore generazione immagine: ${err.message}` });
    wsSend(ws, {
      type: 'chat_done',
      content: '',
      fullContent: errorContent,
      messageId: null,
    });
  }
}

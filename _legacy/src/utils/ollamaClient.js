import config from '../config.js';

const OLLAMA_BASE = config.ollama.host;

/**
 * Strip leaked special tokens from LLM output
 */
function stripSpecialTokens(text) {
  if (!text) return text;
  return text
    .replace(/<\|im_end\|>/g, '')
    .replace(/<\|im_start\|>[^\n]*/g, '')
    .replace(/<\|endoftext\|>/g, '')
    .replace(/<\|end\|>/g, '')
    .replace(/<\|eot_id\|>/g, '')
    .replace(/<\|start_header_id\|>[^<]*<\|end_header_id\|>/g, '')
    .trim();
}

/**
 * List all available models on the Ollama server
 */
export async function listModels() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) throw new Error(`Ollama non raggiungibile: ${res.status}`);
  const data = await res.json();
  return data.models || [];
}

/**
 * Chat with streaming. Calls onChunk for each text chunk received.
 * Returns the full accumulated response text.
 */
export async function chat(messages, model, onChunk, signal) {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Errore Ollama (${res.status}): ${errText}`);
  }

  let fullContent = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // Buffer for detecting partial special tokens during streaming
  let pendingChunk = '';
  const TOKEN_PATTERN = /<\|[^|]*\|?$/; // partial token at end of chunk
  const FULL_TOKEN_RE = /<\|(?:im_end|im_start|endoftext|end|eot_id|start_header_id|end_header_id)[^>]*\|?>/g;

  function emitChunk(text) {
    if (!text) return;
    // Strip any complete special tokens
    const cleaned = text.replace(FULL_TOKEN_RE, '');
    if (cleaned) {
      fullContent += cleaned;
      if (onChunk) onChunk(cleaned);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        if (parsed.message?.content) {
          const chunk = pendingChunk + parsed.message.content;
          pendingChunk = '';

          // Check if the chunk ends with a partial special token
          const partialMatch = chunk.match(TOKEN_PATTERN);
          if (partialMatch) {
            emitChunk(chunk.substring(0, partialMatch.index));
            pendingChunk = partialMatch[0];
          } else {
            emitChunk(chunk);
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer);
      if (parsed.message?.content) {
        const chunk = pendingChunk + parsed.message.content;
        pendingChunk = '';
        emitChunk(chunk);
      }
    } catch {
      // Skip
    }
  }

  // Emit any remaining pending content (if it wasn't a special token)
  if (pendingChunk) {
    const cleaned = pendingChunk.replace(FULL_TOKEN_RE, '');
    if (cleaned) {
      fullContent += cleaned;
      if (onChunk) onChunk(cleaned);
    }
  }

  return stripSpecialTokens(fullContent);
}

/**
 * Chat without streaming. Returns the complete response text.
 */
export async function chatNoStream(messages, model, format = undefined) {
  const body = { model, messages, stream: false };
  if (format) body.format = format;

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Errore Ollama (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return stripSpecialTokens(data.message?.content || '');
}

/**
 * Classify user intent into: chat, image, search, file
 */
export async function classifyIntent(userMessage, model) {
  const systemPrompt = `You are an intent classifier. Analyze the user message and respond ONLY with a JSON object.
Possible intents:
- "image": user wants to generate, create, draw, or make an image/picture/illustration
- "search": user asks about recent events, news, prices, shopping recommendations, current information, or topics you likely don't know about because your training data is outdated. Also use when the user explicitly asks to search online.
- "file": user wants to browse, view, open, list, or manage files, photos, or videos on their device
- "chat": general conversation, questions, coding help, explanations, or anything else

Respond with: {"intent": "...", "reason": "brief reason"}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  try {
    const response = await chatNoStream(messages, model, 'json');
    const parsed = JSON.parse(response);
    return {
      intent: parsed.intent || 'chat',
      reason: parsed.reason || '',
    };
  } catch {
    return { intent: 'chat', reason: 'fallback' };
  }
}

/**
 * Enhance a user's image request into a detailed English prompt for image generation
 */
export async function enhanceImagePrompt(userMessage, model) {
  const systemPrompt = `You are an expert prompt engineer for AI image generation models. The user will describe an image they want in Italian. Your job is to create a detailed, vivid English prompt optimized for a diffusion model.

Rules:
- Translate to English
- Add details about style, lighting, composition, atmosphere, colors
- Keep it under 200 words
- Start with the main subject
- Include quality tags: masterpiece, best quality, highly detailed
- DO NOT include negative prompt
- Return ONLY the prompt text, nothing else`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await chatNoStream(messages, model);
  return response.trim();
}

/**
 * Formulate an optimal search query from the user's message
 */
export async function formulateSearchQuery(userMessage, conversationContext, model) {
  const systemPrompt = `You are a search query optimizer. Given the user's message (in Italian), create a concise, effective web search query. 
Rules:
- Use the most relevant keywords
- Use the language most likely to return good results (usually English for tech, Italian for local/shopping)
- Return ONLY the search query text, nothing else
- Keep it under 10 words`;

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  if (conversationContext) {
    messages.push({ role: 'user', content: `Context from conversation:\n${conversationContext}` });
    messages.push({ role: 'assistant', content: 'I understand the context. What should I search for?' });
  }

  messages.push({ role: 'user', content: userMessage });

  const response = await chatNoStream(messages, model);
  return response.trim().replace(/^["']|["']$/g, '').replace(/\n/g, ' ').trim();
}

/**
 * Synthesize search results into a coherent response, streaming
 */
export async function synthesizeSearchResults(userMessage, searchResults, model, onChunk) {
  const systemPrompt = `You are a helpful AI assistant. The user asked a question and web search results have been provided to help you answer. 

Rules:
- Answer the user's question based on the search results
- Respond in ITALIAN
- Cite your sources by including [Source: URL] at the end of relevant statements
- If the search results don't contain enough information, say so
- Be comprehensive but concise
- Format your response with markdown for readability`;

  const messages = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Domanda dell'utente: ${userMessage}\n\nRisultati della ricerca web:\n${searchResults}`,
    },
  ];

  return await chat(messages, model, onChunk);
}

import * as ollamaClient from '../utils/ollamaClient.js';
import * as searchClient from '../utils/searchClient.js';
import { addMessage } from '../db/database.js';

function wsSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Handle web search request
 */
export async function handleSearchRequest(userMessage, conversationId, model, ws, conversationContext) {
  try {
    // 1. Formulate search query
    const searchQuery = await ollamaClient.formulateSearchQuery(userMessage, conversationContext, model);

    wsSend(ws, {
      type: 'search_start',
      query: searchQuery,
      message: `🔍 Sto cercando: "${searchQuery}"...`,
    });

    // 2. Perform search
    const results = await searchClient.search(searchQuery, 6);

    if (results.length === 0) {
      // SearXNG not available or no results - try to answer without search
      wsSend(ws, {
        type: 'chat_chunk',
        content: '⚠️ *Ricerca web non disponibile. Rispondo con le mie conoscenze...*\n\n',
        done: false,
      });

      const fullContent = await ollamaClient.chat(
        [
          {
            role: 'system',
            content: 'You are a helpful assistant. Respond in Italian. The user asked a question that would benefit from web search but the search service is unavailable. Do your best to answer with your existing knowledge, and note that your information may be outdated.',
          },
          { role: 'user', content: userMessage },
        ],
        model,
        (chunk) => wsSend(ws, { type: 'chat_chunk', content: chunk, done: false })
      );

      const messageId = addMessage(conversationId, 'assistant', fullContent, { type: 'search_fallback' });
      wsSend(ws, { type: 'chat_done', content: '', fullContent, messageId });
      return;
    }

    // 3. Enrich top results with page content
    wsSend(ws, {
      type: 'chat_chunk',
      content: `📊 *Trovati ${results.length} risultati. Leggo le pagine principali...*\n\n`,
      done: false,
    });
    
    await searchClient.enrichResults(results, 3);

    // 4. Send sources to client immediately
    const sources = results.map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
    wsSend(ws, { type: 'search_sources', sources });

    // 5. Format results for LLM
    const formattedResults = searchClient.formatResultsForLLM(results);

    // 6. Synthesize response with search results
    const fullContent = await ollamaClient.synthesizeSearchResults(
      userMessage,
      formattedResults,
      model,
      (chunk) => wsSend(ws, { type: 'chat_chunk', content: chunk, done: false })
    );

    // 5. Save to database
    const messageId = addMessage(conversationId, 'assistant', fullContent, {
      type: 'search',
      query: searchQuery,
      resultCount: results.length,
      sources: results.map((r) => ({ title: r.title, url: r.url })),
    });

    wsSend(ws, { type: 'chat_done', content: '', fullContent, messageId });
  } catch (err) {
    console.error('Errore ricerca web:', err);

    const errorContent = `❌ Errore durante la ricerca web: ${err.message}`;
    addMessage(conversationId, 'assistant', errorContent);

    wsSend(ws, { type: 'error', message: `Errore ricerca: ${err.message}` });
    wsSend(ws, { type: 'chat_done', content: '', fullContent: errorContent, messageId: null });
  }
}

import * as cheerio from 'cheerio';

const searchCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Search the web via DuckDuckGo HTML
 * @param {string} query - Search query
 * @param {number} limit - Max results to return (default 5)
 * @returns {Array} Search results [{title, url, content, engine}]
 */
export async function search(query, limit = 5) {
  const cacheKey = `${query}_${limit}`;
  const cached = searchCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    if (typeof logger !== 'undefined') logger.info(`Cache hit per ricerca: "${query}"`);
    else console.log(`Cache hit per ricerca: "${query}"`);
    return cached.results;
  }

  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const html = await res.text();
    const $ = cheerio.load(html);
    const results = [];
    
    $('.result').each((i, el) => {
      if (i >= limit) return;
      const title = $(el).find('.result__title').text().trim();
      const rawUrl = $(el).find('.result__url').attr('href');
      const snippet = $(el).find('.result__snippet').text().trim();
      
      let cleanUrl = rawUrl;
      if (rawUrl && rawUrl.includes('uddg=')) {
        const urlObj = new URL(rawUrl, 'https://duckduckgo.com');
        cleanUrl = decodeURIComponent(urlObj.searchParams.get('uddg') || rawUrl);
      }
      
      if (title && snippet) {
        results.push({ title, url: cleanUrl, content: snippet, engine: 'DuckDuckGo' });
      }
    });

    searchCache.set(cacheKey, { results, timestamp: Date.now() });
    return results;
  } catch (err) {
    if (typeof logger !== 'undefined') logger.error('Ricerca fallita:', err.message);
    else console.error('Ricerca fallita:', err.message);
    return [];
  }
}

/**
 * Scrape the content of a web page
 */
export async function scrapePageContent(url, maxChars = 3000) {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      }
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    
    // Remove unnecessary elements
    $('script, style, nav, footer, header, aside, iframe').remove();
    
    // Get text from main containers
    let text = $('article').text() || $('main').text() || $('body').text();
    text = text.replace(/\s+/g, ' ').trim();
    
    if (text.length > maxChars) {
      text = text.substring(0, maxChars) + '...';
    }
    return text;
  } catch (err) {
    return null;
  }
}

/**
 * Enrich top N results with full page content
 */
export async function enrichResults(results, topN = 3) {
  const promises = results.slice(0, topN).map(async (r) => {
    const fullContent = await scrapePageContent(r.url);
    if (fullContent && fullContent.length > 100) {
      r.fullContent = fullContent;
    }
    return r;
  });
  await Promise.all(promises);
  return results;
}

/**
 * Format search results as a string suitable for LLM context
 */
export function formatResultsForLLM(results) {
  if (!results || results.length === 0) {
    return 'Nessun risultato trovato dalla ricerca web.';
  }

  return results
    .map(
      (r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.url}\nSNIPPET: ${r.content}\n${r.fullContent ? `CONTENUTO PAGINA:\n${r.fullContent}\n` : ''}`
    )
    .join('\n');
}

import * as cheerio from 'cheerio';

async function testDDG() {
  const query = 'notizie oggi';
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  console.log('Fetching', url);
  
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    }
  });
  
  const html = await res.text();
  console.log('Status:', res.status);
  
  const $ = cheerio.load(html);
  const results = [];
  
  $('.result').each((i, el) => {
    if (i >= 5) return;
    const title = $(el).find('.result__title').text().trim();
    const url = $(el).find('.result__url').attr('href');
    const snippet = $(el).find('.result__snippet').text().trim();
    
    if (title && snippet) {
      results.push({ title, url, content: snippet, engine: 'DuckDuckGo' });
    }
  });
  
  console.log(results);
}

testDDG();

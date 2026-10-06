import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import config from './config.js';

/**
 * Ricerca web e lettura di pagine.
 * Motori: SearXNG (se SEARXNG_URL è impostato), Brave (se BRAVE_API_KEY), altrimenti DuckDuckGo.
 * Se il motore configurato fallisce si ripiega su DuckDuckGo.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const cache = new Map(); // chiave -> { t, value }
const TTL = 10 * 60 * 1000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL) return hit.value;
  const value = await fn();
  cache.set(key, { t: Date.now(), value });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return value;
}

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

async function duckduckgo(query, limit) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=${config.search.region}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7' },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);
  const $ = cheerio.load(await res.text());
  const out = [];
  $('.result').each((_, el) => {
    if (out.length >= limit) return;
    const r = $(el);
    if (r.hasClass('result--ad')) return;
    const a = r.find('a.result__a');
    let href = a.attr('href') || '';
    if (href.includes('uddg=')) href = new URL(href, 'https://duckduckgo.com').searchParams.get('uddg') || href;
    if (!/^https?:\/\//.test(href) || href.includes('duckduckgo.com/y.js')) return;
    out.push({ title: clean(a.text()), url: href, snippet: clean(r.find('.result__snippet').text()) });
  });
  return out;
}

async function searxng(query, limit) {
  const u = `${config.search.searxngUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&language=it`;
  const res = await fetch(u, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`SearXNG HTTP ${res.status}`);
  const j = await res.json();
  return (j.results || []).slice(0, limit).map((r) => ({ title: clean(r.title), url: r.url, snippet: clean(r.content), date: r.publishedDate || undefined }));
}

async function brave(query, limit) {
  const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}&search_lang=it`;
  const res = await fetch(u, { headers: { Accept: 'application/json', 'X-Subscription-Token': config.search.braveKey }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
  const j = await res.json();
  return (j.web?.results || []).slice(0, limit).map((r) => ({ title: clean(r.title), url: r.url, snippet: clean(cheerio.load(r.description || '').text()), date: r.age }));
}

export function engineName() {
  if (config.search.searxngUrl) return 'SearXNG';
  if (config.search.braveKey) return 'Brave';
  return 'DuckDuckGo';
}

export async function webSearch(query, { limit = 6 } = {}) {
  query = clean(query).slice(0, 300);
  if (!query) throw new Error('Query vuota');
  return cached(`s:${query}:${limit}`, async () => {
    const primary = config.search.searxngUrl ? searxng : config.search.braveKey ? brave : null;
    if (primary) {
      try { return await primary(query, limit); }
      catch (e) { console.warn(`[search] ${engineName()} non disponibile (${e.message}), uso DuckDuckGo`); }
    }
    return duckduckgo(query, limit);
  });
}

// ---- Lettura pagine ----

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

/** Impedisce che una pagina (o un prompt) faccia leggere a Gemma servizi della rete locale. */
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('URL non valido'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Sono ammessi solo indirizzi http/https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) throw new Error('Indirizzo locale non consentito');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error('Indirizzo della rete locale non consentito');
  return u;
}

function extractText(html, url) {
  const $ = cheerio.load(html);
  const title = clean($('meta[property="og:title"]').attr('content') || $('title').first().text());
  const published = $('meta[property="article:published_time"]').attr('content') || $('time[datetime]').first().attr('datetime') || undefined;
  $('script, style, noscript, svg, nav, footer, header, aside, form, iframe, button, [role="navigation"], [aria-hidden="true"], .cookie, .advert, .ads').remove();
  // Contenitori di navigazione/servizio riconoscibili dal nome della classe o dell'id
  const junk = /(^|[-_\s])(menu|nav|navbar|breadcrumbs?|share|social|footer|sidebar|newsletter|cookie|banner|related|comments?|subscribe|popup|modal)([-_\s]|$)/i;
  $('div, ul, ol, section, span').filter((_, el) => junk.test(`${$(el).attr('class') || ''} ${$(el).attr('id') || ''}`)).remove();
  const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body');
  const parts = [];
  root.find('h1, h2, h3, h4, p, li, td, th, blockquote, pre').each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const t = clean($(el).text());
    if (t.length < 2) return;
    if (tag === 'li' && $(el).find('p').length) return;
    // voci di elenco fatte solo da un link breve = menu
    if (tag === 'li' && t.length < 60 && clean($(el).find('a').text()).length >= t.length * 0.6) return;
    parts.push(/^h\d$/.test(tag) ? `\n## ${t}` : tag === 'li' ? `- ${t}` : t);
  });
  let text = parts.join('\n');
  if (text.length < 200) text = clean(root.text());
  // rimuove righe duplicate (menu ripetuti, ecc.)
  const seen = new Set();
  text = text.split('\n').filter((l) => { const k = l.trim(); if (!k) return true; if (seen.has(k)) return false; seen.add(k); return true; }).join('\n');
  return { title, url, published, text };
}

export async function readPage(rawUrl, { maxChars = 5000 } = {}) {
  return cached(`p:${rawUrl}:${maxChars}`, async () => {
    let url = (await assertPublicUrl(rawUrl)).toString();
    let res;
    for (let hop = 0; hop < 5; hop++) {
      res = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9', 'Accept-Language': 'it-IT,it;q=0.9,en;q=0.7' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = (await assertPublicUrl(new URL(res.headers.get('location'), url).toString())).toString();
        continue;
      }
      break;
    }
    if (!res.ok) throw new Error(`La pagina ha risposto ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/html|text\/plain|xml/.test(type)) throw new Error(`Contenuto non testuale (${type.split(';')[0] || 'sconosciuto'})`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > 5_000_000) throw new Error('Pagina troppo grande');
    const body = await res.text();
    const page = type.includes('html') ? extractText(body.slice(0, 3_000_000), url) : { title: url, url, text: body };
    const truncated = page.text.length > maxChars;
    return { ...page, text: page.text.slice(0, maxChars) + (truncated ? '\n[…testo troncato…]' : '') };
  });
}

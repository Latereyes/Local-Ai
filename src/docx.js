/**
 * Conversione HTML → .docx senza dipendenze, usata quando Word non è disponibile.
 * Copre ciò che serve a un documento: titoli, paragrafi, grassetto/corsivo/sottolineato, elenchi,
 * tabelle, link (come testo) e interruzioni di riga. CSS e immagini vengono ignorati.
 * Lo zip è scritto senza compressione.
 */

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip "stored" (nessuna compressione) da una lista di { name, data }. */
export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // versione
    local.writeUInt16LE(0x0800, 6);   // nomi in UTF-8
    local.writeUInt16LE(0, 8);        // stored
    local.writeUInt32LE(0, 10);       // ora/data
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', egrave: 'è', eacute: 'é', agrave: 'à', igrave: 'ì', ograve: 'ò', ugrave: 'ù', Egrave: 'È', euro: '€', copy: '©', laquo: '«', raquo: '»', hellip: '…', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', middot: '·', deg: '°' };
const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENTITIES[e] ?? m;
});
const xml = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'section', 'article', 'header', 'footer', 'main', 'tr', 'table', 'ul', 'ol', 'hr', 'title', 'figcaption', 'dt', 'dd']);
const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'area', 'base', 'wbr', 'source']);

/** Converte l'HTML nel corpo di word/document.xml. */
function bodyXml(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<![^>]*>/g, '').replace(/<(script|style|head|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, '');
  const out = [];
  const fmt = { b: 0, i: 0, u: 0 };
  const lists = [];           // pila di { ordered, n }
  let runs = [];              // run del paragrafo corrente
  let para = { style: null, indent: 0, prefix: '' };
  let table = null;           // { rows: [[cell xml…]] }, una tabella alla volta (le annidate diventano testo)
  let cell = null;            // contenuto della cella corrente (array di paragrafi xml)
  let pre = 0;

  const target = () => (cell || out);
  const flush = () => {
    const text = runs.join('');
    if (text || para.prefix) {
      const ppr = [para.style ? `<w:pStyle w:val="${para.style}"/>` : '', para.indent ? `<w:ind w:left="${para.indent}" w:hanging="300"/>` : ''].join('');
      const pref = para.prefix ? `<w:r><w:t xml:space="preserve">${xml(para.prefix)}</w:t></w:r>` : '';
      target().push(`<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${pref}${text}</w:p>`);
    }
    runs = [];
    para = { style: null, indent: 0, prefix: '' };
  };
  const addText = (raw) => {
    let t = decode(raw);
    if (!pre) t = t.replace(/\s+/g, ' ');
    if (!runs.length && !pre) t = t.replace(/^ /, '');
    if (!t) return;
    const rpr = `${fmt.b ? '<w:b/>' : ''}${fmt.i ? '<w:i/>' : ''}${fmt.u ? '<w:u w:val="single"/>' : ''}${pre ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}`;
    const parts = t.split('\n');
    runs.push(parts.map((x, k) => `${k ? '<w:r><w:br/></w:r>' : ''}<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(x)}</w:t></w:r>`).join(''));
  };

  const re = /<\/?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) { addText(m[3]); continue; }
    const tag = m[1].toLowerCase();
    const closing = m[0][1] === '/';
    if (['b', 'strong'].includes(tag)) { fmt.b += closing ? -1 : 1; continue; }
    if (['i', 'em'].includes(tag)) { fmt.i += closing ? -1 : 1; continue; }
    if (tag === 'u') { fmt.u += closing ? -1 : 1; continue; }
    if (tag === 'br') { runs.push('<w:r><w:br/></w:r>'); continue; }
    if (tag === 'hr') { flush(); target().push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>'); continue; }
    if (tag === 'table') {
      flush();
      if (!closing && !table) table = { rows: [] };
      else if (closing && table) {
        const cols = Math.max(1, ...table.rows.map((r) => r.length));
        const grid = `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(cols)}</w:tblGrid>`;
        const b = (s) => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="888888"/>`;
        const rows = table.rows.map((r) => `<w:tr>${r.join('')}${'<w:tc><w:p/></w:tc>'.repeat(cols - r.length)}</w:tr>`).join('');
        out.push(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b).join('')}</w:tblBorders></w:tblPr>${grid}${rows}</w:tbl><w:p/>`);
        table = null;
      }
      continue;
    }
    if (table && tag === 'tr') { flush(); if (!closing) table.rows.push([]); continue; }
    if (table && (tag === 'td' || tag === 'th')) {
      if (!closing) { flush(); cell = []; if (tag === 'th') fmt.b++; }
      else if (cell) {
        flush();
        if (tag === 'th') fmt.b = Math.max(0, fmt.b - 1);
        if (!table.rows.length) table.rows.push([]);
        table.rows.at(-1).push(`<w:tc>${cell.length ? cell.join('') : '<w:p/>'}</w:tc>`);
        cell = null;
      }
      continue;
    }
    if (tag === 'ul' || tag === 'ol') { flush(); if (closing) lists.pop(); else lists.push({ ordered: tag === 'ol', n: 0 }); continue; }
    if (tag === 'pre') { flush(); pre += closing ? -1 : 1; continue; }
    if (BLOCK.has(tag)) {
      flush();
      if (closing) continue;
      if (/^h[1-6]$/.test(tag)) para.style = `Heading${Math.min(3, Number(tag[1]))}`;
      else if (tag === 'title') para.style = 'Title';
      else if (tag === 'blockquote') para.style = 'Quote';
      else if (tag === 'li') {
        const l = lists.at(-1);
        para.indent = 360 * Math.max(1, lists.length);
        para.prefix = l?.ordered ? `${++l.n}. ` : '• ';
      }
      continue;
    }
    if (VOID.has(tag)) continue;
  }
  flush();
  return out.join('') || '<w:p/>';
}

export function buildDocx(html) {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const st = (id, name, rpr, ppr = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
  const styles = `${head}<w:styles xmlns:w="${W}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="it-IT"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${st('Title', 'Title', '<w:b/><w:sz w:val="44"/><w:color w:val="1F3864"/>')}
${st('Heading1', 'heading 1', '<w:b/><w:sz w:val="32"/><w:color w:val="2F5496"/>', '<w:outlineLvl w:val="0"/>')}
${st('Heading2', 'heading 2', '<w:b/><w:sz w:val="26"/><w:color w:val="2F5496"/>', '<w:outlineLvl w:val="1"/>')}
${st('Heading3', 'heading 3', '<w:b/><w:sz w:val="24"/><w:color w:val="1F3864"/>', '<w:outlineLvl w:val="2"/>')}
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;
  return zip([
    { name: '[Content_Types].xml', data: `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>` },
    { name: '_rels/.rels', data: `${head}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>` },
    { name: 'word/_rels/document.xml.rels', data: `${head}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/document.xml', data: `${head}<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${bodyXml(html)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>` },
  ]);
}

import { parsePlan, planPrompt, wordTarget, textFiles, WORDS_PER_PAGE } from './projects.js';
import * as ollama from './ollama.js';

// Calcola le parole totali richieste dal testo dell'obiettivo
export function goalWords(goal) {
  if (!goal) return 0;
  const text = String(goal);
  let max = 0;

  // Cerca pagine (es. "125 pagine")
  const pageMatches = text.matchAll(/(\d[\d.,']*)\s*(?:pagine|pages)/gi);
  for (const m of pageMatches) {
    const n = parseInt(m[1].replace(/[.,']/g, ''), 10);
    if (!isNaN(n) && n > 0) {
      max = Math.max(max, n * WORDS_PER_PAGE);
    }
  }

  // Cerca parole (es. "30000 parole")
  const wordMatches = text.matchAll(/(\d[\d.,']*)\s*(?:parole|words)/gi);
  for (const m of wordMatches) {
    const n = parseInt(m[1].replace(/[.,']/g, ''), 10);
    if (!isNaN(n) && n > 0) {
      max = Math.max(max, n);
    }
  }

  return max;
}

// Estrae l'intervallo di pagine per un PDF dal testo del task
export function pdfPages(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();

  // Intervallo: "tra X e Y pagine" o "between X and Y pages"
  const rangeMatch = t.match(/(?:tra|between)\s*(\d+)\s*(?:e|and)\s*(\d+)\s*(?:pagine|pages)/);
  if (rangeMatch) {
    return { min: parseInt(rangeMatch[1], 10), max: parseInt(rangeMatch[2], 10) };
  }

  // Minimo: "almeno X pagine" o "at least X pages"
  const minMatch = t.match(/(?:almeno|at least)\s*(\d+)\s*(?:pagine|pages)/);
  if (minMatch) {
    return { min: parseInt(minMatch[1], 10), max: Infinity };
  }

  return null;
}

// Estrae i nomi di file univoci con estensione valida, in ordine di apparizione
export function namedFiles(text) {
  if (!text) return [];
  const t = String(text);
  const exts = ['md', 'markdown', 'txt', 'html', 'htm', 'css', 'js', 'mjs', 'py', 'json', 'csv', 'pdf', 'docx'];
  const extPattern = exts.join('|');
  
  // percorso relativo opzionale + nome + estensione; si scartano i nomi dentro un URL (stessa «parola» con ://)
  const regex = new RegExp(`(?:\\.\\/)?(?:[\\w-]+\\/)*[\\w.-]*\\w\\.(?:${extPattern})\\b`, 'gi');
  const found = [];
  const seen = new Set();
  let match;
  while ((match = regex.exec(t)) !== null) {
    const start = t.slice(0, match.index).search(/\S*$/);
    const endRel = t.slice(match.index).search(/\s/);
    if (t.slice(start, endRel === -1 ? t.length : match.index + endRel).includes('://')) continue;
    const name = match[0].replace(/^\.\//, '');
    if (!seen.has(name)) {
      seen.add(name);
      found.push(name);
    }
  }

  return found;
}

// Verifica il piano contro l'obiettivo e restituisce un array di problemi
export function checkPlan(plan, goal) {
  const problems = [];
  const tasks = parsePlan(plan);

  // a) Nessun task
  if (!tasks || tasks.length === 0) {
    return ["Il piano non ha task."];
  }

  const goalW = goalWords(goal);

  // b) Totale parole insufficiente
  if (goalW > 0) {
    let totalWords = 0;
    for (const task of tasks) {
      totalWords += wordTarget(task.text);
    }
    const threshold = 0.85 * goalW;
    if (totalWords < threshold) {
      problems.push(
        `I task di testo sommano ${totalWords} parole, l'obiettivo ne chiede circa ${goalW}: aggiungi task o alza le lunghezze ("almeno N parole").`
      );
    }
  }

  // c) Parti mancanti dell'obiettivo
  const parts = [
    { goalRegex: /copertin|cover/i, taskRegex: /copertin|cover/i, name: 'la copertina' },
    { goalRegex: /\bpdf\b/i, taskRegex: /\bpdf\b|html_to_pdf/i, name: 'il PDF' },
    { goalRegex: /\bword\b|docx/i, taskRegex: /\bword\b|docx|html_to_word/i, name: 'il documento Word' }
  ];

  for (const part of parts) {
    if (part.goalRegex.test(goal)) {
      const hasTask = tasks.some(t => part.taskRegex.test(t.text));
      if (!hasTask) {
        // pronome: «la» per la copertina, «lo» per il PDF e il documento Word
        const article = part.name.startsWith('il') ? 'lo' : 'la';
        problems.push(`L'obiettivo chiede ${part.name} ma nessun task ${article} prepara: aggiungi un task.`);
      }
    }
  }

  // d) Librerie Python invece di LocalAI
  const libRegex = /\b(fpdf2?|reportlab|weasyprint|pdfkit|xhtml2pdf|python-docx)\b/i;
  for (const task of tasks) {
    const match = task.text.match(libRegex);
    if (match) {
      const lib = match[1];
      const shortText = task.text.substring(0, 60);
      problems.push(
        `Il task «${shortText}» usa ${lib}: usa invece lo strumento html_to_pdf (o html_to_word) con una pagina HTML.`
      );
    }
  }

  // e) Task troppo grandi
  for (const task of tasks) {
    const wt = wordTarget(task.text);
    if (wt > 4500) {
      const shortText = task.text.substring(0, 60);
      problems.push(`Il task «${shortText}» chiede ${wt} parole: dividilo in task da al massimo 4000 parole.`);
    }

    const files = textFiles(task.text);
    if (files.length > 3) {
      const shortText = task.text.substring(0, 60);
      problems.push(`Il task «${shortText}» scrive troppi file: un file per task.`);
    }
  }

  return problems;
}

/**
 * Bozza del piano scritta da un modello locale, controllata con checkPlan e, se ci sono problemi, riscritta una volta
 * con l'elenco dei problemi. run avvolge la chiamata (es. l'arbitro della GPU). Restituisce { plan, problems }.
 */
export async function draftPlan({ goal, files = '', notes = '', model, run = (fn) => fn() }) {
  const ask = (messages) => run(() => ollama.complete({ model, messages, timeout: 300000, options: { temperature: 0.3, num_predict: 5000 } }))
    .then((text) => String(text).replace(/^```(markdown|md)?\s*|```\s*$/g, '').trim());
  const messages = planPrompt(goal, files, notes);
  let plan = await ask(messages);
  let problems = checkPlan(plan, goal);
  if (problems.length) {
    const fixed = await ask([...messages, { role: 'assistant', content: plan },
      { role: 'user', content: `Il controllo automatico ha trovato questi problemi nel piano:\n${problems.map((x) => `- ${x}`).join('\n')}\n\nRiscrivi il piano completo correggendoli, nello stesso formato.` }]);
    const again = checkPlan(fixed, goal);
    if (parsePlan(fixed).length && again.length < problems.length) { plan = fixed; problems = again; }
  }
  return { plan, problems };
}

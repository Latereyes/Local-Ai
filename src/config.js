import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const dataDir = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(root, 'data');

export default {
  root,
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',

  assistantName: env.ASSISTANT_NAME || 'Gemma',

  ollama: {
    url: env.OLLAMA_URL || 'http://127.0.0.1:11434',
    model: env.OLLAMA_MODEL || 'gemma4-12b-uncensored:latest',
    // 128k: misurato su gemma4-12b (10,4 GB, 100% GPU, stessa velocità che a 24k; Gemma usa per lo più attenzione a finestra)
    numCtx: Number(env.OLLAMA_CTX || 131072),
    // Tempo per cui Ollama tiene il modello in VRAM tra un messaggio e l'altro
    keepAlive: env.OLLAMA_KEEP_ALIVE || '30m',
    // Nomi da mostrare nel menu dei modelli (e con cui l'assistente si presenta), per nome Ollama senza ":latest"
    labels: {
      'qwen3.8-coder': 'Qwen Coder',
      'qwen3.8-aggressive': 'Qwen Aggressive',
      'hf.co/HauhauCS/Gemma4-26B-A4B-Uncensored-HauhauCS-Balanced:IQ4_XS': 'Gemma 26B',
    },
    // Contesto per modello quando il Modelfile non lo fissa (misurato sul PC)
    ctx: {
      // Gemma 26B non sta mai tutta in GPU (~11% su CPU): 64k ha la stessa velocità di 16k, oltre rallenta
      'hf.co/HauhauCS/Gemma4-26B-A4B-Uncensored-HauhauCS-Balanced:IQ4_XS': 65536,
    },
  },

  comfy: {
    url: env.COMFY_URL || 'http://127.0.0.1:8188',
  },

  // Arbitro della GPU condiviso con ChatBz: sta nell'agent del PC (remote-app-controller, porta 7070).
  // Se l'agent è spento si usa l'arbitro interno come prima. GPU_ARBITER=0 lo ignora del tutto.
  agent: {
    enabled: (env.GPU_ARBITER ?? '1') !== '0',
    url: env.AGENT_URL || 'http://127.0.0.1:7070',
    token: env.AGENT_TOKEN || '',   // serve solo se l'agent gira su un altro PC
    app: 'localai',
  },

  // Notifiche dei progetti (coda finita, task non riusciti, coordinatore). Nel browser arrivano sempre;
  // NTFY_URL (es. https://ntfy.sh/un-nome-segreto) le manda anche al telefono con l'app ntfy.
  notify: {
    ntfyUrl: env.NTFY_URL || '',
    ntfyToken: env.NTFY_TOKEN || '',
    // indirizzo dell'app per il link nella notifica (es. https://pc.tuo-tailnet.ts.net)
    appUrl: (env.APP_URL || '').replace(/\/$/, ''),
  },

  // Cartella di lavoro (modalità «Computer»): progetti, file e comandi dell'assistente.
  // I file si aprono nel browser da una porta separata, così pagine e giochi creati non toccano l'app.
  workspace: {
    port: Number(env.WORKSPACE_PORT || 3001),
    // Porta HTTPS da cui arrivano i file quando l'app è aperta in HTTPS (tailscale serve --https=8443, vedi README)
    httpsPort: Number(env.WORKSPACE_HTTPS_PORT || 0) || null,
    // Modello usato in modalità Computer quando è selezionato quello predefinito (se installato)
    model: env.WORKSPACE_MODEL ?? 'qwen3.8-coder:latest',
    maxRounds: Number(env.WORKSPACE_MAX_ROUNDS || 16),
    // Tempo massimo per confermare un comando dall'interfaccia, poi viene annullato
    confirmTimeoutMs: Number(env.WORKSPACE_CONFIRM_SECONDS || 300) * 1000,
  },

  // Progetti con coda di task: un task alla volta (un solo modello sta nei 16 GB di VRAM)
  projects: {
    // Modello per tipo di task (dal benchmark in C:\AI\benchmark-delega). Se non è installato o non supporta
    // gli strumenti si usa il modello predefinito.
    models: {
      code: env.TASK_MODEL_CODE || 'qwen3.8-coder:latest',
      page: env.TASK_MODEL_PAGE || 'qwen3.8-coder:latest',
      read: env.TASK_MODEL_READ || 'hf.co/HauhauCS/Gemma4-26B-A4B-Uncensored-HauhauCS-Balanced:IQ4_XS',
      chat: env.TASK_MODEL_CHAT || '',   // vuoto = modello predefinito (OLLAMA_MODEL)
    },
    // Tentativi per task: dopo un test fallito il modello riceve l'errore e corregge, fino a questo numero di giri
    maxAttempts: Number(env.TASK_MAX_ATTEMPTS || 3),
    // Task bloccato: il modello sta lavorando (ha la GPU) ma non arriva niente da questi minuti → si ferma
    stallMinutes: Number(env.TASK_STALL_MINUTES || 15),
    // Tempo massimo di lavoro del modello su un task (contato solo mentre ha la GPU, non nell'attesa)
    maxMinutes: Number(env.TASK_MAX_MINUTES || 45),
    // Coordinatore della coda: interventi automatici per task (dopo un fallimento o un blocco) prima di chiedere all'utente
    coordinatorRuns: Number(env.TASK_COORDINATOR_RUNS || 2),
    testTimeoutMs: Number(env.TASK_TEST_SECONDS || 120) * 1000,
    // Tempo massimo di un passo della verifica della pagina (avvio del server con le librerie da installare,
    // giudizio dello screenshot): oltre si salta il passo e la coda va avanti invece di restare ferma
    checkStepMs: Number(env.TASK_CHECK_STEP_SECONDS || 360) * 1000,
    // Librerie mancanti (numpy, pygame…): la verifica le installa da sola se esistono su PyPI/npm (solo amministratore).
    // TASK_AUTO_INSTALL=0 le lascia da installare a mano (prova Missile Command 2026-10-11: la coda si fermava su numpy)
    autoInstall: !['0', 'false', 'no'].includes(String(env.TASK_AUTO_INSTALL || '').toLowerCase()),
    // Consigli contro i loop (2026-10-19): dopo questi tentativi falliti un altro modello (TASK_ADVICE_MODEL, vuoto =
    // quello per lettura e analisi, Gemma 26B) analizza l'errore e scrive CONSIGLI.md; al massimo TASK_ADVICE_ROUNDS volte per task
    adviceAfter: Number(env.TASK_ADVICE_AFTER || 2),
    adviceRounds: Number(env.TASK_ADVICE_ROUNDS ?? 2),
    adviceModel: env.TASK_ADVICE_MODEL || '',
    // Ciclo di riscrittura: stesso file riscritto intero più di così in un task (o lo stesso contenuto 3 volte) → task fermato
    maxRewrites: Number(env.TASK_MAX_REWRITES || 10),
    // Modello che giudica gli screenshot delle pagine; vuoto = il primo che ha passato la verifica visiva
    visionModel: env.VISION_MODEL || '',
  },

  // Immagini allegate quando il modello della chat non le vede: le descrive un modello Ollama che le legge
  // (verifica visiva del 2026-10-10 sul PC: Gemma 26B, Qwen Coder e qwen35 leggono bene). Gemma 26B è senza
  // censura come Qwen3-VL heretic. Se non è installato si usa il migliore della verifica, poi Qwen3-VL su ComfyUI.
  // DESCRIBE_MODEL=comfy torna a Qwen3-VL su ComfyUI.
  vision: {
    describeModel: env.DESCRIBE_MODEL ?? 'hf.co/HauhauCS/Gemma4-26B-A4B-Uncensored-HauhauCS-Balanced:IQ4_XS',
  },

  search: {
    // Vuoto = DuckDuckGo (nessuna configurazione). Impostando uno dei due si usa quel motore.
    searxngUrl: env.SEARXNG_URL || '',
    braveKey: env.BRAVE_API_KEY || '',
    region: env.SEARCH_REGION || 'it-it',
    maxRounds: Number(env.SEARCH_MAX_ROUNDS || 6),
    // Pagine lette automaticamente dopo la ricerca iniziale
    autoRead: Number(env.SEARCH_AUTO_READ ?? 3),
  },

  paths: {
    workflows: path.join(root, 'workflows'),
    data: dataDir,
    conversations: path.join(dataDir, 'conversations'),
    media: path.join(dataDir, 'media'),
    users: path.join(dataDir, 'users.json'),
    sessions: path.join(dataDir, 'sessions.json'),
    public: path.join(root, 'public'),
    projects: path.join(dataDir, 'projects'),
    workspace: env.WORKSPACE_DIR ? path.resolve(env.WORKSPACE_DIR) : path.join(root, 'workspace'),
  },
};

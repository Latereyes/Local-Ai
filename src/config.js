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

  // Cartella di lavoro (modalità «Computer»): progetti, file e comandi dell'assistente.
  // I file si aprono nel browser da una porta separata, così pagine e giochi creati non toccano l'app.
  workspace: {
    port: Number(env.WORKSPACE_PORT || 3001),
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
    testTimeoutMs: Number(env.TASK_TEST_SECONDS || 120) * 1000,
    // Modello che giudica gli screenshot delle pagine; vuoto = il primo che ha passato la verifica visiva
    visionModel: env.VISION_MODEL || '',
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

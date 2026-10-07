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
    numCtx: Number(env.OLLAMA_CTX || 24576),
    // Tempo per cui Ollama tiene il modello in VRAM tra un messaggio e l'altro
    keepAlive: env.OLLAMA_KEEP_ALIVE || '30m',
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
  },
};

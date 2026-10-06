import os from 'os';
import path from 'path';

const homeDir = os.homedir();

const config = {
  ollama: {
    host: process.env.OLLAMA_HOST || 'http://192.168.1.6:11434',
  },
  comfyui: {
    host: process.env.COMFYUI_HOST || 'http://192.168.1.6:8188',
    workflowPath: process.env.COMFYUI_WORKFLOW || './comfy_api.json',
  },
  search: {
    engine: process.env.SEARCH_ENGINE || 'searxng',
    host: process.env.SEARXNG_HOST || 'http://localhost:8080',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    host: process.env.HOST || '0.0.0.0',
  },
  fileAgent: {
    allowedPaths: [
      path.join(homeDir, 'Documents'),
      path.join(homeDir, 'Desktop'),
      path.join(homeDir, 'Pictures'),
      path.join(homeDir, 'Videos'),
      path.join(homeDir, 'Downloads'),
      path.join(homeDir, 'Documenti'),
      path.join(homeDir, 'Immagini'),
      path.join(homeDir, 'Video'),
    ],
  },
  db: {
    path: process.env.DB_PATH || './data/localai.db',
  },
  images: {
    dir: process.env.IMAGES_DIR || './data/images',
  },
};

export default config;

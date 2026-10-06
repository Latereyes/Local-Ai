import express from 'express';
import config from '../config.js';
import db from '../db/database.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const startTime = Date.now();
  const services = {
    ollama: { status: 'unknown' },
    comfyui: { status: 'unknown' },
    database: { status: 'unknown' }
  };
  let overallStatus = 'ok';

  // Check Ollama
  try {
    const ollamaCtrl = new AbortController();
    const ollamaTimeout = setTimeout(() => ollamaCtrl.abort(), 3000);
    const ollamaRes = await fetch(`${config.ollama.host}/api/tags`, { signal: ollamaCtrl.signal });
    clearTimeout(ollamaTimeout);
    if (ollamaRes.ok) {
      services.ollama.status = 'up';
    } else {
      services.ollama.status = 'down';
      overallStatus = 'degraded';
    }
  } catch (err) {
    services.ollama.status = 'down';
    services.ollama.error = err.message;
    overallStatus = 'degraded';
  }

  // Check ComfyUI
  try {
    const comfyCtrl = new AbortController();
    const comfyTimeout = setTimeout(() => comfyCtrl.abort(), 3000);
    const comfyRes = await fetch(`${config.comfyui.host}/system_stats`, { signal: comfyCtrl.signal });
    clearTimeout(comfyTimeout);
    if (comfyRes.ok) {
      services.comfyui.status = 'up';
    } else {
      services.comfyui.status = 'down';
      overallStatus = 'degraded';
    }
  } catch (err) {
    services.comfyui.status = 'down';
    services.comfyui.error = err.message;
    overallStatus = 'degraded';
  }

  // Check Database
  try {
    const test = db.prepare('SELECT 1').get();
    if (test) {
      services.database.status = 'up';
    } else {
      services.database.status = 'down';
      overallStatus = 'degraded';
    }
  } catch (err) {
    services.database.status = 'down';
    services.database.error = err.message;
    overallStatus = 'degraded';
  }

  if (services.database.status === 'down') {
    overallStatus = 'error'; // Database is critical
  }

  res.status(overallStatus === 'error' ? 503 : 200).json({
    status: overallStatus,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - startTime,
    services
  });
});

export default router;

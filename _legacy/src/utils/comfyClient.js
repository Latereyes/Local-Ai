import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import WebSocket from 'ws';
import config from '../config.js';

const COMFY_BASE = config.comfyui.host;
const COMFY_WS = COMFY_BASE.replace('http://', 'ws://').replace('https://', 'wss://');

/**
 * Generate an image using the ComfyUI workflow
 * @param {string} prompt - The enhanced English prompt for image generation
 * @param {function} onProgress - Callback for progress updates: (value, max) => void
 * @returns {object} { filename, localPath }
 */
export async function generateImage(prompt, onProgress) {
  // 1. Load and clone workflow
  const workflowRaw = fs.readFileSync(config.comfyui.workflowPath, 'utf-8');
  const workflow = JSON.parse(workflowRaw);
  const workflowClone = JSON.parse(JSON.stringify(workflow));

  // 2. Inject prompt into node "42" (CLIPTextEncode)
  if (workflowClone['42']?.inputs) {
    workflowClone['42'].inputs.text = prompt;
  }

  // 3. Randomize seed in node "41" (KSampler)
  if (workflowClone['41']?.inputs) {
    workflowClone['41'].inputs.seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  }

  // 4. Generate client ID
  const clientId = uuidv4();

  // 5. Connect WebSocket for progress tracking
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${COMFY_WS}/ws?clientId=${clientId}`);
    let promptId = null;
    let resolved = false;
    let timeoutHandle = null;

    // Set a 5-minute timeout for the entire generation
    timeoutHandle = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('Timeout generazione immagine (5 minuti)'));
      }
    }, 300000);

    ws.on('open', async () => {
      try {
        // 6. Submit workflow
        const res = await fetch(`${COMFY_BASE}/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: workflowClone,
            client_id: clientId,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          throw new Error(`ComfyUI errore (${res.status}): ${errText}`);
        }

        const result = await res.json();
        promptId = result.prompt_id;

        if (result.node_errors && Object.keys(result.node_errors).length > 0) {
          throw new Error(`Errori nei nodi: ${JSON.stringify(result.node_errors)}`);
        }
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutHandle);
          ws.close();
          reject(err);
        }
      }
    });

    ws.on('message', async (data, isBinary) => {
      // Skip binary messages (preview images)
      if (isBinary) return;

      try {
        const message = JSON.parse(data.toString());

        // 7. Progress updates
        if (message.type === 'progress' && onProgress) {
          onProgress(message.data.value, message.data.max);
        }

        // 8. Execution complete - get image
        if (message.type === 'executing' && message.data.node === null && message.data.prompt_id === promptId) {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeoutHandle);

          try {
            const imageInfo = await getImageFromHistory(promptId);
            if (imageInfo) {
              const localPath = await downloadAndSaveImage(imageInfo);
              ws.close();
              resolve(localPath);
            } else {
              ws.close();
              reject(new Error('Nessuna immagine generata'));
            }
          } catch (err) {
            ws.close();
            reject(err);
          }
        }

        // Handle execution errors
        if (message.type === 'execution_error') {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutHandle);
            ws.close();
            reject(new Error(`Errore ComfyUI: ${message.data.exception_message || 'Errore sconosciuto'}`));
          }
        }
      } catch {
        // Skip unparseable messages
      }
    });

    ws.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutHandle);
        reject(new Error(`WebSocket ComfyUI errore: ${err.message}`));
      }
    });

    ws.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutHandle);
        reject(new Error('Connessione WebSocket ComfyUI chiusa inaspettatamente'));
      }
    });
  });
}

/**
 * Get image info from ComfyUI history
 */
async function getImageFromHistory(promptId) {
  // Wait a moment for history to be updated
  await new Promise((r) => setTimeout(r, 500));

  const res = await fetch(`${COMFY_BASE}/history/${promptId}`);
  if (!res.ok) return null;

  const history = await res.json();
  const promptHistory = history[promptId];
  if (!promptHistory?.outputs) return null;

  // Find the SaveImage node output (node "9")
  for (const nodeId of Object.keys(promptHistory.outputs)) {
    const output = promptHistory.outputs[nodeId];
    if (output.images && output.images.length > 0) {
      return output.images[0]; // { filename, subfolder, type }
    }
  }

  return null;
}

/**
 * Download image from ComfyUI and save locally
 */
async function downloadAndSaveImage(imageInfo) {
  const params = new URLSearchParams({
    filename: imageInfo.filename,
    subfolder: imageInfo.subfolder || '',
    type: imageInfo.type || 'output',
  });

  const res = await fetch(`${COMFY_BASE}/view?${params}`);
  if (!res.ok) throw new Error(`Impossibile scaricare immagine: ${res.status}`);

  const buffer = Buffer.from(await res.arrayBuffer());

  // Save to local images directory
  const imagesDir = config.images.dir;
  if (!fs.existsSync(imagesDir)) {
    fs.mkdirSync(imagesDir, { recursive: true });
  }

  const filename = `${uuidv4()}.png`;
  const localPath = path.join(imagesDir, filename);
  fs.writeFileSync(localPath, buffer);

  return { filename, localPath };
}

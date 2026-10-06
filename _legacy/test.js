import * as ollamaClient from './src/utils/ollamaClient.js';
import * as comfyClient from './src/utils/comfyClient.js';
import * as searchClient from './src/utils/searchClient.js';
import { listDirectory } from './src/agents/fileAgent.js';
import config from './src/config.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

async function runTests() {
  console.log('--- Inizio Test ---');

  // Test 1: Ollama Connection
  console.log('\n[1] Test Connessione Ollama a', config.ollama.host);
  try {
    const models = await ollamaClient.listModels();
    console.log(`✅ Connessione Ollama OK. Modelli trovati: ${models.length}`);
    if (models.length > 0) {
      console.log(`   Modello principale: ${models[0].name}`);
      
      // Test Intent
      console.log('   Test Intent Classification...');
      const intent = await ollamaClient.classifyIntent('Mostrami i file sul mio PC', models[0].name);
      console.log(`   ✅ Intent rilevato: ${intent.intent}`);
    }
  } catch (err) {
    console.error(`❌ Connessione Ollama FALLITA: ${err.message}`);
  }

  // Test 2: ComfyUI Connection
  console.log('\n[2] Test Connessione ComfyUI a', config.comfyui.host);
  try {
    const res = await fetch(config.comfyui.host);
    if (res.ok) {
      console.log('✅ Connessione ComfyUI OK.');
    } else {
      console.log(`❌ Connessione ComfyUI FALLITA con status: ${res.status}`);
    }
  } catch (err) {
    console.error(`❌ Connessione ComfyUI FALLITA: ${err.message}`);
  }

  // Test 3: Web Search
  console.log('\n[3] Test Ricerca Web (DuckDuckGo)');
  try {
    const results = await searchClient.search('Notizie oggi', 2);
    if (results.length > 0) {
      console.log(`✅ Ricerca OK. Trovati ${results.length} risultati.`);
      console.log(`   Primo risultato: ${results[0].title}`);
    } else {
      console.log('⚠️ Nessun risultato trovato.');
    }
  } catch (err) {
    console.error(`❌ Ricerca Web FALLITA: ${err.message}`);
  }

  // Test 4: File Explorer
  console.log('\n[4] Test Esplorazione File');
  try {
    const docsPath = path.join(os.homedir(), 'Documents');
    if (fs.existsSync(docsPath)) {
      const files = listDirectory(docsPath);
      console.log(`✅ File Agent OK. Trovati ${files.length} elementi in ${docsPath}`);
    } else {
      console.log(`⚠️ La directory ${docsPath} non esiste.`);
    }
  } catch (err) {
    console.error(`❌ Esplorazione File FALLITA: ${err.message}`);
  }

  console.log('\n--- Fine Test ---');
}

runTests();

# LocalAI

Assistente AI locale in stile Gemini/Claude: chat con **Gemma** (Ollama) che, su richiesta, genera **immagini e video** con **ComfyUI**. Ollama e ComfyUI condividono la stessa GPU (RTX 4070 Ti Super, 16 GB) e si alternano automaticamente.

## Avvio

```bash
npm install
npm start
```

Oppure doppio clic su `start.bat`. L'interfaccia è su `http://localhost:3000` ed è raggiungibile anche dal telefono, sulla stessa rete, all'indirizzo IP che il server stampa all'avvio.

Requisiti: Node.js 22+, Ollama e ComfyUI sullo stesso PC (porte predefinite). Se girano su un altro PC basta impostare `OLLAMA_URL` e `COMFY_URL`.

## Utenti e accesso

Per entrare servono nome utente e password. Ogni utente vede solo le proprie conversazioni, la propria galleria e i propri file, anche quando prova ad aprirli tramite URL diretto.

| Utente | Ruolo | Primo accesso |
|---|---|---|
| `andrea` | amministratore | password temporanea `1234`, poi ne sceglie una personale |
| `claudia` | utente | password temporanea `1234`, poi ne sceglie una personale |

- Al primo accesso, e dopo ogni reimpostazione, l'app chiede di scegliere una nuova password (almeno 6 caratteri, diversa da `1234`). Finché non lo fai, non è possibile usare nient'altro.
- L'amministratore, da *menu utente → Gestione utenti*, può aggiungere utenti e reimpostare le password. La password temporanea predefinita è `1234`, ma se ne può indicare un'altra. Quando una password viene reimpostata, l'utente viene disconnesso da tutti i dispositivi.
- Chiunque può cambiare la propria password da *menu utente → Cambia password*.
- Le password sono salvate solo come hash scrypt in `data/users.json`. Le sessioni durano 30 giorni (cookie HttpOnly). Dopo 5 tentativi sbagliati di fila l'accesso da quell'IP viene bloccato per un minuto.
- Le chat create prima dell'introduzione dei profili sono state assegnate ad Andrea.
- La GPU è condivisa: se un altro utente sta generando un video, la tua richiesta resta in coda. L'indicatore in alto mostra cosa è in corso, ma non il contenuto degli altri.

## Immagini allegate: lettura, image-to-image, image-to-video

Puoi allegare fino a 4 immagini per messaggio: con la graffetta, trascinandole sulla chat o incollandole (Ctrl+V). Su telefono c'è anche il tasto **fotocamera**, che apre direttamente la fotocamera posteriore. Il browser ridimensiona le foto a 1600 px (JPEG) prima dell'invio e ne corregge l'orientamento.

- **Lettura**: Gemma (`gemma4-12b-uncensored`) non vede le immagini, perché il suo GGUF non ha il modulo visivo. L'immagine viene quindi analizzata da **Qwen3-VL 4B** su ComfyUI (workflow `qwen3vl-vision`), che produce una descrizione completa e trascrive il testo visibile. Gemma risponde partendo da quella descrizione, consultabile nel riquadro «Immagine analizzata». Servono circa 5 s di lettura più lo scambio di VRAM. Se in Ollama userai un modello con capacità `vision` (ad esempio un Gemma 4 ufficiale), le immagini verranno inviate direttamente a lui, senza passare da ComfyUI.
- **Image to image** (`edit_image`): rielabora l'immagine più recente della conversazione (allegata o generata) mantenendone la composizione. Funziona per cambi di stile, atmosfera, luce e colori. Gemma sceglie un'intensità da 0 a 1, che ogni workflow converte nel proprio denoise (`denoiseRange` nel manifest):
  - `krea2-i2i` (predefinito) è il migliore per i cambi di stile;
  - `zimage-i2i` è adatto a ritocchi fotorealistici.

  Con **Qwen-Image-Edit 2511** installato (workflow `qwen-image-edit`), `edit_image` diventa editing a istruzioni: aggiunge, toglie o sostituisce oggetti, cambia sfondo, abiti o testo e mantiene tutto il resto. Può combinare fino a 3 immagini allegate («metti gli occhiali della foto 2 sulla persona della foto 1»). Senza Qwen-Edit si usa la rielaborazione Krea/Z-Image, che non fa modifiche chirurgiche.

  **Installare Qwen-Image-Edit**: il Manager di ComfyUI blocca i download richiesti da un altro PC, per la sua policy di sicurezza. Copia `tools/scarica-qwen-image-edit.ps1` sul PC di ComfyUI e lancialo da PowerShell:

  `powershell -ExecutionPolicy Bypass -File scarica-qwen-image-edit.ps1`

  Lo script scarica circa 30,7 GB in `models/diffusion_models`, `models/text_encoders` e `models/loras`. LocalAI se ne accorge entro 5 minuti, oppure subito con *Gestione utenti → Workflow ComfyUI → Ricarica workflow*. In quel pannello l'amministratore vede quali workflow sono attivi e quali file mancano.
- **Image to video** (`animate_image`, workflow `minimax-h3-i2v`): MiniMax H3 parte esattamente dall'immagine e la anima, con audio. Il formato segue quello dell'immagine (0,4 MP). Una clip di 3 s richiede circa 55 s.
- **Rifinitura dei volti**: dopo ogni modifica con Qwen-Edit, FaceDetailer (Juggernaut XL) ripassa solo i volti a basso denoise. Pelle e occhi diventano più naturali e l'identità resta quella; se nell'immagine non ci sono volti, non cambia nulla.
- **Foto con il tuo volto** (`photo_with_face`, workflow `sdxl-face`): crea una foto nuova con la persona dell'immagine allegata in un'altra scena («mettimi sul cratere di un vulcano»). Il volto viene ritagliato in automatico e passato a IPAdapter Plus Face. L'ho confrontato con IPAdapter FaceID Plus v2 sulla foto di Andrea: Plus Face somiglia di più e dà immagini più pulite, quindi resta quello. FaceID è comunque utilizzabile: insightface è stato riparato con `tools/ripara-insightface.ps1` e `tools/diagnosi-insightface.py --patch`, e la LoRA `ip-adapter-faceid-plusv2_sdxl_lora` è installata.
- **Stessa persona, nuova scena** (`photo_with_face`, sia su foto allegate sia su immagini generate, workflow `qwen-scene-real`): «ora fai una foto realistica di questa persona che fa colazione». Qwen-Image-Edit ricrea la scena con la stessa persona, poi Krea Real dà il look da foto spontanea. Il volto è protetto da una maschera, perché Krea su lentiggini e pelle bagnata creava crepe. Nel confronto ha battuto Plus Face, che si portava dietro sfondo e posa del ritratto. Con più scene di fila si riparte sempre dal ritratto originale, così gli errori non si sommano, e l'istruzione ripete i dettagli distintivi della descrizione (orecchini, tatuaggi, nei…). Da ottobre 2026 vale anche per le foto allegate: `sdxl-face` resta solo come riserva se il workflow non è disponibile. Regola per Gemma: con «questa persona», «lui» o «lei» non usa mai `generate_image`, che creerebbe una persona diversa.
- **Upscale** (`upscale_image`): raddoppia la risoluzione («migliora la qualità», «ingrandisci», «rendila più nitida»). Di default usa `upscale-fedele`, che non ridisegna nulla ed è adatto alle foto vere. Solo per le immagini generate, e se si chiede la massima qualità, usa `sdxl-upscale`, che ridisegna il dettaglio e rifinisce i volti (il testo molto piccolo può venire alterato).
- **Quale immagine**: gli strumenti usano l'immagine più recente, ma Gemma può sceglierne un'altra della chat («ingrandisci la foto che ti ho mandato all'inizio»).

Esempi: allega una foto e chiedi «cosa c'è scritto?», «trasformala in acquerello», «animala: lei si gira e sorride». Funziona anche su immagini appena generate: «ora animala».

## Documenti (PDF, TXT, MD)

Con la graffetta (o trascinando il file) puoi allegare PDF, TXT e MD fino a 60 MB. Il testo viene estratto subito, pagina per pagina, con `pdfjs-dist`, e il documento resta disponibile **per tutta la conversazione**: puoi fare domande successive senza ricaricarlo.

- **Documenti brevi** (fino a circa 40.000 caratteri, ~15 pagine fitte): il testo completo, con i numeri di pagina, viene dato a Gemma a ogni domanda.
- **Documenti lunghi** (libri, manuali): alla prima domanda si crea un riassunto a blocchi. Ogni sezione da circa 16.000 caratteri viene riassunta, poi tutto viene unito in una sintesi generale. Per un libro di 189 pagine servono circa 4 minuti; il riassunto resta salvato. A ogni domanda vengono recuperati la sintesi, i riassunti delle sezioni pertinenti e le pagine originali più rilevanti (ricerca BM25). Se il documento è in un'altra lingua, Gemma genera prima le parole chiave in quella lingua, così le domande in italiano funzionano anche su libri in inglese.
- Il riquadro «Documento consultato» mostra cosa è stato letto e quali pagine sono state usate. Gemma cita le pagine (p. N).
- **Verifica sul web**: chiedi «verifica su internet…». La ricerca usa solo termini generici: le regole del prompt impediscono di mettere nelle query nomi, codici o dati sanitari presenti nei documenti.
- **Referti medici**: valori e intervalli di riferimento vengono spiegati in modo chiaro, senza diagnosi e con il rimando al medico.
- I PDF scansionati, cioè senza testo selezionabile, vengono segnalati ma non letti: l'OCR non è ancora supportato.
- Le formule matematiche (`$...$`, `$$...$$`) vengono visualizzate con KaTeX, servito in locale.

## Ricerca sul web

Gemma può cercare su internet per rispondere con informazioni aggiornate.

1. **Decisione**: prima di ogni risposta, una chiamata breve a Gemma (~0,3–0,7 s) decide se serve una ricerca e scrive la query. Cerca per notizie, prezzi, meteo, versioni, eventi e simili; non cerca per conversazione, codice, scrittura o concetti stabili.
2. **Ricerca + lettura**: se serve, il sistema esegue la ricerca e legge subito le prime 3 pagine (domini diversi, in parallelo). Gemma può poi fare altre ricerche o leggere altre pagine da sé, fino a 6 passaggi.
3. **Risposta**: in cima alla risposta c'è un riquadro con le ricerche e le pagine lette. In fondo compaiono le **fonti** consultate davvero: sono prese dai passaggi eseguiti, non dal testo del modello.

Il pulsante **Cerca** nel composer forza la ricerca. Il motore predefinito è DuckDuckGo, che non richiede configurazione. Per sicurezza le pagine della rete locale (Ollama, ComfyUI, router…) non possono essere lette, e il contenuto delle pagine viene trattato come dato, mai come istruzione.

Variabili d'ambiente utili:

| Variabile | Effetto |
|---|---|
| `SEARXNG_URL` | usa un'istanza SearXNG (es. `http://192.168.1.12:8080`) al posto di DuckDuckGo |
| `BRAVE_API_KEY` | usa Brave Search API (2000 query/mese gratuite) |
| `SEARCH_AUTO_READ` | pagine lette automaticamente dopo la ricerca (default `3`, `0` = solo snippet) |
| `SEARCH_MAX_ROUNDS` | passaggi massimi di ricerca/lettura per risposta (default `6`) |

Se il motore configurato non risponde, si ripiega su DuckDuckGo.

## Configurazione

Si fa con variabili d'ambiente (i default sono in `src/config.js`):

| Variabile | Default |
|---|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `gemma4-12b-uncensored:latest` |
| `OLLAMA_CTX` | `24576` |
| `OLLAMA_KEEP_ALIVE` | `30m` |
| `COMFY_URL` | `http://127.0.0.1:8188` |
| `PORT` / `HOST` | `3000` / `0.0.0.0` |
| `DATA_DIR` | `./data` (conversazioni, media, utenti, sessioni) |
| `ASSISTANT_NAME` | `Gemma` |

## Come funziona

```
Messaggio ─► Gemma (Ollama) ──► risposta in streaming
                 │
                 └─ tool call generate_image / generate_video (descrizione in inglese)
                        │
                        ├─ Gemma riscrive la descrizione con la guida del modello (workflows/<id>/guide.md)
                        ├─ Gemma viene scaricato dalla VRAM
                        └─ ComfyUI esegue il workflow ─► anteprima live, progresso ─► file in data/media
```

- **Alternanza VRAM** (`src/gpu.js`): ogni lavoro passa da un'unica coda. Quando serve ComfyUI, i modelli Ollama vengono scaricati (`keep_alive: 0`). Quando serve di nuovo Gemma, ComfyUI viene svuotato (`/free`) e il server attende che la VRAM risulti libera. Il passaggio avviene solo quando serve: generazioni consecutive non ricaricano i modelli. La pillola in alto a destra mostra chi occupa la GPU e cosa c'è in coda, e permette di liberare la VRAM a mano.
- **Prompt**: il prompt di sistema di Gemma è in `src/prompts.js`. La riscrittura specializzata per ogni modello è in `workflows/<id>/guide.md`.
- **Rigenera / modifica prompt**: dalle schede dei media puoi rigenerare con un nuovo seed, oppure modificare il prompt a mano e rilanciarlo, senza passare da Gemma.
- **Dati**: le conversazioni sono salvate in `data/conversations/*.json`, i media generati in `data/media/<id utente>/`.

## Workflow inclusi

| Cartella | Tipo | Modello | Note |
|---|---|---|---|
| `zimage-turbo` | immagine | `zitRemix_realityV2` | default, fotorealismo, circa 5 s di sampling |
| `krea2-turbo` | immagine | `krea2Turbo_v10` + LoRA `Krea2_TextFusion_Refusal_Reduction` | estetica e tipografia |
| `krea2-real` | immagine | Krea 2 Turbo + LoRA `realism_engine_krea2` (0.7) + `lenovo_krea2` (1.2) | foto realistiche dal look amatoriale, senza effetto CGI |
| `sdxl-juggernaut` | immagine | Juggernaut XL + FaceDetailer | look cinematografico/reflex: ritratti, reportage, notte (niente testo leggibile) |
| `reflex-real` | immagine | Juggernaut XL + FaceDetailer, poi Krea Real a denoise 0.22 | catena a due motori: foto da reflex "sporcata" con grana e imperfezioni da scatto vero (~30-50 s) |
| `minimax-h3-t2v` | video | MiniMax H3 int8 + LoRA turbo 8 step + SageAttention + LoRA VBVR Pro, Unlocked V2, Mystic V4 | text-to-video con audio, 0.4 MP, 2–10 s (5 s ≈ 90 s di generazione) |
| `minimax-h3-i2v` | video (img2video) | come sopra + SageAttention + LoRA VBVR Pro, Unlocked V2, Mystic V4 + immagine iniziale | anima un'immagine allegata o generata |
| `krea2-i2i` | immagine (img2img) | Krea 2 Turbo | default per rielaborare immagini (cambi di stile) |
| `zimage-i2i` | immagine (img2img) | Z-Image Turbo | ritocchi fotorealistici |
| `qwen-image-edit` | immagine (edit) | Qwen-Image-Edit 2511 int8 + Lightning 4 step, poi FaceDetailer con Juggernaut XL (solo volti, denoise 0.35) | editing a istruzioni, fino a 3 immagini, ~30 s |
| `sdxl-face` | immagine (identity) | Juggernaut XL + IPAdapter Plus Face (volto ritagliato con YOLO) + FaceDetailer | foto nuova con il volto della persona allegata, ~25 s |
| `qwen-scene-real` | immagine (scene) | Qwen-Image-Edit 2511 (+ FaceDetailer) → Krea Real i2i 0.3 / 12 step, con il volto originale rimesso tramite maschera YOLO sfumata | stessa persona di un'immagine generata in una nuova scena, ~55 s |
| `sdxl-upscale` | immagine (upscale) | Ultimate SD Upscale 2x (4x-UltraSharp + Juggernaut XL, denoise 0.15) + FaceDetailer | «massima qualità» sulle immagini generate: ridisegna il dettaglio fine, ~35–75 s |
| `upscale-fedele` | immagine (upscale, predefinito) | 4x-UltraMix_Restore, ridotto a 2x | ingrandimento fedele senza ridisegno, adatto a foto vere anche mosse o compresse, ~5 s |
| `qwen3vl-vision` | vision | Qwen3-VL 4B (`TextGenerate`) | lettura/descrizione delle immagini allegate |

Questi workflow sono stati ricostruiti in formato API sui modelli e sui nodi **effettivamente installati** su ComfyUI. Alcuni file citati dai JSON originali non sono presenti sul server (per esempio `z_image_turbo_bf16`, il loader int8 di Krea e lo scheduler Krea custom). I JSON originali sono conservati in `workflows/_originali/`.

## Aggiungere un nuovo workflow

1. In ComfyUI: *Workflow → Export (API)* e salva il file come `workflows/<id>/workflow.json`.
2. Crea `workflows/<id>/manifest.json`:

```json
{
  "id": "mio-modello",
  "name": "Nome visibile",
  "type": "image",
  "description": "Quando sceglierlo (questa frase la legge anche Gemma)",
  "resolution": { "megapixels": 1.0, "multiple": 16 },
  "params": {
    "prompt": [{ "node": "6", "input": "text" }],
    "width":  [{ "node": "5", "input": "width" }],
    "height": [{ "node": "5", "input": "height" }],
    "seed":   [{ "node": "3", "input": "seed" }]
  }
}
```

   Per i video aggiungi `"type": "video"`, il blocco `"duration"` e il parametro `"frames"`; usa `minimax-h3-t2v` come esempio. Per i workflow che partono da un'immagine aggiungi `"mode": "img2img"` oppure `"img2video"` e il parametro `"image"` (il nodo `LoadImage`). Per img2img aggiungi anche `"denoise"`, `"denoiseRange"` e `"base"` (l'id del workflow testo→immagine corrispondente); vedi `krea2-i2i` e `minimax-h3-i2v`.
3. (Facoltativo) Aggiungi `guide.md` con le istruzioni di prompting specifiche del modello.
4. Riavvia il server, oppure chiama `POST /api/workflows/reload`.

Le cartelle che iniziano con `_` vengono ignorate.

## Struttura

```
server.js            API REST + eventi SSE
src/
  auth.js            utenti, password (scrypt), sessioni, permessi
  gpu.js             arbitro della VRAM (Ollama ⇄ ComfyUI)
  ollama.js          client Ollama (streaming, tool, scaricamento modelli)
  comfy.js           client ComfyUI (coda, WebSocket, anteprime, /free)
  chat.js            orchestrazione di un turno (ricerca → LLM → tool → prompt → coda)
  jobs.js            generazioni su ComfyUI + bus eventi
  prompts.js         prompt di sistema, tool, router di ricerca e prompt engineer
  search.js          ricerca web (DuckDuckGo/SearXNG/Brave) e lettura pagine
  documents.js       PDF/TXT: estrazione testo, riassunto map-reduce, recupero passaggi (BM25)
  workflows.js       registro dei workflow e iniezione dei parametri
  store.js           salvataggio delle conversazioni
public/              interfaccia (HTML/CSS/JS, senza build)
workflows/           workflow ComfyUI (API) + manifest + guide
_legacy/             vecchia versione del progetto (si può eliminare)
```

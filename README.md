# LocalAI

Assistente AI locale in stile Gemini/Claude: chat con **Gemma** (Ollama) che, su richiesta, genera **immagini e video** con **ComfyUI**. Ollama e ComfyUI condividono la stessa GPU (RTX 4070 Ti Super, 16 GB) e si alternano automaticamente.

## Avvio

```bash
npm install
npm start
```

Oppure doppio clic su `start.bat`. L'interfaccia è su `http://localhost:3000` ed è raggiungibile anche dal telefono, sulla stessa rete, all'indirizzo IP che il server stampa all'avvio.

Requisiti: Node.js 22+, Ollama e ComfyUI sullo stesso PC (`127.0.0.1`, porte predefinite); per usarli da un altro PC imposta `OLLAMA_URL` e `COMFY_URL`.

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

- **Lettura**: Gemma (`gemma4-12b-uncensored`) non vede le immagini, perché il suo GGUF non ha il modulo visivo. Da ottobre 2026 l'immagine la descrive **Gemma 26B** (HauhauCS, senza censura), che nella verifica visiva ha letto giusto: descrizione completa e testo visibile trascritto, consultabile nel riquadro «Immagine analizzata» con il nome del modello. Se Gemma 26B non è installato si usa il modello scelto dalla verifica visiva; se manca anche quello, o la lettura non riesce, si torna a **Qwen3-VL 4B** su ComfyUI (workflow `qwen3vl-vision`). Si cambia con `DESCRIBE_MODEL` (un nome Ollama, oppure `comfy` per Qwen3-VL). Con un modello della chat che vede (Qwen Coder, qwen35, Gemma 26B) le immagini vanno direttamente a lui.
- **Il prompt delle modifiche guarda la foto**: se il modello della chat vede le immagini, quando prepara l'istruzione per Qwen-Edit (o per Krea/Z-Image, o per i video da foto) riceve anche la foto di partenza. Così nomina la persona, il capo o l'oggetto giusto, con il colore e la posizione veri, invece di fidarsi solo della descrizione.
- **Image to image** (`edit_image`): rielabora l'immagine più recente della conversazione (allegata o generata) mantenendone la composizione. Funziona per cambi di stile, atmosfera, luce e colori. Gemma sceglie un'intensità da 0 a 1, che ogni workflow converte nel proprio denoise (`denoiseRange` nel manifest):
  - `krea2-i2i` (predefinito) è il migliore per i cambi di stile;
  - `zimage-i2i` è adatto a ritocchi fotorealistici.

  Con **Qwen-Image-Edit 2511** installato (workflow `qwen-image-edit`), `edit_image` diventa editing a istruzioni: aggiunge, toglie o sostituisce oggetti, cambia sfondo, abiti o testo e mantiene tutto il resto. Può combinare fino a 3 immagini allegate («metti gli occhiali della foto 2 sulla persona della foto 1»). Senza Qwen-Edit si usa la rielaborazione Krea/Z-Image, che non fa modifiche chirurgiche.

  **Installare Qwen-Image-Edit**: il Manager di ComfyUI blocca i download richiesti da LocalAI, per la sua policy di sicurezza. Lancia `tools/scarica-qwen-image-edit.ps1` da PowerShell:

  `powershell -ExecutionPolicy Bypass -File scarica-qwen-image-edit.ps1`

  Lo script scarica circa 30,7 GB in `models/diffusion_models`, `models/text_encoders` e `models/loras`. LocalAI se ne accorge entro 5 minuti, oppure subito con *Gestione utenti → Workflow ComfyUI → Ricarica workflow*. In quel pannello l'amministratore vede quali workflow sono attivi e quali file mancano.
- **Image to video** (`animate_image`, workflow `minimax-h3-i2v`): MiniMax H3 parte esattamente dall'immagine e la anima, con audio. Il formato segue quello dell'immagine (0,7 MP, 6 passi: valori misurati su ChatBz il 2026-10-09, con 0,4 MP le mani nei movimenti uscivano sfocate e doppie), fino a 15 s.
- **Video lunghi e «Continua»** (da ChatBz, provati sul PC il 2026-10-10): fino a 15 s il video è un pezzo solo; da 16 a 30 s («un video di 20 secondi», o il menu «Durata») si fa in pezzi da 10 s. Ogni pezzo carica il precedente, usa gli ultimi 22 fotogrammi e il loro audio come guida (`MiniMaxH3AddGuide`), genera il seguito e lo incolla in coda: ogni pezzo salva il video intero fin lì («parte 2/3 · 20 s»). Sotto ogni video finito c'è **Continua**: chiede cosa succede dopo e quanti secondi aggiungere (2-10). Servono i nodi recenti di ComfyUI (`LoadVideo`, `GetVideoComponents`, `ImageFromBatch`, `ImageBatch`, `AudioConcat`, `TrimAudioDuration`; su ChatBz ComfyUI 0.39.0 li ha); senza `MiniMaxH3AddGuide` il pezzo parte solo dall'ultimo fotogramma (giunzione meno fluida). Codice in `src/videochain.js`.
- **Rifinitura dei volti**: dopo ogni modifica con Qwen-Edit, FaceDetailer (Juggernaut XL) ripassa solo i volti a basso denoise. Pelle e occhi diventano più naturali; se nell'immagine non ci sono volti, non cambia nulla.
- **Volto originale invariato** (ottobre 2026, dalla tecnica dei ritocchi di ChatBz): Qwen ridisegna tutta la foto e il FaceDetailer ridisegna il volto, quindi la persona cambiava un po'. Ora, dopo la modifica, YOLO (`face_yolov8m`) cerca i volti nella foto di partenza e in quella modificata: dove un volto è rimasto nello stesso punto (il riquadro coincide almeno al 90%) si rimettono i pixel originali con una maschera sfumata, come nel workflow `qwen-scene-real`. Un volto spostato o sparito non si tocca, per non sdoppiarlo. Non si fa quando la richiesta riguarda viso, espressione, capelli, trucco, età, cappello od occhiali, oppure luce o stile di tutta la foto («fallo sorridere», «rendila di notte», «in stile anime»): lo decidono le parole del messaggio (italiano e inglese, `src/faces.js`) e il parametro `keep_face` che Gemma può mettere a false. Sotto la foto compare «volto originale». Se ComfyUI rifiuta i nodi (Impact Pack diverso), la modifica si rifà come prima e il log lo scrive. Valori in `KEEP_FACE` (`src/faces.js`).
- **Foto con il tuo volto** (`photo_with_face`, workflow `sdxl-face`): crea una foto nuova con la persona dell'immagine allegata in un'altra scena («mettimi sul cratere di un vulcano»). Il volto viene ritagliato in automatico e passato a IPAdapter Plus Face. L'ho confrontato con IPAdapter FaceID Plus v2 sulla foto di Andrea: Plus Face somiglia di più e dà immagini più pulite, quindi resta quello. FaceID è comunque utilizzabile: insightface è stato riparato con `tools/ripara-insightface.ps1` e `tools/diagnosi-insightface.py --patch`, e la LoRA `ip-adapter-faceid-plusv2_sdxl_lora` è installata.
- **Stessa persona, nuova scena** (`photo_with_face`, sia su foto allegate sia su immagini generate, workflow `qwen-scene-real`): «ora fai una foto realistica di questa persona che fa colazione». Qwen-Image-Edit ricrea la scena con la stessa persona, poi Krea Real dà il look da foto spontanea. Il volto è protetto da una maschera, perché Krea su lentiggini e pelle bagnata creava crepe. Nel confronto ha battuto Plus Face, che si portava dietro sfondo e posa del ritratto. Con più scene di fila si riparte sempre dal ritratto originale, così gli errori non si sommano, e l'istruzione ripete i dettagli distintivi della descrizione (orecchini, tatuaggi, nei…). Da ottobre 2026 vale anche per le foto allegate: `sdxl-face` resta solo come riserva se il workflow non è disponibile. Regola per Gemma: con «questa persona», «lui» o «lei» non usa mai `generate_image`, che creerebbe una persona diversa.
- **Due persone insieme** (`photo_with_face` con due foto allegate, workflow `qwen-duo-real`, da ChatBz): «fai una foto di noi due al bar». Qwen-Image-Edit mette le persone delle due foto nella stessa scena nuova (vestiti nuovi, non quelli delle foto), poi Krea Real dà il look da foto spontanea con i volti protetti dalla maschera YOLO. Circa 60 s.
- **Upscale** (`upscale_image`): raddoppia la risoluzione («migliora la qualità», «ingrandisci», «rendila più nitida»). Di default usa `upscale-fedele`, che non ridisegna nulla ed è adatto alle foto vere. Solo per le immagini generate, e se si chiede la massima qualità, usa `sdxl-upscale`, che ridisegna il dettaglio e rifinisce i volti (il testo molto piccolo può venire alterato).
- **Quale immagine**: gli strumenti usano l'immagine più recente, ma Gemma può sceglierne un'altra della chat («ingrandisci la foto che ti ho mandato all'inizio»).

Esempi: allega una foto e chiedi «cosa c'è scritto?», «trasformala in acquerello», «animala: lei si gira e sorride». Funziona anche su immagini appena generate: «ora animala».

## Musica ed effetti sonori

LocalAI crea musica ed effetti sonori con ComfyUI, sulla stessa GPU e con la stessa coda di foto e video. Non serve Pinokio né un'altra app: i nodi audio sono già nel ComfyUI del PC.

- **Musica** (`generate_music`, workflow `acestep15-music`): brani strumentali o canzoni con voce, con BPM e tonalità. Il testo lo scrive Gemma, nella lingua che chiedi. Esempi: «fammi una base chiptune per un gioco tipo Tetris», «una canzone pop in italiano sull'estate, voce femminile».
- **Effetti sonori** (`generate_sound_effect`, workflow `stable-audio3-sfx`): colpi, esplosioni, passi, suoni di interfaccia o da videogioco, ambienti, singole note di strumenti, da 1 a 30 s. Esempi: «il suono di una moneta raccolta, stile arcade», «pioggia su un tetto di lamiera, 20 secondi».
- **Dalla tua melodia** (`generate_music` con `melody`, workflow `acestep15-melody`): premi il tasto **microfono** nel composer, canticchia o fischietta la melodia (fino a 60 s) e premi stop. Poi scrivi che brano vuoi, per esempio «fanne un pezzo rock con le chitarre», «un piano malinconico» o «una canzone pop con un testo sull'estate». Se mandi solo la melodia, Gemma sceglie lo stile da sé. ACE-Step la usa in modalità *cover* (nodo `ReferenceTimbreAudio`): prende melodia e ritmo dalla registrazione e li arrangia nello stile chiesto.
  - Il server stima tonalità e tempo della registrazione (`src/melody.js`, altezza delle note con YIN e profili tonali di Krumhansl) e li passa ad ACE-Step, così i metadati non contraddicono la melodia. Toglie anche i silenzi all'inizio e alla fine e normalizza il volume.
  - La durata predefinita è quella della melodia (almeno 10 s). Per un brano più lungo la melodia viene ripetuta, perché oltre la fine della registrazione ACE-Step produrrebbe silenzio.
  - Il microfono nel browser funziona su `http://localhost` e in HTTPS. Dal telefono serve l'indirizzo HTTPS di Tailscale (vedi *HTTPS con Tailscale* più sotto). Con l'indirizzo `http://192.168…` il browser non lo concede: il tasto apre allora il registratore del telefono o la scelta di un file audio. Una nota vocale va bene, e si può allegare un file audio anche con la graffetta.
  - Serve un ComfyUI con il nodo `ReferenceTimbreAudio` (sperimentale, nelle versioni con ACE-Step 1.5). Se manca, il tasto non compare e all'avvio LocalAI lo segnala tra i workflow non disponibili: basta aggiornare ComfyUI. I modelli sono gli stessi della musica.
  - Ascolta il risultato con un po' di pazienza: la modalità cover è sperimentale. Il timbro della registrazione può affiorare, quindi conviene nominare lo strumento che suona la melodia (Gemma lo fa da sé). Se il risultato non convince, **Riprova** usa un altro seed.
- In chat compare un lettore audio con la durata, i BPM e la tonalità. Il testo della canzone si apre sotto il lettore e il file si scarica in MP3.
- **Modalità Computer e Progetti** (`create_audio_file`): l'assistente crea i file MP3 direttamente nella cartella del gioco o del sito (es. `tetris/audio/musica.mp3`, `tetris/audio/riga.mp3`). Nello stesso turno scrive il codice che li usa. I file vengono generati alla fine del turno, quando la chat lascia la GPU, e si ascoltano dal riquadro delle azioni. Nei progetti la verifica del task parte quando i file ci sono già.

**Installare i modelli**: lancia `tools/scarica-audio.ps1` da PowerShell sul PC di ComfyUI:

`powershell -ExecutionPolicy Bypass -File scarica-audio.ps1`

Lo script scarica circa 19 GB: ACE-Step 1.5 Turbo per la musica (9,3 GB) e Stable Audio 3 Medium per gli effetti (9,7 GB). Con `-Cosa musica` o `-Cosa effetti` scarichi solo una parte. LocalAI se ne accorge entro 5 minuti, oppure subito con *Gestione utenti → Workflow ComfyUI → Ricarica workflow*. Senza i modelli, gli strumenti audio non vengono proposti.

## Documenti (PDF, TXT, MD)

Con la graffetta (o trascinando il file) puoi allegare PDF, TXT e MD fino a 60 MB. Il testo viene estratto subito, pagina per pagina, con `pdfjs-dist`, e il documento resta disponibile **per tutta la conversazione**: puoi fare domande successive senza ricaricarlo.

- **Documenti brevi** (fino a circa 40.000 caratteri, ~15 pagine fitte): il testo completo, con i numeri di pagina, viene dato a Gemma a ogni domanda. Con i modelli a contesto più piccolo il limite scende: oltre, il documento viene trattato come lungo.
- **Documenti lunghi** (libri, manuali): alla prima domanda si crea un riassunto a blocchi. Ogni sezione da circa 16.000 caratteri viene riassunta, poi tutto viene unito in una sintesi generale. Per un libro di 189 pagine servono circa 4 minuti; il riassunto resta salvato. I documenti oltre circa 90.000 caratteri (~30k token) e fino a ~330.000 li legge invece **interi LFM2.5** (`hf.co/LiquidAI/LFM2.5-24B-A2B-GGUF:QAD-Q4_0`, 128k di contesto), se è installato: in una sola richiesta scrive la sintesi e i riassunti delle sezioni, partendo dal testo completo invece che dai riassunti dei pezzi. A queste lunghezze è 2–2,5× più veloce di Gemma 26B e resta quasi tutto in VRAM; sui testi brevi è più lento, per questo sotto la soglia resta il riassunto a blocchi. Se nella sua risposta manca qualche sezione, quelle si riassumono a blocchi con il modello della chat; se la richiesta non riesce si torna al riassunto a blocchi completo. LFM2.5 ragiona sempre, anche con il ragionamento spento: LocalAI gli lascia almeno 16.384 token di risposta (`config.ollama.minPredict`), altrimenti il ragionamento si mangia la risposta. Si cambia con `DOC_LONG_MODEL` (vuoto lo spegne) e `DOC_LONG_MIN_CHARS`. A ogni domanda vengono recuperati la sintesi, i riassunti delle sezioni pertinenti e le pagine originali più rilevanti (ricerca BM25). Se il documento è in un'altra lingua, Gemma genera prima le parole chiave in quella lingua, così le domande in italiano funzionano anche su libri in inglese.
- Il riquadro «Documento consultato» mostra cosa è stato letto e quali pagine sono state usate. Gemma cita le pagine (p. N).
- **Verifica sul web**: chiedi «verifica su internet…». La ricerca usa solo termini generici: le regole del prompt impediscono di mettere nelle query nomi, codici o dati sanitari presenti nei documenti.
- **Referti medici**: valori e intervalli di riferimento vengono spiegati in modo chiaro, senza diagnosi e con il rimando al medico.
- I PDF scansionati, cioè senza testo selezionabile, vengono segnalati ma non letti: l'OCR non è ancora supportato.
- Le formule matematiche (`$...$`, `$$...$$`) vengono visualizzate con KaTeX, servito in locale.

## Codice con Qwen Coder

Per scrivere e correggere codice puoi passare a **Qwen Coder** (Qwen3.8 27B Uncensored di orcarouter, quantizzazione `IQ3_M`, circa 14 GB) dal menu dei modelli in alto. Gemma resta il modello predefinito; la scelta vale per i messaggi successivi e si può cambiare in qualsiasi momento.

**Installazione**: sul PC di Ollama lancia `tools/installa-qwen-coder.ps1` da PowerShell:

`powershell -ExecutionPolicy Bypass -File installa-qwen-coder.ps1`

Lo script:
- toglie il Qwen installato in precedenza (anche la vecchia Unsloth `UD-Q3_K_XL`);
- scarica `orcarouter/Qwen3.8-27B-Uncensored:iq3_m` dalla libreria di Ollama e crea il modello `qwen3.8-coder` da `tools/qwen-coder.Modelfile`, poi toglie il nome scaricato (i file restano), così nel menu c'è un solo Qwen;
- imposta tutti i layer in GPU (`num_gpu 999`) e 48k di contesto (`num_ctx 49152`);
- attiva per Ollama `OLLAMA_FLASH_ATTENTION=1` e `OLLAMA_KV_CACHE_TYPE=q8_0`, che dimezzano la memoria del contesto. Sono impostazioni del server Ollama, quindi valgono anche per Gemma, e valgono solo per un Ollama avviato dopo lo script: riavvia Ollama, o l'agent del PC se è lui ad avviarlo.

Misurato sulla 4070 Ti Super (ottobre 2026), con la KV cache ancora in f16: 100% in GPU, ~40 token/s in scrittura e ~1.500 token/s in lettura del prompt, ~6 s di caricamento a freddo. Con un prompt di 13.000 token a 16k la VRAM arriva a 15,2 GB su 16,4. Questo modello ha pochi strati di attenzione piena, quindi il contesto costa poco: da 12k a 16k servono solo ~140 MB in più. Il `q3_K_L` (~15 GB) lascerebbe invece troppo poco margine, per questo si usa `iq3_m`. Dopo un messaggio, `ollama ps` deve indicare `100% GPU`; se una parte finisce su CPU, abbassa `num_ctx` nel Modelfile a 32768 e rilancia lo script. Con flash attention e KV cache q8_0 (10 ottobre 2026), sempre 100% in GPU e ~41 token/s: 24k 15,0 GB, 32k 15,3 GB, 40k 15,6 GB su 16,0, con ~1,4 GB occupati dal desktop. Restano ~390 MB liberi, quindi se altri programmi usano più VRAM conviene scendere a 32k. Rimisurato il 22 ottobre 2026 (Ollama 0.40.8) a contesto pieno, contando tutta la VRAM del PC: 40k 14,8 GB, 48k 15,1 GB, 56k 15,4 GB, 64k 15,65 GB. Il Modelfile ora usa **48k**, con ~0,55 GB di margine. Oltre ~15,65 GB il driver riversa nella RAM condivisa e il modello rallenta, ma con `num_gpu 999` `ollama ps` dice comunque `100% GPU`: il riversamento si vede solo dai contatori di Windows (`\GPU Adapter Memory(*)\Shared Usage`). Se la RAM condivisa sale mentre Qwen lavora, torna a 40960 nel Modelfile e rilancia lo script. Ogni passaggio Gemma ⇄ Qwen scarica un modello per caricare l'altro (non stanno insieme in VRAM).

LocalAI usa il `num_ctx` del Modelfile al posto di `OLLAMA_CTX` per quel modello e dimensiona tutto su quello (vedi *Finestra di contesto* più sotto): documenti, pagine web e cronologia hanno lo spazio di quella finestra, e la richiesta non supera mai la finestra. Il nome mostrato nel menu, e con cui il modello si presenta, è in `config.ollama.labels` (`src/config.js`). Il menu elenca solo i modelli per cui Ollama riconosce i tool; se Qwen Coder non compare, aggiorna Ollama e rilancia lo script, che in quel caso lo segnala. Questo Qwen ha anche la capacità `vision`: con Qwen Coder selezionato le immagini allegate vanno direttamente a lui, senza passare da Qwen3-VL su ComfyUI.

### Secondo Qwen: Qwen Aggressive

Nel menu c'è anche **Qwen Aggressive** (`qwen3.8-aggressive`): Qwen3.8 27B Uncensored Aggressive di HauhauCS, quantizzazione `Q3_K_P` (~13,4 GB). Si installa con `tools/installa-qwen-aggressive.ps1`, che scarica il GGUF da Hugging Face, ne controlla lo SHA256 con il file `SHA256SUMS` del repo, crea il modello da `tools/qwen-aggressive.Modelfile` e poi cancella il file scaricato. `ollama pull hf.co/…:Q3_K_P` non funziona: `K_P` è una quantizzazione personalizzata e Hugging Face non la offre come tag per Ollama.

Misurato sulla 4070 Ti Super (ottobre 2026): 100% in GPU con 16k di contesto, 14,9 GB su 16,4, ~37 token/s. Tool e ragionamento sì, visione no (il file `mmproj` non è incluso). Nei test di codice è andato peggio di Qwen Coder: su un parser di date Python ha passato 8 test su 12 contro 11 su 11; JavaScript ed Express erano corretti. Per il codice resta consigliato Qwen Coder.

## Ricerca sul web

Gemma può cercare su internet per rispondere con informazioni aggiornate.

1. **Decisione**: prima di ogni risposta, una chiamata breve a Gemma (~0,3–0,7 s) decide se serve una ricerca e scrive la query. Cerca per notizie, prezzi, meteo, versioni, eventi e simili; non cerca per conversazione, codice, scrittura o concetti stabili.
2. **Ricerca + lettura**: se serve, il sistema esegue la ricerca e legge subito le prime 3 pagine (domini diversi, in parallelo). Gemma può poi fare altre ricerche o leggere altre pagine da sé, fino a 6 passaggi, finché c'è spazio nella finestra di contesto. Di ogni pagina entra solo quanto ci sta (da ~1.000 a 6.000 caratteri, secondo il modello e lo spazio rimasto): se è più lunga si tengono l'inizio e i paragrafi più pertinenti alla domanda (BM25), non solo l'inizio.
3. **Risposta**: in cima alla risposta c'è un riquadro con le ricerche e le pagine lette. In fondo compaiono le **fonti** consultate davvero: sono prese dai passaggi eseguiti, non dal testo del modello.

Il pulsante **Cerca** nel composer forza la ricerca. Il motore predefinito è DuckDuckGo, che non richiede configurazione. Per sicurezza le pagine della rete locale (Ollama, ComfyUI, router…) non possono essere lette, e il contenuto delle pagine viene trattato come dato, mai come istruzione.

Variabili d'ambiente utili:

| Variabile | Effetto |
|---|---|
| `SEARXNG_URL` | usa un'istanza SearXNG (es. `http://127.0.0.1:8080`) al posto di DuckDuckGo |
| `BRAVE_API_KEY` | usa Brave Search API (2000 query/mese gratuite) |
| `SEARCH_AUTO_READ` | pagine lette automaticamente dopo la ricerca (default `3`, `0` = solo snippet) |
| `SEARCH_MAX_ROUNDS` | passaggi massimi di ricerca/lettura per risposta (default `6`) |

Se il motore configurato non risponde, si ripiega su DuckDuckGo.

## Modalità Computer: progetti e comandi sul PC

Con il tasto **Computer** nel composer l'assistente lavora in una cartella del PC: crea pagine web, piccoli giochi per il browser (per esempio un Tetris), script, documenti PDF e Word, e può eseguire comandi. La modalità resta attiva per tutta la conversazione e funziona anche da telefono, in casa o da fuori con Tailscale, come il resto dell'app.

- **Cartella di lavoro**: `workspace\<utente>\` dentro LocalAI, con una sottocartella per progetto (`tetris\`, `sito\`…). Il modello scrive, legge ed elimina file solo lì: i percorsi con `..`, quelli assoluti e i collegamenti che puntano fuori vengono rifiutati.
- **Aprire i file**: sotto la risposta compaiono i file creati con i link **Apri** e **Scarica**. La voce **Progetti** nella barra laterale elenca le cartelle, con i loro file (vedi sotto). Pagine e giochi vengono serviti dalla porta `3001`, un'origine diversa dall'app: girano liberamente (anche con `localStorage`) ma non possono leggere chat o dati di LocalAI. Il link contiene un codice personale dell'utente, quindi si apre anche da un altro dispositivo senza fare l'accesso.
- **PDF e Word**: l'assistente scrive una pagina HTML e la converte. Il PDF si crea stampando la pagina con Edge (o Chrome) in modalità headless. Il Word usa Microsoft Word se è installato, altrimenti un convertitore interno che gestisce titoli, paragrafi, grassetto e corsivo, elenchi e tabelle.
- **Comandi** (solo per gli amministratori): partono da `cmd.exe` nella cartella di lavoro, con un limite di 2 minuti. I comandi di sola lettura (`dir`, `type`, `tasklist`, `systeminfo`, `ipconfig`, `ping`, `nvidia-smi`, `node -v`, `git status`…) senza percorsi esterni partono subito. Tutti gli altri, compreso l'avvio degli script creati, si fermano su una scheda **Esegui / Annulla** nella chat. Senza risposta entro 5 minuti il comando viene annullato. Mentre aspetta la conferma, la chat tiene occupata la GPU.
- **Modello**: in modalità Computer, se nel menu è selezionato il modello predefinito, si usa **Qwen Coder** (`qwen3.8-coder`), che nel benchmark scrive il codice migliore. Se scegli a mano un altro modello, si usa quello.

| Variabile | Default |
|---|---|
| `WORKSPACE_DIR` | `./workspace` |
| `WORKSPACE_PORT` | `3001` (server dei file creati) |
| `WORKSPACE_MODEL` | `qwen3.8-coder:latest` (vuoto = usa sempre il modello scelto nel menu) |
| `WORKSPACE_MAX_ROUNDS` | `16` (azioni massime per risposta) |
| `WORKSPACE_CONFIRM_SECONDS` | `300` |
| `PDF_BROWSER` | percorso di Edge/Chrome, se non è nella posizione standard |

## Progetti: piano, coda di task e verifica automatica

La voce **Progetti** nella barra laterale apre i progetti: ognuno è una cartella della cartella di lavoro (`workspace\<utente>\<progetto>\`) con un piano, una coda di task e la cronologia. Le cartelle create in chat con **Computer** compaiono anche qui. L'elenco è in ordine di **ultima modifica**, la più recente in alto: conta sia il lavoro della coda sia l'ultimo file cambiato nella cartella, anche a mano.

- **Apri** capisce che cosa è il progetto:
  - una **pagina o un gioco** (`index.html`) si apre come prima dal server dei file;
  - un **server web** (Flask, FastAPI, `http.server` o un altro server Python, Node con express o `http`) viene **avviato sul PC**: LocalAI lancia il file giusto (es. `python app.py`, oppure `python -m flask --app app run` se il file non si avvia da solo), installa prima le librerie mancanti che esistono, aspetta la porta che il server apre davvero e apre `http://<indirizzo da cui usi l'app>:<porta>/`. Dal telefono con Tailscale è quindi l'indirizzo Tailscale del PC. Se il server ascolta solo su `127.0.0.1` (Flask di serie), LocalAI gira la stessa porta dagli altri indirizzi del PC, così si vede lo stesso;
  - se il server risponde «non trovato» sulla pagina principale (solo API) e c'è `index.html`, si apre la pagina e il server resta acceso dietro;
  - il server resta acceso finché non premi **Ferma server**, elimini il progetto o chiudi LocalAI. Se non parte, l'errore mostra le ultime righe del suo output. Avviare un server esegue il codice del progetto, quindi è solo per gli amministratori; un programma da riga di comando (es. `torrent-cli`) non ha niente da aprire e il tasto non compare.

- **Parla con il progetto**: nel riquadro in cima alla pagina del progetto scrivi una domanda, una modifica o una nuova funzione, per esempio «aggiungi un tasto pausa», «il punteggio non sale quando completo una riga» o «come funziona il salvataggio?». Si apre la **chat del progetto**: una chat normale, con la barra del progetto in cima, che lavora solo nella sua cartella e a ogni messaggio vede il piano, i task con il loro esito e la cronologia.
  - Il lavoro lo guida lui: non serve dirgli ogni passo. Sceglie da solo cosa fare subito e cosa mettere in coda.
  - Le **modifiche piccole** (un bug, colori, testi, una funzione, una libreria da installare, un file rovinato) le fa subito, poi verifica con `check_project`: gli stessi test della coda (solo per gli amministratori) e la pagina aperta in Edge headless con gli errori JavaScript. Se qualcosa non va, corregge.
  - I **lavori grandi** («fai il gioco», «aggiungi i livelli») li porta avanti tutti nello stesso turno: scrive o aggiorna `PIANO.md`, crea i task della coda (`add_project_tasks`) con il tipo giusto e la coda **parte da sola**. Se vuoi rivederli prima, digli «aspetta» o «non avviare». I task chiesti in chat hanno il link *chiesto in chat*.
  - Le **librerie mancanti** (Python con pip, npm nella cartella del progetto) le installa lui con `install_packages`, senza chiedere conferma, solo se esistono davvero su PyPI o npm (amministratori).
  - Se un task della coda sta lavorando, la chat non tocca i file, per non sovrapporsi: risponde alle domande e mette in coda le modifiche.
  - Gli amministratori possono far eseguire comandi, con la conferma come nella modalità Computer. I nuovi messaggi dalla pagina del progetto vanno nell'ultima chat; **Nuova chat del progetto** ne apre una pulita.
- **Coordinatore della coda** (attivo di default, si spegne dal riquadro *Verifica*): quando un task non supera la verifica dopo tutti i tentativi, o si ferma con un errore, la coda del progetto va in pausa come prima. Subito dopo, però, nella chat del progetto parte un turno automatico, il riquadro «Coordinatore: … controllo» con il dettaglio apribile. Il modello riceve il testo del task, le ultime verifiche e l'ultima risposta del modello del task, legge i file e decide:
  - se il problema è piccolo lo corregge, verifica con `check_project` e rimette il task in coda **solo per la verifica completa** (test, librerie, pagina e screenshot), senza far rifare il lavoro al modello. Se passa, il task risulta *Fatto · sistemato dal coordinatore*; se no il modello del task riparte dall'esito della verifica;
  - se il task era troppo grande o ambiguo lo riscrive o lo divide in task più piccoli;
  - se il modello del task ha sbagliato per poco lo rimette in coda;
  - se manca una libreria la installa (`install_packages`) e rifà la verifica;
  - se il task si è fermato per un ciclo di riscrittura, rimette il file com'era (`restore_file` o la storia della cartella) e corregge lui il punto o divide il task.
  Dopo aver rimesso in coda un task (da verificare, da rifare o riscritto) la coda riparte da sola; se serve una tua decisione la lascia in pausa e te lo scrive. Il coordinatore non chiude mai un task senza la verifica completa: chiuderlo senza verifica resta possibile solo chiedendolo tu nella chat. Puoi rispondergli nella stessa chat: è la chat del progetto, e con `manage_queue` rifà, riscrive, segna come fatti o elimina task e avvia o ferma la coda anche su tua richiesta. Al massimo 2 interventi per task (`TASK_COORDINATOR_RUNS`), poi la cronologia dice che serve il tuo aiuto. Se rimetti in coda tu il task, il conteggio riparte.
- **Task bloccati o troppo lunghi**: se il modello di un task ha la GPU ma da 15 minuti (`TASK_STALL_MINUTES`) non produce niente, né testo né azioni, il task viene fermato come errore e passa al coordinatore. Lo stesso succede se ci lavora in tutto più di 45 minuti (`TASK_MAX_MINUTES`). Il tempo conta solo mentre il modello ha la GPU: l'attesa, per esempio mentre usi la chat o lavora ChatBz, non conta.
- **Scritture protette** (prova di Missile Command, 2026-10-11: `game.js` e `synth_gen.py` diventavano una riga sola e il task li riscriveva all'infinito):
  - nella cronologia di un turno LocalAI accorcia i file già scritti con una nota («omessi N caratteri…»). Il modello a volte la copiava nel file al posto del codice. Ora una scrittura che contiene quella nota, o un segnaposto corto come «resto del codice invariato», viene **rifiutata** e il file su disco resta com'era;
  - un file pieno non può essere sovrascritto con un contenuto vuoto (per toglierlo serve `delete_file`);
  - prima di ogni modifica, e prima di eliminarlo, LocalAI salva una **copia del file** (le ultime 5, in `data/backups/`, fuori dalla cartella del progetto). `restore_file` la rimette, e anche il ripristino si annulla;
  - per cambiare un file esistente il modello usa `edit_file`, che sostituisce solo il pezzo che cambia. Prima lo riscriveva intero a blocchi e, se si fermava a metà, il file restava troncato. Se una riscrittura accorcia di più della metà un file lungo, il modello riceve un avviso;
  - **ciclo di riscrittura**: se in un task lo stesso file viene riscritto da capo più di 10 volte (`TASK_MAX_REWRITES`), se viene scritto 3 volte lo stesso contenuto o se il segnaposto viene rifiutato 2 volte, il turno si ferma. Prima di fermare il task LocalAI chiede i **consigli** a Gemma 26B (vedi *Consigli contro i loop*) e riprova; se i consigli sono finiti il task si ferma con il motivo scritto («Ciclo di riscrittura: il modello ha…»), arriva una notifica e interviene il coordinatore.
- **Giri e letture ripetute** (prova di Space Invaders, 2026-10-11: un task ha riletto `game.js` 70 volte in 33 minuti, e lo ha cambiato e rimesso com'era più volte):
  - oltre il tetto dei giri di un turno (`WORKSPACE_MAX_ROUNDS`, 16) le chiamate agli strumenti vengono ignorate e il turno finisce. Prima il modello continuava a chiamarli anche quando non gli venivano più offerti;
  - dalla terza lettura dello stesso file invariato nello stesso turno il modello riceve un avviso. Alla quinta passa all'ultimo giro, senza strumenti, dove scrive il riepilogo, e poi decide la verifica;
  - un file riportato 3 volte allo stesso contenuto (modifiche fatte e disfatte) conta come ciclo e ferma il task;
  - se una modifica con `edit_file` è già stata fatta, il modello lo viene a sapere invece di ricevere «il testo non c'è»;
  - mentre un task della coda lavora, la chat del progetto e il coordinatore non possono modificare i file. Lo screenshot di un turno automatico del coordinatore non apre più una «correzione» basata sul messaggio del coordinatore.
- **Leggi prima di scrivere** e **chiamate ripetute** (idee prese da [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), licenza MIT):
  - un file che esiste già si può modificare, sovrascrivere o allungare solo se il modello l'ha letto (o scritto lui) nella stessa conversazione e non è cambiato dopo. Altrimenti la modifica viene rifiutata con l'invito a rileggerlo. Così niente riscritture a memoria e niente modifiche sopra il lavoro di un altro task;
  - se il modello fa la stessa chiamata con gli stessi argomenti 3 volte di fila riceve un avviso. Alla quinta il turno passa all'ultimo giro, senza strumenti.
- **Regole nel piano**: il piano scritto con l'AI ha una sezione `# Regole`, con le regole concrete del risultato (per un clone, le meccaniche dell'originale con i numeri). Ogni task ha una riga «Fatto quando: …» che i test devono verificare. I punti della sezione Regole non diventano task.
- **Ollama spento o caduto**: se Ollama non risponde, il task non parte (o si ferma) senza consumare tentativi e senza disturbare il coordinatore, che non potrebbe farci niente. La coda va *in attesa di Ollama*, lo segnala con una notifica e riparte da sola entro un minuto da quando Ollama torna raggiungibile. Se un intervento del coordinatore era rimasto a metà, riprende prima lui.
- **Dopo un riavvio di LocalAI** il task interrotto torna in coda e la coda resta in pausa. Con l'opzione *Se LocalAI si riavvia con la coda attiva, riprendi da solo* (riquadro *Verifica*) riparte invece da sola.
- **Storia della cartella e annullamento** (serve [Git](https://git-scm.com/download/win) installato sul PC): LocalAI fotografa la cartella del progetto con git prima e dopo ogni task e ogni turno della chat del progetto. Le modifiche fatte a mano nel frattempo finiscono in una fotografia a parte. Il repository è locale (`.git` nella cartella), con autore «LocalAI»; dipendenze e cache (`node_modules`, `__pycache__`, `.venv`) restano fuori. Il modello e il server dei file non possono toccare `.git`.
  - Nel task c'è **annulla le modifiche di questo task**: la cartella torna a prima del task. Spariscono anche le modifiche fatte dopo, ma restano nella storia.
  - Il riquadro **Storia della cartella** elenca le ultime fotografie, ognuna con il suo **ripristina**. Anche un ripristino è una fotografia, quindi si può annullare.
  - Il coordinatore riceve il diff di quello che il task ha cambiato. Nella chat del progetto il modello usa `project_history` per elencare le versioni, vedere cosa è cambiato e ripristinare: «annulla l'ultima modifica», «torna a com'era stamattina».
  - Senza Git tutto funziona come prima, solo senza storia; la pagina del progetto lo segnala.
- **Notifiche**: quando la coda finisce, quando un task non riesce (con il coordinatore spento) e a ogni esito del coordinatore («ha sistemato…», «ha bisogno di te», «serve il tuo aiuto») arriva un avviso.
  - **Nell'app** compare un riquadro in basso a destra; un clic apre il progetto.
  - **Nel browser**, con **Attiva le notifiche del browser** nel riquadro *Verifica*, arrivano anche a scheda chiusa o in secondo piano (servono HTTPS o localhost).
  - **Sul telefono, anche ad app chiusa**, con [ntfy](https://ntfy.sh): installa l'app ntfy, iscriviti a un argomento con un nome difficile da indovinare (es. `localai-andrea-7f3k9q`) e avvia LocalAI con `NTFY_URL=https://ntfy.sh/localai-andrea-7f3k9q`. Titolo e testo della notifica (nome del progetto e del task) passano dal server di ntfy: se preferisci, ntfy si può installare sul PC e `NTFY_URL` punta lì (`NTFY_TOKEN` se l'argomento è protetto). Con `APP_URL` (lo imposta `tools/attiva-https.ps1`) la notifica apre il progetto.
- **Verifica dalla chat del progetto**: `check_project` fa anche lo screenshot della pagina, visibile nel passaggio. A fine turno un modello che legge le immagini lo giudica, come nella coda; se non convince parte un turno automatico di correzione, uno solo.
- **Prova del coordinatore con i modelli veri**: con LocalAI acceso, dalla cartella di LocalAI:

  `node tools/prova-coordinatore.mjs --utente andrea --password LA_TUA_PASSWORD`

  Prima controlla che Ollama risponda: senza Ollama i task falliscono subito e la prova non direbbe niente. Poi crea quattro progetti `prova-coord-…` con un problema apposta: un test sbagliato, una pagina con un errore JavaScript già presente, un task vaghissimo, una libreria Python inesistente. Poi avvia le code, aspetta coda e coordinatore e controlla l'esito. Il resoconto, con cronologia e risposte del coordinatore, finisce in `prova-coordinatore-<data>.md`. Rilanciandolo i progetti vengono ricreati da capo; `--solo test-sbagliato,pagina-rotta` ne prova solo alcuni. Serve un utente amministratore, perché i test girano solo per loro. I progetti di prova hanno un solo tentativo per task (`--tentativi 1`): così alla prima verifica fallita interviene il coordinatore, che è quello che si vuole provare.
- **Piano**: si scrive nel riquadro *Piano* (o lo scrive Claude Code direttamente in `PIANO.md` nella cartella del progetto). Con **Scrivi il piano con l'AI** basta scrivere l'obiettivo: il modello per la lettura (Gemma 26B, o il predefinito) prepara il piano nel formato giusto, da rivedere prima di creare i task. **Crea task dal piano** trasforma ogni punto di elenco (`- …` o `1. …`) in un task; le righe rientrate sotto un punto ne sono i dettagli e le caselle già spuntate (`- [x] …`) si saltano. Un task si può aggiungere anche a mano.
- **Coda**: **Avvia coda** esegue i task in ordine, uno alla volta per tutto LocalAI (nei 16 GB di VRAM sta un solo modello). Tra progetti diversi passa prima il task che usa il modello già caricato. Gira sul server: continua anche con il browser chiuso o dal telefono spento. Se un task non riesce la coda del progetto va in pausa; dopo un riavvio di LocalAI il task interrotto torna in coda e si riprende con **Avvia**. Le chat dell'utente passano davanti ai task (priorità bassa verso l'agent del PC).
- **Modello per tipo di task** (dal benchmark in `C:\AI\benchmark-delega`): *Codice* e *Pagina o gioco* a **Qwen Coder** (48k di contesto), *Lettura e analisi* (riassunti, log, estrazione, JSON) a **Gemma 26B HauhauCS** (32k di contesto: rimisurato il 22 ottobre 2026, ~78 tok/s a 32k, 63 a 64k, 45 a 128k), *Testo* al modello predefinito. Il tipo si sceglie da solo dalle parole del task, si forza nel piano con `[codice]`, `[pagina]`, `[lettura]`, `[testo]` all'inizio del punto, o si cambia dal menu del task. Se il modello scelto non è installato o non supporta gli strumenti (servono per leggere e scrivere i file) si usa quello predefinito: l'interfaccia mostra quale modello userà ogni tipo.
- **Ogni task ha la sua chat** (titolo «Progetto · task»), con tutti i file scritti e gli esiti delle verifiche: si apre dal task e non compare nello storico a sinistra. Il modello vede il piano, i task già fatti con il loro riepilogo, e lavora solo nella cartella del progetto. Nei task non esegue comandi: i test li lancia LocalAI.
- **Lingua**: le istruzioni che il modello riceve nei task, gli esiti della verifica e il messaggio al coordinatore sono in inglese, come il codice, i commenti e i test che scrive. Qwen Coder è allenato soprattutto in inglese e il testo occupa meno contesto. Piano, titoli dei task, riepiloghi, notifiche e risposte della chat restano in italiano.
- **Verifica automatica**, dopo ogni turno del modello:
  - *test* (codice, e pagine che ne hanno; solo per gli amministratori perché esegue il codice scritto dal modello): il comando impostato nel progetto, altrimenti `npm test` se `package.json` ha uno script di test, `node --test` per i file `*.test.js`, `pytest` (se installato) o `unittest` per i `test_*.py`. Se un task di codice non ha test, il modello deve scriverli;
  - *librerie* (task di codice): le librerie importate nei file Python e JavaScript devono essere installate, o almeno esistere davvero. Quelle che mancano si cercano su PyPI e sul registro npm: se non esistono la verifica fallisce. Il caso tipico è una libreria inventata dal modello e simulata nei test, che così passano; succedeva davvero nella prima prova del coordinatore. Se esistono ma non sono installate, **LocalAI le installa da sola prima dei test** (`python -m pip install …`, oppure `npm install …` nella cartella del progetto). Lo stesso vale se i test falliscono con `ModuleNotFoundError` o `Cannot find package`: installa e li rifà una volta. Succede solo per gli amministratori e solo per pacchetti che esistono sul registro; con `TASK_AUTO_INSTALL=0` il task mostra invece il comando, per esempio `pip install pyyaml`, da lanciare a mano.
  - *pagina* (task di tipo pagina o gioco): Edge headless apre `index.html` (o la pagina scritta nel task) dal server dei file, raccoglie gli errori JavaScript e della console (la favicon mancante non conta) e fa uno screenshot, visibile nel task;
  - *screenshot*: se la pagina non ha errori, un modello che vede le immagini giudica se mostra quanto richiesto.
  Se qualcosa non va, l'esito torna al modello nella stessa chat e lui corregge, fino a 3 tentativi (`TASK_MAX_ATTEMPTS`, oppure il valore scelto nel riquadro *Verifica* del progetto, da 1 a 5).
  Dei test falliti il modello riceve la parte con gli errori (da `FAIL:`/`ERROR:` di unittest, dai blocchi di pytest, da `not ok` di node:test). Prima riceveva l'inizio dell'output: con `unittest -v` erano solo righe «… ok» e correggeva alla cieca (prova torrent-cli, 2026-10-19). Anche l'output dei comandi ora tiene l'inizio e la fine.
- **Consigli contro i loop** (prova torrent-cli, 2026-10-19: Qwen riprovava la stessa correzione fino alla fine dei tentativi): dopo 2 verifiche fallite dello stesso task (`TASK_ADVICE_AFTER`), o subito dopo un ciclo di riscrittura, LocalAI chiede a **Gemma 26B** (il modello per lettura e analisi, `TASK_ADVICE_MODEL`) di analizzare l'errore. Gemma riceve il task, l'esito della verifica, l'ultima risposta di Qwen e i file toccati o citati nell'errore, e risponde con la causa, cosa fare file per file e cosa non rifare.
  - I consigli finiscono in **`CONSIGLI.md`** nella cartella del progetto (le 8 voci più recenti, in alto l'ultima) e nel messaggio del tentativo successivo. I task successivi sanno che il file esiste e lo leggono se si incastrano su un errore simile.
  - Si vedono anche nel task, alla voce *Consigli* tra le verifiche, e nella cronologia.
  - **Giri limitati**: al massimo 2 consigli per task (`TASK_ADVICE_ROUNDS`, `0` li spegne). Dopo l'ultimo consiglio c'è sempre un tentativo per metterlo in pratica, anche oltre il numero di tentativi, ma uno solo: con 3 tentativi sono al massimo 4 giri di Qwen e 2 di Gemma, poi il task passa al coordinatore, che vede anche l'ultimo consiglio.
- **Quale modello legge davvero le immagini**: non basta che Ollama dichiari la capacità `vision`, quindi si misura. LocalAI fotografa con Edge una pagina con una parola e un numero a caso e chiede a ogni candidato di leggerli: i modelli Ollama che dichiarano la visione e Qwen3-VL di ComfyUI. Per giudicare gli screenshot si usa il più veloce tra quelli che hanno letto giusto. La verifica parte da sola al primo task di tipo pagina, oppure dal riquadro *Verifica* di un progetto (**Verifica ora**, solo amministratori); il risultato resta in `data/vision-check.json`. Con Qwen3-VL lo screenshot viene descritto e poi giudicato dal modello predefinito.

| Variabile | Default |
|---|---|
| `TASK_MODEL_CODE` / `TASK_MODEL_PAGE` | `qwen3.8-coder:latest` |
| `TASK_MODEL_READ` | `hf.co/HauhauCS/Gemma4-26B-A4B-Uncensored-HauhauCS-Balanced:IQ4_XS` |
| `TASK_MODEL_CHAT` | vuoto = modello predefinito |
| `TASK_MAX_ATTEMPTS` | `3` |
| `TASK_TEST_SECONDS` | `120` (tempo massimo dei test) |
| `TASK_STALL_MINUTES` | `15` (task fermo: nessuna attività del modello) |
| `TASK_MAX_MINUTES` | `45` (tempo di lavoro massimo del modello su un task) |
| `TASK_COORDINATOR_RUNS` | `2` (interventi del coordinatore per task) |
| `TASK_AUTO_INSTALL` | `1` (librerie mancanti installate dalla verifica; `0` = a mano) |
| `TASK_MAX_REWRITES` | `10` (riscritture intere dello stesso file in un task prima di fermarlo) |
| `TASK_ADVICE_AFTER` | `2` (verifiche fallite prima di chiedere i consigli) |
| `TASK_ADVICE_ROUNDS` | `2` (consigli per task; `0` = spenti) |
| `TASK_ADVICE_MODEL` | vuoto = il modello per lettura e analisi (Gemma 26B) |
| `NTFY_URL` / `NTFY_TOKEN` | vuoto (notifiche sul telefono con ntfy) |
| `APP_URL` | vuoto (indirizzo HTTPS dell'app, per il link nelle notifiche) |
| `VISION_MODEL` | vuoto = scelto dalla verifica (es. `gemma4-12b-uncensored:latest`, oppure `comfy:qwen3-vl`) |

## HTTPS con Tailscale (microfono e notifiche dal telefono)

Il browser concede microfono e notifiche solo alle pagine in HTTPS (o su `localhost`). Con Tailscale l'app ha un indirizzo HTTPS vero, `https://<nome-pc>.<tailnet>.ts.net`, raggiungibile dal telefono anche fuori casa e senza avvisi di certificato:

1. Nella console di Tailscale, alla voce *DNS*, attiva **MagicDNS** e **HTTPS Certificates**.
2. Sul PC di LocalAI, in PowerShell: `powershell -ExecutionPolicy Bypass -File tools\attiva-https.ps1`.
3. Chiudi e riapri LocalAI (`start.bat`).

Lo script fa due cose:
- pubblica l'app sulla porta 443 e i file della cartella di lavoro sulla 8443 (`tailscale serve`): restano su un'origine separata, come la 3001 in HTTP;
- imposta `WORKSPACE_HTTPS_PORT=8443` e `APP_URL`.

L'indirizzo `http://…:3000` continua a funzionare. Per tornare indietro: `tailscale serve reset`.

## Configurazione

Si fa con variabili d'ambiente (i default sono in `src/config.js`):

| Variabile | Default |
|---|---|
| `OLLAMA_URL` | `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | `gemma4-12b-uncensored:latest` |
| `OLLAMA_CTX` | `131072` (misurato su gemma4-12b: 10,4 GB, 100% GPU, ~64 tok/s come a 24k; i modelli con `num_ctx` nel Modelfile, come Qwen Coder, usano il proprio) |
| `OLLAMA_KEEP_ALIVE` | `30m` |
| `DOC_LONG_MODEL` | `hf.co/LiquidAI/LFM2.5-24B-A2B-GGUF:QAD-Q4_0` (legge interi i documenti lunghi; vuoto = sempre riassunto a blocchi) |
| `DOC_LONG_MIN_CHARS` | `90000` (~30k token: sotto, riassunto a blocchi con il modello della chat) |
| `COMFY_URL` | `http://127.0.0.1:8188` |
| `AGENT_URL` | `http://127.0.0.1:7070` (agent del PC, arbitro della GPU condiviso con ChatBz) |
| `GPU_ARBITER` | `1` (`0` = solo l'arbitro interno) |
| `PORT` / `HOST` | `3000` / `0.0.0.0` |
| `WORKSPACE_HTTPS_PORT` | vuoto (porta HTTPS dei file quando l'app è in HTTPS: `8443` con `tools/attiva-https.ps1`) |
| `DATA_DIR` | `./data` (conversazioni, media, utenti, sessioni, progetti) |
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
- **Arbitro condiviso con ChatBz** (`src/gpu-agent.js`): se l'agent del PC (remote-app-controller, porta 7070) è acceso, ogni lavoro chiede anche a lui il permesso di usare la GPU. L'agent fa lavorare una sola app alla volta (prima la chat, poi le generazioni, poi i lavori in sottofondo di ChatBz) e fa lui lo scambio Ollama ⇄ ComfyUI; la pillola mostra «In attesa della GPU (ChatBz: …)». Senza agent tutto funziona come prima.
- **Finestra di contesto** (`src/context.js`): prima di ogni chiamata al modello si stimano i token di prompt di sistema, strumenti, cronologia, documenti e pagine lette (~3 caratteri per token, corretti con i conteggi reali che Ollama restituisce) e si lascia libero lo spazio per la risposta: il 15% della finestra, almeno 2.048 token, oppure il 30%, almeno 4.096, con il ragionamento attivo. Se non ci sta tutto si accorciano, nell'ordine, le pagine lette nei passaggi precedenti, i turni più vecchi (gli ultimi due scambi restano), tutti i risultati web, il resto della cronologia. Quando resta poco spazio non si offrono altre ricerche e il modello risponde con ciò che ha raccolto. Se Ollama segnala comunque un contesto superato, la stima si corregge e il passaggio si ripete; se il ragionamento riempie la finestra prima della risposta, il passaggio si ripete senza ragionamento. Sotto ogni risposta, accanto ai token/s, compare il contesto usato (es. «contesto 12,5k/16k»). Le sezioni del prompt di sistema su documenti e immagini allegate entrano solo nelle chat che li contengono.
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
| `minimax-h3-t2v` | video | MiniMax H3 int8 + LoRA turbo 6 step + SageAttention + LoRA VBVR Pro, Unlocked V2, Mystic V4 | text-to-video con audio, 0.7 MP, 6 passi, 2–15 s |
| `minimax-h3-i2v` | video (img2video) | come sopra + SageAttention + LoRA VBVR Pro, Unlocked V2, Mystic V4 + immagine iniziale | anima un'immagine allegata o generata |
| `krea2-i2i` | immagine (img2img) | Krea 2 Turbo | default per rielaborare immagini (cambi di stile) |
| `zimage-i2i` | immagine (img2img) | Z-Image Turbo | ritocchi fotorealistici |
| `qwen-image-edit` | immagine (edit) | Qwen-Image-Edit 2511 int8 + Lightning 4 step, poi FaceDetailer con Juggernaut XL (solo volti, denoise 0.35) e volto originale rimesso dove non si è spostato | editing a istruzioni, fino a 3 immagini, ~30 s |
| `sdxl-face` | immagine (identity) | Juggernaut XL + IPAdapter Plus Face (volto ritagliato con YOLO) + FaceDetailer | foto nuova con il volto della persona allegata, ~25 s |
| `qwen-scene-real` | immagine (scene) | Qwen-Image-Edit 2511 (+ FaceDetailer) → Krea Real i2i 0.3 / 12 step, con il volto originale rimesso tramite maschera YOLO sfumata | stessa persona di un'immagine generata in una nuova scena, ~55 s |
| `qwen-duo-real` | immagine (duo) | come `qwen-scene-real` ma con due foto: Qwen-Image-Edit compone le due persone insieme, poi Krea Real con i volti protetti | due persone di due foto allegate in una scena nuova, ~60 s |
| `sdxl-upscale` | immagine (upscale) | Ultimate SD Upscale 2x (4x-UltraSharp + Juggernaut XL, denoise 0.15) + FaceDetailer | «massima qualità» sulle immagini generate: ridisegna il dettaglio fine, ~35–75 s |
| `upscale-fedele` | immagine (upscale, predefinito) | 4x-UltraMix_Restore, ridotto a 2x | ingrandimento fedele senza ridisegno, adatto a foto vere anche mosse o compresse, ~5 s |
| `qwen3vl-vision` | vision | Qwen3-VL 4B (`TextGenerate`) | lettura/descrizione delle immagini allegate |
| `acestep15-music` | audio (music) | ACE-Step 1.5 Turbo (8 step) + encoder Qwen 0.6B/1.7B | musica e canzoni con testo, BPM e tonalità, 10–240 s, MP3 |
| `acestep15-melody` | audio (melody) | come sopra, in modalità cover: melodia canticchiata → `VAEEncodeAudio` → `ReferenceTimbreAudio`, senza codici audio dell'LM | brano dalla melodia registrata dall'utente, ripetuta fino alla durata scelta |
| `stable-audio3-sfx` | audio (sfx) | Stable Audio 3 Medium (8 step) + T5Gemma | effetti sonori e ambienti, 1–30 s, MP3 |

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
  context.js         stima dei token e budget della finestra di contesto
  jobs.js            generazioni su ComfyUI + bus eventi
  audio.js           musica ed effetti sonori: impostazioni del brano, file nella cartella di lavoro
  melody.js          melodia canticchiata: lettura del WAV, tonalità e tempo stimati, file per ComfyUI
  snapshots.js       storia dei progetti con git: fotografie, diff, ripristino
  prompts.js         prompt di sistema, tool, router di ricerca e prompt engineer
  search.js          ricerca web (DuckDuckGo/SearXNG/Brave) e lettura pagine
  documents.js       PDF/TXT: estrazione testo, riassunto map-reduce (o lettura intera con LFM2.5), recupero passaggi (BM25)
  workflows.js       registro dei workflow e iniezione dei parametri
  store.js           salvataggio delle conversazioni
  workspace.js       cartella di lavoro: file, comandi con conferma, PDF e Word
  docx.js            conversione HTML → .docx senza dipendenze
  projects.js        progetti: piano (PIANO.md), task, scelta del modello per tipo
  runner.js          coda dei task: un task alla volta, test, controllo pagine e tentativi
  browser.js         Edge/Chrome headless via DevTools: errori della console e screenshot
  vision.js          verifica dei modelli che leggono le immagini, giudizio degli screenshot, lettura delle immagini allegate
  faces.js           volto originale rimesso dopo le modifiche (YOLO + maschera sfumata)
  videochain.js      video lunghi in pezzi e «Continua» (MiniMax H3)
public/              interfaccia (HTML/CSS/JS, senza build)
workflows/           workflow ComfyUI (API) + manifest + guide
_legacy/             vecchia versione del progetto (si può eliminare)
```

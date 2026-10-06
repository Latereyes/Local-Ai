# Piano: coerenza del volto

Piano concordato il 4 ottobre 2026. Si parte da IPAdapter migliorato e si arriva a una LoRA addestrata, prima sulle foto reali e poi su un volto inventato.

## Principi (valgono per ogni fase)
- **Decide l'utente.** Ogni modifica che cambia l'aspetto delle immagini va prima provata con un confronto fianco a fianco (stessa foto di riferimento, stessi prompt e seed, griglia con etichette). Nell'app entra solo l'opzione scelta.
- **Consenso:** si usano solo il proprio volto, quello di chi è d'accordo (es. Claudia per il suo profilo) o volti inventati.
- **Una sola GPU** (4070 Ti Super 16 GB, condivisa da Ollama e ComfyUI su 192.168.1.12). L'addestramento la occupa per ore, quindi LocalAI deve sapere quando è «in manutenzione».

## Situazione di partenza
- Workflow `sdxl-face`: Juggernaut XL + IPAdapter Plus Face (peso 0.85) sul volto ritagliato con YOLO (BboxDetectorSEGS → OrderedFilter → SEGSToImageList), poi FaceDetailer.
- FaceID Plus v2 funziona (insightface riparato, LoRA installata), ma nel confronto sulla foto di Andrea ha vinto Plus Face.
- Difetto noto: Plus Face si porta dietro anche gli abiti della foto (maglietta nera al posto della giacca richiesta).

## Fase 0 · Banco di prova (½ giorno)
- Script di confronto: 3-5 foto di riferimento, 4 scene fisse (vulcano, smoking, caffè, spiaggia), 2 seed, griglia con etichette.
- Da Fase 2 la griglia mostra anche un punteggio di somiglianza per ogni immagine.

## Fase 1 · Taglia e cuci migliorato (1-2 giorni, niente da scaricare)
1. **Niente più abiti copiati:** ritaglio più stretto sul viso (crop_factor ~1.3) e IPAdapter attivo fino a `end_at` ~0.8.
2. **«Il mio volto» nel profilo:** ogni utente carica 3-5 foto una volta sola e IPAdapter le combina (batch, `combine_embeds` average). Gemma capisce «fammi una foto *mia* al mare» anche senza allegati. Ogni utente può usare solo il proprio volto.
3. **FaceDetailer più incisivo:** guide_size più alto, denoise ~0.45-0.5, modello con il riferimento applicato.
4. **Plus Face + FaceID insieme**, ciascuno a metà intensità: da confrontare.
5. **Strada alternativa con Qwen-Image-Edit 2511** («metti questa persona sul vulcano»): da confrontare con la strada SDXL.

→ Confronto finale, si tengono le varianti scelte.

## Fase 2 · Più varianti, vince la più somigliante (1 giorno)
- Installare il nodo **ComfyUI_FaceAnalysis** sul PC di ComfyUI. Calcola la distanza tra volti con insightface. Va installato da lì: il Manager blocca le installazioni da un altro PC.
- L'app genera 3-4 varianti, mette per prima la più somigliante con un indicatore («somiglianza 82%») e lascia visibili le altre.
- Il tempo si moltiplica per il numero di varianti (~1,5 min invece di ~25 s): sarà un'impostazione regolabile.
- Il punteggio diventa il metro di misura per le fasi 3 e 4.

## Fase 3 · LoRA dalle foto reali (2-3 giorni + 1-2 h di addestramento per LoRA)
1. **Preparazione:** installare AI-Toolkit sul PC di ComfyUI (comodo con una sessione Claude su quel PC). In LocalAI aggiungere l'interruttore **«GPU in manutenzione»**: le richieste vengono messe in attesa con un messaggio chiaro, e ComfyUI e Ollama liberano la VRAM.
2. **Set di foto:** l'utente raccoglie 20-30 foto seguendo la checklist:
   - angolazioni diverse: frontale, tre quarti, profilo;
   - luci, espressioni, abiti e sfondi diversi;
   - per lo più primi piani, più qualche mezzobusto;
   - foto nitide, con una sola persona;
   - gli occhiali si tengono se si portano sempre.

   Le didascalie le scrive in automatico Qwen3-VL, con la parola chiave del nome; poi si rivedono.
3. **Addestramento su SDXL (Juggernaut):** rank 16-32, circa 2000 step, una versione intermedia salvata ogni 250.
4. **Scelta della versione:** griglia versioni × scene di prova, più il punteggio. Si scartano le versioni sovra-addestrate (espressione rigida, sfondi copiati); sceglie l'utente.
5. **Integrazione nell'app:** archivio delle LoRA per utente (file, modello base, parola chiave, intensità). «Foto mia» usa la LoRA, più FaceDetailer e un leggero IPAdapter di rinforzo. La LoRA è usabile solo dal suo proprietario.
6. **Secondo addestramento su Z-Image Turbo** (serve l'adattatore di AI-Toolkit per i modelli turbo). Confronto SDXL contro Z-Image; sceglie l'utente.

Video: si genera l'immagine con la LoRA e poi la si anima. Addestrare una LoRA per MiniMax su 16 GB non è realistico.

## Fase 4 · Volto inventato + LoRA (3-4 giorni)
1. **Sezione «Personaggi»:** nome, proprietario, chi lo può usare, foto principale, foto di riferimento, LoRA e stato («solo foto» oppure «LoRA pronta»).
2. **Disegno:** 16-32 candidati con tratti distintivi (lentiggini, neo, naso, sopracciglia, taglio di capelli), generati con Z-Image o Krea Real; l'utente sceglie la foto principale. Va controllato che non somigli a una persona reale.
3. **Set di foto sintetico:**
   - circa 40 varianti a partire dalla foto principale, guidate da una lista di istruzioni (angolazioni, espressioni, luci, abiti, sfondi);
   - si generano con Qwen-Edit 2511 e, dove serve, con IPAdapter + FaceDetailer;
   - il filtro di somiglianza scarta le immagini in cui il volto deriva, poi c'è la revisione dell'utente.

   Per evitare l'effetto «AI» si usano il look di Krea Real e il FaceDetailer.
4. **LoRA in due giri:** la v1 sul set sintetico; con la v1 si generano circa 100 immagini, si tengono le migliori e si addestra la v2.
5. **Uso in chat:** «fai una foto di Giulia in spiaggia» fa scegliere a Gemma il personaggio giusto. Un personaggio senza LoRA resta comunque utilizzabile tramite IPAdapter.

## Riepilogo
| Fase | Durata indicativa | Da scaricare | Risultato |
|---|---|---|---|
| 0 | ½ giorno | niente | confronti misurabili |
| 1 | 1-2 giorni | niente | volto più fedele, «Il mio volto» |
| 2 | 1 giorno | nodo ComfyUI_FaceAnalysis | sceglie in automatico la variante migliore |
| 3 | 2-3 giorni + addestramenti | AI-Toolkit | LoRA personale (SDXL, poi Z-Image) |
| 4 | 3-4 giorni + addestramenti | niente di nuovo | personaggi inventati coerenti |

Prossimo passo: Fase 0 + Fase 1.

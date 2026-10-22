import { EventEmitter } from 'node:events';
import * as ollama from './ollama.js';
import * as comfy from './comfy.js';
import * as agent from './gpu-agent.js';
import * as voice from './voice.js';

// Mentre un'altra app usa la GPU non si dice quale né per cosa
const BUSY = 'GPU occupata, attendere...';

/**
 * Arbitro della VRAM condivisa (RTX 4070 Ti Super, 16 GB).
 * Ollama e ComfyUI non possono stare in memoria insieme: ogni lavoro passa da qui,
 * viene eseguito uno alla volta e, quando cambia il "proprietario", l'altro viene scaricato.
 * Il passaggio è pigro: ComfyUI resta carico finché non serve di nuovo Ollama (e viceversa),
 * così generazioni consecutive non ricaricano i modelli.
 *
 * Con l'agent del PC acceso (remote-app-controller) il permesso si chiede anche a lui, che arbitra tra
 * LocalAI e ChatBz e fa lui il passaggio tra Ollama e ComfyUI: le due app non si accavallano più.
 * Senza agent si lavora come prima, solo con questa coda.
 */
class GpuArbiter extends EventEmitter {
  owner = null;        // 'ollama' | 'comfy' | null (sconosciuto all'avvio)
  shared = false;      // l'ultimo passaggio l'ha fatto l'agent: owner può non essere più vero
  active = null;       // { who, label, model }
  ollamaModel = null;  // nome del modello Ollama dell'ultimo lavoro (per la pillola: «Qwen Coder al lavoro»)
  waiting = [];        // etichette in coda
  tail = Promise.resolve();

  state() {
    return { owner: this.owner, ollamaModel: this.ollamaModel, active: this.active, queued: this.waiting.map((w) => w.label) };
  }

  #emit() { this.emit('state', this.state()); }

  async #switchTo(who) {
    // Dopo l'agent un'altra app può aver cambiato la GPU: senza agent si riparte da "sconosciuto"
    if (this.shared) { this.owner = null; this.shared = false; }
    if (this.owner === who || who === 'none') return;
    if (who === 'comfy') {
      this.active = { ...this.active, phase: 'Libero la VRAM da Ollama…' };
      this.#emit();
      await ollama.unloadAll();
    } else {
      this.active = { ...this.active, phase: 'Libero la VRAM da ComfyUI…' };
      this.#emit();
      if (await comfy.isUp()) await comfy.freeVram();
    }
    this.owner = who;
  }

  /**
   * Esegue fn con la GPU riservata a `who`. onWait viene chiamato se si deve aspettare.
   * priority (per l'agent): 'high' per chi aspetta davanti allo schermo, 'normal' per le generazioni,
   * 'low' per i lavori in sottofondo, che passano dopo quelli delle altre app.
   * model: nome da mostrare del modello Ollama che lavora (default: nessuno, la pillola dice «Ollama»).
   */
  run(who, label, fn, { onWait, priority = 'high', model } = {}) {
    const ticket = { who, label };
    const base = model ? { who, label, model } : { who, label };
    this.waiting.push(ticket);
    if (this.active) onWait?.(this.active);
    this.#emit();

    const job = this.tail.then(async () => {
      this.waiting.splice(this.waiting.indexOf(ticket), 1);
      this.active = base;
      if (who === 'ollama' && model) this.ollamaModel = model;
      this.#emit();
      let lease = null;
      try {
        let notified = false;
        lease = await agent.acquire({
          who, label, priority,
          onWait: () => {
            this.active = { ...base, phase: BUSY };
            this.#emit();
            if (!notified) { notified = true; onWait?.({ who, label: BUSY }); }
          },
        });
        if (lease) {
          if (who !== 'none') this.owner = who;
          this.shared = true;
        } else {
          await this.#switchTo(who);
        }
        // il servizio voce sta in VRAM accanto a Gemma; a ComfyUI (video, Qwen-Edit) serve tutta
        if (who === 'comfy') await voice.unload();
        this.active = base;
        this.#emit();
        return await fn();
      } finally {
        await lease?.release();
        this.active = null;
        this.#emit();
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }

  /** Libera la VRAM su richiesta dell'utente (tramite l'agent se c'è, al suo turno). */
  async release() {
    if (await agent.free()) {
      this.owner = null;
      this.#emit();
      return;
    }
    return this.run('none', 'Liberazione VRAM', async () => {
      await ollama.unloadAll().catch(() => {});
      if (await comfy.isUp()) await comfy.freeVram().catch(() => {});
      this.owner = null;
    });
  }

  /** Nessun lavoro qui e nessuna altra app sulla GPU: via libera ai lavori in sottofondo. */
  async idle() {
    const s = this.state();
    if (s.active || s.queued.length) return false;
    return !(await agent.busyElsewhere());
  }
}

export const gpu = new GpuArbiter();

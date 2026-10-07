import { EventEmitter } from 'node:events';
import * as ollama from './ollama.js';
import * as comfy from './comfy.js';
import * as agent from './gpu-agent.js';

const APP_NAMES = { chatbz: 'ChatBz', localai: 'LocalAI', agent: 'agent del PC' };

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
  active = null;       // { who, label }
  waiting = [];        // etichette in coda
  tail = Promise.resolve();

  state() {
    return { owner: this.owner, active: this.active, queued: this.waiting.map((w) => w.label) };
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
   */
  run(who, label, fn, { onWait, priority = 'high' } = {}) {
    const ticket = { who, label };
    this.waiting.push(ticket);
    if (this.active) onWait?.(this.active);
    this.#emit();

    const job = this.tail.then(async () => {
      this.waiting.splice(this.waiting.indexOf(ticket), 1);
      this.active = { who, label };
      this.#emit();
      let lease = null;
      try {
        let notified = false;
        lease = await agent.acquire({
          who, label, priority,
          onWait: (r) => {
            const other = r.active ? `${APP_NAMES[r.active.app] || r.active.app}: ${r.active.label}` : 'altre app in coda';
            this.active = { who, label, phase: `In attesa della GPU (${other})` };
            this.#emit();
            if (!notified) { notified = true; onWait?.({ who, label: other }); }
          },
        });
        if (lease) {
          if (who !== 'none') this.owner = who;
          this.shared = true;
        } else {
          await this.#switchTo(who);
        }
        this.active = { who, label };
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

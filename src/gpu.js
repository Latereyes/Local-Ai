import { EventEmitter } from 'node:events';
import * as ollama from './ollama.js';
import * as comfy from './comfy.js';

/**
 * Arbitro della VRAM condivisa (RTX 4070 Ti Super, 16 GB).
 * Ollama e ComfyUI non possono stare in memoria insieme: ogni lavoro passa da qui,
 * viene eseguito uno alla volta e, quando cambia il "proprietario", l'altro viene scaricato.
 * Il passaggio è pigro: ComfyUI resta carico finché non serve di nuovo Ollama (e viceversa),
 * così generazioni consecutive non ricaricano i modelli.
 */
class GpuArbiter extends EventEmitter {
  owner = null;        // 'ollama' | 'comfy' | null (sconosciuto all'avvio)
  active = null;       // { who, label }
  waiting = [];        // etichette in coda
  tail = Promise.resolve();

  state() {
    return { owner: this.owner, active: this.active, queued: this.waiting.map((w) => w.label) };
  }

  #emit() { this.emit('state', this.state()); }

  async #switchTo(who) {
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

  /** Esegue fn con la GPU riservata a `who`. onWait viene chiamato se si deve aspettare. */
  run(who, label, fn, { onWait } = {}) {
    const ticket = { who, label };
    this.waiting.push(ticket);
    if (this.active) onWait?.(this.active);
    this.#emit();

    const job = this.tail.then(async () => {
      this.waiting.splice(this.waiting.indexOf(ticket), 1);
      this.active = { who, label };
      this.#emit();
      try {
        await this.#switchTo(who);
        this.active = { who, label };
        this.#emit();
        return await fn();
      } finally {
        this.active = null;
        this.#emit();
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }

  /** Libera la VRAM su richiesta dell'utente. */
  async release() {
    return this.run('none', 'Liberazione VRAM', async () => {
      await ollama.unloadAll().catch(() => {});
      if (await comfy.isUp()) await comfy.freeVram().catch(() => {});
      this.owner = null;
    });
  }
}

export const gpu = new GpuArbiter();

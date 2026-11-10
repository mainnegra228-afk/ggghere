import type { Job } from './acoustics.worker';

export class Cancelled extends Error {
  constructor() { super('cancelled'); }
}

/**
 * Runs one job at a time on a dedicated worker. Starting a new job terminates the
 * in-flight one (the simulation loops are synchronous and cannot be interrupted otherwise).
 */
export class JobRunner<T> {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; reject: (e: unknown) => void } | null = null;

  private spawn() {
    return new Worker(new URL('./acoustics.worker.ts', import.meta.url), { type: 'module' });
  }

  run(job: Job, onProgress?: (p: number) => void): Promise<T> {
    if (this.pending) {
      this.worker?.terminate();
      this.worker = null;
      this.pending.reject(new Cancelled());
      this.pending = null;
    }
    if (!this.worker) this.worker = this.spawn();
    const id = ++this.seq;
    const worker = this.worker;
    return new Promise<T>((resolve, reject) => {
      this.pending = { id, reject };
      worker.onmessage = (ev) => {
        const d = ev.data;
        if (d.id !== id) return;
        if (d.progress !== undefined) { onProgress?.(d.progress); return; }
        this.pending = null;
        if (d.error) reject(new Error(d.error));
        else resolve(d.result as T);
      };
      worker.onerror = (ev) => {
        this.pending = null;
        this.worker?.terminate();
        this.worker = null;
        reject(new Error(ev.message || 'Simulation worker crashed'));
      };
      worker.postMessage({ id, job });
    });
  }
}

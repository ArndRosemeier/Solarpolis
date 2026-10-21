/**
 * The one worker pool (guarded: nothing else creates a worker). Generation runs here, off the main thread: a job is
 * a message to `gen.worker.ts`, and its answer comes back with its buffers transferred, not copied.
 *
 * Jobs are handed out in the order asked, to whichever worker is free. A job can be dropped while it waits (the view
 * moved on and no longer needs it).
 */
import type { GenRequest, GenAnswer } from './gen.worker';

interface Pending {
  id: number;
  request: GenRequest;
  resolve: (a: GenAnswer) => void;
  reject: (e: Error) => void;
}

export class WorkerPool {
  private readonly idle: Worker[] = [];
  private readonly busy = new Map<Worker, Pending>();
  private readonly queue: Pending[] = [];
  private next = 1;

  constructor(size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1))) {
    for (let i = 0; i < size; i++) {
      const w = new Worker(new URL('./gen.worker.ts', import.meta.url), { type: 'module', name: `gen ${i + 1}` });
      w.onmessage = (e: MessageEvent<GenAnswer>) => this.done(w, e.data);
      w.onerror = (e) => { const p = this.busy.get(w); this.busy.delete(w); this.idle.push(w); p?.reject(new Error(e.message)); this.pump(); };
      this.idle.push(w);
    }
  }

  /** Workers in the pool. */
  get workers(): number { return this.idle.length + this.busy.size; }
  /** Jobs waiting for a worker. */
  get queued(): number { return this.queue.length; }

  job(request: GenRequest): Promise<GenAnswer> {
    return new Promise((resolve, reject) => {
      this.queue.push({ id: this.next++, request, resolve, reject });
      this.pump();
    });
  }

  /** Drop waiting jobs the caller no longer needs (their promises never settle). */
  drop(keep: (r: GenRequest) => boolean): void {
    for (let i = this.queue.length - 1; i >= 0; i--) if (!keep(this.queue[i].request)) this.queue.splice(i, 1);
  }

  terminate(): void {
    for (const w of [...this.idle, ...this.busy.keys()]) w.terminate();
    this.idle.length = 0;
    this.busy.clear();
    this.queue.length = 0;
  }

  private pump(): void {
    while (this.idle.length && this.queue.length) {
      const w = this.idle.pop()!, p = this.queue.shift()!;
      this.busy.set(w, p);
      w.postMessage(p.request);
    }
  }

  private done(w: Worker, a: GenAnswer): void {
    const p = this.busy.get(w);
    this.busy.delete(w);
    this.idle.push(w);
    if ('error' in a) p?.reject(new Error(a.error)); else p?.resolve(a);
    this.pump();
  }
}

let shared: WorkerPool | null = null;

/** The one pool every view shares (interior terrain and plants, the skin's detail tiles outside). */
export function sharedPool(): WorkerPool {
  return (shared ??= new WorkerPool());
}

/**
 * The one way the view streams things the worker pool builds (terrain tiles, plant cells): a cache of built entries
 * by id, the jobs in flight, and what they hold for the memory watchdog. Each frame the view says which ids it wants,
 * most needed first (`want`); missing ones are asked of the pool, a few at a time, and jobs no longer wanted are
 * dropped from its queue. Entries not drawn for longest go first when the cache is full (`evict`) or memory runs
 * short (`shed`).
 */
import type { GenAnswer, GenRequest } from '../workers/gen.worker';
import type { WorkerPool } from '../workers/pool';

export interface Streamed {
  /** Bytes it holds, and the frame it was last drawn in (set by `mark`). */
  bytes: number;
  lastDrawn: number;
}

export interface StreamOptions<T extends Streamed> {
  /** The id of one of its jobs. */
  id: (r: GenRequest) => string;
  /** Entries kept, drawn or not, and jobs in flight at once. */
  limit: number;
  inFlight: number;
  /** Turns a finished job into an entry (ready to draw), or null to keep nothing. */
  make: (answer: GenAnswer, id: string) => Promise<T | null>;
  /** Frees an entry's own buffers. */
  free: (e: T) => void;
  /** Entries that are never evicted (the terrain's roots). */
  pinned?: (e: T) => boolean;
}

export class StreamCache<T extends Streamed> {
  readonly built = new Map<string, T>();
  private readonly asked = new Set<string>();
  /** The jobs this cache handed the pool: only those are dropped when no longer wanted (other caches share the pool). */
  private readonly sent = new WeakSet<GenRequest>();
  private frameNo = 0;
  private held = 0;

  constructor(private readonly pool: WorkerPool, private readonly opts: StreamOptions<T>) {}

  get(id: string): T | undefined { return this.built.get(id); }
  /** Bytes the cached entries hold. */
  get bytes(): number { return this.held; }
  /** Jobs in flight. */
  get building(): number { return this.asked.size; }

  /** Start a frame. */
  frame(): void { this.frameNo++; }

  /** Mark an entry as drawn this frame. */
  mark(e: T): void { e.lastDrawn = this.frameNo; }

  /** The ids wanted now, most needed first, each with its job: ask for the missing ones, drop the rest, evict. */
  want(wanted: readonly { id: string; request: GenRequest }[]): void {
    const ids = new Set(wanted.map((w) => w.id));
    this.pool.drop((r) => !this.sent.has(r) || ids.has(this.opts.id(r)));
    for (const id of [...this.asked]) if (!ids.has(id)) this.asked.delete(id);
    for (const w of wanted) {
      if (this.asked.size >= this.opts.inFlight) break;
      if (!this.asked.has(w.id) && !this.built.has(w.id)) void this.ask(w.id, w.request);
    }
    this.evict();
  }

  /** Ask for one entry now, whatever else is wanted; resolves when it is built (or not wanted any more). */
  async ask(id: string, request: GenRequest): Promise<void> {
    this.asked.add(id);
    this.sent.add(request);
    const answer = await this.pool.job(request);
    if (this.built.has(id)) return;
    const e = await this.opts.make(answer, id);
    if (!e) return;
    if (!this.asked.has(id)) { this.opts.free(e); return; } // no longer wanted while it was made
    this.built.set(id, e);
    this.held += e.bytes;
    this.asked.delete(id);
  }

  /** Give memory back: drop every entry not drawn this frame. */
  shed(): void {
    for (const [id, e] of [...this.built]) if (e.lastDrawn < this.frameNo) this.forget(id, e);
  }

  /** Drop everything. */
  clear(): void {
    for (const e of this.built.values()) this.opts.free(e);
    this.built.clear();
    this.asked.clear();
    this.held = 0;
  }

  private evict(): void {
    if (this.built.size <= this.opts.limit) return;
    const old = [...this.built].filter(([, e]) => e.lastDrawn < this.frameNo).sort((a, b) => a[1].lastDrawn - b[1].lastDrawn);
    for (const [id, e] of old.slice(0, this.built.size - this.opts.limit)) this.forget(id, e);
  }

  private forget(id: string, e: T): void {
    if (this.opts.pinned?.(e)) return;
    this.opts.free(e);
    this.built.delete(id);
    this.held -= e.bytes;
  }
}

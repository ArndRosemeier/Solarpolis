/**
 * The memory watchdog (Arnd, 2026-10-21: "right from the start"). It samples memory every few seconds, keeps a short
 * history, and when the total crosses the device's budget it warns and asks the subsystems to shed what they can.
 *
 * Two sources, because browsers tell little:
 *  - the JS heap, where the browser reports it (`performance.memory`, Chromium only; guarded: read only here);
 *  - what the game itself holds: every subsystem with big buffers (GPU geometry and textures, chunk caches, the sim)
 *    reports its own size through `watchdog.track(owner, bytes)`. On Safari this is the only source, and it is the one
 *    that matters most there: iPadOS kills a tab long before the device's RAM is used up.
 *
 * Subsystems that can give memory back register with `onPressure(level, shed)`. `soft` fires once on crossing the soft
 * budget (drop caches that are cheap to rebuild); `hard` fires on crossing the hard budget (drop everything not on
 * screen). Both re-arm when the total falls back under 90% of their budget.
 *
 * Time and the memory reader are injected, so the watchdog is tested headless (test/memory.test.ts).
 */

export interface MemoryBudget {
  /** Above this, warn and shed caches (bytes). */
  soft: number;
  /** Above this, shed everything that is not needed for the current view (bytes). */
  hard: number;
  /** Which device class the budget was chosen for, for the debug line. */
  device: string;
}

export type PressureLevel = 'ok' | 'soft' | 'hard';

export interface MemorySample {
  /** When it was taken (ms, from the injected clock). */
  t: number;
  /** The JS heap in use, where the browser reports it (bytes). */
  heap: number | null;
  /** The game's own tracked memory, by owner (bytes). */
  owners: Record<string, number>;
  /** The figure the budget is checked against: the heap plus the tracked memory outside it (bytes). */
  total: number;
  level: PressureLevel;
}

export interface WatchdogOptions {
  budget: MemoryBudget;
  /** Reads the JS heap in use (bytes), or null where the browser does not say. */
  readHeap: () => number | null;
  now: () => number;
  /** Samples kept for the history and the growth rate. */
  keep?: number;
  /** Called on each change of level, for the on-screen warning. */
  onLevel?: (level: PressureLevel, sample: MemorySample) => void;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

/** The budget for a device class. iPads and phones get far less: Safari kills a tab at roughly 1 to 1.5 GB in total. */
export function deviceBudget(d: { mobile: boolean; deviceMemoryGB: number | null }): MemoryBudget {
  if (d.mobile) return { soft: 700 * MB, hard: 1000 * MB, device: 'tablet or phone' };
  if (d.deviceMemoryGB !== null && d.deviceMemoryGB <= 4) return { soft: 1.2 * GB, hard: 1.8 * GB, device: `desktop, ${d.deviceMemoryGB} GB` };
  return { soft: 2.5 * GB, hard: 3.5 * GB, device: 'desktop' };
}

export class MemoryWatchdog {
  readonly budget: MemoryBudget;
  private readonly owners = new Map<string, () => number>();
  private readonly shedders: Record<'soft' | 'hard', (() => void)[]> = { soft: [], hard: [] };
  private readonly armed = { soft: true, hard: true };
  private readonly samples: MemorySample[] = [];
  private level: PressureLevel = 'ok';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: WatchdogOptions) {
    this.budget = opts.budget;
  }

  /** A subsystem reports how many bytes it holds (GPU buffers, caches). Returns the function that stops tracking it. */
  track(owner: string, bytes: () => number): () => void {
    this.owners.set(owner, bytes);
    return () => { this.owners.delete(owner); };
  }

  /** Called when memory crosses the `soft` or `hard` budget. Returns the function that unregisters it. */
  onPressure(level: 'soft' | 'hard', shed: () => void): () => void {
    this.shedders[level].push(shed);
    return () => {
      const list = this.shedders[level];
      const i = list.indexOf(shed);
      if (i >= 0) list.splice(i, 1);
    };
  }

  /** Take one sample now: check the budget and shed if it is crossed. */
  sample(): MemorySample {
    const owners: Record<string, number> = {};
    let tracked = 0;
    for (const [name, bytes] of this.owners) {
      let b = 0;
      try { b = Math.max(0, bytes()); } catch { b = 0; }
      owners[name] = b;
      tracked += b;
    }
    const heap = this.opts.readHeap();
    // GPU memory and typed arrays handed to workers are not in the JS heap, so the tracked figure adds to it.
    // Owners that also live in the heap count twice; the budget leans safe on purpose.
    const total = (heap ?? 0) + tracked;
    const b = this.budget;
    if (total < b.soft * 0.9) this.armed.soft = true;
    if (total < b.hard * 0.9) this.armed.hard = true;
    let shed: 'soft' | 'hard' | null = null;
    if (total >= b.hard && this.armed.hard) { this.armed.hard = false; this.armed.soft = false; shed = 'hard'; }
    else if (total >= b.soft && this.armed.soft) { this.armed.soft = false; shed = 'soft'; }
    const level: PressureLevel = total >= b.hard ? 'hard' : total >= b.soft ? 'soft' : 'ok';
    const s: MemorySample = { t: this.opts.now(), heap, owners, total, level };
    this.samples.push(s);
    if (this.samples.length > (this.opts.keep ?? 120)) this.samples.shift();
    // A hard crossing sheds the cheap caches too.
    if (shed) this.shedNow(shed);
    if (level !== this.level) {
      this.level = level;
      this.opts.onLevel?.(level, s);
    }
    return s;
  }

  /** Give memory back now, as on crossing a budget (the debug menu): `soft` drops caches, `hard` everything not on screen. */
  shedNow(level: 'soft' | 'hard'): void {
    const run = level === 'hard' ? [...this.shedders.soft, ...this.shedders.hard] : this.shedders.soft;
    for (const f of run) { try { f(); } catch (e) { console.error('memory: a shedder failed', e); } }
  }

  /** Sample every `ms` milliseconds until `stop`. */
  start(ms = 2000): void {
    if (this.timer !== null) return;
    this.sample();
    this.timer = setInterval(() => this.sample(), ms);
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  get history(): readonly MemorySample[] {
    return this.samples;
  }

  get pressure(): PressureLevel {
    return this.level;
  }

  /** How fast the total grew over the kept history (bytes per minute); a steady climb while standing still is a leak. */
  growth(): number {
    const s = this.samples;
    if (s.length < 2) return 0;
    const a = s[0], b = s[s.length - 1];
    const dt = (b.t - a.t) / 60000;
    return dt > 0 ? (b.total - a.total) / dt : 0;
  }

  /** One line for the debug menu. */
  line(): string {
    const s = this.samples[this.samples.length - 1];
    if (!s) return 'memory: no sample yet';
    const parts = Object.entries(s.owners).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${mb(v)}`);
    const heap = s.heap === null ? 'heap n/a' : `heap ${mb(s.heap)}`;
    return `memory ${mb(s.total)} of ${mb(this.budget.soft)}/${mb(this.budget.hard)} (${this.budget.device}), ${heap}${parts.length ? ', ' + parts.join(', ') : ''}, ${this.growth() < 0 ? '−' : '+'}${mb(Math.abs(this.growth()))}/min`;
  }

  /** Every owner, largest first, and the totals of the last `n` samples, oldest first (the debug menu's details). */
  details(n = 15): string {
    const s = this.samples[this.samples.length - 1];
    if (!s) return '';
    const owners = Object.entries(s.owners).sort((x, y) => y[1] - x[1]).map(([k, v]) => `  ${k}: ${mb(v)}`);
    const totals = this.samples.slice(-n).map((x) => Math.round(x.total / MB)).join(' ');
    return [`memory by owner:`, ...owners, `last totals (MB): ${totals}`].join('\n');
  }
}

const mb = (b: number): string => `${Math.round(b / MB)} MB`;

/** The browser's own reading of the JS heap: Chromium's `performance.memory`, null elsewhere. */
export function browserHeap(): number | null {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m ? m.usedJSHeapSize : null;
}

/** This device's budget, from what the browser tells about it. */
export function thisDeviceBudget(): MemoryBudget {
  const nav = navigator as Navigator & { deviceMemory?: number };
  // iPadOS reports itself as a Mac; touch points give it away.
  const mobile = /iPhone|iPad|Android/i.test(nav.userAgent) || (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  return deviceBudget({ mobile, deviceMemoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null });
}

/**
 * The opening on the page (design "First Light"): the black frame under the header with the name over it, and the
 * worker that draws the opening into its canvas (worker.ts). Started by the page's first script (boot.ts) before the
 * game has loaded; main.ts ends it at the cut to shot 1, once the Outside view is drawing behind it, or the moment the
 * player goes anywhere else. Small on purpose: this file and boot.ts are all the page runs before its first frame.
 */
import type { FromWorker, ToWorker } from './worker';

/** How the opening's own frames went, from its worker: frames drawn, the slowest (ms), and how many stuttered. */
export interface OpeningFigures {
  frames: number;
  slowest: number;
  stutters: number;
}

export class FirstLight {
  private worker: Worker | null = null;
  private overlay: HTMLElement | null = null;
  private litAt: number | null = null;
  private memory = 0;
  private resolveLit: (at: number | null) => void = () => {};
  private resolveEnded: (f: OpeningFigures | null) => void = () => {};
  /** When the first frame was on screen (ms on this page's clock), or null if it never came. */
  readonly lit = new Promise<number | null>((done) => { this.resolveLit = done; });
  /** The opening's frame figures, once it has ended (null if it never drew). */
  readonly ended = new Promise<OpeningFigures | null>((done) => { this.resolveEnded = done; });
  /** What went wrong, if anything (the debug menu and the console show it). */
  readonly problems: string[] = [];
  /** Whether the opening is on screen (or about to be). */
  playing = false;

  /** Start the opening, if this browser can draw it in a worker. */
  begin(): void {
    const overlay = document.getElementById('first-light');
    const canvas = overlay?.querySelector('canvas');
    const header = document.querySelector('header.top');
    if (!overlay || !canvas || !header || !('gpu' in navigator) || typeof Worker === 'undefined' || !('transferControlToOffscreen' in canvas)) { this.leaveScreen(); return; }
    this.overlay = overlay;
    this.playing = true;
    // The frame starts under the header, wherever it wraps to.
    const fit = (): void => overlay.style.setProperty('--top', `${header.getBoundingClientRect().bottom}px`);
    new ResizeObserver(fit).observe(header);
    fit();
    const sized = (): { width: number; height: number } => {
      // As many pixels as the Outside view draws (createRenderer: device pixel ratio up to 2).
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      return { width: Math.round(overlay.clientWidth * ratio), height: Math.round(overlay.clientHeight * ratio) };
    };
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'first light' });
    this.worker = worker;
    worker.onmessage = (e: MessageEvent<FromWorker>) => this.fromWorker(e.data);
    worker.onerror = (e) => { this.problem(e.message || 'the opening could not start'); this.end(); };
    const offscreen = canvas.transferControlToOffscreen();
    const start: ToWorker = { type: 'start', canvas: offscreen, search: location.search, base: import.meta.env.BASE_URL, ...sized() };
    worker.postMessage(start, [offscreen]);
    new ResizeObserver(() => { if (this.worker) this.worker.postMessage({ type: 'size', ...sized() } satisfies ToWorker); }).observe(overlay);
  }

  private fromWorker(m: FromWorker): void {
    if (m.type === 'lit') {
      this.litAt = m.at - performance.timeOrigin;
      this.overlay?.classList.add('lit');
      this.resolveLit(this.litAt);
    } else if (m.type === 'bytes') this.memory = m.bytes;
    else if (m.type === 'problem') { this.problem(m.text); if (this.litAt === null) this.end(); }
    else if (m.type === 'ended') {
      // It ended on its own (its device was lost): off the screen too.
      if (this.playing) this.leaveScreen();
      this.memory = 0;
      this.worker?.terminate();
      this.worker = null;
      this.resolveEnded(this.litAt === null ? null : { frames: m.frames, slowest: m.slowest, stutters: m.stutters });
    }
  }

  private problem(text: string): void {
    this.problems.push(text);
    console.error(`first light: ${text}`);
  }

  /** Seconds since the first frame (0 before it). */
  elapsed(): number {
    return this.litAt === null ? 0 : (performance.now() - this.litAt) / 1000;
  }

  /** GPU memory the opening holds (bytes): its frame, the stars, Earth's and the Moon's maps. */
  heldBytes(): number {
    return this.memory;
  }

  /** The cut: the opening leaves the screen at once and its worker lets go of its device. */
  end(): void {
    if (!this.playing) return;
    this.leaveScreen();
    if (this.worker) {
      this.worker.postMessage({ type: 'end' } satisfies ToWorker);
      // A worker that cannot answer any more goes anyway.
      const w = this.worker;
      setTimeout(() => { if (this.worker === w) { w.terminate(); this.worker = null; this.memory = 0; this.resolveEnded(null); } }, 2000);
    }
  }

  private leaveScreen(): void {
    this.playing = false;
    document.documentElement.classList.add('no-opening');
    this.resolveLit(this.litAt);
    if (!this.worker) this.resolveEnded(null);
  }
}

/** The one opening of this page. */
export const firstLight = new FirstLight();

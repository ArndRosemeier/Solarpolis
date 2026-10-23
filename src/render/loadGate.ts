/**
 * Heavy steps that cannot be split wait for a cut (Arnd, 2026-10-23: the arrival is a cinematic, the warm-up runs
 * behind it). While the title or the arrival plays, a step that would freeze a frame for long (an Actors pack being
 * read, about 250 ms on the render PC) waits here until the camera cuts to the next shot: one held frame on a cut is
 * not seen, the same in the middle of a shot is a stutter. Everything waiting goes through at the same cut, and all
 * of it once the cinematic ends (`hold(false)`, behind the curtain or on leaving the title).
 */
export class LoadGate {
  private holding = false;
  private waiting: (() => void)[] = [];

  /** While held, `wait` waits for a cut; let go, it lets everything through. */
  hold(on: boolean): void {
    this.holding = on;
    if (!on) this.cut();
  }

  get held(): boolean {
    return this.holding;
  }

  /** How many steps wait for the next cut. */
  get waitingSteps(): number {
    return this.waiting.length;
  }

  /** The camera cut: everything waiting goes now. */
  cut(): void {
    const go = this.waiting;
    this.waiting = [];
    for (const f of go) f();
  }

  /** Resolves at once, or at the next cut while a cinematic plays. */
  wait(): Promise<void> {
    return this.holding ? new Promise((go) => this.waiting.push(go)) : Promise.resolve();
  }
}

/** The one gate (the views and the Actors packs share it). */
export const loadGate = new LoadGate();

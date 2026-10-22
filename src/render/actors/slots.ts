/**
 * Figures loading for the things a view draws near (people.ts, animals.ts): one loading at a time, each into its own
 * slot, which the view hands over to in the frame it first draws the figure (CLAUDE.md, rule 16). A slot dropped while
 * its figure loads lets the figure go when it arrives.
 */

/** One thing's figure: loading (`figure` null), arrived, or drawn in place of its stand-in (`shown`). */
export interface FigureSlot<F> {
  figure: F | null;
  shown: boolean;
  dropped: boolean;
}

export class FigureLoads<F extends { dispose(): void }> {
  /** How many figures are loading now. */
  loading = 0;

  /** `gone`: whether the view has been disposed (a figure arriving then is let go). */
  constructor(private readonly gone: () => boolean) {}

  /** Load a figure into a new slot; it is in the slot once it arrives, unless the slot was dropped by then. */
  load(make: () => Promise<F | null>): FigureSlot<F> {
    const slot: FigureSlot<F> = { figure: null, shown: false, dropped: false };
    this.loading++;
    void make().then((f) => {
      this.loading--;
      if (slot.dropped || this.gone()) { f?.dispose(); return; }
      slot.figure = f;
    }, () => { this.loading--; });
    return slot;
  }

  /** Let a slot's figure go (or, still loading, when it arrives). */
  drop(slot: FigureSlot<F> | null): void {
    if (!slot) return;
    slot.dropped = true;
    slot.figure?.dispose();
  }
}

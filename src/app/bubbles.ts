/**
 * The speech bubbles over the 3D view (design "Speech bubbles: how people talk in Solarpolis", Arnd 2026-10-23):
 * quiet cards with the speaker's name and words and a short tail to their head, or a small "…" farther out. Page text,
 * so it stays sharp at every size and costs the GPU nothing; it never takes the mouse (the world stays clickable).
 * Where they go and what they say is the renderer's (render/talk.ts): this only draws them.
 */
import type { Bubble } from '../render/talk';
import { el } from './dom';

/** Frames a bubble's card is kept after its speaker stops (it fades out meanwhile). */
const LINGER = 20;
/** The card's size by the speaker's distance: full up to `near` m, down to `far` share at `words` m. */
const SIZE = { near: 6, far: 0.78 };

interface Card {
  box: HTMLDivElement;
  name: HTMLSpanElement;
  text: HTMLSpanElement;
  /** The words it shows (null: "…"; undefined: nothing yet). */
  shown: string | null | undefined;
  missing: number;
}

export class SpeechBubbles {
  readonly box = el('div', 'speech');
  private readonly cards = new Map<string, Card>();

  constructor(private readonly words: () => number) {
    this.box.setAttribute('aria-live', 'polite');
  }

  showBubbles(bubbles: readonly Bubble[]): void {
    const seen = new Set<string>(), words = this.words();
    for (const b of bubbles) {
      seen.add(b.id);
      let c = this.cards.get(b.id);
      if (!c) {
        c = { box: el('div', 'bubble'), name: el('span', 'bubble-name'), text: el('span', 'bubble-text'), shown: undefined, missing: 0 };
        c.box.append(c.name, c.text);
        this.box.append(c.box);
        this.cards.set(b.id, c);
      }
      c.missing = 0;
      if (c.shown !== b.text) {
        c.shown = b.text;
        c.name.textContent = b.text ? b.name : '';
        c.text.textContent = b.text ?? '…';
        c.box.classList.toggle('dots', !b.text);
      }
      const k = b.distance <= SIZE.near ? 1 : Math.max(SIZE.far, 1 - ((1 - SIZE.far) * (b.distance - SIZE.near)) / Math.max(1e-3, words - SIZE.near));
      c.box.style.transform = `translate(${b.x.toFixed(1)}px, ${b.y.toFixed(1)}px) translate(-50%, -100%) scale(${k.toFixed(3)})`;
      c.box.classList.add('on');
    }
    for (const [id, c] of this.cards) {
      if (seen.has(id)) continue;
      c.box.classList.remove('on');
      if (++c.missing > LINGER) { c.box.remove(); this.cards.delete(id); }
    }
  }
}

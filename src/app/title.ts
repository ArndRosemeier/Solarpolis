/**
 * The title card over the attract loop (design "Solarpolis: the outside", "The title sequence"): the name fades in
 * over the first shot. Start lets the ship carry on to its berth (render/outside.ts, `arrive`), with the card gone;
 * any key, on the card or during the arrival, skips straight in for returning players. The flight behind it is the
 * Outside view playing its attract loop (`startAttract`).
 */
import { button, el } from './dom';

export class TitleCard {
  readonly root = el('div', 'title-card');
  /** Off; showing over the attract loop; or gone while the arrival plays (keys still skip it). */
  private state: 'off' | 'title' | 'arriving' = 'off';

  constructor(start: () => void, skip: () => void) {
    const name = el('h2', 'title-name', 'Solarpolis');
    const line = el('p', 'title-line', 'A habitat in the geostationary ring, in the year 3026');
    const go = button('title-start', 'Start', () => start());
    const hint = el('p', 'title-hint', 'or press any key to go straight in');
    const top = el('div', 'title-top'), bottom = el('div', 'title-bottom');
    top.append(name, line);
    bottom.append(go, hint);
    this.root.append(top, bottom);
    this.root.hidden = true;
    window.addEventListener('keydown', (e) => {
      // Any plain key; not the debug menu's chord or other shortcuts.
      if (this.state === 'off' || e.repeat || e.ctrlKey || e.altKey || e.metaKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      skip();
    });
  }

  show(on: boolean): void {
    this.state = on ? 'title' : 'off';
    this.root.hidden = !on;
    if (on) this.fade(0);
  }

  /** Start pressed: the card goes, the arrival plays behind where it was. */
  arriving(): void {
    this.state = 'arriving';
    this.root.hidden = true;
  }

  /** How far the card has faded in (0–1). */
  fade(x: number): void {
    this.root.style.setProperty('--fade', String(x));
  }
}

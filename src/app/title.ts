/**
 * The title card over the attract loop (design "Solarpolis: the outside", "The title sequence"): the name fades in
 * over the first shot, Start (or any key, for returning players) goes in. The flight behind it is the Outside view
 * playing its attract loop (render/outside.ts, `startAttract`).
 */
import { button, el } from './dom';

export class TitleCard {
  readonly root = el('div', 'title-card');
  private on = false;

  constructor(start: () => void) {
    const name = el('h2', 'title-name', 'Solarpolis');
    const line = el('p', 'title-line', 'A habitat in the geostationary ring, in the year 3026');
    const go = button('title-start', 'Start', () => start());
    const hint = el('p', 'title-hint', 'or press any key');
    const top = el('div', 'title-top'), bottom = el('div', 'title-bottom');
    top.append(name, line);
    bottom.append(go, hint);
    this.root.append(top, bottom);
    this.root.hidden = true;
    window.addEventListener('keydown', (e) => {
      // Any plain key; not the debug menu's chord or other shortcuts.
      if (!this.on || e.repeat || e.ctrlKey || e.altKey || e.metaKey || ['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return;
      e.preventDefault();
      start();
    });
  }

  show(on: boolean): void {
    this.on = on;
    this.root.hidden = !on;
    if (on) this.fade(0);
  }

  /** How far the card has faded in (0–1). */
  fade(x: number): void {
    this.root.style.setProperty('--fade', String(x));
  }
}

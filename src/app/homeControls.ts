import { button, el } from './dom';
import { HOME_MODES, type HomeMode } from '../gen/homeInterior';
import type { RoomState } from '../render/homes';

/** The room's ambient controls, available only while inside it. */
export class HomeControls {
  readonly root = el('div', 'home-controls');
  private readonly status = el('p', 'home-status');
  private readonly choices = new Map<HomeMode | null, HTMLButtonElement>();
  constructor(choose: (mode: HomeMode | null) => void) {
    this.root.append(el('span', 'home-eyebrow', 'RESPONSIVE HOME'), this.status);
    const row = el('div', 'home-choices');
    const labels = { gather: 'Gather', focus: 'Focus', rest: 'Rest', clear: 'Clear floor' };
    for (const mode of [null, ...HOME_MODES]) {
      const b = button('', mode ? labels[mode] : 'Follow residents', () => choose(mode));
      row.append(b); this.choices.set(mode, b);
    }
    this.root.append(row); this.root.hidden = true;
  }
  updateRoom(state: RoomState | null): void {
    this.root.hidden = !state;
    if (!state) return;
    this.status.textContent = `${state.automatic ? state.lived ? 'Following the household' : 'Available space' : 'Your arrangement'} · ${state.mode === 'clear' ? 'Open space' : state.mode} · Level ${state.floor + 1}`;
    for (const [mode, b] of this.choices) {
      const active = state.automatic ? mode === null : mode === state.mode;
      b.classList.toggle('on', active); b.setAttribute('aria-pressed', String(active));
    }
  }
}

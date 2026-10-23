import type { Habitat } from '../blueprint';
import { button, el } from './dom';

/** A quiet welcome over the reveal, then practical directions while the player remains on the overlook. */
export class ArrivalCard {
  readonly root = el('div', 'arrival-card');
  private readonly skip;
  private readonly label = el('p', 'arrival-eyebrow');
  private readonly title = el('h2', 'arrival-name');
  private readonly scale = el('p', 'arrival-scale');
  constructor(h: Habitat, where: string, stepOut: () => void) {
    const route = el('div', 'arrival-route');
    route.append(el('strong', '', 'Lift Stair · Gardens & commons'), el('p', '', 'Follow the bronze arrows. Gravity grows as you descend.'));
    this.skip = button('arrival-skip', 'Step onto the terrace', stepOut);
    this.root.append(this.label, this.title, this.scale, route, this.skip);
    this.root.hidden = true;
    this.describe(h, where);
  }
  /** The habitat arrived at, and where in the system it is (a visit, docs/system.md). */
  describe(h: Habitat, where: string): void {
    this.label.textContent = `PORT ARRIVAL · ${where.toUpperCase()} · 3026`;
    this.title.textContent = h.params.mind;
    this.scale.textContent = `${(h.radius * 2 / 1000).toLocaleString('en-GB')} km across · ${(h.length / 1000).toLocaleString('en-GB')} km long · ${h.params.population.toLocaleString('en-GB')} residents`;
  }
  show(progress: number, nearby: boolean): void {
    this.root.hidden = !nearby;
    this.root.classList.toggle('arrived', progress >= 1);
    this.root.classList.toggle('welcoming', progress > 0.18);
    this.skip.hidden = progress >= 1;
  }
}

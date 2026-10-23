import type { Habitat } from '../blueprint';
import { button, el } from './dom';

/** A quiet welcome over the reveal, then practical directions while the player remains on the overlook. */
export class ArrivalCard {
  readonly root = el('div', 'arrival-card');
  private readonly skip;
  constructor(h: Habitat, stepOut: () => void) {
    const label = el('p', 'arrival-eyebrow', 'PORT ARRIVAL · THE NECKLACE · 3026');
    const title = el('h2', 'arrival-name', h.params.mind);
    const scale = el('p', 'arrival-scale', `${(h.radius * 2 / 1000).toLocaleString('en-GB')} km across · ${(h.length / 1000).toLocaleString('en-GB')} km long · ${h.params.population.toLocaleString('en-GB')} residents`);
    const route = el('div', 'arrival-route');
    route.append(el('strong', '', 'Lift Stair · Gardens & commons'), el('p', '', 'Follow the bronze arrows. Gravity grows as you descend.'));
    this.skip = button('arrival-skip', 'Step onto the terrace', stepOut);
    this.root.append(label, title, scale, route, this.skip);
    this.root.hidden = true;
  }
  show(progress: number, nearby: boolean): void {
    this.root.hidden = !nearby;
    this.root.classList.toggle('arrived', progress >= 1);
    this.root.classList.toggle('welcoming', progress > 0.18);
    this.skip.hidden = progress >= 1;
  }
}

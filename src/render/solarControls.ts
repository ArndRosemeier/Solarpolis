/** The outside observer's catalogue. Navigation changes the observer, never a body's scale or orbit. */
import type { SolarSystem } from '../space/solarSystem';
import { AU } from '../space/constants';
import './solar.css';

export class SolarControls {
  readonly element = document.createElement('details');
  private select = document.createElement('select');
  private information = document.createElement('p');
  private status = document.createElement('p');

  constructor(private system: SolarSystem, observe: (id: string) => void, home: () => void, speed: (n: number) => void) {
    this.element.className = 'solar-controls';
    const summary = document.createElement('summary'); summary.textContent = 'Solar system';
    const intro = document.createElement('p'); intro.textContent = 'A real-scale view of the worlds around us.';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Find a planet or moon'; search.setAttribute('aria-label', 'Find a planet or moon');
    this.select.setAttribute('aria-label', 'Celestial body');
    const fill = (): void => {
      const current = this.select.value, query = search.value.toLowerCase();
      this.select.replaceChildren();
      for (const b of system.bodies) {
        if (!`${b.name} ${b.parent}`.toLowerCase().includes(query)) continue;
        const option = document.createElement('option'); option.value = b.id;
        option.textContent = b.kind === 'moon' ? `${b.name} — ${system.byId.get(b.parent)!.name}` : b.name;
        this.select.append(option);
      }
      if (Array.from(this.select.options).some(o => o.value === current)) this.select.value = current;
      this.describe();
    };
    search.addEventListener('input', fill); this.select.addEventListener('change', () => this.describe());
    const go = document.createElement('button'); go.textContent = 'Observe'; go.addEventListener('click', () => { if (this.select.value) observe(this.select.value); });
    const back = document.createElement('button'); back.textContent = 'Return to habitat'; back.addEventListener('click', home);
    const buttons = document.createElement('div'); buttons.className = 'solar-actions'; buttons.append(go, back);
    const clock = document.createElement('select'); clock.setAttribute('aria-label', 'Outside clock speed');
    for (const [value, label] of [[0, 'Paused'], [1, 'Real time'], [3600, 'One hour / second'], [86400, 'One day / second'], [31557600, 'One year / second']] as const) {
      const option = document.createElement('option'); option.value = String(value); option.textContent = label; clock.append(option);
    }
    clock.value = '1'; clock.addEventListener('change', () => speed(Number(clock.value)));
    this.status.className = 'solar-status'; this.information.className = 'solar-information';
    this.element.append(summary, intro, search, this.select, this.information, buttons, clock, this.status);
    fill(); this.select.value = 'saturn'; this.describe();
  }

  private describe(): void {
    const b = this.system.byId.get(this.select.value);
    if (!b) { this.information.textContent = 'No matching body'; return; }
    const moon = this.system.moons.get(b.id);
    const uncertainty = b.radiusKnown === false ? ' Size is an estimate.' : '';
    this.information.textContent = `${b.kind[0].toUpperCase() + b.kind.slice(1)} · ${(b.radius * 2 / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} km across.${uncertainty}`
      + (moon ? ` Mean orbit: ${(moon.a).toLocaleString('en')} km from ${this.system.byId.get(b.parent)!.name}; future phase approximate.` : '');
  }

  update(date: string, id: string | null, sunDistance: number): void {
    this.status.textContent = `${date} · ${(sunDistance / AU).toFixed(2)} AU from the Sun${id ? ` · observing ${this.system.byId.get(id)?.name ?? id}` : ''}`;
  }
}

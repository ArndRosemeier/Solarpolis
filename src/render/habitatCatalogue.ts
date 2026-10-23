/**
 * The habitats' part of the Solar system catalogue (plan "The Whole System", S2): the world bible's polities and the
 * Necklace, each told as a citizen's overlay would tell it (what it is, where, how many live there, its Mind), with
 * how long its light takes to reach home right now. Observe goes to what it orbits, where its light shows among the
 * others (habitatLights.ts). Whatever else is lit in sight is counted.
 */
import { centreOf, type HabitatRecord, type Ledger, type Polity } from '../system';
import type { SolarSystem } from '../space/solarSystem';
import './habitats.css';

const TIERS = { major: 'Major polity', significant: 'Polity', minor: 'Minor polity' } as const;
const FORMS = { cylinder: 'cylinder', torus: 'torus', bubble: 'bubble', asteroid: 'hollowed asteroid', swarm: 'swarm', water: 'water drum', surface: 'settlement' } as const;

/** A light time in words: seconds, minutes, or hours and minutes. */
export function lightWords(s: number): string {
  if (s < 90) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** How many people, in words. */
function people(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} billion` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} million` : `${Math.round(n / 1000).toLocaleString('en')} thousand`;
}

export class HabitatCatalogue {
  readonly element = document.createElement('details');
  private select = document.createElement('select');
  private information = document.createElement('p');
  private status = document.createElement('p');
  private observeButton = document.createElement('button');
  private people = 0;

  /** `observe` takes a body id; `naming` turns the names beside the points on and off. */
  constructor(private ledger: Ledger, private system: SolarSystem, observe: (body: string) => void, naming: (on: boolean) => void) {
    this.element.className = 'solar-habitats';
    const summary = document.createElement('summary'); summary.textContent = 'Habitats';
    this.select.setAttribute('aria-label', 'Polity');
    this.select.addEventListener('change', () => this.describe(this.lastT));
    this.observeButton.textContent = 'Observe its world';
    this.observeButton.addEventListener('click', () => { const h = this.seat(); if (h) observe(centreOf(h.orbit)); });
    const names = document.createElement('label'), box = document.createElement('input');
    box.type = 'checkbox'; box.checked = true; box.addEventListener('change', () => naming(box.checked));
    names.append(box, ' Name them in view');
    const buttons = document.createElement('div'); buttons.className = 'solar-actions'; buttons.append(this.observeButton);
    this.information.className = 'solar-information'; this.status.className = 'solar-status';
    this.element.append(summary, this.select, this.information, buttons, names, this.status);
    // Everyone counted once the catalogue is first opened: going through every habitat takes a moment.
    this.element.addEventListener('toggle', () => {
      if (!this.element.open || this.people) return;
      let n = 0;
      this.ledger.each((h) => { n += h.population; });
      this.people = n;
    });
    this.reset(ledger);
  }

  private lastT = 0;

  /** Another ledger (the Lab changed the home habitat). */
  reset(ledger: Ledger): void {
    this.ledger = ledger;
    this.people = 0;
    this.select.replaceChildren();
    const order = [...ledger.polities.filter((p) => p.canon), ...ledger.polities.filter((p) => !p.canon)];
    for (const p of order) {
      const option = document.createElement('option'); option.value = p.id;
      option.textContent = p.canon ? p.name : `${p.name} — the Necklace`;
      this.select.append(option);
    }
    this.describe(this.lastT);
  }

  private polity(): Polity | undefined { return this.ledger.polity(this.select.value); }
  private seat(): HabitatRecord | undefined { const p = this.polity(); return p && this.ledger.habitat(p.habitats[0]); }

  /** Where a habitat is, in words. */
  private where(h: HabitatRecord): string {
    const o = h.orbit, name = (id: string): string => this.system.byId.get(id)?.name ?? id;
    switch (o.kind) {
      case 'necklace': return 'in the Necklace, Earth’s geostationary ring';
      case 'lagrange': return `at the Earth–Moon L${o.point}`;
      case 'circle': return `in orbit about ${name(o.body)}`;
      case 'surface': return `on ${name(o.body)}`;
      case 'asteroid': return o.belt === 'kuiper' ? 'in the outer dark, on a Kuiper object' : o.belt === 'trojan' ? 'among Jupiter’s Trojans' : 'in the Belt';
      case 'sun': return `on its own orbit about the Sun`;
    }
  }

  /** Tell of the chosen polity at clock time t. */
  private describe(t: number): void {
    const p = this.polity(), h = this.seat();
    if (!p || !h) { this.information.textContent = ''; return; }
    const all = p.habitats.map((id) => this.ledger.habitat(id)!), many = all.reduce((s, x) => s + x.population, 0);
    const lag = h.id === 'home' ? null : this.ledger.arrival(h.id, t, 'home') - t;
    this.information.textContent = [
      `${TIERS[p.tier]} · ${all.length > 1 ? `${all.length} habitats` : FORMS[h.form]} ${this.where(h)} · ${people(many)} people.`,
      p.note ?? '',
      `Steward Mind: ${h.mind}.`,
      lag === null ? 'Home.' : `Its light takes ${lightWords(lag)} to reach home.`,
    ].filter(Boolean).join(' ');
    this.observeButton.disabled = centreOf(h.orbit) === 'sun' || h.id === 'home';
  }

  /** Every quarter second or so: light times move with the clock; `lit` habitats are in sight now. */
  update(t: number, lit: number): void {
    this.lastT = t;
    if (this.element.open) this.describe(t);
    const all = this.people ? `, ${people(this.people)} people` : '';
    this.status.textContent = `${this.ledger.count.toLocaleString('en')} habitats${all} · ${lit.toLocaleString('en')} in sight`;
  }
}

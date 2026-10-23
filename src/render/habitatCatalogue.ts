/**
 * The habitats' part of the Solar system catalogue (plan "The Whole System", S2): the world bible's polities and the
 * Necklace, each told as a citizen's overlay would tell it (what it is, where, how many live there, its Mind), with
 * how long its light takes to reach home right now. Observe goes to what it orbits, where its light shows among the
 * others (habitatLights.ts). Whatever else is lit in sight is counted. Visit goes there (a proof of concept: one arrives
 * at once, with the times a sail, a coasting torch ship and a hurry would take; docs/system.md).
 */
import { blueprintOf, centreOf, tripsTo, placeInWords, type HabitatRecord, type Ledger, type Polity, type TravelWay } from '../system';
import { AU } from '../space/constants';
import './habitats.css';

const TIERS = { major: 'Major polity', significant: 'Polity', minor: 'Minor polity' } as const;
const FORMS = { cylinder: 'cylinder', torus: 'torus', bubble: 'bubble', asteroid: 'hollowed asteroid', swarm: 'swarm', water: 'water drum', surface: 'settlement' } as const;

/** A light time in words: seconds, minutes, or hours and minutes. */
export function lightWords(s: number): string {
  if (s < 1) return 'under a second';
  if (s < 90) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** A trip's length in words: hours, days or months. */
export function tripWords(s: number): string {
  const h = s / 3600, d = h / 24;
  if (h < 1) return `${Math.max(1, Math.round(s / 60))} min`;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  if (d < 60) return `${Math.round(d)} days`;
  return `${(d / 30.44).toFixed(d < 300 ? 1 : 0)} months`;
}

const WAYS: Record<TravelWay, string> = { sail: 'by sail', coast: 'by coasting torch ship', hurry: 'in a hurry' };

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
  private visitButton = document.createElement('button');
  private homeButton = document.createElement('button');
  private trip = document.createElement('p');
  private people = 0;
  /** The habitat the player is at ('home' unless visiting). */
  private at = 'home';

  /**
   * `observe` takes a body id; `naming` turns the names beside the points on and off; `visit` takes a habitat id
   * ('home' to go back).
   */
  constructor(private ledger: Ledger, observe: (body: string) => void, naming: (on: boolean) => void, visit: (id: string) => void) {
    this.element.className = 'solar-habitats';
    const summary = document.createElement('summary'); summary.textContent = 'Habitats';
    this.select.setAttribute('aria-label', 'Polity');
    this.select.addEventListener('change', () => this.describe(this.lastT));
    this.observeButton.textContent = 'Observe its world';
    this.observeButton.addEventListener('click', () => { const h = this.seat(); if (h) observe(centreOf(h.orbit)); });
    const names = document.createElement('label'), box = document.createElement('input');
    box.type = 'checkbox'; box.checked = true; box.addEventListener('change', () => naming(box.checked));
    names.append(box, ' Name them in view');
    this.visitButton.textContent = 'Visit';
    this.visitButton.addEventListener('click', () => { const h = this.seat(); if (h) visit(h.id); });
    this.homeButton.textContent = 'Return home';
    this.homeButton.addEventListener('click', () => visit('home'));
    const buttons = document.createElement('div'); buttons.className = 'solar-actions'; buttons.append(this.observeButton, this.visitButton, this.homeButton);
    this.information.className = 'solar-information'; this.status.className = 'solar-status'; this.trip.className = 'solar-trip';
    this.element.append(summary, this.select, this.information, this.trip, buttons, names, this.status);
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
    this.at = 'home';
    const order = [...ledger.polities.filter((p) => p.canon), ...ledger.polities.filter((p) => !p.canon)];
    for (const p of order) {
      const option = document.createElement('option'); option.value = p.id;
      option.textContent = p.canon ? p.name : `${p.name} — the Necklace`;
      this.select.append(option);
    }
    this.describe(this.lastT);
  }

  /** The player is now at habitat `id` ('home' when back). */
  setAt(id: string): void {
    this.at = id;
    this.describe(this.lastT);
  }

  /** Show one habitat (a name clicked in view): a polity's, or one of the many, which gets an entry of its own. */
  showHabitat(id: string): void {
    const h = this.ledger.habitat(id);
    if (!h) return;
    const owner = this.ledger.polities.find((p) => p.habitats.includes(id));
    if (owner && owner.habitats[0] === id) this.select.value = owner.id;
    else {
      let option = [...this.select.options].find((o) => o.value === `habitat:${id}`);
      if (!option) {
        option = document.createElement('option'); option.value = `habitat:${id}`;
        option.textContent = `${h.name} — ${placeInWords(h)}`;
        this.select.append(option);
      }
      this.select.value = option.value;
    }
    this.element.open = true;
    const panel = this.element.parentElement?.closest('details');
    if (panel) panel.open = true;
    this.describe(this.lastT);
  }

  private polity(): Polity | undefined { return this.ledger.polity(this.select.value); }
  private seat(): HabitatRecord | undefined {
    const v = this.select.value;
    if (v.startsWith('habitat:')) return this.ledger.habitat(v.slice(8));
    const p = this.polity();
    return p && this.ledger.habitat(p.habitats[0]);
  }

  /** Tell of the chosen polity at clock time t. */
  private describe(t: number): void {
    const p = this.polity(), h = this.seat();
    this.homeButton.hidden = this.at === 'home';
    if (!h) { this.information.textContent = ''; this.trip.textContent = ''; return; }
    const all = p ? p.habitats.map((id) => this.ledger.habitat(id)!) : [h], many = all.reduce((s, x) => s + x.population, 0);
    const lag = h.id === 'home' ? null : this.ledger.arrival(h.id, t, 'home') - t;
    this.information.textContent = [
      p ? `${TIERS[p.tier]} ·` : '',
      `${all.length > 1 ? `${all.length} habitats` : FORMS[h.form]} ${placeInWords(h)} · ${people(many)} people.`,
      p?.note ?? '',
      `Steward Mind: ${h.mind}.`,
      lag === null ? 'Home.' : `Its light takes ${lightWords(lag)} to reach home.`,
    ].filter(Boolean).join(' ');
    this.observeButton.disabled = centreOf(h.orbit) === 'sun' || h.id === 'home';
    this.describeTrip(h, t);
  }

  /** How far it is from where the player is, how long each way of going takes, and whether one can walk in yet. */
  private describeTrip(h: HabitatRecord, t: number): void {
    const here = this.ledger.habitat(this.at);
    const away = this.at === 'home' ? '' : `You are visiting ${here?.name ?? this.at}. `;
    const canVisit = h.id !== this.at && h.id !== 'home' && blueprintOf(this.ledger, h.id) !== null;
    this.visitButton.disabled = !canVisit;
    if (h.id === this.at) { this.trip.textContent = `${away}You are here.`; return; }
    if (h.id === 'home' && this.at === 'home') { this.trip.textContent = ''; return; }
    const trip = tripsTo(this.ledger, this.at, h.id, t), au = trip.distance / AU;
    const far = au >= 0.01 ? `${au.toFixed(au < 1 ? 2 : 1)} AU` : `${Math.round(trip.distance / 1000).toLocaleString('en')} km`;
    const ways = (Object.keys(WAYS) as TravelWay[]).map((w) => `${tripWords(trip.times[w])} ${WAYS[w]}`).join(', ');
    const why = canVisit || h.id === 'home' ? 'For now you arrive at once (a proof of concept).' : h.form === 'surface' ? 'No way to walk in yet: settlements come later.' : 'Too small to walk in yet.';
    this.trip.textContent = `${away}From ${here?.name ?? 'here'}: ${far}, ${ways}. ${why}`;
  }

  /** Every quarter second or so: light times move with the clock; `lit` habitats are in sight now. */
  update(t: number, lit: number): void {
    this.lastT = t;
    if (this.element.open) this.describe(t);
    const all = this.people ? `, ${people(this.people)} people` : '';
    this.status.textContent = `${this.ledger.count.toLocaleString('en')} habitats${all} · ${lit.toLocaleString('en')} in sight`;
  }
}

/** The passenger's computer: itinerary, observations and time controls. Flight belongs to the Mind. */
import { v3add, v3cross, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { el, button, km, svg } from './dom';
import { AU, DAY } from '../space/constants';
import { calendarOf } from '../space/time';
import type { Space } from '../space/space';
import type { SolarSystem } from '../space/solarSystem';
import { TOUR_SHIP, TOUR_RESERVE, voyageAt, type VoyagePlan, type VoyageState } from '../space/voyage';
import './voyage.css';
import { sharedPool } from '../workers/pool';

const duration = (s: number): string => s >= DAY ? `${(s / DAY).toFixed(1)} days` : s >= 3600 ? `${(s / 3600).toFixed(1)} hours` : s >= 60 ? `${Math.floor(s / 60)} min` : `${Math.max(0, Math.floor(s))} s`;
const range = (m: number): string => m > AU * .1 ? `${(m / AU).toFixed(3)} AU` : km(m);

export class VoyageComputer {
  readonly element = el('section', 'voyage-computer');
  active = false;
  plan: VoyagePlan | null = null;
  state: VoyageState | null = null;
  clock = 0;
  scale = 1;
  private planning = false;
  private request = 0;
  private selected = 'moon';
  private catalogue = el('details', 'voyage-catalogue');
  private tree = el('div', 'voyage-tree');
  private description = el('p', 'voyage-description');
  private message = el('p', 'voyage-message');
  private launch = button('voyage-launch', 'Ask the ship to take us there', () => this.planTrip());
  private hud = el('section', 'voyage-hud');
  private compact = button('voyage-compact', 'Minimise computer', () => this.compactHud(!this.hud.classList.contains('compact')));
  private phase = el('h2', '');
  private stats = el('p', 'voyage-stats');
  private progress = el('progress', '');
  private itinerary = el('ol', 'voyage-itinerary');
  private chart = svg('svg', { viewBox: '0 0 480 200', role: 'img', 'aria-label': 'Planned round trip projected onto the ecliptic plane' });
  private marker = svg('circle', { r: 4, fill: '#ffe6a3' });
  private chartScale = 1;
  private chartCenter: [number, number] = [0, 0];
  private observation = el('p', 'voyage-observation');
  private encounters = el('div', 'voyage-encounters');
  private speed = el('select', '');
  private direction = el('select', '');
  private bodySelect = el('select', '');
  private instrument = el('select', '');
  private mode = 'destination';
  private watched = 'moon';
  private zoom = 1;
  private yaw = 0;
  private pitch = 0;
  private updateClock = 0;

  constructor(private system: SolarSystem, private getSpace: () => Space, private getTime: () => number, private departed: () => void, visit: () => void) {
    this.element.hidden = true;
    const summary = el('summary', '', 'Choose a destination'); this.catalogue.open = true;
    const name = el('h2', '', TOUR_SHIP.name);
    const welcome = el('p', 'voyage-welcome', 'Your ship is your host. Choose a world; I’ll plan the burns, two observation orbits, and our return to the cylinder.');
    const search = el('input', ''); search.type = 'search'; search.placeholder = 'Find a world or moon'; search.setAttribute('aria-label', 'Search destinations');
    search.addEventListener('input', () => this.fillTree(search.value));
    this.message.setAttribute('role', 'status');
    const cancel = button('', 'Cancel planning', () => { this.request++; this.planning = false; this.launch.disabled = false; this.message.textContent = 'Planning cancelled. Your current voyage is unchanged.'; this.refresh(); });
    cancel.className = 'voyage-cancel';
    this.catalogue.append(summary, name, welcome, search, this.tree, this.description, this.launch, cancel, this.message);
    this.progress.max = 1; this.progress.setAttribute('aria-label', 'Voyage completion');
    const instruments = el('div', 'voyage-instruments');
    const selector = (select: HTMLSelectElement, label: string, values: [string, string][]): HTMLLabelElement => {
      select.setAttribute('aria-label', label);
      for (const [value, text] of values) { const o = el('option', '', text); o.value = value; select.append(o); }
      const wrap = el('label', '', label); wrap.append(select); return wrap;
    };
    instruments.append(selector(this.speed, 'Voyage clock', [['0', 'Paused'], ['1', 'Real time · 1×'], ['60', '1 minute / second'], ['3600', '1 hour / second'], ['86400', '1 day / second'], ['604800', '1 week / second']]));
    this.speed.value = '1'; this.speed.addEventListener('change', () => { this.scale = Number(this.speed.value); });
    instruments.append(selector(this.direction, 'Look toward', [['destination', 'Destination'], ['home', 'Home cylinder'], ['forward', 'Bow'], ['aft', 'Stern'], ['port', 'Port'], ['starboard', 'Starboard'], ['above', 'Dorsal'], ['below', 'Ventral'], ['body', 'Selected body']]));
    this.direction.addEventListener('change', () => { this.mode = this.direction.value; this.yaw = 0; this.pitch = 0; this.zoom = 1; this.refresh(); });
    instruments.append(selector(this.instrument, 'Observation mode', [['window', 'Actual view'], ['telescope', 'Optical magnification'], ['model', 'Close-up reconstruction']]));
    this.instrument.addEventListener('change', () => { this.zoom = 1; this.refresh(); });
    const bodies: [string, string][] = system.bodies.map(b => [b.id, b.kind === 'moon' ? `${b.name} · ${system.byId.get(b.parent)!.name}` : b.name]);
    instruments.append(selector(this.bodySelect, 'Observe a world', bodies));
    this.bodySelect.value = 'moon';
    this.bodySelect.addEventListener('change', () => { this.watched = this.bodySelect.value; this.mode = 'body'; this.direction.value = 'body'; this.yaw = 0; this.pitch = 0; this.refresh(); });
    const details = el('details', 'voyage-details'), detailTitle = el('summary', '', 'Itinerary & propulsion');
    const envelope = el('p', '', 'Fusion torch · 9,000 km/s exhaust · 9,600 t propellant · 12% return reserve. Powered transfers use 1 g. Turnovers and fuel-saving coasts are freefall; observation laps use small corrections. Engine power and heat rejection are speculative 3026 engineering.');
    this.chart.classList.add('voyage-chart');
    details.append(detailTitle, this.chart, el('p', '', 'Route projected onto the ecliptic plane. Gold: ship. Teal: outbound. Amber: homeward.'), this.itinerary, envelope);
    this.hud.append(this.compact, this.phase, this.progress, this.stats, instruments, this.observation, this.encounters, button('voyage-visit', 'Visit the passenger decks', visit), details);
    this.element.append(this.catalogue, this.hud);
    this.fillTree(''); this.describe(); this.refresh();
  }

  private fillTree(query: string): void {
    this.tree.replaceChildren(); const q = query.trim().toLowerCase();
    const choose = (id: string): HTMLButtonElement => {
      const b = this.system.byId.get(id)!;
      const pick = button('', b.name, () => { this.selected = id; this.describe(); for (const n of this.tree.querySelectorAll<HTMLButtonElement>('button[data-body]')) n.setAttribute('aria-pressed', String(n.dataset.body === id)); });
      pick.dataset.body = id; pick.setAttribute('aria-pressed', String(this.selected === id)); return pick;
    };
    for (const parent of this.system.bodies.filter(b => b.kind !== 'moon' && b.kind !== 'star')) {
      const all = this.system.bodies.filter(b => b.parent === parent.id), match = parent.name.toLowerCase().includes(q);
      const children = all.filter(b => match || b.name.toLowerCase().includes(q));
      if (!match && !children.length) continue;
      const group = el('details', 'voyage-branch'), heading = el('summary', '', `${parent.name}${all.length ? ` · ${all.length} ${all.length === 1 ? 'moon' : 'moons'}` : ''}`);
      group.open = !!q || parent.id === 'earth';
      const list = el('ul', ''); const entry = el('li', ''); entry.append(choose(parent.id)); list.append(entry);
      for (const moon of children) { const row = el('li', 'voyage-moon'); row.append(choose(moon.id)); list.append(row); }
      group.append(heading, list); this.tree.append(group);
    }
    if (!this.tree.childElementCount) this.tree.append(el('p', '', 'No matching worlds.'));
  }
  private describe(): void {
    const body = this.system.byId.get(this.selected)!;
    this.description.textContent = `${body.name} · ${body.kind} · ${km(body.radius * 2)} across.${body.radiusKnown === false ? ' Size estimated.' : ''}${body.kind === 'moon' ? ' Future moon phase is approximate; small-moon masses may be estimates.' : ''}`;
    this.launch.disabled = this.planning || !!this.plan && this.clock < this.plan.end;
    if (this.plan && this.clock < this.plan.end) this.message.textContent = 'A voyage is under way. You can choose the next destination after we return.';
  }
  private planTrip(): void {
    if (this.planning || this.plan && this.clock < this.plan.end) return;
    this.launch.disabled = true; this.message.textContent = 'The Mind is solving both rendezvous, checking clearances and reserving fuel for home…';
    const request = ++this.request; this.planning = true; this.refresh();
    void sharedPool().job({ kind: 'voyage', space: this.getSpace().params, target: this.selected, start: this.getTime(), base: new URL(import.meta.env.BASE_URL, location.href).href }).then(answer => {
      if (request !== this.request) return;
      this.planning = false;
      if (!('kind' in answer) || answer.kind !== 'voyage') throw new Error('Unexpected flight planner reply');
      this.plan = answer.plan; this.clock = this.plan.start; this.scale = 1; this.speed.value = '1';
      this.watched = this.plan.target; this.bodySelect.value = this.watched; this.mode = 'destination'; this.direction.value = this.mode;
      this.catalogue.open = false; this.message.textContent = 'Your passage is ready. We’ll bring you home.';
      this.departed(); this.fillItinerary(); this.tick(0); this.refresh();
    }).catch(error => {
      if (request !== this.request) return;
      this.planning = false; this.launch.disabled = false;
      this.message.textContent = error instanceof Error ? error.message : String(error); this.refresh();
    });
  }

  private fillItinerary(): void {
    const p = this.plan!; this.itinerary.replaceChildren();
    for (const group of [p.outbound, p.inbound]) {
      if (group === p.inbound) this.itinerary.append(el('li', '', `Two ${p.orbit.guided ? 'guided observation laps' : 'orbits'} · ${duration(p.orbit.end - p.orbit.start)}${p.orbit.estimated ? ' · estimated gravity' : ''}`));
      for (const leg of group) this.itinerary.append(el('li', '', `${leg.name} · ${duration(leg.flight.end - leg.flight.start)}${leg.flight.coast > 121 ? ` · ${duration(leg.flight.coast)} coasting` : ''}`));
    }
    const paths = [p.outbound, p.inbound].map(legs => legs.flatMap(l => l.flight.samples.filter((_, i) => i % 12 === 0).map(s => s.p)));
    const points = paths.flat(), xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    this.chartCenter = [(xmin + xmax) / 2, (ymin + ymax) / 2];
    this.chartScale = Math.min(440 / Math.max(1, xmax - xmin), 160 / Math.max(1, ymax - ymin));
    this.chart.replaceChildren();
    paths.forEach((path, i) => this.chart.append(svg('polyline', { points: path.map(p => this.chartPoint(p).join(',')).join(' '), fill: 'none', stroke: i ? '#d9a96b' : '#7cbea7', 'stroke-width': 1.5 })));
    for (const [label, point] of [['Cylinder', paths[0][0]], [this.system.byId.get(p.target)!.name, paths[0][paths[0].length - 1]]] as [string, Vec3][]) {
      const [x, y] = this.chartPoint(point), text = svg('text', { x: Math.max(5, Math.min(380, x + 7)), y: Math.max(15, y - 8), fill: '#dce7d5', 'font-size': 11 }); text.textContent = label;
      this.chart.append(svg('circle', { cx: x, cy: y, r: 3, fill: '#b0c9b5' }), text);
    }
    this.chart.append(this.marker);
  }
  private chartPoint(p: Vec3): [number, number] { return [240 + (p[0] - this.chartCenter[0]) * this.chartScale, 100 - (p[1] - this.chartCenter[1]) * this.chartScale]; }
  get cameraKey(): string { return `${this.mode}:${this.watchedId()}:${this.instrument.value}`; }
  setActive(on: boolean): void { this.active = on; this.element.hidden = !on; }
  showCabin(on: boolean): void { this.element.classList.toggle('cabin', on); this.compactHud(on); }
  private compactHud(on: boolean): void { this.hud.classList.toggle('compact', on); this.compact.textContent = on ? 'Expand computer' : 'Minimise computer'; this.compact.setAttribute('aria-expanded', String(!on)); }
  reset(): void { this.request++; this.planning = false; this.plan = null; this.state = null; this.catalogue.open = true; this.describe(); this.refresh(); }
  bytes(): number { return (this.planning ? this.system.bytes() * 3 : 0) + (this.plan ? [...this.plan.outbound, ...this.plan.inbound].reduce((n, l) => n + l.flight.samples.length * 160, 0) : 0); }
  tick(dt: number): void {
    if (!this.active || !this.plan) return;
    this.clock = Math.min(this.plan.end, this.clock + dt * this.scale);
    this.state = voyageAt(this.plan, this.system, this.getSpace().params.epochJd, this.clock);
    if (this.clock === this.plan.end) { this.scale = 0; this.speed.value = '0'; this.launch.disabled = false; }
    this.updateClock += dt;
    if (this.updateClock > .25 || dt === 0) { this.updateClock = 0; this.refresh(); }
  }
  turn(dx: number, dy: number): void { this.yaw -= dx * .004; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * .004)); }
  magnify(delta: number): void { this.zoom = Math.max(.1, Math.min(1000, this.zoom * Math.exp(-delta * .001))); }
  private watchedId(): string { return this.mode === 'destination' ? this.plan?.target ?? this.selected : this.watched; }
  camera(): { eye: Vec3; target: Vec3; up: Vec3; fov: number } | null {
    const s = this.state; if (!s) return null;
    const space = this.getSpace(), frame = space.home.orbitFrame, id = this.watchedId(), b = this.system.byId.get(id)!;
    const body = this.system.position(id, space.jd(this.clock)), side = v3norm(v3cross(s.forward, s.up));
    let eye = s.p, look: Vec3 = s.forward, fov = 60 / this.zoom;
    const tracking = this.mode === 'destination' || this.mode === 'body';
    if (tracking) look = v3norm(v3sub(body, s.p));
    else if (this.mode === 'home') look = v3norm(v3sub(space.frames.position([0, 0, 0], frame, 'sun', this.clock), s.p));
    else if (this.mode === 'aft') look = v3scale(s.forward, -1);
    else if (this.mode === 'port' || this.mode === 'starboard') look = v3scale(side, this.mode === 'port' ? -1 : 1);
    else if (this.mode === 'above' || this.mode === 'below') look = v3scale(s.up, this.mode === 'below' ? -1 : 1);
    if (tracking && this.instrument.value === 'model') {
      const distance = Math.max(b.radius * 4.5, (b.rings?.outer ?? 0) * 2.7);
      eye = v3sub(body, v3scale(look, distance)); fov = 45 / this.zoom;
    } else if (tracking && this.instrument.value === 'telescope') {
      fov = Math.max(.00005, 4 * Math.atan(Math.max(b.radius, b.rings?.outer ?? 0) / v3len(v3sub(body, eye))) * 180 / Math.PI) / this.zoom;
    }
    const right = v3norm(v3cross(look, Math.abs(look[2]) < .97 ? [0, 0, 1] : [0, 1, 0])), up = v3norm(v3cross(right, look));
    const direction = v3add(v3scale(look, Math.cos(this.yaw) * Math.cos(this.pitch)), v3add(v3scale(right, Math.sin(this.yaw) * Math.cos(this.pitch)), v3scale(up, Math.sin(this.pitch))));
    const origin = space.frames.position(eye, 'sun', frame, this.clock), forward = space.frames.direction(direction, 'sun', frame, this.clock);
    return { eye: origin, target: v3add(origin, v3scale(forward, 1e6)), up: space.frames.direction(up, 'sun', frame, this.clock), fov: Math.max(.00001, Math.min(100, fov)) };
  }
  private refresh(): void {
    const p = this.plan, s = this.state;
    this.hud.hidden = !p || !s;
    this.element.classList.toggle('planning', this.planning);
    if (!p || !s) return;
    const space = this.getSpace(), jd = space.jd(this.clock), date = calendarOf(jd), target = this.system.byId.get(p.target)!;
    this.phase.textContent = s.phase;
    this.progress.value = (this.clock - p.start) / (p.end - p.start);
    const [x, y] = this.chartPoint(s.p); this.marker.setAttribute('cx', String(x)); this.marker.setAttribute('cy', String(y));
    this.stats.textContent = `${target.name} & home · ${duration(this.clock - p.start)} elapsed · ${duration(p.end - this.clock)} remaining\n${date.year}-${String(date.month).padStart(2, '0')}-${String(Math.floor(date.day)).padStart(2, '0')} · ${(v3len(s.v) / 1000).toLocaleString('en', { maximumFractionDigits: 1 })} km/s heliocentric · ${(v3len(s.thrust) / 9.80665).toFixed(3)} g\n${(s.fuel / 1000).toLocaleString('en', { maximumFractionDigits: 0 })} t propellant · ${(TOUR_SHIP.drive.propellant * TOUR_RESERVE / 1000).toFixed(0)} t reserve`;
    const id = this.watchedId(), body = this.system.byId.get(id)!, distance = v3len(v3sub(this.system.position(id, jd), s.p));
    const tracking = this.mode === 'destination' || this.mode === 'body';
    this.observation.textContent = `${tracking ? `${body.name} · ${range(distance)} from ship · ` : ''}${tracking && this.instrument.value === 'model' ? 'COMPUTER RECONSTRUCTION · enlarged model, not a window' : tracking && this.instrument.value === 'telescope' ? 'OPTICAL MAGNIFICATION · viewed from the ship' : 'ACTUAL VIEW · ship’s external cameras'}${tracking && body.radiusKnown === false ? ' · size estimated' : ''}. Hold right mouse to look; scroll to magnify.`;
    // Nearest relevant worlds at the current position, never scripted fictional flybys.
    const nearby = this.system.bodies.filter(b => b.kind !== 'star').map(b => ({ body: b, distance: v3len(v3sub(this.system.position(b.id, jd), s.p)) })).sort((a, b) => a.distance - b.distance).slice(0, 4);
    this.encounters.replaceChildren(el('span', '', 'Around us now'));
    for (const n of nearby) this.encounters.append(button('', `${n.body.name} · ${range(n.distance)}`, () => {
      this.watched = n.body.id; this.bodySelect.value = this.watched; this.mode = 'body'; this.direction.value = 'body'; this.instrument.value = 'model'; this.zoom = 1; this.yaw = 0; this.pitch = 0; this.refresh();
    }));
  }
}

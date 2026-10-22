/**
 * The page: the header with the version and What's new, the memory watchdog, the debug menu, and the current view:
 * the Blueprint Lab (design a habitat), Inside (walk in it) or Outside (the habitat in its orbit, with Earth, the Moon,
 * the Sun and the stars). The two views are WebGPU only.
 */
import { nearestFloor, nearestWood, type Ecology, type Found } from './gen/ecology';
import { nearestOnPath } from './gen/paths';
import { busiestNear, deerAt, fleetOf, flierAt, floorGap, herdsNear, peopleAt, personKey, residentOf, venuesOf, type Person } from './sim';
import { POSE } from './gen/standIn';
import { nearestPlace, vineFaceFoot } from './gen/places';
import { besideRiver, nearestSample, type River } from './gen/rivers';
import './app/style.css';
import { el } from './app/dom';
import { GravityMeter } from './app/gravityMeter';
import { TitleCard } from './app/title';
import { DebugMenu } from './app/debug';
import { MemoryWatchdog, browserHeap, thisDeviceBudget, type PressureLevel } from './app/memory';
import { VERSION, whatsNewButton } from './app/whatsNew';
import { BlueprintLab } from './lab/blueprintLab';
import { GraphicsUnavailable } from '@futuremagic/stage';
import { InteriorView } from './render/view';
import { talksWithHands } from './render/people';
import { speckMark } from './render/crowdShaders';
import { OutsideView } from './render/outside';
import { hubView } from './space';
import { fromWorld, toWorld, type DebrisSpec, type Habitat, type Vec3 } from './blueprint';
import { levelRunOf, nearestOf, onRow, plantsOf, slopeAt, type Level } from './gen/scatter';
import { frameOf, landmarksOf, type Hut, type Pavilion } from './gen/landmarks';
import { plantingsOf, type Grove, type Hall } from './gen/planted';
import { daisOf } from './gen/grownHall';
import type { Terrain } from './gen/terrain';
import { floorAt, floorPoint, outOfPlace, placeAt, type FloorFrame } from './gen/shapes';
import { crossingsOf, type Crossing, type CrossingKind } from './gen/crossings';
import { landformOf, planOf, type GroundForm } from './gen/plan';
import { WORK_KINDS, isDug, type Work, type WorkKind } from './gen/works';
import { angleDiff } from '@futuremagic/core';
import { baysOfHamlet, underOf, type Hamlet } from './gen/under';
import { HALL_KINDS, hallAt } from './gen/halls';
import { doorToward } from './gen/homes';
import { underLiftOf } from './gen/underMesh';
import { GLASS, SKIES, hamletSkiesOf, skyOverBay } from './gen/skies';
import { pavilionPlan } from './gen/pavilion';
import { hutPlan } from './gen/summitHut';
import { courtLayoutOf, courtWorld, type CourtLayout } from './gen/courts';
import { legShapesOf, liftStairOf, onLeg, rampOf, stairTopAt, type LiftStair } from './gen/liftStair';

const app = document.getElementById('app')!;
const debug = new DebugMenu();

// ---- the header ---------------------------------------------------------------------------------
const header = el('header', 'top');
const tabs = el('nav', 'tabs');
const labTab = el('button', 'tab on', 'Blueprint'), insideTab = el('button', 'tab', 'Inside'), outsideTab = el('button', 'tab', 'Outside');
tabs.append(labTab, insideTab, outsideTab);
const home = el('h1', '', 'Solarpolis');
home.title = 'Back to the title';
header.append(home, tabs, whatsNewButton());
app.append(header);

// ---- the memory watchdog --------------------------------------------------------------------------
const warning = el('div', 'mem-warning');
warning.setAttribute('role', 'status');
const showLevel = (level: PressureLevel): void => {
  warning.textContent = level === 'ok' ? '' : level === 'soft' ? 'Memory is getting high; caches are being dropped.' : 'Memory is very high; the game is freeing everything it can.';
  warning.classList.toggle('on', level !== 'ok');
};
const memory = new MemoryWatchdog({ budget: thisDeviceBudget(), readHeap: browserHeap, now: () => performance.now(), onLevel: showLevel });
memory.start(2000);
document.body.append(warning);

// ---- the view ------------------------------------------------------------------------------------
const lab = new BlueprintLab(new URLSearchParams(location.search), (query) => {
  // The Lab owns the habitat's fields; the open view rides along.
  const q = new URLSearchParams(query);
  const open = new URLSearchParams(location.search).get('view');
  if (open === 'inside' || open === 'outside' || open === 'lab') q.set('view', open);
  const all = q.toString();
  history.replaceState(null, '', all ? `?${all}` : location.pathname);
});
app.append(lab.root);

/** A 3D view on the page: made on first show, then kept and handed the Lab's current habitat. */
interface PageView {
  readonly canvas: HTMLCanvasElement;
  setHabitat(h: Habitat): Promise<void>;
  setRunning(on: boolean): void;
  bytes(): number;
  shed(): void;
}

class ViewSlot<V extends PageView> {
  readonly box = el('div', 'inside');
  private readonly note = el('p', 'inside-note');
  view: V | null = null;

  constructor(hint: string, private readonly building: string, private readonly memoryOwner: string, private readonly make: (h: Habitat) => Promise<V>) {
    this.box.append(this.note, el('p', 'inside-hint', hint));
    this.box.hidden = true;
    app.append(this.box);
  }

  async show(): Promise<void> {
    const h = lab.habitat;
    if (!h) { this.note.textContent = 'These parameters make no habitat: fix them in the Blueprint first.'; return; }
    if (this.view) { await this.view.setHabitat(h); this.view.setRunning(!this.box.hidden); return; }
    this.note.textContent = this.building;
    try {
      const v = await this.make(h);
      this.view = v;
      this.box.prepend(v.canvas);
      memory.track(this.memoryOwner, () => this.view?.bytes() ?? 0);
      memory.onPressure('soft', () => this.view?.shed());
      this.note.textContent = '';
      v.setRunning(!this.box.hidden);
    } catch (e) {
      this.note.textContent = e instanceof Error ? e.message : String(e);
      if (e instanceof GraphicsUnavailable) this.note.textContent += '. Solarpolis needs WebGPU: a current Chrome, Edge or Safari (macOS 26, iPadOS 26), or Firefox 141+ on Windows.';
    }
  }
}

const insideSlot = new ViewSlot('Hold the right mouse button to look around · W A S D to move · Shift to run · Space to jump · wheel to see yourself · F to fly (E up, Q down)', 'Building the interior…', 'terrain tiles', async (h) => {
  const v = await InteriorView.create(h);
  // The gravity the player feels, and why (with the spin, against it, higher up): Arnd, 2026-10-22.
  const meter = new GravityMeter(() => (lab.habitat ? { habitat: lab.habitat, ...v.paces } : null));
  insideSlot.box.append(meter.box);
  v.onGravity = (r) => meter.showReading(r);
  memory.track('player body', () => v.bodyBytes());
  memory.track('people', () => v.peopleBytes());
  memory.track('drones', () => v.droneBytes());
  memory.track('animals', () => v.animalBytes());
  return v;
});
const outsideSlot = new ViewSlot('Hold the right mouse button to swing around · wheel to come closer · 1 habitat, 2 Earth, 3 Moon, 4 nearest neighbour · F to fly (W A S D, E up, Q down, Shift faster)', 'Building the sky…', 'sky maps, stars and skin detail', (h) => OutsideView.create(h));
/** A black curtain over the views for the short fade from the crossing into the Hub (Arnd, 2026-10-21). */
const curtain = el('div', 'curtain');
app.append(curtain);
// The views fill the window below the header, whatever height the header wraps to.
const fit = (): void => { for (const box of [insideSlot.box, outsideSlot.box, curtain]) box.style.setProperty('--top', `${header.getBoundingClientRect().bottom}px`); };
new ResizeObserver(fit).observe(header);
let starting: Promise<void> | null = null;

// The title: the Outside view flying its attract loop, with the card over it. It is where the page opens.
const title = new TitleCard(() => void startArrival(), () => showTab('inside'));
const FADE_MS = 500;
function drawCurtain(closed: boolean): Promise<void> {
  curtain.classList.toggle('closed', closed);
  return new Promise((done) => setTimeout(done, FADE_MS));
}
/**
 * Start: the passenger's ship comes in to its berth and they float through the bore (OutsideView.arrive), then a
 * short fade and they float on at the Hub in the Inside view, looking down the sunline, in control. The interior
 * builds behind it while the ship comes in.
 */
async function startArrival(): Promise<void> {
  const v = outsideSlot.view;
  if (!v?.attracting) { showTab('inside'); return; }
  title.arriving();
  v.onTitle = null;
  starting = (starting ?? Promise.resolve()).then(() => insideSlot.show());
  await v.arrive();
  if (tab !== 'title') return;
  await drawCurtain(true);
  if (tab === 'title') {
    showTab('inside');
    await starting;
    const h = lab.habitat, inside = insideSlot.view;
    if (h && inside) { const hub = hubView(h); inside.floatAt(hub.eye, hub.look); }
  }
  await drawCurtain(false);
}
outsideSlot.box.append(title.root);

type Tab = 'title' | 'lab' | 'inside' | 'outside';
let tab: Tab = 'title';
function showTab(which: Tab): void {
  tab = which;
  labTab.classList.toggle('on', which === 'lab');
  insideTab.classList.toggle('on', which === 'inside');
  outsideTab.classList.toggle('on', which === 'outside');
  lab.root.hidden = which !== 'lab';
  const titled = which === 'title';
  title.show(titled);
  outsideSlot.box.classList.toggle('titled', titled);
  for (const [tab, slot] of [['inside', insideSlot], ['outside', outsideSlot]] as const) {
    const on = which === tab || (titled && tab === 'outside');
    slot.box.hidden = !on;
    if (on) starting = (starting ?? Promise.resolve()).then(() => slot.show());
    else slot.view?.setRunning(false);
  }
  starting = (starting ?? Promise.resolve()).then(async () => {
    const v = outsideSlot.view;
    if (!v) return;
    v.onTitle = titled ? (x) => title.fade(x) : null;
    if (titled && !v.attracting) await v.startAttract();
    else if (!titled && v.attracting) v.stopAttract();
  });
  const q = new URLSearchParams(location.search);
  if (which !== 'title') q.set('view', which); else q.delete('view');
  const query = q.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}
home.addEventListener('click', () => showTab('title'));
labTab.addEventListener('click', () => showTab('lab'));
insideTab.addEventListener('click', () => showTab('inside'));
outsideTab.addEventListener('click', () => showTab('outside'));
const opened = new URLSearchParams(location.search).get('view');
showTab(opened === 'inside' || opened === 'outside' || opened === 'lab' ? opened : 'title');

// ---- the debug menu ------------------------------------------------------------------------------
debug.addInfo(() => `Solarpolis ${VERSION}`);
debug.addInfo(() => {
  const h = lab.habitat;
  return h ? `habitat R ${h.radius.toFixed(0)} m, L ${h.length.toFixed(0)} m, seed ${h.seed}, ${h.rpm.toFixed(2)} rpm` : 'habitat: none (the parameters make no habitat)';
});
debug.addInfo(() => memory.line());
debug.addInfo(() => debug.fps());
debug.add({ label: 'Copy the parameters as JSON', group: 'Habitat', run: () => { void navigator.clipboard?.writeText(JSON.stringify(lab.parameters, null, 2)); } });
debug.add({ label: 'Log the parameters and the derived habitat', group: 'Habitat', run: () => console.log(lab.parameters, lab.habitat) });
const view = (): InteriorView | null => insideSlot.view, outsideView = (): OutsideView | null => outsideSlot.view;
debug.addInfo(() => view()?.info() ?? 'inside: not started');
const go = (label: string, s: (h: NonNullable<typeof lab.habitat>) => number): void => debug.add({
  label, group: 'Go', run: () => { const h = lab.habitat, v = view(); if (v && h) v.goTo(v.walker.at.theta, s(h)); },
});
/** Go to a place the ecology finds, `back` metres short of where it starts (negative: that far in), facing it. */
const toPlace = (label: string, back: number, find: (eco: Ecology, theta: number, s: number) => Found | null): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), eco = v?.ecology, at = v?.walker.at;
    const w = eco && at && find(eco, at.theta, at.s);
    if (!v || !eco || !w) return;
    const r = Math.max(eco.terrain.habitat.profile.at(w.s).r, 1);
    // Facing it (walker.step: forward is +s, -θ).
    v.goTo(w.theta - (w.way[0] * back) / r, w.s - w.way[1] * back, Math.atan2(-w.way[0], w.way[1]));
  },
});
toPlace('Before the nearest wood', 40, (eco, t, s) => nearestWood(eco, t, s));
toPlace('Into the nearest wood', -30, (eco, t, s) => nearestWood(eco, t, s));
toPlace('Into the nearest meadow', -30, (eco, t, s) => nearestFloor(eco, t, s, eco.climate.cover[0]?.on ?? 'grass'));
toPlace('Onto the Sunwalk', 0, (eco, t, s) => nearestOnPath(eco.terrain.habitat, 'sunwalk', t, s));
toPlace('Onto the nearest way', 0, (eco, t, s) => nearestOnPath(eco.terrain.habitat, 'way', t, s));
toPlace('Onto the Mountain trail', 0, (eco, t, s) => nearestOnPath(eco.terrain.habitat, 'trail', t, s));
/** The busiest spot within 2 km now (the people up on the land), approached from where the player stands. */
toPlace('Before the nearest crowd', 12, (eco, t, s) => {
  const h = eco.terrain.habitat, v = view(), b = v && busiestNear(h, v.time, { theta: t, s, radius: 2000 });
  if (!b) return null;
  const d = b.theta - t, dx = (d - 2 * Math.PI * Math.round(d / (2 * Math.PI))) * h.radius, dy = b.s - s, l = Math.hypot(dx, dy) || 1;
  return { theta: b.theta, s: b.s, way: [dx / l, dy / l] };
});
/** In the busiest entrance court within 3 km now (most people meeting or sitting in it), 12 m from its light well, facing it. */
toPlace('In the busiest court nearby', 12, (eco, t, s) => {
  const h = eco.terrain.habitat, r = h.radius, v = view();
  if (!v) return null;
  const count = new Map<number, number>();
  for (const p of peopleAt(h, v.time, { theta: t, s, radius: 3000 })) if (p.activity === 'meet' || p.activity === 'bench') count.set(p.court, (count.get(p.court) ?? 0) + 1);
  const best = [...count].sort((a, b) => b[1] - a[1])[0], c = best && venuesOf(h).courts[best[0]];
  if (!c) return null;
  const d = c.theta - t, dx = (d - 2 * Math.PI * Math.round(d / (2 * Math.PI))) * r, dy = c.s - s, l = Math.hypot(dx, dy) || 1;
  return { theta: c.theta, s: c.s, way: [dx / l, dy / l] };
});
/** 5 m from the nearest party of three or more standing in a ring to talk, facing its middle. */
toPlace('Beside the nearest talking ring', 5, (eco, t, s) => {
  const h = eco.terrain.habitat, r = h.radius, v = view();
  if (!v) return null;
  const rings = new Map<number, Person[]>();
  for (const p of peopleAt(h, v.time, { theta: t, s, radius: 1500 })) {
    if (p.moving || p.size < 3 || (p.activity !== 'meet' && p.activity !== 'gather')) continue;
    const key = personKey({ court: p.court, outing: p.outing - p.member });
    rings.set(key, [...(rings.get(key) ?? []), p]);
  }
  let best: { theta: number; s: number } | null = null, gap = Infinity;
  for (const ring of rings.values()) {
    const m = { theta: ring.reduce((a, p) => a + p.theta, 0) / ring.length, s: ring.reduce((a, p) => a + p.s, 0) / ring.length };
    const g = floorGap(r, t, s, m.theta, m.s);
    if (g < gap) { gap = g; best = m; }
  }
  if (!best) return null;
  const d = best.theta - t, dx = (d - 2 * Math.PI * Math.round(d / (2 * Math.PI))) * r, dy = best.s - s, l = Math.hypot(dx, dy) || 1;
  return { theta: best.theta, s: best.s, way: [dx / l, dy / l] };
});
/** 4 m from the nearest person in a drone body staying with others (or else anyone in one), facing them. */
toPlace('Beside the nearest person in a drone body', 4, (eco, t, s) => {
  const h = eco.terrain.habitat, r = h.radius, v = view();
  if (!v) return null;
  const aloft = peopleAt(h, v.time, { theta: t, s, radius: 1500 }, eco.terrain).filter((p) => residentOf(h, p.resident).body === 'drone');
  const by = (p: Person): number => floorGap(r, t, s, p.theta, p.s) + (p.moving || p.size < 2 ? 1e6 : 0);
  const best = aloft.sort((a, b) => by(a) - by(b))[0];
  if (!best) return null;
  const d = best.theta - t, dx = (d - 2 * Math.PI * Math.round(d / (2 * Math.PI))) * r, dy = best.s - s, l = Math.hypot(dx, dy) || 1;
  return { theta: best.theta, s: best.s, way: [dx / l, dy / l] };
});
/** 6 m from the nearest party out on the land that `keep` picks (within `within` m), facing it. */
const besideParty = (label: string, within: number, keep: (p: Person) => boolean): void => toPlace(label, 6, (eco, t, s) => {
  const h = eco.terrain.habitat, r = h.radius, v = view();
  if (!v) return null;
  const some = peopleAt(h, v.time, { theta: t, s, radius: within }, eco.terrain).filter((p) => !p.moving && keep(p));
  const best = some.sort((a, b) => floorGap(r, t, s, a.theta, a.s) - floorGap(r, t, s, b.theta, b.s))[0];
  if (!best) return null;
  const d = best.theta - t, dx = (d - 2 * Math.PI * Math.round(d / (2 * Math.PI))) * r, dy = best.s - s, l = Math.hypot(dx, dy) || 1;
  return { theta: best.theta, s: best.s, way: [dx / l, dy / l] };
});
// Down on the grass (sitting or lying, not on a seat); then the beats the places offer.
besideParty('Beside the nearest party on the grass', 6000, (p) => p.size > 1 && p.posture !== POSE.upright && p.activity !== 'bench');
besideParty('Beside the nearest game of catch', 20000, (p) => p.act === 'catch' && p.size > 1);
besideParty('Beside the nearest dancers', 20000, (p) => p.act === 'dance');
besideParty('Beside the nearest pair talking with their hands', 20000, talksWithHands);
besideParty('Beside the nearest one stretching', 20000, (p) => p.act === 'stretch');
besideParty('Beside the nearest one at standing work', 20000, (p) => p.act === 'work' && p.posture === POSE.upright);
/** Before the nearest herd of deer (within a few km, or else in the wild reserve), approached from where the player stands. */
toPlace('Before the nearest herd', 60, (eco, t, s) => {
  const h = eco.terrain.habitat, v = view(), r = h.radius;
  if (!v) return null;
  let herds = herdsNear(eco, t, s, 3000);
  if (!herds.length) herds = herdsNear(eco, t, (h.profile.floorStart + planOf(h).reserveEnd) / 2, 3000);
  const herd = herds.sort((a, b) => floorGap(r, t, s, a.theta, a.s) - floorGap(r, t, s, b.theta, b.s))[0];
  if (!herd) return null;
  const d = deerAt(eco.terrain, herd, 0, v.time), dt = d.theta - t, dx = (dt - 2 * Math.PI * Math.round(dt / (2 * Math.PI))) * r, dy = d.s - s, l = Math.hypot(dx, dy) || 1;
  return { theta: d.theta, s: d.s, way: [dx / l, dy / l] };
});
/**
 * Floating `back` m from the nearest drone at work (hovering at a spot it is still at half a minute on), a little
 * above it, looking at it: a tender over its orchard, a lifter at the Gate, a courier at its stop.
 */
const toDrone = (label: string, back: number): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, at = v?.walker.at;
    if (!v || !t || !at) return;
    const P = t.habitat.profile, me = toWorld(P, { theta: at.theta, s: at.s, h: 0 });
    let best: { theta: number; s: number; h: number } | null = null, gap = Infinity;
    fleetOf(t).forEach((_, id) => {
      const f = flierAt(t, id, v.time), later = flierAt(t, id, v.time + 30);
      if (f.doing !== 'work' || later.theta !== f.theta || later.s !== f.s) return;
      const w = toWorld(P, f), d = Math.hypot(w[0] - me[0], w[1] - me[1], w[2] - me[2]);
      if (d < gap) { gap = d; best = f; }
    });
    const f = best as { theta: number; s: number; h: number } | null;
    if (!f) return;
    const r = Math.max(P.at(f.s).r, 1), drone = toWorld(P, { theta: f.theta, s: f.s, h: f.h + 0.5 });
    const eye = toWorld(P, { theta: f.theta + (back * 0.6) / r, s: f.s - back * 0.8, h: f.h + 0.5 + back * 0.25 });
    const d = Math.hypot(drone[0] - eye[0], drone[1] - eye[1], drone[2] - eye[2]);
    v.floatAt(eye, [(drone[0] - eye[0]) / d, (drone[1] - eye[1]) / d, (drone[2] - eye[2]) / d]);
  },
});
toDrone('Fly: beside the nearest drone at work', 4);
toDrone('Fly: the nearest drone at work from 60 m', 60);
/** Low beside the nearest animal of a kind out on the land around the player, `back` m off its side, looking at it. */
const toAnimal = (kind: string, label: string, back: number): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), eye = v?.eye(), q = v && eye && v.animals.find((a) => a.kind.name === kind)?.nearest(eye);
    if (!v || !q) return;
    const side: Vec3 = [q.up[1] * q.front[2] - q.up[2] * q.front[1], q.up[2] * q.front[0] - q.up[0] * q.front[2], q.up[0] * q.front[1] - q.up[1] * q.front[0]];
    const lift = q.height * 0.5, at: Vec3 = [q.feet[0] + q.up[0] * lift, q.feet[1] + q.up[1] * lift, q.feet[2] + q.up[2] * lift];
    // A little above it, but under the crowns of the woods it may be in.
    const rise = Math.min(back * 0.3, 3);
    const from: Vec3 = [at[0] + side[0] * back + q.up[0] * rise, at[1] + side[1] * back + q.up[1] * rise, at[2] + side[2] * back + q.up[2] * rise];
    const d = Math.hypot(at[0] - from[0], at[1] - from[1], at[2] - from[2]);
    v.floatAt(from, [(at[0] - from[0]) / d, (at[1] - from[1]) / d, (at[2] - from[2]) / d]);
  },
});
toAnimal('squirrels', 'Fly: beside the nearest squirrel', 1.2);
toAnimal('squirrels', 'Fly: the nearest squirrel from 15 m', 15);
toAnimal('deer', 'Fly: beside the nearest deer', 5);
toAnimal('deer', 'Fly: the nearest deer from 60 m', 60);
/** Ground one can stand on (a terrace's ledge, not its wall). */
const ledge = (eco: Ecology) => (pt: number, ps: number): boolean => slopeAt(eco, pt, ps, eco.terrain.heightAt(pt, ps), 2) < 0.2;
toPlace('Into the nearest orchard', -10, (eco, t, s) => nearestPlace(eco.terrain, 'orchard', t, s, ledge(eco)));
toPlace('Into the nearest vineyard', 0, (eco, t, s) => {
  // Between two rows, looking along them.
  const at = nearestPlace(eco.terrain, 'vineyard', t, s, ledge(eco));
  const vine = eco.climate.biomes.find((b) => b.name === eco.climate.places.vineyard)?.plants.find((p) => p.rowGap);
  const P = eco.terrain.habitat.profile, row = at && vine?.rowGap ? onRow(eco.terrain, levelRunOf(P), at.theta, at.s, vine.rowGap, Infinity) : null;
  if (!at || !row || !vine?.rowGap) return at;
  // Half a row across: up the level's gradient, square to the row (`onRow`'s turn: the row runs along cos, sin).
  const r = Math.max(P.at(row.s).r, 1), cos = Math.max(Math.abs(P.at(row.s).nr), 0.3), half = vine.rowGap / 2;
  return { theta: row.theta + (half * Math.sin(row.turn)) / r, s: row.s - (half * Math.cos(row.turn)) / cos, way: [Math.cos(row.turn), Math.sin(row.turn)] };
});
debug.add({
  label: 'Fly: the Vine face from over the floor', group: 'Go', run: () => {
    // Floating over the floor before the face, looking at its lower terraces (where gravity is about 0.75 of the floor's).
    const v = view(), t = v?.ecology?.terrain, foot = t && vineFaceFoot(t);
    if (!v || !t || !foot) return;
    const P = t.habitat.profile, R = t.habitat.radius;
    let s = foot.s;
    while (s < P.length && P.at(s).r > R * 0.75) s += 10;
    const eye = toWorld(P, { theta: foot.theta, s: foot.s - R * 0.25, h: 150 }), at = toWorld(P, { theta: foot.theta, s, h: t.heightAt(foot.theta, s) });
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
/** A few metres before the nearest of the climate's first debris that `pick` chooses, facing it. */
const toDebris = (label: string, back: number, pick: (d: DebrisSpec) => boolean): void => toPlace(label, back, (eco, theta, s) => {
  const { profile } = eco.terrain.habitat, plants = plantsOf(eco), sp = plants.find((p) => p.what === 'debris' && pick(p.spec as DebrisSpec));
  const p = sp && nearestOf(eco, plants, sp, toWorld(profile, { theta, s, h: 0 }));
  if (!p) return null;
  const at = fromWorld(profile, ...p), r = Math.max(profile.at(at.s).r, 1);
  let dt = at.theta - theta;
  dt -= 2 * Math.PI * Math.round(dt / (2 * Math.PI));
  const x = dt * r, y = at.s - s, l = Math.hypot(x, y) || 1;
  return { theta: at.theta, s: at.s, way: [x / l, y / l] };
});
toDebris('To the nearest fallen trunk', 6, (d) => d.form === 'log');
toDebris('To the nearest boulder', 8, (d) => d.form === 'stone' && d.height[1] >= 1);
/** Beside the nearest river sample that `pick` accepts: `down` metres downstream of it and off to the side, looking at it. */
const toRiver = (label: string, down: number, pick: (r: River, i: number) => boolean): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, at = v?.walker.at;
    const near = t && at && nearestSample(t.rivers, at.theta, at.s, pick);
    if (!v || !near) return;
    const w = near.river.halfWidth[near.i];
    const p = besideRiver(near.river, near.i, down, w + Math.max(3, w * 0.5));
    v.goTo(p.theta, p.s, p.heading);
  },
});
toRiver('To the nearest river', 40, (r, i) => r.steep[i] < 0.05);
toRiver('Below the nearest falls', 200, (r, i) => r.steep[i] > 0.8);
go('The middle of the floor', (h) => (h.profile.floorStart + h.profile.floorEnd) / 2);
go('The foot of the wild endcap', (h) => h.profile.floorStart + 20);
go('Halfway up the wild endcap', (h) => h.profile.floorStart / 2);
go('The foot of the port endcap', (h) => h.profile.floorEnd - 20);
// Where the sunline meets the endcaps: the axis at the wild end, the dock hub at the port end.
go('Near the wild endcap\'s tip', (h) => h.profile.floorStart * 0.05);
go('Near the port endcap\'s hub', (h) => h.profile.length - (h.profile.length - h.profile.floorEnd) * 0.05);
/**
 * Viewpoints high over the land, for judging how the interior reads from afar (docs/far-view.md): the eye `up` shares of
 * the radius over the floor's middle, looking at a ground point `around` radians further round and `along` radii further
 * along the axis. Every distance is a share of the habitat's own size.
 */
const viewpoint = (label: string, up: number, around: number, along: number, s0 = 0.5): void => debug.add({
  label, group: 'Go', run: () => {
    const h = lab.habitat, v = view();
    if (!v || !h) return;
    const { profile } = h, theta = v.walker.at.theta;
    const s = profile.floorStart + (profile.floorEnd - profile.floorStart) * s0;
    const to = Math.min(profile.length, Math.max(0, s + along * h.radius));
    const eye = toWorld(profile, { theta, s, h: up * h.radius }), at = toWorld(profile, { theta: theta + around, s: to, h: 0 });
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
viewpoint('Fly: low over the floor, looking along it', 0.05, 0, 2.5);
viewpoint('Fly: a quarter of the way up, looking across the curve', 0.25, Math.PI / 2, 0.4);
viewpoint('Fly: halfway up, looking at the far side', 0.5, Math.PI, 0.6);
viewpoint('Fly: high up, looking down', 0.6, 0.05, 0.25);
viewpoint('Fly: near the axis at the wild end, looking along the tube', 0.9, 0.02, 3, 0);
viewpoint('Fly: over the floor, looking up the wild endcap', 0.1, 0, -1.5, 0.08);
viewpoint('Fly: over the floor, looking up the port endcap', 0.1, 0, 1.5, 0.92);
/**
 * Over the Mountain's snow (gen/snow.ts): the eye where gravity is `from` times the snow line's, `up` shares of the
 * radius over the ground, looking at the ground where it is `to` times the snow line's.
 */
const overSnow = (label: string, from: number, up: number, to: number): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain;
    if (!v || !t) return;
    const h = t.habitat, form = landformOf(h), line = form.mountain.snowLine, theta = v.walker.at.theta;
    const s0 = form.endcapAt(true, line * from), s1 = form.endcapAt(true, line * to);
    const eye = toWorld(h.profile, { theta, s: s0, h: t.heightAt(theta, s0) + up * h.radius }), at = toWorld(h.profile, { theta, s: s1, h: t.heightAt(theta, s1) });
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
overSnow('Fly: at the Mountain\'s snow line, looking up into the snow', 1.1, 0.001, 0.75);
overSnow('Fly: over the Mountain\'s snowfield', 1.6, 0.03, 0.4);
/** The Inside view and something of its terrain (`pick`), when both are there. */
function inView<T>(pick: (t: Terrain) => T | undefined): { v: InteriorView; x: T } | null {
  const v = view(), t = v?.ecology?.terrain, x = t && pick(t);
  return v && x ? { v, x } : null;
}
/** The landmarks (gen/landmarks.ts): the pavilion, and where its parts are. */
const firstLandmark = (): { v: InteriorView; l: Pavilion } | null => {
  const f = inView((t) => landmarksOf(t).find((l): l is Pavilion => l.kind === 'pavilion'));
  return f && { v: f.v, l: f.x };
};
debug.add({
  label: 'To the pavilion: the shore end of its bridge', group: 'Go', run: () => {
    const f = firstLandmark(), b = f?.l.bridges[0];
    if (f && b) f.v.goTo(f.l.theta, f.l.s + b.dir * (b.to - f.l.handrail * 2), b.dir > 0 ? Math.PI : 0);
  },
});
debug.add({
  label: 'Onto the pavilion\'s speaking floor', group: 'Go', run: () => {
    const f = firstLandmark();
    if (!f) return;
    const q = pavilionPlan(f.l);
    f.v.goTo(f.l.theta, f.l.s - (q.pool + q.floor) / 2, 0);
  },
});
/** Float `out` roof radii from the pavilion along the axis and `up` eaves' heights over the water, looking at it. */
const overPavilion = (label: string, out: number, up: number): void => debug.add({
  label, group: 'Go', run: () => {
    const f = firstLandmark(), h = lab.habitat;
    if (!f || !h) return;
    const q = pavilionPlan(f.l), fr = frameOf(h, f.l);
    const eye = outOfPlace(fr, [-q.reach * out, q.reach * out * 0.4, q.eaves * up]), at = outOfPlace(fr, [0, 0, q.eaves * 0.4]);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
overPavilion('Fly: by the pavilion', 2.2, 1.4);
overPavilion('Fly: the pavilion from afar', 14, 5);
/** The summit hut on the Mountain's cliff (gen/summitHut.ts). */
const summitHut = (): { v: InteriorView; l: Hut; h: Habitat } | null => {
  const f = inView((t) => landmarksOf(t).find((l): l is Hut => l.kind === 'hut')), h = lab.habitat;
  return f && h ? { v: f.v, l: f.x, h } : null;
};
debug.add({
  label: 'To the summit hut: on its terrace, looking down the cylinder', group: 'Go', run: () => {
    const f = summitHut();
    if (!f) return;
    const q = hutPlan(f.l.handrail, f.l.scale), at = fromWorld(f.h.profile, ...outOfPlace(frameOf(f.h, f.l), [q.length + q.terrace / 2, 0, 0.05]));
    f.v.goTo(at.theta, at.s, f.l.facing);
  },
});
/** Float off the hut: `out` hut lengths out along its x, `side` across, `up` over its floor, looking at the hall. */
const byHut = (label: string, out: number, side: number, up: number): void => debug.add({
  label, group: 'Go', run: () => {
    const f = summitHut();
    if (!f) return;
    const q = hutPlan(f.l.handrail, f.l.scale), fr = frameOf(f.h, f.l);
    const eye = outOfPlace(fr, [q.reach * out, q.reach * side, q.reach * up]), at = outOfPlace(fr, [q.length * 0.6, 0, q.eaves * 0.5]);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
byHut('Fly: by the summit hut', 1.5, -0.9, 0.25);
byHut('Fly: under the summit hut, its struts and corbels', 1.1, 0.5, -0.6);
byHut('Fly: the summit hut from afar', 14, -6, 3);
/** An entrance court (gen/courts.ts): the one nearest the middle of the floor, or the first `style` one. */
const court = (style?: string): { v: InteriorView; l: CourtLayout; h: Habitat } | null => {
  const h = lab.habitat, mid = h ? (h.profile.floorStart + h.profile.floorEnd) / 2 : 0;
  const f = inView((t) => {
    const all = t.courts.map((_, i) => courtLayoutOf(t, i)).filter((l): l is CourtLayout => !!l && (!style || l.style === style));
    return all.sort((a, b) => Math.abs(a.court.s - mid) - Math.abs(b.court.s - mid))[0];
  });
  return f && h ? { v: f.v, l: f.x, h } : null;
};
/** Stand in a court at `r` of its radius from the middle, `turn` from the portal's side, facing its middle (or the portal). */
const inCourt = (label: string, r: number, turn: number, style?: string): void => debug.add({
  label, group: 'Go', run: () => {
    const f = court(style);
    if (!f) return;
    const c = f.l.court, a = f.l.portal.angle + turn, at = fromWorld(f.h.profile, ...courtWorld(f.h, c, [Math.cos(a) * c.radius * r, Math.sin(a) * c.radius * r, 0]));
    // The walker's heading turns from along the axis toward −θ; the court's angles toward +θ.
    f.v.goTo(at.theta, at.s, -(a + Math.PI));
  },
});
inCourt('To an entrance court: on its floor, facing the portal', 0.45, Math.PI);
inCourt('To an entrance court: on its rim walk, looking in', 0.98, Math.PI * 0.8);
inCourt('To a court where the land was let go', 0.45, Math.PI, 'let-go');
/** Float over a court: `out` radii from its middle (on the stairs' side), `up` radii above its floor, looking at it. */
const overCourt = (label: string, out: number, up: number): void => debug.add({
  label, group: 'Go', run: () => {
    const f = court();
    if (!f) return;
    const c = f.l.court, a = f.l.portal.angle + Math.PI * 0.85;
    const eye = courtWorld(f.h, c, [Math.cos(a) * c.radius * out, Math.sin(a) * c.radius * out, c.radius * up]), at = courtWorld(f.h, c, [0, 0, 0]);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
overCourt('Fly: over an entrance court', 1.5, 0.9);
overCourt('Fly: entrance courts from afar', 12, 5);
/** Stand at a lift's doors, facing them (gen/lifts.ts): the court's portal above or its cage below; the lift nearest the floor's middle. */
const atLift = (label: string, below: boolean): void => debug.add({
  label, group: 'Go', run: () => {
    const h = lab.habitat, mid = h ? (h.profile.floorStart + h.profile.floorEnd) / 2 : 0;
    const f = inView((t) => t.courts.map((c, i) => ({ s: c.s, i })).sort((a, b) => Math.abs(a.s - mid) - Math.abs(b.s - mid)).find((c) => underLiftOf(t, c.i)));
    f?.v.toLiftDoors(f.x.i, below);
  },
});
atLift('To a lift: at its doors in an entrance court (click them to ride down)', false);
atLift('Below: at a lift cage (click it to call the cabin, again to ride up)', true);
/** Of the things built on the floor in a frame (crossings, halls) that `list` gives, the one nearest the walker. */
function nearestOnFloor<T extends { frame: FloorFrame }>(list: (t: Terrain) => readonly T[]): { v: InteriorView; x: T } | null {
  const at = view()?.walker.at;
  return inView((t) => {
    if (!at) return undefined;
    const R = t.habitat.radius, away = (x: T): number => Math.hypot(Math.atan2(Math.sin(x.frame.theta - at.theta), Math.cos(x.frame.theta - at.theta)) * R, x.frame.s - at.s);
    return [...list(t)].sort((a, b) => away(a) - away(b))[0];
  });
}
/** The river crossing (gen/crossings.ts) of a kind nearest the walker. */
const nearestCrossing = (kind?: CrossingKind): { v: InteriorView; c: Crossing } | null => {
  const f = nearestOnFloor((t) => crossingsOf(t).filter((c) => !kind || c.kind === kind));
  return f && { v: f.v, c: f.x };
};
debug.add({
  label: 'Onto the nearest river crossing', group: 'Go', run: () => {
    const f = nearestCrossing(), h = lab.habitat;
    if (!f || !h) return;
    // On it, before the middle, facing across (the walker's heading turns toward −θ, the frame's toward +θ).
    const c = f.c, at = floorAt(h, c.frame, c.kind === 'stepping' ? c.stones[0].x : -c.half * 0.6, c.kind === 'stepping' ? c.stones[0].y : 0);
    f.v.goTo(at.theta, at.s, -c.frame.heading);
  },
});
/** Float beside the nearest crossing of a kind, a little downstream of its middle and above it, looking at it. */
const byCrossing = (label: string, kind: CrossingKind): void => debug.add({
  label, group: 'Go', run: () => {
    const f = nearestCrossing(kind), h = lab.habitat;
    if (!f || !h) return;
    const c = f.c, size = Math.max(c.half, 4 * c.handrail);
    const eye = floorPoint(h, c.frame, [-size * 0.7, c.width / 2 + size * 1.6, size * 0.45 + c.handrail]), at = floorPoint(h, c.frame, [0, 0, c.hump * 0.5]);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
byCrossing('Fly: by the nearest stone arch bridge', 'arch');
byCrossing('Fly: by the nearest timber bridge', 'timber');
byCrossing('Fly: by the nearest stepping stones', 'stepping');
byCrossing('Fly: by the nearest log across a river', 'log');
/** The grown hall (gen/planted.ts, gen/grownHall.ts) nearest the walker. */
const nearestHall = (): { v: InteriorView; hall: Hall } | null => {
  const f = nearestOnFloor((t) => plantingsOf(t).halls);
  return f && { v: f.v, hall: f.x };
};
/** Stand in the nearest hall at (x, y) of its frame, facing along its nave toward the hearth. */
const inHallAt = (label: string, spot: (hall: Hall) => [number, number]): void => debug.add({
  label, group: 'Go', run: () => {
    const f = nearestHall(), h = lab.habitat;
    if (!f || !h) return;
    const [x, y] = spot(f.hall), at = floorAt(h, f.hall.frame, x, y);
    f.v.goTo(at.theta, at.s, -f.hall.frame.heading);
  },
});
inHallAt('To a grown hall: in its nave, by the table', (hall) => [-hall.half + hall.bay * 1.2, hall.span * 0.22]);
inHallAt('To a grown hall: on its dais', (hall) => { const d = daisOf(hall); return [(d.x0 + d.x1) / 2, 0]; });
/** Float by the nearest hall: (x, y, z) in its frame as shares of its length, its span and its trees' height. */
const byHall = (label: string, x: number, y: number, z: number): void => debug.add({
  label, group: 'Go', run: () => {
    const f = nearestHall(), h = lab.habitat;
    if (!f || !h) return;
    const hall = f.hall, eye = floorPoint(h, hall.frame, [x * hall.half, y * hall.span, z * hall.height]), at = floorPoint(h, hall.frame, [0, 0, hall.height * 0.3]);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
// Beside: in the clearing the woods keep round it, at eye height, outside the lattice.
byHall('Fly: beside a grown hall', -1.1, 1.15, 0.1);
byHall('Fly: a grown hall from afar', -5, 12, 2.5);
/**
 * The landforms the plan built (gen/plan.ts `grounds`): float off a Ring's terraced front over the ridge nearest the
 * eye, or off the tallest Height, `out` of the form's heights away (toward the port end) and `up` of them above the
 * land, looking at it a third of the way up.
 */
const nearRing = (t: Terrain, theta: number, s: number): { ring: GroundForm; ridge: number } | undefined => {
  const plan = planOf(t.habitat), rings = plan.grounds.filter((g) => g.kind === 'ring');
  const ring = rings.reduce<GroundForm | undefined>((a, g) => (!a || Math.abs(g.s - s) < Math.abs(a.s - s) ? g : a), undefined);
  if (!ring) return undefined;
  // The ridge between the valleys nearest the eye, where the front is terraced.
  const gap = (2 * Math.PI) / plan.valleys, first = plan.valleyAt(0, ring.s);
  const k = Math.round((theta - first - gap / 2) / gap), ridge = first + gap / 2 + k * gap;
  return { ring, ridge };
};
const offForm = (label: string, kind: 'ring' | 'height', out: number, up: number): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, h = lab.habitat;
    if (!v || !t || !h) return;
    let theta: number, s: number, H: number;
    if (kind === 'ring') {
      const f = nearRing(t, v.walker.at.theta, v.walker.at.s);
      if (!f) return;
      theta = f.ridge; s = planOf(h).ringLine(f.ring, f.ridge); H = f.ring.height;
    } else {
      const g = planOf(h).grounds.find((x) => x.kind === 'height');
      if (!g) return;
      theta = g.theta; s = g.s; H = g.height;
    }
    const es = s + H * out, eye = toWorld(h.profile, { theta, s: es, h: t.heightAt(theta, es) + H * up });
    const at = toWorld(h.profile, { theta, s, h: H * 0.35 + t.heightAt(theta, s) - t.builtAt(theta, s) });
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
offForm('Fly: before the nearest Ring\'s terraced front', 'ring', 2.5, 0.25);
offForm('Fly: the nearest Ring from far off', 'ring', 12, 1.5);
offForm('Fly: the tallest Height from far off', 'height', 4, 0.3);
debug.add({
  label: 'To the top of the tallest Height', group: 'Go', run: () => {
    const v = view(), h = lab.habitat, g = h && planOf(h).grounds.find((x) => x.kind === 'height');
    if (v && g) v.goTo(g.theta, g.s, 0);
  },
});
/**
 * The districts' works (gen/works.ts): each press floats by the work of the next kind (in `WORK_KINDS` order) nearest
 * the eye, two of its radii off and half of one up, looking at its middle; a work that faces along the axis is seen
 * from its face's side. The line names what it is and who made it.
 */
let workTurn = -1, workSeen = '';
debug.add({
  label: 'Fly: the next district work', group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, h = lab.habitat;
    if (!v || !t || !h) return;
    const plan = planOf(h), kinds = Object.keys(WORK_KINDS) as WorkKind[], R = h.radius, at = v.walker.at;
    for (let k = 1; k <= kinds.length; k++) {
      const kind = kinds[(workTurn + k) % kinds.length];
      const w = plan.works.filter((x) => x.kind === kind).reduce<Work | undefined>((a, x) => {
        const d = (y: Work): number => Math.hypot(angleDiff(at.theta, y.theta) * R, y.s - at.s);
        return !a || d(x) < d(a) ? x : a;
      }, undefined);
      if (!w) continue;
      workTurn = (workTurn + k) % kinds.length;
      const style = w.district >= 0 ? `the ${plan.districts[w.district].style} district ${w.district}` : 'the wild reserve';
      workSeen = `${w.kind}, ${w.height.toFixed(0)} m ${isDug(w) ? 'deep' : 'high'}, ${(w.radius * 2).toFixed(0)} m across, made by ${style}`;
      const dir = WORK_KINDS[kind].axial ? -1 : 1, du = Math.sin(w.facing) * dir, dv = Math.cos(w.facing) * dir;
      const et = w.theta + (du * w.radius * 2) / R, es = w.s + dv * w.radius * 2;
      const eye = toWorld(h.profile, { theta: et, s: es, h: t.heightAt(et, es) + w.radius * 0.5 });
      const { theta, s } = w, mid = toWorld(h.profile, { theta, s, h: t.heightAt(theta, s) });
      const d = Math.hypot(mid[0] - eye[0], mid[1] - eye[1], mid[2] - eye[2]);
      v.floatAt(eye, [(mid[0] - eye[0]) / d, (mid[1] - eye[1]) / d, (mid[2] - eye[2]) / d]);
      return;
    }
  },
});
debug.addInfo(() => (workSeen ? `work: ${workSeen}` : ''));
/** The founders' grove (gen/planted.ts). */
const grove = (): { v: InteriorView; g: Grove } | null => {
  const f = inView((t) => plantingsOf(t).groves[0]);
  return f && { v: f.v, g: f.x };
};
debug.add({
  label: 'To the founders\' grove: inside its ring', group: 'Go', run: () => {
    const f = grove();
    if (f) f.v.goTo(f.g.theta, f.g.s - Math.max(f.g.ring * 0.7, f.g.crown), 0);
  },
});
/** Float `out` grove radii from its middle (toward the wild end) and `up` of them above the ground, looking at it. */
const overGrove = (label: string, out: number, up: number): void => debug.add({
  label, group: 'Go', run: () => {
    const f = grove(), h = lab.habitat;
    if (!f || !h) return;
    const g = f.g, reach = Math.max(g.ring, g.crown) + g.crown, fr = placeAt(h, g.theta, g.s, f.v.ecology!.terrain.heightAt(g.theta, g.s));
    const eye = outOfPlace(fr, [-reach * out, reach * out * 0.3, reach * up]), at = outOfPlace(fr, [0, 0, g.trees[0].height * 0.3]);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
overGrove('Fly: over the founders\' grove', 1.6, 0.9);
overGrove('Fly: the founders\' grove from afar', 12, 3);
/** The Lift Stair up the Gate (gen/liftStair.ts). */
const stair = (): { v: InteriorView; st: LiftStair; h: Habitat } | null => {
  const f = inView((t) => liftStairOf(t.habitat) ?? undefined), h = lab.habitat;
  return f && h ? { v: f.v, st: f.x, h } : null;
};
/** Stand on the stair at a plan point (z along the axis, w across the ramp), facing up the Gate. */
const standOnStair = (f: NonNullable<ReturnType<typeof stair>>, z: number, w: number): void => {
  const top = stairTopAt(f.st, [z, w]) ?? 0, at = fromWorld(f.h.profile, ...rampOf(f.h).world(z, w, top + 0.05));
  f.v.goTo(at.theta, at.s, 0);
};
debug.add({
  label: 'To the Lift Stair: its forecourt at the foot of the Gate', group: 'Go', run: () => {
    const f = stair(), q = f?.st.platforms[0];
    if (f && q) standOnStair(f, (q.z0 + q.z1) / 2, 0);
  },
});
debug.add({
  label: 'Onto the Lift Stair: a landing halfway up', group: 'Go', run: () => {
    const f = stair();
    if (!f) return;
    const s = legShapesOf(f.st)[Math.floor(f.st.legs.length / 2)], k = s.steps.find((x) => x.landing) ?? s.steps[0];
    const p = onLeg(s, (k.a0 + k.a1) / 2, 0);
    standOnStair(f, p[0], p[1]);
  },
});
/** Float off the stair at leg `share` of the way up: `back` m down the axis and `up` m higher than its middle, looking at it. */
const byStair = (label: string, share: number, back: number, up: number, across = 0): void => debug.add({
  label, group: 'Go', run: () => {
    const f = stair();
    if (!f) return;
    const s = legShapesOf(f.st)[Math.min(f.st.legs.length - 1, Math.floor(f.st.legs.length * share))], ramp = rampOf(f.h);
    const m = onLeg(s, s.run / 2, 0), e = (s.leg.e0 + s.leg.e1) / 2;
    const eye = ramp.world(m[0] - back, m[1] + across, e + up), at = ramp.world(m[0], m[1], e);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
byStair('Fly: the Lift Stair from over the floor', 0.3, 900, 120);
byStair('Fly: beside the Lift Stair', 0.5, 60, 25, 30);
byStair('Fly: the Lift Stair close up', 0.5, 8, 4, 3);
byStair('Fly: the Lift Stair near the hub', 0.9, 120, 40);
/**
 * Below the land, in the Understorey (gen/under.ts), until the courts' lifts go down: on the floor in the middle of the
 * bay `pick` gives (its i, j), facing along the axis.
 */
const goBelow = (label: string, pick: (h: Habitat, theta: number, s: number) => { i: number; j: number } | null): void => debug.add({
  label, group: 'Go', run: () => {
    const h = lab.habitat, v = view();
    const bay = h && v && pick(h, v.walker.at.theta, v.walker.at.s);
    if (!h || !v || !bay) return;
    const c = underOf(h).centreOf(bay.i, bay.j);
    v.goBelow(c.theta, c.s, 0);
  },
});
goBelow('Below: the pillar forest under here', (h, theta, s) => {
  const u = underOf(h);
  return u.bayAt(theta, Math.min(u.s0 + (u.along - 0.5) * u.bay, Math.max(u.s0 + u.bay / 2, s)));
});
/** The hamlets nearest (θ, s) first (over the unrolled floor). */
const hamletsNear = (h: Habitat, theta: number, s: number): Hamlet[] => {
  const R = h.radius, away = (m: Hamlet): number => Math.hypot(Math.atan2(Math.sin(m.site.theta - theta), Math.cos(m.site.theta - theta)) * R, m.site.s - s);
  return [...underOf(h).hamlets].sort((a, b) => away(a) - away(b));
};
goBelow("Below: under the nearest entrance court (its hamlet's wellhead)", (h, theta, s) => {
  const m = hamletsNear(h, theta, s)[0];
  return m ? { i: m.i, j: m.j } : null;
});
/** Below, in the middle of a bay under sky `want` (gen/skies.ts), off the wellhead and its lanes. */
function underSky(want: number): void {
  const h = lab.habitat, v = view();
  if (!h || !v) return;
  const u = underOf(h), skies = hamletSkiesOf(h);
  for (const m of u.hamlets.filter((x) => skies[x.court] === want)) {
    for (const { i, j } of baysOfHamlet(u, m, 5)) {
      if (skyOverBay(h, i, j) !== want || u.useAt(i, j) === 'lane' || u.useAt(i, j) === 'well') continue;
      const c = u.centreOf(i, j);
      v.goBelow(c.theta, c.s, 0);
      return;
    }
  }
}
/** Below, in a hamlet's street: on the walk between two of its home bays, looking along the axis down it. */
debug.add({
  label: "Below: in a street among a hamlet's homes", group: 'Go', run: () => {
    const h = lab.habitat, v = view();
    if (!h || !v) return;
    const u = underOf(h);
    for (const m of hamletsNear(h, v.walker.at.theta, v.walker.at.s).slice(0, 8)) {
      for (const { i, j } of baysOfHamlet(u, m, 8)) {
        if (u.useAt(i, j) !== 'home' || u.useAt(i - 1, j) !== 'home') continue;
        const c = u.centreOf(i, j);
        v.goBelow(c.theta - u.dTheta / 2, c.s, 0);
        return;
      }
    }
  },
});
/** Below, at a hamlet's hall of the next kind (gen/halls.ts): on the walk on its wellhead side, looking at its front. */
let nextHall = 0;
debug.add({
  label: "Below: at the next kind of hall (kitchen, bath, shop, stage, minds' room, commons)", group: 'Go', run: () => {
    const h = lab.habitat, v = view();
    if (!h || !v) return;
    const u = underOf(h), want = HALL_KINDS[nextHall++ % HALL_KINDS.length];
    for (const m of hamletsNear(h, v.walker.at.theta, v.walker.at.s).slice(0, 8)) {
      for (const { i, j } of baysOfHamlet(u, m, Math.ceil(m.hall) + 1)) {
        if (hallAt(h, i, j) !== want) continue;
        // On the walk on its wellhead side, a few steps back, facing it (a positive heading turns toward −θ).
        const c = u.centreOf(i, j), toward = doorToward(u, m, i);
        v.goBelow(c.theta + toward * 0.65 * u.dTheta, c.s, (toward * Math.PI) / 2);
        return;
      }
    }
  },
});
let nextSky = 0;
debug.add({ label: 'Below: under the next kind of hamlet sky', group: 'Go', run: () => underSky(nextSky++ % SKIES.length) });
debug.add({ label: 'Below: under a glass deck (the real sky above)', group: 'Go', run: () => underSky(GLASS) });
debug.add({ label: 'Up onto the land (from below)', group: 'Go', run: () => { const v = view(); if (v) v.goTo(v.walker.at.theta, v.walker.at.s); } });
debug.add({ label: 'Travel 10× faster (toggle)', group: 'Go', run: () => { const v = view(); if (v) v.boost = v.boost === 1 ? 10 : 1; } });
debug.addInfo(() => view()?.clockLine() ?? '');
/** The next of a cycle of clock speeds. */
const nextOf = <T>(choices: T[], now: T): T => choices[(choices.indexOf(now) + 1) % choices.length];
debug.add({ label: 'Clock speed: real time → ×60 → ×600 → paused', group: 'Time', run: () => { const v = view(); if (v) v.timeScale = nextOf([1, 60, 600, 0], v.timeScale); } });
debug.add({ label: 'Two hours later', group: 'Time', run: () => view()?.skip(7200) });
debug.add({ label: 'Five minutes later', group: 'Time', run: () => view()?.skip(300) });
debug.add({ label: 'Clouds: schedule → few → half → overcast → none', group: 'Time', run: () => { const v = view(); if (v) v.cloudCover = nextOf<number | null>([null, 0.15, 0.5, 0.85, 0], v.cloudCover); } });
const toClouds = (label: string, share: number): void => debug.add({
  label, group: 'Go',
  run: () => { const v = view(), c = lab.habitat?.params.clouds; if (v && c) v.flyUp(c.base + c.thickness * share); },
});
toClouds('Fly up under the clouds', -0.3);
toClouds('Fly up into the clouds', 0.5);
debug.addInfo(() => outsideView()?.info() ?? 'outside: not started');
debug.add({ label: 'Clock speed outside: real time → ×60 → ×3600 → paused', group: 'Outside', run: () => { const v = outsideView(); if (v) v.timeScale = nextOf([1, 60, 3600, 0], v.timeScale); } });
debug.add({ label: 'Six hours later', group: 'Outside', run: () => outsideView()?.skip(6 * 3600) });
debug.add({ label: "Jump to Earth's next shadow on the habitat", group: 'Outside', run: () => { const v = outsideView(); if (v && !v.nextShadow()) console.log('no shadow within a year'); } });
debug.add({ label: 'Heroic stars (toggle): off shows them as true eyes would', group: 'Outside', run: () => { const v = outsideView(); if (v) v.heroicStars = !v.heroicStars; } });
debug.add({ label: 'Night eyes augmentation (toggle): the eyes open far enough for the stars', group: 'Outside', run: () => { const v = outsideView(); if (v) v.nightEyes = !v.nightEyes; } });
debug.addInfo(() => view()?.physicsLine() ?? '');
debug.add({ label: 'Drop a ball from 20 m', group: 'Physics', run: () => void view()?.dropBall(20) });
debug.add({ label: 'Drop a ball from 100 m', group: 'Physics', run: () => void view()?.dropBall(100) });
debug.add({ label: 'Remove the balls', group: 'Physics', run: () => view()?.clearBalls() });
debug.add({ label: 'People far off: specks → marked (magenta, 4 px) → hidden', group: 'Render', run: () => { speckMark.value = (speckMark.value + 1) % 3; } });
debug.add({ label: 'Plants: every level → only the full → only the lite → only the far level', group: 'Render', run: () => { const v = view(); if (v) v.plantLevel = nextOf<Level | null>([null, 0, 1, 2], v.plantLevel); } });
debug.add({ label: 'Log the shader report', group: 'Render', run: () => console.log((globalThis as { shaders?: { report(): string } }).shaders?.report() ?? 'no renderer yet') });
let memoryDetails = false;
debug.addInfo(() => (memoryDetails ? memory.details() : ''));
debug.add({ label: 'Show memory details (every owner, the last totals)', group: 'Memory', isOn: () => memoryDetails, set: (on) => { memoryDetails = on; memory.sample(); } });
debug.add({ label: 'Free the caches now (as when memory runs short)', group: 'Memory', run: () => { memory.shedNow('soft'); memory.sample(); } });

let last = performance.now();
const frame = (t: number): void => {
  debug.frame(t - last);
  last = t;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

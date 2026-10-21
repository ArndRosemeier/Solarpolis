/**
 * The page: the header with the version and What's new, the memory watchdog, the debug menu, and the current view:
 * the Blueprint Lab (design a habitat), Inside (walk in it) or Outside (the habitat in its orbit, with Earth, the Moon,
 * the Sun and the stars). The two views are WebGPU only.
 */
import { nearestFloor, nearestWood, type Ecology, type Found } from './gen/ecology';
import { nearestOnPath } from './gen/paths';
import { nearestPlace, vineFaceFoot } from './gen/places';
import { besideRiver, nearestSample, type River } from './gen/rivers';
import './app/style.css';
import { el } from './app/dom';
import { TitleCard } from './app/title';
import { DebugMenu } from './app/debug';
import { MemoryWatchdog, browserHeap, thisDeviceBudget, type PressureLevel } from './app/memory';
import { VERSION, whatsNewButton } from './app/whatsNew';
import { BlueprintLab } from './lab/blueprintLab';
import { GraphicsUnavailable } from '@futuremagic/stage';
import { InteriorView } from './render/view';
import { OutsideView } from './render/outside';
import { hubView } from './space';
import { fromWorld, toWorld, type DebrisSpec, type Habitat } from './blueprint';
import { nearestOf, plantsOf, type Level } from './gen/scatter';
import { frameOf, landmarksOf, placeAt, type Hut, type Pavilion } from './gen/landmarks';
import { plantingsOf, type Grove } from './gen/planted';
import type { Terrain } from './gen/terrain';
import { outOfPlace } from './gen/shapes';
import { landformOf } from './gen/plan';
import { pavilionPlan } from './gen/pavilion';
import { hutPlan } from './gen/summitHut';
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
  memory.track('player body', () => v.bodyBytes());
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
toPlace('Into the nearest orchard', -10, (eco, t, s) => nearestPlace(eco.terrain, 'orchard', t, s));
toPlace('Into the nearest vineyard', 0, (eco, t, s) => {
  // Between two rows, looking along them.
  const at = nearestPlace(eco.terrain, 'vineyard', t, s);
  const vine = eco.climate.biomes.find((b) => b.name === eco.climate.places.vineyard)?.plants.find((p) => p.rowGap);
  const gap = vine?.rowGap ?? 0;
  return at && gap ? { ...at, s: (Math.floor(at.s / gap) + 0.5) * gap } : at;
});
debug.add({
  label: 'Before the Vine face, out on the floor', group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, foot = t && vineFaceFoot(t);
    if (v && t && foot) v.goTo(foot.theta, foot.s - t.habitat.radius * 0.3, 0);
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
debug.add({ label: 'Travel 10× faster (toggle)', group: 'Go', run: () => { const v = view(); if (v) v.boost = v.boost === 1 ? 10 : 1; } });
debug.addInfo(() => view()?.clockLine() ?? '');
/** The next of a cycle of clock speeds. */
const nextOf = <T>(choices: T[], now: T): T => choices[(choices.indexOf(now) + 1) % choices.length];
debug.add({ label: 'Clock speed: real time → ×60 → ×600 → paused', group: 'Time', run: () => { const v = view(); if (v) v.timeScale = nextOf([1, 60, 600, 0], v.timeScale); } });
debug.add({ label: 'Two hours later', group: 'Time', run: () => view()?.skip(7200) });
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

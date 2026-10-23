import { HomeControls } from './app/homeControls';
import { homePlan } from './gen/homeInterior';
import { underHousesIn, bayFrame } from './gen/underMesh';
import { neighboursAt } from './sim/neighbourhood';
import { BOAT_KINDS, BOAT_KIND_LIST, boatAt, boatsNear, sailingOf, type Boat } from './sim/sailing';
import { crewsAt, crewsOf } from './sim/crews';
import { HARBOUR } from './gen/harbours';
import { windAt } from './world/wind';
import { footingOf } from './world/fall';
import { postsNear, type Post } from './world/posts';
import { Link } from './app/link/link';
import { Ways } from './app/link/ways';
import type { LinkChoice } from './link/service';
import { SpeechBubbles } from './app/bubbles';
import { ArrivalCard } from './app/arrivalCard';
import { ArrivalTiming, type LongFrame } from './app/arrivalTiming';
import { firstLight } from './boot/firstLight';
/**
 * The page: the header with the version and What's new, the memory watchdog, the debug menu, and the current view:
 * the Blueprint Lab (design a habitat), Inside (walk in it) or Outside (the habitat in its orbit, with Earth, the Moon,
 * the Sun and the stars). The two views are WebGPU only.
 */
import { nearestFloor, nearestWood, type Ecology, type Found } from './gen/ecology';
import type { BirdKind } from './gen/birds';
import { nearestOnPath } from './gen/paths';
import { busiestNear, deerAt, fleetOf, flierAt, floorGap, herdsNear, peopleAt, personKey, residentOf, venuesOf, type Person } from './sim';
import { POSE } from './gen/standIn';
import { nearestPlace, vineFaceFoot } from './gen/places';
import { besideRiver, nearestSample, sampleS, type River } from './gen/rivers';
import { el } from './app/dom';
import { GravityMeter } from './app/gravityMeter';
import { TitleCard } from './app/title';
import { DebugMenu } from './app/debug';
import { MemoryWatchdog, browserHeap, thisDeviceBudget, type PressureLevel } from './app/memory';
import { VERSION, whatsNewButton } from './app/whatsNew';
import { Sound } from './audio/sound';
import { soundButton } from './app/soundButton';
import { BlueprintLab } from './lab/blueprintLab';
import { GraphicsUnavailable } from '@futuremagic/stage';
import { InteriorView } from './render/view';
import { loadLog } from './render/loadLog';
import { loadGate } from './render/loadGate';
import { talksWithHands } from './render/people';
import { speckMark } from './render/crowdShaders';
import { OutsideView } from './render/outside';
import type { BirdSeen } from './render/birds';
import { VoyageComputer } from './app/voyageComputer';
import { OPENING_MIN, arrivalScore, captionAt, hubView, type ArrivalScore } from './space';
import { apart, fromWorld, toWorld, type DebrisSpec, type Habitat, type HabitatParams, type Vec3 } from './blueprint';
import { blueprintOf, placeInWords, type Ledger, type Whereabouts } from './system';
import { levelRunOf, nearestOf, onRow, plantsOf, slopeAt, type Level } from './gen/scatter';
import { frameOf, landmarksOf, type Hut, type Pavilion } from './gen/landmarks';
import { plantingsOf, type Grove, type Hall } from './gen/planted';
import { daisOf } from './gen/grownHall';
import type { Terrain } from './gen/terrain';
import { floorAt, floorPoint, outOfPlace, placeAt, type FloorFrame } from './gen/shapes';
import { crossingsOf, type Crossing, type CrossingKind } from './gen/crossings';
import { landformOf, mereShore, planOf, type GroundForm } from './gen/plan';
import { WORK_KINDS, isDug, isSignature, type DistrictWorkKind, type Work } from './gen/works';
import { angleDiff, v3madd } from '@futuremagic/core';
import { baysOfHamlet, underOf, type Hamlet } from './gen/under';
import { HALL_KINDS, hallAt } from './gen/halls';
import { doorToward } from './gen/homes';
import { underLiftOf } from './gen/underMesh';
import { GLASS, SKIES, hamletSkiesOf, skyOverBay } from './gen/skies';
import { pavilionPlan } from './gen/pavilion';
import { hutPlan } from './gen/summitHut';
import { courtLayoutOf, courtWorld, type CourtLayout } from './gen/courts';
import { legShapesOf, liftStairOf, onLeg, rampOf, stairTopAt, type LiftStair } from './gen/liftStair';
import { welcomeSignOf } from './gen/welcomeSign';

const app = document.getElementById('app')!;
const debug = new DebugMenu();

// ---- the header ---------------------------------------------------------------------------------
// The header and its name are in the page from the first paint (index.html), over the opening; the rest joins here.
const header = document.querySelector<HTMLElement>('header.top') ?? el('header', 'top');
const tabs = el('nav', 'tabs');
const labTab = el('button', 'tab on', 'Blueprint'), insideTab = el('button', 'tab', 'Inside'), outsideTab = el('button', 'tab', 'Outside'), tourTab = el('button', 'tab', 'Ship Tour');
tabs.append(labTab, insideTab, outsideTab, tourTab);
const home = header.querySelector('h1') ?? el('h1', '', 'Solarpolis');
home.title = 'Back to the title';
header.append(home, tabs, whatsNewButton());
if (!header.parentElement) app.append(header);

// ---- the memory watchdog --------------------------------------------------------------------------
const warning = el('div', 'mem-warning');
warning.setAttribute('role', 'status');
const showLevel = (level: PressureLevel): void => {
  warning.textContent = level === 'ok' ? '' : level === 'soft' ? 'Memory is getting high; caches are being dropped.' : 'Memory is very high; the game is freeing everything it can.';
  warning.classList.toggle('on', level !== 'ok');
};
const memory = new MemoryWatchdog({ budget: thisDeviceBudget(), readHeap: browserHeap, now: () => performance.now(), onLevel: showLevel });
memory.start(2000);
// The opening's own renderer (src/boot) until the cut: its frame, the stars, Earth's and the Moon's maps.
memory.track('first light', () => firstLight.heldBytes());
document.body.append(warning);

// ---- sound: the land heard from the Inside view, the title's music (design "Solarpolis: how it sounds") ----------------
const sound = new Sound(memory, () => (tab === 'inside' ? insideSlot.view?.hearing() ?? null : null));
header.append(soundButton(sound));

// ---- the view ------------------------------------------------------------------------------------
/** The habitat visited (a ledger id), or null at home. Declared before the Lab, which reports its first query at once. */
let visiting: string | null = null;
const lab = new BlueprintLab(new URLSearchParams(location.search), (query) => {
  // The Lab owns the habitat's fields; the open view rides along. A visit's habitat is not the page's to keep.
  if (visiting) return;
  const q = new URLSearchParams(query);
  const open = new URLSearchParams(location.search).get('view');
  if (open === 'inside' || open === 'outside' || open === 'lab' || open === 'tour') q.set('view', open);
  const all = q.toString();
  history.replaceState(null, '', all ? `?${all}` : location.pathname);
});
app.append(lab.root);

// ---- visiting another habitat (docs/system.md: a proof of concept, one arrives at once) ----------------------
/** Home while away (the habitat left behind): its parameters and the habitat the Outside view keeps showing. */
let left: { params: HabitatParams; habitat: Habitat } | null = null;
/** Where the player is in the system, for the Inside view (news heard with the visited habitat's light-lag). */
let whereabouts: Whereabouts | null = null;
/** Where the arrival card says one has arrived. */
let arrivedAt = 'the Necklace';
let arrivalCard: ArrivalCard | null = null;

/** Be at habitat `id` ('home', or a ledger id with its blueprint): the Inside view follows, the Outside view stays home. */
function settle(id: string, params: HabitatParams, where: string): void {
  if (id !== 'home' && !visiting && !(left && lab.parameters === left.params) && lab.habitat) left = { params: lab.parameters, habitat: lab.habitat };
  if (id !== 'home' && !left) return;
  visiting = id === 'home' ? null : id;
  whereabouts = visiting && left ? { home: left.params, at: visiting } : null;
  if (insideSlot.view) insideSlot.view.whereabouts = whereabouts;
  arrivedAt = where;
  lab.use(params);
  if (lab.habitat) arrivalCard?.describe(lab.habitat, where);
  outsideSlot.view?.setVisiting(id);
}

/** Visit habitat `id` of the ledger ('home' to go back): through the curtain onto its arrival terrace. */
async function travelTo(id: string, ledger: Ledger): Promise<void> {
  const back = id === 'home';
  const record = ledger.habitat(id);
  const params = back ? left?.params : blueprintOf(ledger, id);
  if (!params || (!back && !record) || (back && !visiting) || id === visiting) return;
  await drawCurtain(true);
  settle(id, params, back || !record ? 'the Necklace' : `${record.name}, ${placeInWords(record)}`);
  await arriveInside();
}

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

  /** `habitat`: the one this view shows (the Lab's, or for the Outside view the home one while visiting). */
  constructor(hint: string, private readonly building: string, private readonly memoryOwner: string, private readonly make: (h: Habitat) => Promise<V>, private readonly habitat: () => Habitat | null = () => lab.habitat) {
    this.box.append(this.note, el('p', 'inside-hint', hint));
    this.box.hidden = true;
    app.append(this.box);
  }

  async show(): Promise<void> {
    const h = this.habitat();
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

/** The player's neural link and its overlay (app/link): systems serve it their offers and say their lines through it. */
const link = new Link();
const insideSlot = new ViewSlot('Hold the right mouse button to look around · W A S D to move · Shift to run · Space to jump · wheel to see yourself · Tab for your link (call a capsule) · F to fly (E up, Q down)', 'Building the interior…', 'terrain tiles', async (h) => {
  const v = await InteriorView.create(h, whereabouts);
  // The gravity the player feels, and why (with the spin, against it, higher up): Arnd, 2026-10-22.
  const meter = new GravityMeter(() => (lab.habitat ? { habitat: lab.habitat, ...v.paces } : null));
  insideSlot.box.append(meter.box);
  v.onGravity = (r) => meter.showReading(r);
  // The player's neural link (Arnd, 2026-10-23): the one overlay every system speaks through.
  insideSlot.box.append(link.root);
  v.onOverlay = (dt, project) => link.frame(dt, project);
  const ways = new Ways();
  link.serve(ways);
  v.onExit = (exit) => ways.showExit(exit);
  // Transport capsules, called through the link (Arnd, 2026-10-23); their Minds speak through it too.
  link.serve(v.capsules);
  // The guardians who catch a fall (design "Nobody falls far"): their card while a catch has the player.
  link.serve(v.guarding);
  v.onLine = (line) => link.say(line);
  // People talk in silent speech bubbles (Arnd, 2026-10-23).
  const speech = new SpeechBubbles(() => h.params.life.talk.words);
  insideSlot.box.append(speech.box);
  v.onTalk = (bubbles) => speech.showBubbles(bubbles);
  const room = new HomeControls((mode) => v.arrangeHome(mode));
  insideSlot.box.append(room.root);
  v.onRoom = (state) => room.updateRoom(state);
  const welcome = new ArrivalCard(h, arrivedAt, () => v.finishArrivalReveal());
  arrivalCard = welcome;
  insideSlot.box.append(welcome.root);
  v.onArrival = (progress, nearby) => {
    welcome.show(progress, nearby);
    insideSlot.box.classList.toggle('revealing', progress < 1 && nearby);
  };
  memory.track('player body', () => v.bodyBytes());
  memory.track('people', () => v.peopleBytes());
  memory.track('drones', () => v.droneBytes());
  memory.track('talk', () => v.talkBytes());
  memory.track('animals', () => v.animalBytes());
  memory.track('birds', () => v.birdBytes());
  memory.track('boats', () => v.boatBytes());
  return v;
});
const outsideSlot = new ViewSlot('Hold the right mouse button to swing around · wheel to come closer · 1 habitat, 2 Earth, 3 Moon, 4 nearest neighbour · F to fly (W A S D, E up, Q down, Shift faster)', 'Building the sky…', 'sky maps, stars and skin detail', async (h) => {
  const v = await OutsideView.create(h, (...args) => new VoyageComputer(...args));
  v.onVisit = (id, ledger) => void travelTo(id, ledger);
  return v;
}, () => (left && (visiting || lab.parameters === left.params) ? left.habitat : lab.habitat));
/** A black curtain over the views for the short fade from the crossing into the Hub (Arnd, 2026-10-21). */
const curtain = el('div', 'curtain');
app.append(curtain);
// The views fill the window below the header, whatever height the header wraps to.
const fit = (): void => { for (const box of [insideSlot.box, outsideSlot.box, curtain]) box.style.setProperty('--top', `${header.getBoundingClientRect().bottom}px`); };
new ResizeObserver(fit).observe(header);
let starting: Promise<void> | null = null;
/** The arrival as the loading screen: how long until the title, whether the flight hid the interior's warm-up. */
const timing = new ArrivalTiming(() => performance.now());
timing.watchShaders('inside', () => insideSlot.view?.shaderLog ?? null);
timing.watchShaders('outside', () => outsideSlot.view?.shaderLog ?? null);
loadLog.note = (what) => timing.note(what);
// The opening, drawn before this code loaded: when its first frame came, and how its frames went.
void firstLight.lit.then((at) => { if (at !== null) timing.mark('light', at); });
void firstLight.ended.then((figures) => { if (figures) timing.opening(figures); });
// Chrome names the scripts that make a frame long (Long Animation Frames): which work stutters the flight.
if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame')) {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) timing.longFrame(e as unknown as LongFrame); }).observe({ type: 'long-animation-frame', buffered: true });
}

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
  // The title's ship comes in to the home habitat: a visit ends there.
  if (visiting && left) settle('home', left.params, 'the Necklace');
  arriving = true;
  try { await flyIn(v); } finally {
    arriving = false;
    v.onArrival = null;
    title.caption(null);
    sound.arrival(null);
    // The title theme carries the flight and the first look, then fades into the land.
    sound.music(null);
  }
}
/** Whether Start's flight is under way (the title's music plays on through it). */
let arriving = false;
async function flyIn(v: OutsideView): Promise<void> {
  title.arriving();
  timing.mark('start');
  v.onTitle = null;
  // The flight's sounds under the title theme, and the ship's Mind's lines on screen.
  let score: ArrivalScore | null = null;
  v.onArrival = (elapsed, a) => {
    score ??= arrivalScore(a.moments, a.guest.ship.seed);
    sound.arrival(score, elapsed);
    title.caption(captionAt(score, elapsed));
  };
  starting = (starting ?? Promise.resolve()).then(() => { timing.note('interior view …'); return insideSlot.show(); }).then(() => {
    const inside = insideSlot.view;
    if (!inside) return;
    timing.mark('inside');
    void inside.bodyLoaded.then(() => timing.mark('body'));
  });
  await v.arrive();
  if (tab !== 'title') return;
  timing.mark('flown');
  await drawCurtain(true);
  timing.mark('closed');
  // Behind the closed curtain nothing is seen: what waited for a cut goes now.
  loadGate.hold(false);
  if (tab === 'title') await arriveInside();
  else await drawCurtain(false);
}
/** Behind the closed curtain: into the Inside view, out onto its arrival terrace (or the Hub), the curtain drawn back. */
async function arriveInside(): Promise<void> {
  showTab('inside');
  await starting;
  const h = lab.habitat, inside = insideSlot.view;
  const open = async (): Promise<void> => { timing.mark('ready'); await drawCurtain(false); timing.mark('open'); };
  if (h && inside) {
    const terrace = await inside.prepareArrival();
    if (insideSlot.box.hidden) { inside.finishArrivalReveal(); await open(); return; }
    if (terrace) {
      const reveal = inside.revealArrival();
      await open();
      await reveal;
      return;
    }
    const hub = hubView(h); inside.floatAt(hub.eye, hub.look);
  }
  await open();
}
outsideSlot.box.append(title.root, title.mind);

type Tab = 'title' | 'lab' | 'inside' | 'outside' | 'tour';
let tab: Tab = 'title';
function showTab(which: Tab): void {
  tab = which;
  // Anywhere but the title, the opening is gone at once.
  if (which !== 'title') firstLight.end();
  labTab.classList.toggle('on', which === 'lab');
  insideTab.classList.toggle('on', which === 'inside');
  outsideTab.classList.toggle('on', which === 'outside');
  tourTab.classList.toggle('on', which === 'tour');
  lab.root.hidden = which !== 'lab';
  const titled = which === 'title';
  // While the title (and the arrival after Start) plays, heavy loading waits for its cuts. Not while the opening
  // plays: its own worker draws it, so a long step here cannot stutter it.
  loadGate.hold(titled && !firstLight.playing);
  title.show(titled);
  if (titled) sound.music('music/title');
  else if (!arriving) sound.music(null);
  outsideSlot.box.classList.toggle('titled', titled);
  for (const [tab, slot] of [['inside', insideSlot], ['outside', outsideSlot]] as const) {
    const on = which === tab || ((titled || which === 'tour') && tab === 'outside');
    slot.box.hidden = !on;
    if (on) starting = (starting ?? Promise.resolve()).then(() => slot.show());
    else slot.view?.setRunning(false);
  }
  starting = (starting ?? Promise.resolve()).then(async () => {
    const v = outsideSlot.view;
    if (!v) return;
    v.setTourMode(which === 'tour');
    v.onTitle = titled ? (x) => title.fade(x) : null;
    if (titled && !v.attracting) {
      const opening = firstLight.playing;
      await v.startAttract(opening);
      timing.mark('title');
      // The title is the loading screen too: the interior warms up behind it, so Start finds it (nearly) ready.
      if (!insideSlot.view) starting = (starting ?? Promise.resolve()).then(() => { timing.note('interior view …'); return insideSlot.show(); });
      if (opening) void cutFromOpening(v);
    }
    else if (!titled && v.attracting) v.stopAttract();
  });
  const q = new URLSearchParams(location.search);
  if (which !== 'title') q.set('view', which); else q.delete('view');
  const query = q.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}
/**
 * The cut from the opening to shot 1 (design "First Light"): once the opening has played its least and this view is
 * ready, shot 1 starts from its first frame behind the opening, is drawn, and the opening steps aside. Until then the
 * view waits unseen (not drawing), so the opening keeps the GPU to itself.
 */
async function cutFromOpening(v: OutsideView): Promise<void> {
  v.setRunning(false);
  const after = (s: number): Promise<void> => new Promise((done) => setTimeout(done, s * 1000));
  // An opening that has not drawn by now, with the view ready, never will: the title goes on without it.
  const lit = await Promise.race([firstLight.lit, after(OPENING_MIN).then(() => null)]);
  if (lit === null) firstLight.end();
  const wait = OPENING_MIN - firstLight.elapsed();
  // An opening that fails on the way ends at once (`ended`), and the title goes on.
  if (wait > 0 && firstLight.playing) await Promise.race([after(wait), firstLight.ended]);
  if (!firstLight.playing || tab !== 'title' || !v.attracting) {
    if (tab === 'title') { loadGate.hold(true); v.setRunning(true); }
    return;
  }
  // From the cut on, heavy steps wait for the title's cuts again.
  loadGate.hold(true);
  v.restartAttract(firstLight.elapsed());
  v.setRunning(true);
  // Two frames: the first of shot 1 is drawn under the opening before it goes.
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  firstLight.end();
  timing.mark('opened');
}
home.addEventListener('click', () => showTab('title'));
labTab.addEventListener('click', () => showTab('lab'));
insideTab.addEventListener('click', () => showTab('inside'));
outsideTab.addEventListener('click', () => showTab('outside'));
tourTab.addEventListener('click', () => showTab('tour'));
const opened = new URLSearchParams(location.search).get('view');
showTab(opened === 'inside' || opened === 'outside' || opened === 'lab' || opened === 'tour' ? opened : 'title');

// ---- the debug menu ------------------------------------------------------------------------------
debug.addInfo(() => `Solarpolis ${VERSION}`);
debug.addInfo(() => {
  const h = lab.habitat;
  return h ? `habitat R ${h.radius.toFixed(0)} m, L ${h.length.toFixed(0)} m, seed ${h.seed}, ${h.rpm.toFixed(2)} rpm` : 'habitat: none (the parameters make no habitat)';
});
debug.addInfo(() => memory.line());
debug.addInfo(() => sound.hearingLine());
debug.addInfo(() => debug.fps());
debug.addInfo(() => timing.arrivalLine());
debug.addInfo(() => timing.stutterLine());
debug.addInfo(() => timing.loadingLine());
debug.add({ label: 'Copy the parameters as JSON', group: 'Habitat', run: () => { void navigator.clipboard?.writeText(JSON.stringify(lab.parameters, null, 2)); } });
debug.add({ label: 'Log the parameters and the derived habitat', group: 'Habitat', run: () => console.log(lab.parameters, lab.habitat) });
const view = (): InteriorView | null => insideSlot.view, outsideView = (): OutsideView | null => outsideSlot.view;
debug.addInfo(() => view()?.info() ?? 'inside: not started');
const go = (label: string, s: (h: NonNullable<typeof lab.habitat>) => number): void => debug.add({
  label, group: 'Go', run: () => { const h = lab.habitat, v = view(); if (v && h) v.goTo(v.walker.at.theta, s(h)); },
});
/** Go to a place the ecology finds, `back` metres short of where it starts (negative: that far in), facing it. */
/** A place on the floor at (theta, s) as found from (t, s0) on a floor of radius r: the way there is the way to face. */
const towards = (r: number, t: number, s0: number, at: { theta: number; s: number }): Found => {
  const d = at.theta - t, dx = (d - 2 * Math.PI * Math.round(d / (2 * Math.PI))) * r, dy = at.s - s0, l = Math.hypot(dx, dy) || 1;
  return { theta: at.theta, s: at.s, way: [dx / l, dy / l] };
};
/** Go `back` metres short of a place found, facing it (walker.step: forward is +s, -θ). */
const goBefore = (v: NonNullable<ReturnType<typeof view>>, eco: Ecology, w: Found, back: number): void => {
  const r = Math.max(eco.terrain.habitat.profile.at(w.s).r, 1);
  v.goTo(w.theta - (w.way[0] * back) / r, w.s - w.way[1] * back, Math.atan2(-w.way[0], w.way[1]));
};
const toPlace = (label: string, back: number, find: (eco: Ecology, theta: number, s: number) => Found | null): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), eco = v?.ecology, at = v?.walker.at;
    const w = eco && at && find(eco, at.theta, at.s);
    if (v && eco && w) goBefore(v, eco, w, back);
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
  return towards(h.radius, t, s, b);
});
/** In the busiest entrance court within 3 km now (most people meeting or sitting in it), 12 m from its light well, facing it. */
toPlace('In the busiest court nearby', 12, (eco, t, s) => {
  const h = eco.terrain.habitat, r = h.radius, v = view();
  if (!v) return null;
  const count = new Map<number, number>();
  for (const p of peopleAt(h, v.time, { theta: t, s, radius: 3000 })) if (p.activity === 'meet' || p.activity === 'bench') count.set(p.court, (count.get(p.court) ?? 0) + 1);
  const best = [...count].sort((a, b) => b[1] - a[1])[0], c = best && venuesOf(h).courts[best[0]];
  if (!c) return null;
  return towards(r, t, s, c);
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
  return towards(r, t, s, best);
});
/** 4 m from the nearest person in a drone body staying with others (or else anyone in one), facing them. */
toPlace('Beside the nearest person in a drone body', 4, (eco, t, s) => {
  const h = eco.terrain.habitat, r = h.radius, v = view();
  if (!v) return null;
  const aloft = peopleAt(h, v.time, { theta: t, s, radius: 1500 }, eco.terrain).filter((p) => residentOf(h, p.resident).body === 'drone');
  const by = (p: Person): number => floorGap(r, t, s, p.theta, p.s) + (p.moving || p.size < 2 ? 1e6 : 0);
  const best = aloft.sort((a, b) => by(a) - by(b))[0];
  if (!best) return null;
  return towards(r, t, s, best);
});
/** 6 m from the nearest party out on the land that `keep` picks (within `within` m), facing it. */
const besideParty = (label: string, within: number, keep: (p: Person) => boolean): void => toPlace(label, 6, (eco, t, s) => {
  const h = eco.terrain.habitat, r = h.radius, v = view();
  if (!v) return null;
  const some = peopleAt(h, v.time, { theta: t, s, radius: within }, eco.terrain).filter((p) => !p.moving && keep(p));
  const best = some.sort((a, b) => floorGap(r, t, s, a.theta, a.s) - floorGap(r, t, s, b.theta, b.s))[0];
  if (!best) return null;
  return towards(r, t, s, best);
});
// Down on the grass (sitting or lying, not on a seat); then the beats the places offer.
besideParty('Beside the nearest party on the grass', 6000, (p) => p.size > 1 && p.posture !== POSE.upright && p.activity !== 'bench');
besideParty('Beside the nearest game of catch', 20000, (p) => p.act === 'catch' && p.size > 1);
besideParty('Beside the nearest dancers', 20000, (p) => p.act === 'dance');
besideParty('Beside the nearest pair talking with their hands', 20000, talksWithHands);
besideParty('Beside the nearest one stretching', 20000, (p) => p.act === 'stretch');
besideParty('Beside the nearest one at standing work', 20000, (p) => p.act === 'work' && p.posture === POSE.upright);
// The speech bubbles: a party holding a conversation (Arnd, 2026-10-23).
besideParty('Beside the nearest party talking', 20000, (p) => p.act === 'talk' && p.size > 1 && p.court >= 0);
// Commonwear 3026 (Actors 0.7.0): 4 m from the nearest one standing or sitting in a screen (aurora mantle, living canvas,
// halo), facing them. Their looks are Actors', so its catalogue is loaded first.
debug.add({ label: 'Beside the nearest one in a screen garment (Commonwear)', group: 'Go', run: async () => {
  const v = view(), eco = v?.ecology, at = v?.walker.at;
  if (!v || !eco || !at) return;
  const { humanCatalog } = await import('./render/actors/pack');
  const { Residents } = await import('./render/actors/residents');
  const { catalog, base, human } = await humanCatalog(), looks = new Residents(catalog, base, human);
  const h = eco.terrain.habitat, { theta: t, s } = at;
  const near = peopleAt(h, v.time, { theta: t, s, radius: 3000 }, eco.terrain).filter((p) => !p.moving && residentOf(h, p.resident).body === 'grown');
  near.sort((a, b) => floorGap(h.radius, t, s, a.theta, a.s) - floorGap(h.radius, t, s, b.theta, b.s));
  const best = near.slice(0, 200).find((p) => looks.figureLook(residentOf(h, p.resident)).outfit.some((g) => /^future-(mantle|screen|halo)$/.test(g)));
  if (best) goBefore(v, eco, towards(h.radius, t, s, best), 4);
} });
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
 * above it, looking at it: a tender over its orchard, a lifter at the Gate, a courier at its stop (only of `role`, if given).
 */
const toDrone = (label: string, back: number, role?: string): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, at = v?.walker.at;
    if (!v || !t || !at) return;
    const P = t.habitat.profile, me = toWorld(P, { theta: at.theta, s: at.s, h: 0 });
    let best: { theta: number; s: number; h: number } | null = null, gap = Infinity;
    fleetOf(t).forEach((_, id) => {
      const f = flierAt(t, id, v.time), later = flierAt(t, id, v.time + 30);
      if (f.doing !== 'work' || later.theta !== f.theta || later.s !== f.s || (role && f.role !== role)) return;
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
toDrone('Fly: beside the nearest watcher (the Mind\'s camera drone)', 2, 'watcher');
toDrone('Fly: the nearest watcher from 20 m', 20, 'watcher');
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
/** Where a bird or a flock is, which way is up there and which way it faces, and where it is now. */
type BirdFound = BirdSeen | null | undefined;
/** How long (s) the eye rides beside a bird found from the debug menu, so a swallow at 10 m/s stays in view. */
const RIDE_BESIDE = 12;
/**
 * How far (m) the eye may have moved since it was floated beside the bird before the ride counts as left: more than the
 * flyer's lift off the ground (a swallow skims lower than the flyer may go), less than any jump from this menu.
 */
const RIDE_MOVED = 2;
/**
 * The bird the eye rides beside: until when (ms, page time), where to float each frame, and where it floated last (the
 * ride ends when the eye is sent somewhere else from this menu, or flown off fast).
 */
let birdRide: { until: number; float: () => Vec3 | null; was: Vec3 } | null = null;
/** Beside a bird (or a flock) found round the player, `back` m off its side and `rise` × that above, looking at it; riding along. */
const toBird = (label: string, back: number, find: (v: NonNullable<ReturnType<typeof view>>, eye: Vec3) => BirdFound, rise = 0.3): void => debug.add({
  label, group: 'Go', run: () => {
    const v = view(), eye = v?.eye(), q = v && eye && find(v, eye);
    if (!v || !q) return;
    const float = (): Vec3 | null => {
      const b = q.track(), side: Vec3 = [b.up[1] * b.fwd[2] - b.up[2] * b.fwd[1], b.up[2] * b.fwd[0] - b.up[0] * b.fwd[2], b.up[0] * b.fwd[1] - b.up[1] * b.fwd[0]];
      const n = Math.hypot(...side) || 1, from = v3madd(v3madd(b.at, side, back / n), b.up, back * rise);
      floatToward(from, b.at);
      return v.eye();
    };
    // Off any boat being ridden with.
    riding = null;
    rideSeen = '';
    const was = float();
    birdRide = was && { until: performance.now() + RIDE_BESIDE * 1000, float, was };
  },
});
/** The nearest bird out (not roosting), of a kind; with `still`, one sitting or feeding before one in the air. */
const birdNear = (kind?: BirdKind, still = false) => (v: NonNullable<ReturnType<typeof view>>, eye: Vec3): BirdFound => v.birds?.nearest(eye, kind, still);
toBird('Fly: beside the nearest bird', 0.8, birdNear(undefined, true));
toBird('Fly: the nearest bird from 4 m', 4, birdNear(undefined, true));
toBird('Fly: the nearest bird from 20 m', 20, birdNear(undefined, true));
toBird('Fly: beside the nearest lark', 1.5, birdNear('lark'));
toBird('Fly: beside the nearest owl', 1.5, birdNear('owl'));
toBird('Fly: beside the nearest swallow', 1.2, birdNear('swallow'));
toBird('Fly: beside the nearest swift', 2, birdNear('swift'));
toBird('Fly: beside the nearest starling', 1.2, birdNear('starling', true));
// A murmuration in the air: from the side and a little below it, against the sky.
toBird('Fly: before the nearest murmuration from 120 m', 120, (v, eye) => v.birds?.murmuration(eye), -0.15);
toBird('Fly: into the nearest murmuration', 15, (v, eye) => v.birds?.murmuration(eye), -0.15);
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
// Where a river breaks through a Ring (gen/plan.ts `roomAt`): the only falls on the floor, one room down to the next.
const ringFall = (r: River, i: number): boolean => {
  const p = lab.habitat?.profile, s = sampleS(r, i);
  return !!p && s > p.floorStart && s < p.floorEnd && r.steep[i] > 0.5;
};
toRiver('Below the nearest Ring fall', 80, ringFall);
toRiver('Above the nearest Ring fall', -40, ringFall);
debug.add({ label: 'Fly: across the nearest Ring fall', group: 'Go', run: () => {
  const v = view(), t = v?.ecology?.terrain, at = v?.walker.at;
  const near = t && at && nearestSample(t.rivers, at.theta, at.s, ringFall);
  if (!v || !t || !near) return;
  const r = near.river, i = near.i, s = sampleS(r, i), theta = r.theta[i], w = r.halfWidth[i];
  const aim = toWorld(t.habitat.profile, { theta, s, h: r.surface[i] });
  const eye = toWorld(t.habitat.profile, { theta: theta + w * 2.5 / t.habitat.radius, s: s + (r.from === 'wild' ? 1 : -1) * (w * 2 + 12), h: r.surface[i] + 4 });
  const d = Math.hypot(...aim.map((q, k) => q - eye[k]));
  v.floatAt(eye, aim.map((q, k) => (q - eye[k]) / d) as Vec3);
} });

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
/** Stand on the nearest harbour's pontoon (gen/harbourBuild.ts), by the pier, looking out past the boats in their berths. */
debug.add({
  label: 'Onto the nearest harbour', group: 'Go', run: () => {
    const f = nearestOnFloor((t) => sailingOf(t.habitat).harbours), h = lab.habitat;
    if (!f || !h) return;
    const hb = f.x, at = floorAt(h, hb.frame, hb.pontoon + HARBOUR.pontoon * hb.handrail * 0.6, HARBOUR.pier * hb.handrail);
    f.v.goTo(at.theta, at.s, -hb.frame.heading);
  },
});
/** Float off the nearest harbour, out over the water to one side and above it, looking back at the pier and its berths. */
debug.add({
  label: 'Fly: over the nearest harbour', group: 'Go', run: () => {
    const f = nearestOnFloor((t) => sailingOf(t.habitat).harbours), h = lab.habitat;
    if (!f || !h) return;
    const hb = f.x, size = Math.max(hb.reach, hb.y1 - hb.y0);
    const eye = floorPoint(h, hb.frame, [hb.reach + size * 0.5, hb.y1 + size * 0.4, size * 0.35]), at = floorPoint(h, hb.frame, [hb.reach * 0.45, 0, 0]);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
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
 * The lakes on the floor (gen/plan.ts `meres`): each press floats by the next, the great lake first, off the end of its
 * long axis nearer the eye and up a fifth of its length, looking down it; the other entry stands on its shore, facing
 * the water. The line names which lake it is.
 */
let mereTurn = -1, mereSeen = '';
/** Float at `eye`, looking at `at`. */
const floatToward = (eye: Vec3, at: Vec3): void => {
  const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
  view()?.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
};
const nextMere = () => {
  const h = lab.habitat, meres = h ? planOf(h).meres : [];
  if (!meres.length) return undefined;
  mereTurn = (mereTurn + 1) % meres.length;
  const m = meres[mereTurn];
  mereSeen = `${m.kind === 'great' ? 'the great lake' : `lake ${m.id}`}, ${(m.along * 2).toFixed(0)} × ${(m.across * 2).toFixed(0)} m, ${m.depth.toFixed(0)} m deep, ${m.wild > 0.5 ? 'natural' : 'made'}`;
  return m;
};
debug.add({
  label: 'Fly: the next lake', group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, h = lab.habitat, m = nextMere();
    if (!v || !t || !h || !m) return;
    const R = h.radius, out = m.along + mereShore(m) * 2, side = Math.cos(m.heading) * (v.walker.at.s - m.s) >= 0 ? 1 : -1;
    const et = m.theta + (side * Math.sin(m.heading) * out) / R, es = m.s + side * Math.cos(m.heading) * out;
    const { theta, s, level } = m, eye = toWorld(h.profile, { theta: et, s: es, h: Math.max(t.heightAt(et, es), level) + m.along * 0.4 });
    floatToward(eye, toWorld(h.profile, { theta, s, h: level }));
  },
});
debug.add({
  label: 'To the next lake\'s shore', group: 'Go', run: () => {
    const v = view(), h = lab.habitat, m = nextMere();
    if (!v || !h || !m) return;
    // Across its long axis, a few metres up from the water, facing it (heading 0 along +s, rising toward −θ).
    const R = h.radius, out = m.across + Math.min(mereShore(m) * 0.4, 12);
    const theta = m.theta + (Math.cos(m.heading) * out) / R, s = m.s - Math.sin(m.heading) * out;
    v.goTo(theta, s, Math.atan2((theta - m.theta) * R, m.s - s));
  },
});
debug.addInfo(() => (mereSeen ? `lake: ${mereSeen}` : ''));
/**
 * The wind where the walker is (world/wind.ts) and the boats out on the water (sim/sailing.ts); the Go entry floats
 * beside the nearest boat under sail, a few of its lengths off and above, looking at it.
 */
debug.addInfo(() => {
  const v = view(), h = lab.habitat;
  if (!v || !h) return '';
  const { theta, s } = v.walker.at, w = windAt(h, v.time, theta, s), fleet = sailingOf(h);
  const from = `${Math.abs(w.along) >= Math.abs(w.around) ? (w.along > 0 ? 'the wild end' : 'the port end') : w.around > 0 ? 'against the spin' : 'spinward'}`;
  const out = boatsNear(h, v.time, theta, s, h.radius * 8).filter((b) => b.sailing).length, crews = crewsOf(h);
  return `wind: ${Math.hypot(w.along, w.around).toFixed(1)} m/s from ${from}; boats under sail: ${out} of ${fleet.boats.length}; ${crews.sailors} residents crew them`;
});
/** Beside the nearest crew walking to their boat or home from it (sim/crews.ts), a few metres off and a little up. */
let crewSeen = '';
debug.add({
  label: 'Fly: beside the nearest crew on their way to their boat', group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, h = lab.habitat;
    if (!v || !t || !h) return;
    const { theta, s } = v.walker.at, R = h.radius, gap = (p: Person): number => floorGap(R, theta, s, p.theta, p.s);
    const p = crewsAt(h, v.time, undefined, t).filter((q) => !q.seat).sort((a, b) => gap(a) - gap(b))[0];
    crewSeen = p ? `a crew of ${p.size} walking between their court and boat ${p.boat}` : 'no crew on their way now';
    if (!p) return;
    const side = p.heading + Math.PI / 2, ground = t.standAt(p.theta, p.s);
    floatToward(toWorld(h.profile, { theta: p.theta + (Math.sin(side) * 7) / R, s: p.s + Math.cos(side) * 7, h: ground + 3 }), toWorld(h.profile, { theta: p.theta, s: p.s, h: ground + 1 }));
  },
});
debug.addInfo(() => crewSeen);
debug.add({
  label: 'Fly: beside the nearest boat under sail', group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, h = lab.habitat;
    if (!v || !t || !h) return;
    const { theta, s } = v.walker.at, boat = boatsNear(h, v.time, theta, s, h.radius * 20).find((b) => b.sailing);
    if (!boat) return;
    // Off its beam to windward, a few lengths out and up.
    const R = h.radius, off = 6 * 12, side = boat.heading + (Math.PI / 2) * boat.tack;
    const across = Math.sin(side) * off, along = Math.cos(side) * off;
    const et = boat.theta + across / R, es = boat.s + along;
    floatToward(toWorld(h.profile, { theta: et, s: es, h: boat.level + off * 0.4 }), toWorld(h.profile, { theta: boat.theta, s: boat.s, h: boat.level + 3 }));
  },
});
/**
 * Riding beside a boat: each press picks the next design (skiff, foiler, cruiser, then off) and the nearest boat of it
 * under sail (or at its mooring, if none is out), and the eye keeps pace with it every frame, off its lee bow a couple
 * of its lengths out and a little up, swinging round slowly as it tacks, looking at its wing.
 */
let riding: { boat: Boat; angle: number } | null = null, rideTurn = -1, rideSeen = '';
debug.add({
  label: 'Ride beside a boat: skiff → foiler → cruiser → off', group: 'Go', run: () => {
    const v = view(), h = lab.habitat;
    if (!v || !h) return;
    rideTurn = (rideTurn + 1) % (BOAT_KIND_LIST.length + 1);
    const kind = BOAT_KIND_LIST[rideTurn], { theta, s } = v.walker.at;
    const near = kind ? boatsNear(h, v.time, theta, s, h.radius * 40).filter((b) => b.boat.kind === kind) : [];
    const boat = near.find((b) => b.sailing) ?? near[0];
    riding = boat ? { boat: boat.boat, angle: NaN } : null;
    rideSeen = boat ? `riding beside a ${kind} ${boat.sailing ? 'under sail' : 'at its mooring'}` : kind ? `no ${kind} on this water` : '';
  },
});
debug.addInfo(() => rideSeen);
/**
 * The capsules (render/capsules.ts), through the same link offers the player takes: call one to here, get into the one
 * waiting, ride to the nearest court further than 150 m, get out.
 */
const capOffer = (id: string, choose?: (choices: readonly LinkChoice[]) => LinkChoice | undefined): void => {
  const offer = view()?.capsules.offers().find((o) => o.id === id);
  if (!offer) return;
  if (!choose) { offer.take(); return; }
  const pick = choose(offer.choices ?? []);
  if (pick) offer.take(pick.id);
};
debug.add({ label: 'Capsule: call one here', group: 'Go', run: () => capOffer('call') });
debug.add({ label: 'Capsule: walk up to it', group: 'Go', run: () => {
  const v = view(), h = lab.habitat, at = v?.besideCapsule(), step = v?.besideCapsule(0);
  if (!v || !h || !at || !step) return;
  // Facing the door.
  const p = fromWorld(h.profile, ...at), d = fromWorld(h.profile, ...step);
  v.goTo(p.theta, p.s, Math.atan2((p.theta - d.theta) * h.radius, d.s - p.s));
} });
debug.add({ label: 'Capsule: get in', group: 'Go', run: () => view()?.boardCapsule() });
debug.add({ label: 'Capsule: ride to the nearest court', group: 'Go', run: () => capOffer('go', (cs) => cs.filter((c) => c.group !== 'Landmarks' && (c.near ?? 0) > 150).sort((a, b) => (a.near ?? 0) - (b.near ?? 0))[0]) });
debug.add({ label: 'Capsule: get out', group: 'Go', run: () => capOffer('out') });
/** Keep the eye beside the boat being ridden with, this frame (dt: s). */
function rideAlong(dt: number): void {
  const v = view(), h = lab.habitat;
  if (!riding || !v || !h) return;
  const b = boatAt(h, riding.boat, v.time), spec = BOAT_KINDS[riding.boat.kind];
  const want = b.heading - b.tack * 0.75;
  riding.angle = Number.isFinite(riding.angle) ? riding.angle + angleDiff(riding.angle, want) * Math.min(1, dt * 0.5) : want;
  const off = 2.2 * spec.length + 6, R = h.radius, ahead = b.speed * 0.5;
  const at = { theta: b.theta + (Math.sin(b.heading) * ahead) / R, s: b.s + Math.cos(b.heading) * ahead };
  const eye = toWorld(h.profile, { theta: at.theta + (Math.sin(riding.angle) * off) / R, s: at.s + Math.cos(riding.angle) * off, h: b.level + 0.3 * spec.mast + 1.5 });
  floatToward(eye, toWorld(h.profile, { theta: at.theta, s: at.s, h: b.level + 0.35 * spec.mast }));
}
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
    const plan = planOf(h), kinds = Object.keys(WORK_KINDS) as DistrictWorkKind[], R = h.radius, at = v.walker.at;
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
/**
 * The signature works (gen/works.ts `SIGNATURE_KINDS`): each press floats by the next (the Spiral, the Wave Field, the
 * Tilt, as the habitat has them), 1.6 of its radii off and 0.45 up, the Tilt seen from before its cliff; the far-side
 * entry looks at the last one from the floor across the axis, as people there see it over their heads.
 */
let signatureTurn = -1;
const signatureNamed = (w: Work): string => ({ spiral: 'the Spiral', 'wave-field': 'the Wave Field', tilt: 'the Tilt' } as Record<string, string>)[w.kind] ?? w.kind;
const signatureOf = (): Work | undefined => {
  const h = lab.habitat;
  return h ? planOf(h).works.filter(isSignature)[signatureTurn] : undefined;
};
const lookFrom = (eye: Vec3, w: Work, t: Terrain, h: Habitat): void => {
  const { theta, s } = w;
  floatToward(eye, toWorld(h.profile, { theta, s, h: t.heightAt(theta, s) }));
};
debug.add({
  label: 'Fly: the next signature work', group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, h = lab.habitat;
    if (!v || !t || !h) return;
    const all = planOf(h).works.filter(isSignature);
    if (!all.length) { workSeen = 'no signature works in this habitat'; return; }
    signatureTurn = (signatureTurn + 1) % all.length;
    const w = all[signatureTurn], R = h.radius, dir = w.kind === 'tilt' ? 1 : -1;
    const maker = w.district >= 0 ? `standing in the ${planOf(h).districts[w.district].style} district ${w.district}` : 'on the floor';
    workSeen = `${signatureNamed(w)}, ${w.height.toFixed(0)} m high, ${(w.radius * 2).toFixed(0)} m across, ${maker}`;
    const et = w.theta + (Math.sin(w.facing) * dir * w.radius * 1.6) / R, es = w.s + Math.cos(w.facing) * dir * w.radius * 1.6;
    lookFrom(toWorld(h.profile, { theta: et, s: es, h: t.heightAt(et, es) + w.radius * 0.45 }), w, t, h);
  },
});
debug.add({
  label: 'Fly: the signature work from the far side', group: 'Go', run: () => {
    const v = view(), t = v?.ecology?.terrain, h = lab.habitat, w = signatureOf();
    if (!v || !t || !h || !w) return;
    const et = w.theta + Math.PI, es = w.s;
    lookFrom(toWorld(h.profile, { theta: et, s: es, h: t.heightAt(et, es) + 60 }), w, t, h);
  },
});
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
/** Float at a plan point and height of the Threshold (gen/threshold.ts), looking at another. */
const byThreshold = (label: string, place: (st: LiftStair) => { eye: [number, number, number]; at: [number, number, number] } | null): void => debug.add({
  label, group: 'Go', run: () => {
    const f = stair(), p = f && f.st.threshold ? place(f.st) : null;
    if (!f || !p) return;
    const ramp = rampOf(f.h), eye = ramp.world(...p.eye), at = ramp.world(...p.at);
    const d = Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]);
    f.v.floatAt(eye, [(at[0] - eye[0]) / d, (at[1] - eye[1]) / d, (at[2] - eye[2]) / d]);
  },
});
byThreshold('Fly: the Threshold from off the Gate face', (st) => {
  const g = st.threshold!.galleries, low = g[g.length - 1], w = (low.w0 + low.w1) / 2;
  return { eye: [low.z0 - (low.w1 - low.w0) * 0.9, w, st.top.e + st.width], at: [(low.z0 + st.top.z1) / 2, w, low.e] };
});
byThreshold('Fly: the Threshold\'s portal', (st) => {
  const q = st.top, w = (q.w0 + q.w1) / 2;
  return { eye: [q.z0 + (q.z1 - q.z0) * 0.3, w, q.e + 1.7], at: [q.z1, w, q.e + st.handrail * 2.2] };
});
// The notice to newcomers (gen/welcomeSign.ts), from where one steps out of the port door.
byThreshold('Fly: the notice at the port door, as a newcomer reads it', (st) => {
  const f = stair(), sign = f && welcomeSignOf(f.h), q = st.top;
  if (!sign) return null;
  const w = (sign.plan.w0 + sign.plan.w1) / 2;
  return { eye: [q.z1 - (q.z1 - q.z0) * 0.2, w, q.e + 1.7], at: [sign.plan.z, w, (sign.plan.e0 + sign.plan.e1) / 2] };
});
debug.add({
  label: 'To the Threshold: its lowest gallery, by the capsule berth', group: 'Go', run: () => {
    const f = stair(), b = f?.st.threshold?.berth;
    if (f && b) standOnStair(f, b.at[0], b.at[1] + Math.sign(b.toward[1] - b.at[1]) * f.st.width * 0.6);
  },
});
/**
 * Falls (design "Nobody falls far", render/guardians.ts): stand `up` m over the ground where the player is, facing the
 * same way, and let go. The guardians catch what would hurt; when none is near enough the ground's bag does.
 */
const dropHere = (label: string, up: number): void => debug.add({
  label: `Fall: ${label}`, group: 'Physics', run: () => {
    const f = inView((t) => footingOf(t));
    if (!f) return;
    const { theta, s } = f.v.walker.at;
    f.v.dropFrom({ theta, s, h: f.x(theta, s, Infinity).h + up }, f.v.walker.heading);
  },
});
dropHere('drop from 8 m here (the bag)', 8);
dropHere('drop from 50 m here', 50);
dropHere('drop from 300 m here', 300);
debug.add({
  label: 'Fall: walk to the brink of the deepest drop within 1.5 km (step off it yourself)', group: 'Physics', run: () => {
    const f = inView((t) => t), h = lab.habitat;
    if (!f || !h) return;
    const { theta, s } = f.v.walker.at, footing = footingOf(f.x);
    // The deepest, not the nearest: the nearest is often a bank a few metres high, which one slides down rather than falls.
    const post = postsNear(h, footing, theta, s, 1500).reduce<Post | null>((a, q) => (!a || q.drop > a.drop ? q : a), null);
    if (!post) { console.info('No drop that would hurt within 1.5 km.'); return; }
    // A few steps back from the post, facing the way the ground falls away (the walker's heading turns the other way round the axis).
    const back = 2.5, r = Math.max(1, h.profile.at(post.s).r);
    f.v.goTo(post.theta - (back * Math.sin(post.toward)) / r, post.s - back * Math.cos(post.toward), -post.toward);
  },
});
debug.add({
  label: 'Fall: the Long Drop, step out at capsule height over the floor', group: 'Physics', run: () => {
    const f = inView((t) => footingOf(t)), h = lab.habitat;
    if (!f || !h) return;
    const { theta, s } = f.v.walker.at, g = h.params.life;
    // As high as the capsules fly near the axis, a little lower; caught `late` (a share of the radius) over the ground.
    const r = g.caps.axis * h.radius * 1.05, ground = f.x(theta, s, Infinity).h, top = h.profile.at(s).r - r;
    f.v.dropFrom({ theta, s, h: Math.max(ground + 20, top) }, f.v.walker.heading, g.guard.late * h.radius);
  },
});
debug.add({
  label: 'Fall: off the Threshold\'s lowest gallery (down the Gate face)', group: 'Physics', run: () => {
    const f = stair(), q = f?.st.threshold?.galleries;
    if (!f || !q?.length) return;
    const low = q[q.length - 1], w = (low.w0 + low.w1) / 2, at = fromWorld(f.h.profile, ...rampOf(f.h).world(low.z0 - 0.8, w, low.e + 0.05));
    f.v.dropFrom(at, Math.PI);
  },
});
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
debug.add({ label: 'Below: beside neighbours at a shared hall', group: 'Go', run: () => {
  const h = lab.habitat, v = view(), t = v?.ecology?.terrain;
  if (!h || !v || !t) return;
  const m = hamletsNear(h, v.walker.at.theta, v.walker.at.s)[0];
  if (!m) return;
  const people = neighboursAt(t, v.time, { ...m.site, radius: m.edge * h.params.under.bay * 1.3 });
  const p = people.find((p) => !p.moving) ?? people[0];
  if (!p) return;
  const u = underOf(h), bay = u.bayAt(p.theta, p.s)!, c = u.centreOf(bay.i, bay.j);
  const s = c.s + (p.s < c.s ? 5 : -5);
  v.goBelow(p.theta, s, p.s > s ? 0 : Math.PI);
} });
let nextSky = 0;
debug.add({ label: 'Below: beside a resident wearing stockings', group: 'Go', run: async () => {
  const h = lab.habitat, v = view(), t = v?.ecology?.terrain;
  if (!h || !v || !t) return;
  const { humanCatalog } = await import('./render/actors/pack');
  const { Residents } = await import('./render/actors/residents');
  const { catalog, base, human } = await humanCatalog(), looks = new Residents(catalog, base, human);
  for (const m of hamletsNear(h, v.walker.at.theta, v.walker.at.s).slice(0, 8)) {
    const people = neighboursAt(t, v.time, { ...m.site, radius: m.edge * h.params.under.bay * 1.3 });
    const p = people.find((p) => !p.moving && looks.figureLook(residentOf(h, p.resident)).outfit.includes('stockings'));
    if (!p) continue;
    v.goBelow(p.theta, p.s - 3, 0);
    return;
  }
} });
debug.add({ label: 'Below: under the next kind of hamlet sky', group: 'Go', run: () => underSky(nextSky++ % SKIES.length) });
debug.add({ label: 'Below: under a glass deck (the real sky above)', group: 'Go', run: () => underSky(GLASS) });
debug.add({ label: 'Up onto the land (from below)', group: 'Go', run: () => { const v = view(); if (v) v.goTo(v.walker.at.theta, v.walker.at.s); } });
debug.add({ label: 'Arrival: reveal the port terrace', group: 'Go', run: async () => {
  const v = view();
  if (v && await v.prepareArrival()) void v.revealArrival();
} });
debug.add({ label: 'Travel 10× faster (toggle)', group: 'Go', run: () => { const v = view(); if (v) v.boost = v.boost === 1 ? 10 : 1; } });
debug.addInfo(() => view()?.clockLine() ?? '');
/** The next of a cycle of clock speeds. */
const nextOf = <T>(choices: T[], now: T): T => choices[(choices.indexOf(now) + 1) % choices.length];
debug.add({ label: 'Clock speed: real time → ×60 → ×600 → paused', group: 'Time', run: () => { const v = view(); if (v) v.timeScale = nextOf([1, 60, 600, 0], v.timeScale); } });
debug.add({ label: 'Two hours later', group: 'Time', run: () => view()?.skip(7200) });
debug.add({ label: 'Five minutes later', group: 'Time', run: () => view()?.skip(300) });
debug.add({ label: 'To the dawn chorus (the light coming up here)', group: 'Time', run: () => view()?.skipToLight(0.3, true) });
debug.add({ label: 'To nightfall here (owls out)', group: 'Time', run: () => view()?.skipToLight(0.03, false) });
debug.add({ label: "To the starlings' murmuration here (dusk)", group: 'Time', run: () => view()?.skipToLight(0.06, false, -600) });
debug.add({ label: "To the swifts' dusk race at the Stair", group: 'Time', run: () => view()?.skipToLight(0.3, false) });
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
  timing.countFrame(t - last);
  rideAlong(Math.min(0.1, (t - last) / 1000));
  const eye = birdRide && view()?.eye();
  if (birdRide && eye && t < birdRide.until && apart(eye, birdRide.was) < RIDE_MOVED) birdRide.was = birdRide.float() ?? birdRide.was;
  else birdRide = null;
  last = t;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

/** The same home for entry, room and stair verification. */
function visitAdaptiveHome(where: 'inside' | 'door' | 'stairs'): void {
  const h = lab.habitat, v = view(), t = v?.ecology?.terrain;
  if (!h || !v || !t) return;
  const u = underOf(h), hr = h.params.landmarks?.handrail ?? 1;
  for (const m of hamletsNear(h, v.walker.at.theta, v.walker.at.s).slice(0, 8)) for (const { i, j } of baysOfHamlet(u, m, 8)) {
    if (u.useAt(i, j) !== 'home') continue;
    const house = underHousesIn(t, i, j).houses.find((x) => x.lived && x.storeys > 1);
    if (!house) continue;
    const p = homePlan(house, hr), st = p.stair;
    const at = floorAt(h, bayFrame(u, i, j), where === 'stairs' ? (st.x0 + st.x1) / 2 : p.doorX,
      where === 'stairs' ? st.y0 - hr * 0.3 : p.doorY - house.door * hr * (where === 'door' ? -0.7 : 1.5));
    v.goBelow(at.theta, at.s, where === 'stairs' ? -Math.PI / 2 : house.door * Math.PI / 2);
    if (where !== 'door') v.walker.follow(toWorld(h.profile, { ...at, h: house.base + 0.02 * hr }));
    v.walker.pitch = where === 'stairs' ? 0.3 : -0.08;
    return;
  }
}
debug.add({ label: 'Below: inside an adaptive home', group: 'Go', run: () => visitAdaptiveHome('inside') });
debug.add({ label: 'Below: at an adaptive home doorway', group: 'Go', run: () => visitAdaptiveHome('door') });
debug.add({ label: 'Below: at an adaptive home stair', group: 'Go', run: () => visitAdaptiveHome('stairs') });
debug.add({ label: 'Below: beside residents at home', group: 'Go', run: () => {
  const h = lab.habitat, v = view(), t = v?.ecology?.terrain;
  if (!h || !v || !t) return;
  for (const m of hamletsNear(h, v.walker.at.theta, v.walker.at.s).slice(0, 8)) {
    const p = neighboursAt(t, v.time, { ...m.site, radius: m.edge * h.params.under.bay }).find((x) => x.interiorFloor !== undefined && !x.moving);
    if (!p) continue;
    v.goBelow(p.theta, p.s + 2.5, Math.PI);
    v.walker.follow(toWorld(h.profile, { theta: p.theta, s: p.s + 2.5, h: p.interiorFloor! }));
    v.walker.pitch = -0.08;
    return;
  }
} });

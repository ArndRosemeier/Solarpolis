/**
 * The page: the header with the version and What's new, the memory watchdog, the debug menu, and the current view:
 * the Blueprint Lab (design a habitat), Inside (walk in it) or Outside (the habitat in its orbit, with Earth, the Moon,
 * the Sun and the stars). The two views are WebGPU only.
 */
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
import { EYE_HEIGHT } from './world/walker';
import type { Habitat } from './blueprint';

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
// The views fill the window below the header, whatever height the header wraps to.
const fit = (): void => { for (const s of [insideSlot, outsideSlot]) s.box.style.setProperty('--top', `${header.getBoundingClientRect().bottom}px`); };
new ResizeObserver(fit).observe(header);
let starting: Promise<void> | null = null;

// The title: the Outside view flying its attract loop, with the card over it. It is where the page opens.
const title = new TitleCard(() => showTab('inside'));
outsideSlot.box.append(title.root);

type Tab = 'title' | 'lab' | 'inside' | 'outside';
function showTab(which: Tab): void {
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
  label, group: 'Go', run: () => { const h = lab.habitat, v = view(); if (v && h) v.walker.at = { theta: v.walker.at.theta, s: s(h), h: EYE_HEIGHT }; },
});
go('The middle of the floor', (h) => (h.profile.floorStart + h.profile.floorEnd) / 2);
go('The foot of the wild endcap', (h) => h.profile.floorStart + 20);
go('Halfway up the wild endcap', (h) => h.profile.floorStart / 2);
go('The foot of the port endcap', (h) => h.profile.floorEnd - 20);
debug.add({ label: 'Travel 10× faster (toggle)', group: 'Go', run: () => { const v = view(); if (v) v.boost = v.boost === 1 ? 10 : 1; } });
debug.addInfo(() => view()?.clockLine() ?? '');
/** The next of a cycle of clock speeds. */
const nextSpeed = (speeds: number[], now: number): number => speeds[(speeds.indexOf(now) + 1) % speeds.length];
debug.add({ label: 'Clock speed: real time → ×60 → ×600 → paused', group: 'Time', run: () => { const v = view(); if (v) v.timeScale = nextSpeed([1, 60, 600, 0], v.timeScale); } });
debug.add({ label: 'Two hours later', group: 'Time', run: () => view()?.skip(7200) });
debug.addInfo(() => outsideView()?.info() ?? 'outside: not started');
debug.add({ label: 'Clock speed outside: real time → ×60 → ×3600 → paused', group: 'Outside', run: () => { const v = outsideView(); if (v) v.timeScale = nextSpeed([1, 60, 3600, 0], v.timeScale); } });
debug.add({ label: 'Six hours later', group: 'Outside', run: () => outsideView()?.skip(6 * 3600) });
debug.add({ label: "Jump to Earth's next shadow on the habitat", group: 'Outside', run: () => { const v = outsideView(); if (v && !v.nextShadow()) console.log('no shadow within a year'); } });
debug.add({ label: 'Heroic stars (toggle): off shows them as true eyes would', group: 'Outside', run: () => { const v = outsideView(); if (v) v.heroicStars = !v.heroicStars; } });
debug.add({ label: 'Night eyes augmentation (toggle): the eyes open far enough for the stars', group: 'Outside', run: () => { const v = outsideView(); if (v) v.nightEyes = !v.nightEyes; } });
debug.addInfo(() => view()?.physicsLine() ?? '');
debug.add({ label: 'Drop a ball from 20 m', group: 'Physics', run: () => void view()?.dropBall(20) });
debug.add({ label: 'Drop a ball from 100 m', group: 'Physics', run: () => void view()?.dropBall(100) });
debug.add({ label: 'Remove the balls', group: 'Physics', run: () => view()?.clearBalls() });
debug.add({ label: 'Log the shader report', group: 'Render', run: () => console.log((globalThis as { shaders?: { report(): string } }).shaders?.report() ?? 'no renderer yet') });
debug.add({ label: 'Take a memory sample now', group: 'Memory', run: () => console.log(memory.sample()) });
debug.add({ label: 'Log the memory history', group: 'Memory', run: () => console.table(memory.history.map((s) => ({ t: Math.round(s.t), totalMB: Math.round(s.total / 1048576), level: s.level }))) });

let last = performance.now();
const frame = (t: number): void => {
  debug.frame(t - last);
  last = t;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

/**
 * The page: the header with the version and What's new, the memory watchdog, the debug menu, and the current view:
 * the Blueprint Lab (design a habitat) or Inside (walk in it, WebGPU only).
 */
import './app/style.css';
import { el } from './app/dom';
import { DebugMenu } from './app/debug';
import { MemoryWatchdog, browserHeap, thisDeviceBudget, type PressureLevel } from './app/memory';
import { VERSION, whatsNewButton } from './app/whatsNew';
import { BlueprintLab } from './lab/blueprintLab';
import { GraphicsUnavailable } from '@futuremagic/stage';
import { InteriorView } from './render/view';
import { EYE_HEIGHT } from './world/walker';

const app = document.getElementById('app')!;
const debug = new DebugMenu();

// ---- the header ---------------------------------------------------------------------------------
const header = el('header', 'top');
const tabs = el('nav', 'tabs');
const labTab = el('button', 'tab on', 'Blueprint'), insideTab = el('button', 'tab', 'Inside');
tabs.append(labTab, insideTab);
header.append(el('h1', '', 'Solarpolis'), tabs, whatsNewButton());
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
  if (new URLSearchParams(location.search).get('view') === 'inside') q.set('view', 'inside');
  const all = q.toString();
  history.replaceState(null, '', all ? `?${all}` : location.pathname);
});
app.append(lab.root);

const inside = el('div', 'inside');
const note = el('p', 'inside-note');
const hint = el('p', 'inside-hint', 'Hold the right mouse button to look around · W A S D to move · Shift to run · F to fly (E up, Q down)');
inside.append(note, hint);
inside.hidden = true;
app.append(inside);
// The view fills the window below the header, whatever height the header wraps to.
const fit = (): void => inside.style.setProperty('--top', `${header.getBoundingClientRect().bottom}px`);
new ResizeObserver(fit).observe(header);
let view: InteriorView | null = null;
let starting: Promise<void> | null = null;

async function showInside(): Promise<void> {
  const h = lab.habitat;
  if (!h) { note.textContent = 'These parameters make no habitat: fix them in the Blueprint first.'; return; }
  if (view) { await view.setHabitat(h); view.setRunning(true); return; }
  note.textContent = 'Building the interior…';
  try {
    view = await InteriorView.create(h);
    inside.prepend(view.canvas);
    memory.track('terrain tiles', () => view?.bytes() ?? 0);
    memory.onPressure('soft', () => view?.shed());
    note.textContent = '';
    view.setRunning(!inside.hidden);
  } catch (e) {
    note.textContent = e instanceof Error ? e.message : String(e);
    if (e instanceof GraphicsUnavailable) note.textContent += '. Solarpolis needs WebGPU: a current Chrome, Edge or Safari (macOS 26, iPadOS 26), or Firefox 141+ on Windows.';
  }
}

function select(which: 'lab' | 'inside'): void {
  labTab.classList.toggle('on', which === 'lab');
  insideTab.classList.toggle('on', which === 'inside');
  lab.root.hidden = which !== 'lab';
  inside.hidden = which !== 'inside';
  if (which === 'inside') starting = (starting ?? Promise.resolve()).then(showInside);
  else view?.setRunning(false);
  const q = new URLSearchParams(location.search);
  if (which === 'inside') q.set('view', 'inside'); else q.delete('view');
  const query = q.toString();
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
}
labTab.addEventListener('click', () => select('lab'));
insideTab.addEventListener('click', () => select('inside'));
if (new URLSearchParams(location.search).get('view') === 'inside') select('inside');

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
debug.addInfo(() => (view ? view.info() : 'inside: not started'));
const go = (label: string, s: (h: NonNullable<typeof lab.habitat>) => number): void => debug.add({
  label, group: 'Go', run: () => { const h = lab.habitat; if (view && h) view.walker.at = { theta: view.walker.at.theta, s: s(h), h: EYE_HEIGHT }; },
});
go('The middle of the floor', (h) => (h.profile.floorStart + h.profile.floorEnd) / 2);
go('The foot of the wild endcap', (h) => h.profile.floorStart + 20);
go('Halfway up the wild endcap', (h) => h.profile.floorStart / 2);
go('The foot of the port endcap', (h) => h.profile.floorEnd - 20);
debug.add({ label: 'Travel 10× faster (toggle)', group: 'Go', run: () => { if (view) view.boost = view.boost === 1 ? 10 : 1; } });
debug.addInfo(() => (view ? view.clockLine() : ''));
debug.add({ label: 'Clock speed: ×60 → ×600 → paused → real time', group: 'Time', run: () => {
  if (!view) return;
  const speeds = [60, 600, 0, 1];
  view.timeScale = speeds[(speeds.indexOf(view.timeScale) + 1) % speeds.length];
} });
debug.add({ label: 'Two hours later', group: 'Time', run: () => view?.skip(7200) });
debug.addInfo(() => (view ? view.physicsLine() : ''));
debug.add({ label: 'Drop a ball from 20 m', group: 'Physics', run: () => void view?.dropBall(20) });
debug.add({ label: 'Drop a ball from 100 m', group: 'Physics', run: () => void view?.dropBall(100) });
debug.add({ label: 'Remove the balls', group: 'Physics', run: () => view?.clearBalls() });
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

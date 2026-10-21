/**
 * The page: the header with the version and What's new, the memory watchdog, the debug menu, and the current view.
 * Until the habitat can be walked in (milestone 2), the view is the Blueprint Lab.
 */
import './app/style.css';
import { el } from './app/dom';
import { DebugMenu } from './app/debug';
import { MemoryWatchdog, browserHeap, thisDeviceBudget, type PressureLevel } from './app/memory';
import { VERSION, whatsNewButton } from './app/whatsNew';
import { BlueprintLab } from './lab/blueprintLab';

const app = document.getElementById('app')!;
const debug = new DebugMenu();

// ---- the header ---------------------------------------------------------------------------------
const header = el('header', 'top');
header.append(el('h1', '', 'Solarpolis'), el('span', 'top-sub', 'Blueprint Lab'), whatsNewButton());
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
  history.replaceState(null, '', query ? `?${query}` : location.pathname);
});
app.append(lab.root);

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
debug.add({ label: 'Take a memory sample now', group: 'Memory', run: () => console.log(memory.sample()) });
debug.add({ label: 'Log the memory history', group: 'Memory', run: () => console.table(memory.history.map((s) => ({ t: Math.round(s.t), totalMB: Math.round(s.total / 1048576), level: s.level }))) });

let last = performance.now();
const frame = (t: number): void => {
  debug.frame(t - last);
  last = t;
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);

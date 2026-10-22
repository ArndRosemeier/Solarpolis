/**
 * The Blueprint Lab (the Blueprint tab, the start page): habitat parameters
 * in, derived numbers, validity findings and a to-scale section out. Every change rewrites the URL, so a link is a
 * habitat. Plain DOM and SVG; it needs no renderer.
 */
import { derive, validate, isValid, MATRIX, type Habitat, type HabitatParams, type Finding } from '../blueprint';
import { habitatFromUrl, habitatToUrl, presetOf } from '../app/params';
import { el } from '../app/dom';
import { PlanView } from './planView';
import { LifeView } from './lifeView';
import { UnderView } from './underView';

const G = 9.80665;
const SVG = 'http://www.w3.org/2000/svg';

/** A slider: label, range (log or linear), how it reads and writes the parameters, and how its value is shown. */
interface Control {
  label: string;
  min: number;
  max: number;
  log?: boolean;
  step?: number;
  get: (p: HabitatParams) => number;
  set: (p: HabitatParams, v: number) => HabitatParams;
  show: (v: number) => string;
}

const km = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${m.toFixed(0)} m`);
const si = (v: number, unit: string): string => {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)} T${unit}`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)} G${unit}`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} M${unit}`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)} k${unit}`;
  return `${v.toFixed(1)} ${unit}`;
};

const CONTROLS: Control[] = [
  { label: 'Radius', min: 100, max: 40000, log: true, get: (p) => p.radius, set: (p, v) => ({ ...p, radius: v }), show: km },
  { label: 'Length', min: 500, max: 200000, log: true, get: (p) => p.length, set: (p, v) => ({ ...p, length: v }), show: km },
  { label: 'Floor gravity', min: 0.1, max: 1.5, step: 0.01, get: (p) => p.floorGravity / G, set: (p, v) => ({ ...p, floorGravity: v * G }), show: (v) => `${v.toFixed(2)} g` },
  { label: 'Sun distance', min: 0.3, max: 40, log: true, get: (p) => p.sunDistanceAu, set: (p, v) => ({ ...p, sunDistanceAu: v }), show: (v) => `${v.toFixed(2)} AU` },
  { label: 'Extra collectors', min: 1, max: 300, log: true, get: (p) => p.collectorRatio, set: (p, v) => ({ ...p, collectorRatio: v }), show: (v) => `${v.toFixed(1)}×` },
  { label: 'Light target', min: 20, max: 300, step: 1, get: (p) => p.lightTarget, set: (p, v) => ({ ...p, lightTarget: v }), show: (v) => `${v.toFixed(0)} W/m²` },
  { label: 'Shielding', min: 0.5, max: 20, step: 0.1, get: (p) => p.shieldingDensity / 1000, set: (p, v) => ({ ...p, shieldingDensity: v * 1000 }), show: (v) => `${v.toFixed(1)} t/m²` },
  { label: 'Living layer height', min: 5, max: 60, step: 1, get: (p) => p.layers.living, set: (p, v) => ({ ...p, layers: { ...p.layers, living: v } }), show: (v) => `${v.toFixed(0)} m` },
  { label: 'Hull strength', min: 0.3, max: 10, log: true, get: (p) => p.hull.strength / 1e9, set: (p, v) => ({ ...p, hull: { ...p.hull, strength: v * 1e9 } }), show: (v) => `${v.toFixed(2)} GPa` },
  { label: 'Population', min: 100, max: 1e7, log: true, get: (p) => p.population, set: (p, v) => ({ ...p, population: Math.round(v) }), show: (v) => v.toLocaleString('en', { maximumFractionDigits: 0 }) },
];

const RES = 1000;
const toSlider = (c: Control, v: number): number => {
  const t = c.log ? Math.log(v / c.min) / Math.log(c.max / c.min) : (v - c.min) / (c.max - c.min);
  return Math.round(Math.min(1, Math.max(0, t)) * RES);
};
const fromSlider = (c: Control, x: number): number => {
  const t = x / RES;
  const v = c.log ? c.min * Math.pow(c.max / c.min, t) : c.min + (c.max - c.min) * t;
  return c.step ? Math.round(v / c.step) * c.step : Number(v.toPrecision(3));
};

export class BlueprintLab {
  readonly root = el('div', 'lab');
  private params: HabitatParams;
  private preset: string;
  private readonly sliders: { c: Control; input: HTMLInputElement; out: HTMLOutputElement }[] = [];
  private readonly findings = el('ul', 'lab-findings');
  private readonly section = el('div', 'lab-section');
  private readonly stack = el('div', 'lab-stack');
  private readonly table = el('table', 'lab-table');
  private readonly presets = el('div', 'lab-presets');
  private readonly error = el('p', 'lab-error');
  private readonly plan = new PlanView();
  private readonly life = new LifeView();
  private readonly under = new UnderView();
  habitat: Habitat | null = null;

  constructor(search: URLSearchParams, private readonly onChange: (query: string) => void = () => {}) {
    this.params = habitatFromUrl(search);
    this.preset = presetOf(search).name;
    const controls = el('section', 'lab-controls');
    controls.append(el('h2', '', 'Parameters'), this.presets);
    for (const m of MATRIX) {
      const b = el('button', 'lab-preset', m.name);
      b.type = 'button';
      b.addEventListener('click', () => { this.preset = m.name; this.params = m.params; this.syncSliders(); this.update(); });
      this.presets.append(b);
    }
    for (const c of CONTROLS) {
      const row = el('label', 'lab-row');
      const input = el('input', '');
      input.type = 'range';
      input.min = '0';
      input.max = String(RES);
      const out = el('output', 'lab-value');
      input.addEventListener('input', () => { this.params = c.set(this.params, fromSlider(c, Number(input.value))); this.update(); });
      row.append(el('span', 'lab-label', c.label), out, input);
      controls.append(row);
      this.sliders.push({ c, input, out });
    }
    const results = el('section', 'lab-results');
    results.append(el('h2', '', 'Section'), this.section, el('h2', '', 'Land plan'), this.plan.root, el('h2', '', 'Who is out on the land'), this.life.root, el('h2', '', 'Under the floor'), this.stack, this.under.root, el('h2', '', 'Checks'), this.error, this.findings, el('h2', '', 'Derived'), this.table);
    this.root.append(controls, results);
    this.syncSliders();
    this.update();
  }

  /** The parameters shown now. */
  get parameters(): HabitatParams {
    return this.params;
  }

  private syncSliders(): void {
    for (const s of this.sliders) s.input.value = String(toSlider(s.c, s.c.get(this.params)));
    for (const b of this.presets.querySelectorAll('button')) b.classList.toggle('on', b.textContent === this.preset);
  }

  private update(): void {
    for (const s of this.sliders) s.out.value = s.c.show(s.c.get(this.params));
    this.onChange(habitatToUrl(this.preset, this.params));
    let h: Habitat;
    try {
      h = derive(this.params);
    } catch (e) {
      this.habitat = null;
      this.error.textContent = e instanceof Error ? e.message : String(e);
      this.findings.replaceChildren();
      this.table.replaceChildren();
      this.section.replaceChildren();
      this.stack.replaceChildren();
      this.plan.show(null);
      this.life.show(null);
      this.under.show(null);
      return;
    }
    this.habitat = h;
    this.error.textContent = '';
    const findings = validate(h);
    this.showFindings(findings);
    this.showTable(h);
    this.section.replaceChildren(sectionSvg(h));
    this.stack.replaceChildren(stackSvg(h));
    this.plan.show(isValid(findings) ? h : null);
    this.life.show(isValid(findings) ? h : null);
    this.under.show(isValid(findings) ? h : null);
  }

  private showFindings(fs: Finding[]): void {
    this.findings.replaceChildren(...(fs.length ? fs.map((f) => el('li', `lab-${f.severity}`, `${f.severity === 'invalid' ? 'Cannot exist' : 'Unusual'}: ${f.message}`)) : [el('li', 'lab-ok', 'A habitat like the reference: nothing unusual.')]));
  }

  private showTable(h: Habitat): void {
    const p = h.params;
    const rows: [string, string][] = [
      ['Rotation period', `${h.period.toFixed(0)} s (${h.rpm.toFixed(2)} rpm)`],
      ['Floor speed relative to the stars', `${h.floorSpeed.toFixed(0)} m/s`],
      ['Floor area', `${(h.floorArea / 1e6).toFixed(h.floorArea < 1e7 ? 2 : 0)} km²`],
      ['Air pressure at the axis', `${((h.pressureAt(0) / p.air.floorPressure) * 100).toFixed(0)}% of the floor`],
      ['Gravity at the top of a 100 m tower', `${((1 - h.gravityAt(h.radius - 100) / h.gravityAt(h.radius)) * 100).toFixed(1)}% lower`],
      ['Dropped from 10 m, lands antispinward by', `${h.dropOffset(10).toFixed(2)} m`],
      ['Profile length, axis to hub', km(h.profile.length)],
      ['Hull thickness', Number.isFinite(h.hullThickness) ? `${h.hullThickness.toFixed(1)} m (largest radius ${km(h.maxRadius)})` : `none holds (largest radius ${km(h.maxRadius)})`],
      ['Rubble padding', `${h.paddingThickness.toFixed(1)} m, ${(h.paddingMass / 1e12).toFixed(2)} billion t`],
      ['Sunlight collected', si(h.sunlight, 'W')],
      ['Solar power', si(h.solarPower, 'W')],
      ['Light collectors', `${(h.collectorShare * 100).toFixed(0)}% of the skin, piping ${si(h.params.pipedLight * h.lightPower, 'W')} of sunlight to the sunline`],
      ['Light the floor needs', si(h.lightPower, 'W')],
      ['Heat released inside', si(h.heat, 'W')],
      ['Radiators needed', `${(h.radiatorArea / 1e6).toFixed(0)} km² of radiating faces, ${h.radiatorToEndcaps.toFixed(1)}× the endcaps`],
      ['Radiator brims', `${h.exterior.brimsPerEnd} per end, out to ${km(h.exterior.brims[0].tip)} (tips at ${h.exterior.brimTipSpeed.toFixed(0)} m/s)`],
      ['Population', `${h.population.toLocaleString('en')} (${h.density.toFixed(0)} per km²)`],
    ];
    this.table.replaceChildren(...rows.map(([k, v]) => {
      const tr = el('tr', '');
      tr.append(el('th', '', k), el('td', '', v));
      return tr;
    }));
  }
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** A to-scale longitudinal section: the axis across the middle, both halves of the interior, the endcap slopes, and the outside (radiator brims, dock spindle, mast). */
function sectionSvg(h: Habitat): SVGSVGElement {
  const e = h.exterior;
  const W = 760, pad = 12, outer = h.layers.outer, reach = Math.max(outer, ...e.brims.map((b) => b.tip));
  const z0 = e.mast.from, z1 = e.spindle.to;
  const scale = (W - 2 * pad) / (z1 - z0);
  const H = Math.max(80, 2 * reach * scale + 2 * pad);
  const cy = H / 2;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Section through the habitat along its axis' });
  const X = (z: number): number => pad + (z - z0) * scale;
  const shell = Math.max(2, (outer - h.radius) * scale);
  // The spindle and mast on the axis, drawn at least two pixels thick.
  const hub = Math.max(1, e.spindle.radius * scale);
  s.append(svg('rect', { x: X(e.spindle.from), y: cy - hub, width: (e.spindle.to - e.spindle.from) * scale, height: 2 * hub, class: 'sec-spindle' }));
  s.append(svg('line', { x1: X(e.mast.from), y1: cy, x2: X(e.mast.to), y2: cy, class: 'sec-mast' }));
  for (const side of [-1, 1]) {
    // The hull and everything under the floor, at least two pixels so it stays visible; the endcap faces as well.
    s.append(svg('rect', { x: X(e.wildFace), y: side < 0 ? cy - h.radius * scale - shell : cy + h.radius * scale, width: (e.portFace - e.wildFace) * scale, height: shell, class: 'sec-shell' }));
    for (const b of e.brims) {
      const bw = Math.max(1.5, b.thickness * scale);
      s.append(svg('rect', { x: X(b.z) - bw / 2, y: side < 0 ? cy - b.tip * scale : cy + b.inner * scale, width: bw, height: (b.tip - b.inner) * scale, class: 'sec-brim' }));
    }
    const pts: string[] = [];
    for (let i = 0; i <= 400; i++) {
      const p = h.profile.at((h.profile.length * i) / 400);
      pts.push(`${X(p.z).toFixed(1)},${(cy + side * p.r * scale).toFixed(1)}`);
    }
    pts.push(`${X(h.length).toFixed(1)},${(cy + side * h.radius * scale).toFixed(1)}`, `${X(0).toFixed(1)},${(cy + side * h.radius * scale).toFixed(1)}`);
    s.append(svg('polygon', { points: pts.join(' '), class: 'sec-ground' }));
  }
  s.append(svg('line', { x1: X(0), y1: cy, x2: X(h.length), y2: cy, class: 'sec-sunline' }));
  const label = svg('text', { x: X(h.length / 2), y: cy - 6, class: 'sec-label', 'text-anchor': 'middle' });
  label.textContent = `sunline · ${km(2 * h.radius)} across, ${km(h.length)} long`;
  const wild = svg('text', { x: X(0) + 4, y: H - 4, class: 'sec-label' });
  wild.textContent = 'wild end';
  const port = svg('text', { x: X(h.length) - 4, y: H - 4, class: 'sec-label', 'text-anchor': 'end' });
  port.textContent = 'port end, dock spindle';
  s.append(label, wild, port);
  return s;
}

/** The layers from the surface down to the solar skin, to scale in metres. */
function stackSvg(h: Habitat): SVGSVGElement {
  const l = h.layers;
  const bands: [string, number, number][] = [
    ['soil', l.surface, l.ceilingDeck],
    ['ceiling deck', l.ceilingDeck, l.living],
    ['living layer', l.living, l.floorDeck],
    ['floor deck', l.floorDeck, l.service],
    ['service layer', l.service, l.hull],
    ['hull', l.hull, l.padding],
    ['rubble padding', l.padding, l.solarSkin],
    ['solar skin', l.solarSkin, l.outer],
  ];
  const W = 760, total = l.outer - l.surface, rowH = 22;
  const s = svg('svg', { viewBox: `0 0 ${W} ${bands.length * rowH + 8}`, role: 'img', 'aria-label': 'The layers under the floor, to scale' });
  const x0 = 150, w = W - x0 - 90;
  bands.forEach(([name, a, b], i) => {
    const y = 4 + i * rowH;
    const t = svg('text', { x: 0, y: y + 15, class: 'stack-name' });
    t.textContent = name;
    s.append(t, svg('rect', { x: x0 + ((a - l.surface) / total) * w, y: y + 3, width: Math.max(1.5, ((b - a) / total) * w), height: rowH - 6, class: `stack-band stack-${i}` }));
    const v = svg('text', { x: W, y: y + 15, class: 'stack-value', 'text-anchor': 'end' });
    v.textContent = `${(b - a).toFixed(1)} m`;
    s.append(v);
  });
  return s;
}

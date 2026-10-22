/**
 * The Blueprint tab's "Land plan": the habitat plan (gen/plan.ts) as maps from above, with a key and the plan's
 * numbers. Redrawn a moment after the parameters stop changing, since a map takes a few hundred milliseconds.
 */
import { DISTRICT_STYLES, type Habitat } from '../blueprint';
import { entrancesOf, makePlan, siteOf, type Plan, type Site } from '../gen/plan';
import { el } from '../app/dom';
import { FACE_COLORS, STYLE_COLORS, endcapMap, floorMap, floorPixel, type PlanImage } from './planMap';

/** Width of the floor map and size of each endcap map (pixels drawn; the page scales them). */
const FLOOR_WIDTH = 520, ENDCAP_SIZE = 300;
/** How long the parameters must rest before the maps are redrawn (ms). */
const SETTLE = 250;

export const rgb = (c: readonly number[]): string => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

const LANDMARK_NAMES: Partial<Record<Site['kind'], string>> = {
  'lift-stair': 'Lift Stair',
  'summit-hut': 'summit hut',
  'lake-pavilion': 'lake pavilion',
  'founders-grove': "founders' grove",
};

export function canvasOf(img: PlanImage): HTMLCanvasElement {
  const c = el('canvas', 'plan-map');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')?.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
  return c;
}

/** Text with a dark halo, so it reads on any colour of the map. */
function label(c: HTMLCanvasElement, text: string, x: number, y: number, align: CanvasTextAlign = 'left'): void {
  const g = c.getContext('2d');
  if (!g) return;
  g.font = '600 12px system-ui, sans-serif';
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.lineWidth = 3;
  g.strokeStyle = 'rgba(0,0,0,0.75)';
  g.fillStyle = '#fff';
  // Near the right edge the words run leftward instead, so they stay on the map.
  if (align === 'left' && x > c.width * 0.75) { align = 'right'; x -= 16; g.textAlign = align; }
  const tx = Math.min(c.width - 4, Math.max(4, x)), ty = Math.min(c.height - 8, Math.max(8, y));
  g.strokeText(text, tx, ty);
  g.fillText(text, tx, ty);
}

/** A key entry: a swatch (a line for paths) and its name. */
export function chip(color: string, name: string, line = false): HTMLElement {
  const c = el('span', 'plan-chip');
  const sw = el('i', line ? 'plan-swatch plan-line' : 'plan-swatch');
  sw.style.background = color;
  c.append(sw, name);
  return c;
}

/** A map with its caption. */
export function figure(c: HTMLCanvasElement, caption: string): HTMLElement {
  const f = el('figure', 'plan-figure');
  f.append(c, el('figcaption', '', caption));
  return f;
}

/**
 * A Blueprint tab panel of maps under a summary line, redrawn a moment (`settle` ms) after the parameters stop changing,
 * since a map takes a few hundred milliseconds. Each panel draws its own maps (`draw`) and hands them to `present`.
 */
export abstract class MapsPanel {
  readonly root = el('div', 'plan');
  private readonly maps = el('div', 'plan-maps');
  private readonly summary = el('p', 'plan-summary');
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly settle: number) {
    this.root.append(this.summary, this.maps);
  }

  /** Redraws the maps for a habitat (null: none to draw), once the parameters have settled. */
  show(h: Habitat | null): void {
    if (this.timer) clearTimeout(this.timer);
    if (!h) { this.present(''); return; }
    this.timer = setTimeout(() => { this.timer = null; this.draw(h); }, this.settle);
  }

  protected abstract draw(h: Habitat): void;

  /** Shows the summary and the maps (none: why there are none). */
  protected present(summary: string, ...maps: HTMLElement[]): void {
    this.summary.textContent = summary;
    this.maps.replaceChildren(...maps);
  }
}

export class PlanView extends MapsPanel {
  constructor() {
    super(SETTLE);
    const key = el('div', 'plan-key');
    for (const s of DISTRICT_STYLES) key.append(chip(rgb(STYLE_COLORS[s]), s));
    key.append(chip('rgb(56,92,51)', 'reserve'), chip(rgb(FACE_COLORS.stair), 'Stair face'), chip(rgb(FACE_COLORS.vine), 'Vine face'), chip(rgb(FACE_COLORS.water), 'Water face'));
    key.append(chip('rgb(255,219,89)', 'Sunwalk', true), chip('rgb(247,242,224)', 'ways', true), chip('rgb(77,140,204)', 'rivers', true), chip('rgb(46,36,26)', 'entrances'), chip('rgb(191,31,26)', 'landmarks'));
    this.root.append(key);
  }

  protected draw(h: Habitat): void {
    let plan: Plan;
    try {
      plan = makePlan(h);
    } catch (e) {
      this.present(`No plan for this habitat: ${String(e)}`);
      return;
    }
    const entrances = entrancesOf(plan).length;
    const roles = plan.rivers.map((r) => r.role).join(', ');
    const summary = `${plan.valleys} valleys · ${plan.districts.length} districts · ${entrances} entrances down to the living layer · rivers: ${roles || 'none'} · the wild ${Math.round(h.params.plan.reserve * 100)}% of the floor is reserve`;

    const floor = canvasOf(floorMap(plan, FLOOR_WIDTH));
    const lm = (kind: Site['kind']): Site | undefined => siteOf(plan, kind);
    for (const kind of ['lake-pavilion', 'founders-grove'] as const) {
      const s = lm(kind);
      if (s) { const [x, y] = floorPixel(plan, FLOOR_WIDTH, s.theta, s.s); label(floor, LANDMARK_NAMES[kind] ?? kind, x + 8, y - 10); }
    }
    const walk = plan.paths.find((p) => p.kind === 'sunwalk');
    if (walk) { const [x, y] = floorPixel(plan, FLOOR_WIDTH, walk.points[0], walk.points[1]); label(floor, 'Sunwalk', x + 4, y - 12); }
    const [rx] = floorPixel(plan, FLOOR_WIDTH, 0, (h.profile.floorStart + plan.reserveEnd) / 2);
    label(floor, 'reserve', rx, 12, 'center');

    const wild = canvasOf(endcapMap(plan, 'wild', ENDCAP_SIZE)), port = canvasOf(endcapMap(plan, 'port', ENDCAP_SIZE));
    const half = ENDCAP_SIZE / 2;
    for (const face of plan.faces) {
      const r = 0.6 * half;
      label(port, `${face.kind[0].toUpperCase()}${face.kind.slice(1)} face`, half - Math.cos(face.theta) * r, half - Math.sin(face.theta) * r, 'center');
    }
    label(wild, 'snow', half, half, 'center');
    const ring = (s: number): number => h.profile.at(s).r / h.radius * half;
    const top = h.profile.floorStart * 0.35;
    label(wild, 'cirque', half + Math.cos(plan.mountain.cirque) * ring(top * 1.6), half - Math.sin(plan.mountain.cirque) * ring(top * 1.6), 'center');
    const stair = lm('lift-stair');
    if (stair) label(port, 'Lift Stair', half - Math.cos(stair.theta) * half * 0.85, half - Math.sin(stair.theta) * half * 0.85, 'center');
    const hut = lm('summit-hut');
    if (hut) label(wild, 'summit hut', half + Math.cos(hut.theta) * ring(hut.s) + 8, half - Math.sin(hut.theta) * ring(hut.s));

    const ends = el('div', 'plan-ends');
    ends.append(figure(wild, 'The Mountain (wild end), seen from the floor: rings are gravity bands'), figure(port, 'The Gate (port end), seen from the floor'));
    this.present(summary, figure(floor, 'The floor unrolled: wild end left, port end right, once round the axis top to bottom'), ends);
  }
}

/**
 * The Blueprint tab's "Who is out on the land": everyone up on the land at an hour of the day (src/sim), one dot each
 * over the land plan's maps, coloured by what they are doing, with a slider through the day. The crowd follows the
 * bright stretch down the tube from the Mountain to the Gate, and fills the Stair face at dusk.
 */
import type { Habitat } from '../blueprint';
import { planOf, type Plan } from '../gen/plan';
import { peopleAt, type Activity, type Person } from '../sim';
import { el } from '../app/dom';
import { dot, endcapMap, endcapPixel, floorMap, floorPixel, type PlanImage } from './planMap';
import { canvasOf, chip, figure, rgb } from './planView';

const FLOOR_WIDTH = 520, ENDCAP_SIZE = 300;
/** How long the slider or the parameters must rest before the maps are redrawn (ms). */
const SETTLE = 120;
/** The day shown (any will do; a whole day in, so yesterday's outings are past). */
const DAY = 3;

type Rgb = readonly [number, number, number];

/** What the dots say, grouped: the activity's colour and the group's name in the key. */
const GROUPS: { name: string; color: Rgb; activities: Activity[] }[] = [
  { name: 'walking to or from their place', color: [1, 1, 1], activities: ['walk'] },
  { name: 'Sunwalk', color: [1, 0.86, 0.2], activities: ['sunwalk', 'stroll'] },
  { name: 'meeting at the courts', color: [1, 0.55, 0.15], activities: ['meet'] },
  { name: 'on the commons', color: [0.25, 0.95, 0.55], activities: ['picnic', 'sit', 'gather', 'herd', 'play', 'make', 'wander'] },
  { name: 'water', color: [0.3, 0.75, 1], activities: ['swim', 'bathe'] },
  { name: 'Stair: climbing, watching the dusk', color: [1, 0.2, 0.25], activities: ['climb', 'watch'] },
  { name: 'hiking, flying', color: [0.8, 0.45, 1], activities: ['hike', 'fly'] },
  { name: 'stargazing', color: [0.6, 0.7, 1], activities: ['stargaze'] },
];
const COLOR = new Map<Activity, Rgb>(GROUPS.flatMap((g) => g.activities.map((a) => [a, g.color] as const)));

export class LifeView {
  readonly root = el('div', 'plan');
  private readonly summary = el('p', 'plan-summary');
  private readonly maps = el('div', 'plan-maps');
  private readonly slider = el('input', 'life-hour');
  private readonly hourText = el('span', 'life-hour-text');
  private timer: ReturnType<typeof setTimeout> | null = null;
  private habitat: Habitat | null = null;
  /** The plan's maps without people, made once per habitat. */
  private base: { h: Habitat; plan: Plan; floor: PlanImage; port: PlanImage; wild: PlanImage } | null = null;

  constructor() {
    this.slider.type = 'range';
    this.slider.min = '0';
    this.slider.max = '24';
    this.slider.step = '0.25';
    this.slider.value = '7';
    this.slider.addEventListener('input', () => this.later());
    const row = el('label', 'life-row');
    row.append('Hours after dawn ', this.slider, this.hourText);
    const key = el('div', 'plan-key');
    for (const g of GROUPS) key.append(chip(rgb(g.color), g.name));
    this.root.append(row, this.summary, this.maps, key);
  }

  /** Shows a habitat's people (null: none), once the parameters have settled. */
  show(h: Habitat | null): void {
    this.habitat = h;
    if (!h) { if (this.timer) clearTimeout(this.timer); this.maps.replaceChildren(); this.summary.textContent = ''; return; }
    this.later();
  }

  private later(): void {
    const hours = Number(this.slider.value);
    this.hourText.textContent = ` ${hours.toFixed(2).replace(/\.?0+$/, '')} h`;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; if (this.habitat) this.draw(this.habitat, hours); }, SETTLE);
  }

  private draw(h: Habitat, hours: number): void {
    let people: Person[];
    try {
      if (this.base?.h !== h) {
        const plan = planOf(h);
        this.base = { h, plan, floor: dim(floorMap(plan, FLOOR_WIDTH)), port: dim(endcapMap(plan, 'port', ENDCAP_SIZE)), wild: dim(endcapMap(plan, 'wild', ENDCAP_SIZE)) };
      }
      people = peopleAt(h, DAY * h.params.day.length + hours * 3600);
    } catch (e) {
      this.maps.replaceChildren();
      this.summary.textContent = `No people for this habitat: ${String(e)}`;
      return;
    }
    const { plan } = this.base, floor = cloneImage(this.base.floor), port = cloneImage(this.base.port), wild = cloneImage(this.base.wild);
    const { floorStart, floorEnd } = h.profile;
    for (const p of people) {
      const c = COLOR.get(p.activity) ?? [1, 1, 1];
      if (p.s < floorStart) { const q = endcapPixel(plan, 'wild', ENDCAP_SIZE, p.theta, p.s); if (q) dot(wild, q[0], q[1], 0.8, c); }
      else if (p.s > floorEnd) { const q = endcapPixel(plan, 'port', ENDCAP_SIZE, p.theta, p.s); if (q) dot(port, q[0], q[1], 0.8, c); }
      else { const q = floorPixel(plan, FLOOR_WIDTH, p.theta, p.s); dot(floor, q[0], q[1], 0.7, c); }
    }
    const count = (a: Activity[]): number => people.filter((p) => a.includes(p.activity)).length;
    const n = people.length, share = h.params.population ? (100 * n) / h.params.population : 0;
    const dark = hours / 24 >= h.params.day.daylight;
    this.summary.textContent = `${n.toLocaleString('en')} of ${h.params.population.toLocaleString('en')} residents up on the land (${share.toFixed(1)} %)${dark ? ', night' : ''} · ${count(['sunwalk']).toLocaleString('en')} on the Sunwalk · ${count(['watch']).toLocaleString('en')} watching the dusk from the Stair face · ${count(['walk']).toLocaleString('en')} walking`;
    const ends = el('div', 'plan-ends');
    ends.append(figure(canvasOf(wild), 'The Mountain (wild end)'), figure(canvasOf(port), 'The Gate (port end)'));
    this.maps.replaceChildren(figure(canvasOf(floor), 'Everyone on the floor, one dot each: wild end left, port end right'), ends);
  }
}

/** The plan map, darker, so the people read over it. */
function dim(img: PlanImage): PlanImage {
  const out = cloneImage(img);
  for (let i = 0; i < out.data.length; i += 4) for (let k = 0; k < 3; k++) out.data[i + k] *= 0.45;
  return out;
}

function cloneImage(img: PlanImage): PlanImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

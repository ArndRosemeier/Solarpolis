/**
 * The Blueprint tab's "Under the floor" maps: the Understorey's plan (gen/under.ts) for the whole floor and for one
 * hamlet close up, with the plan's numbers and a key (a `MapsPanel`).
 */
import { BAY_USES, makeUnder, sharesOf, type BayUse, type Under } from '../gen/under';
import { el } from '../app/dom';
import type { Habitat } from '../blueprint';
import { MapsPanel, canvasOf, chip, figure, rgb } from './planView';
import { USE_COLORS, hamletMap, underFloorMap } from './underMap';

const FLOOR_WIDTH = 520, HAMLET_SIZE = 360;
/** How long the parameters must rest before the maps are redrawn (ms). */
const SETTLE = 300;

const NAMES: Readonly<Record<BayUse, string>> = {
  well: 'wellhead (under a court)',
  hall: 'halls',
  home: 'homes',
  lane: 'lanes',
  gallery: 'galleries (under the ways)',
  cistern: 'cisterns',
  lake: 'under the lake',
  works: "the mind's works (under the reserve)",
  dim: 'the Dim',
};

export class UnderView extends MapsPanel {
  constructor() {
    super(SETTLE);
    const key = el('div', 'plan-key');
    for (const u of BAY_USES) key.append(chip(rgb(USE_COLORS[u]), NAMES[u]));
    this.root.append(key);
  }

  protected draw(h: Habitat): void {
    let under: Under;
    try {
      under = makeUnder(h);
    } catch (e) {
      this.present(`No plan below for this habitat: ${String(e)}`);
      return;
    }
    const p = h.pillars, share = sharesOf(under, Math.max(1, Math.round(Math.sqrt((under.around * under.along) / 2e5))));
    const percent = (u: BayUse): string => `${Math.round(share[u] * 100)}%`;
    const first = under.hamlets[0];
    const lake = h.params.relief.ringLake ? 'under the lake a gallery under its glass bed' : 'no lake';
    const ribs = h.params.under.spring * h.params.layers.living;
    const summary = `${(under.around * under.along).toLocaleString('en')} bays of ${under.bay} m · pillars ${(2 * p.radius).toFixed(1)} m thick (${p.governs} decides), ribs spring ${ribs.toFixed(0)} m up · `
      + `${under.hamlets.length} hamlets of about ${Math.round(first?.people ?? 0)} people · homes and lanes ${percent('home')} + ${percent('lane')}, halls ${percent('hall')}, galleries ${percent('gallery')}, cisterns ${percent('cistern')}, the Dim ${percent('dim')}, works ${percent('works')} · ${lake}`;
    const figs = [figure(canvasOf(underFloorMap(under, FLOOR_WIDTH)), 'Under the floor, unrolled like the land plan: wild end left, port end right')];
    // The hamlet nearest the middle of the worked floor, close up.
    const mid = (Math.max(h.profile.floorStart, under.s0) + h.profile.floorEnd) / 2;
    const near = under.hamlets.reduce<typeof first | undefined>((a, m) => (!a || Math.abs(m.site.s - mid) < Math.abs(a.site.s - mid) ? m : a), undefined);
    if (near) figs.push(figure(canvasOf(hamletMap(under, near, HAMLET_SIZE)), `One hamlet close up (court ${near.court}): ${Math.round(near.households)} households round the wellhead; a dot per pillar, the ring is the court above`));
    this.present(summary, ...figs);
  }
}

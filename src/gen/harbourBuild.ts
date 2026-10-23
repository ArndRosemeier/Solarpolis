/**
 * The harbours built (laid out in gen/harbours.ts): what one is made of and what people stand on there.
 *
 * In its frame (`Harbour.frame`: x out from the shore, y along it to the left, z up from the water's surface), each
 * part in handrails (`HARBOUR`):
 *
 * - the landing: a stone ramp (the district's stone, `STYLE_STONE`) from the shore's ground down to the pier's deck;
 * - the pier: a timber deck on slender dark bronze piles in pairs, cross-heads under it, out to the pontoon, its last
 *   handrail a hinged plate down to the pontoon (the pier stands, the pontoon floats a little lower);
 * - the pontoon: a float in pale composite panels with a dark rubbing strake round its top edge, decked in timber, held
 *   by tall guide piles along its landward side; fingers stand out from its far side between the berths, each with a
 *   mooring pile at its tip; a cleat each side of each berth, lamp bollards at the pier's root and the pontoon's ends,
 *   a swimming ladder at its end.
 *
 * At a detail (`SiteDetail`): far, the decks and the float as slabs of the same size and colour; mid, the piles, the
 * strake and the fingers' tips too; near, the cleats, lamps, ladder and pile caps. `solid` is the decks, for the
 * physics. Things at sites (`harbourSites`, gen/siteTiles.ts); plants keep off it (`harbourKeepsClear`). Pure.
 */
import type { Vec3 } from '@futuremagic/core';
import type { Terrain } from './terrain';
import { kept } from './kept';
import { planOf } from './plan';
import { STYLE_STONE } from './courts';
import { FINISH } from './pavilion';
import { HARBOUR, fleetOf, harbourRail, type Harbour } from './harbours';
import { Shape, floorAt, inFloorFrame, shade, type RGB } from './shapes';
import { siteParts, type Site, type SiteDetail } from './siteTiles';

/** Linear albedos: the deck's silvered timber, the float's pale composite, the strake's black, the piles' dark bronze. */
const DECK: RGB = [0.4, 0.36, 0.31];
const FLOAT: RGB = [0.6, 0.6, 0.58];
const STRAKE: RGB = [0.035, 0.035, 0.04];
const PILE: RGB = [0.16, 0.13, 0.1];
const CAP: RGB = [0.66, 0.65, 0.62];
const PLAIN_STONE: RGB = [0.52, 0.5, 0.46];

/** How deep a deck is (its planks and joists), how far its piles go into the bed; in handrails. */
const DECK_DEEP = 0.14;
const BURY = 0.6;
/** The float's draught under the water, its strake's height and how far it stands out; in handrails. */
const DRAUGHT = 0.3;
const STRAKE_HIGH = 0.16;
const STRAKE_OUT = 0.06;

/** Where a harbour's landing starts on the land (x, m): `HARBOUR.landing` handrails in from the shore. */
export const landingOf = (hb: Harbour): number => -HARBOUR.landing * hb.handrail;

/** The pier's deck over the water at x (m): down the landing from the ground to the deck, level out, down the hinge to the pontoon. */
function pierTop(hb: Harbour, land: number, x: number): number {
  const hr = hb.handrail, deck = HARBOUR.deck * hr, float = HARBOUR.float * hr, x0 = landingOf(hb), hinge = Math.min(hr, hb.pontoon / 2);
  if (x <= 0) return land + ((deck - land) * (x - x0)) / -x0;
  if (x >= hb.pontoon - hinge) return deck + ((float - deck) * (x - hb.pontoon + hinge)) / hinge;
  return deck;
}

/** The ground over the harbour's water where its landing starts (m), never under the pier's deck. */
const landOf = kept((t: Terrain) => {
  const cache = new Map<number, number>();
  return (hb: Harbour): number => {
    let g = cache.get(hb.id);
    if (g === undefined) {
      const p = floorAt(t.habitat, hb.frame, landingOf(hb), 0);
      g = Math.max(HARBOUR.deck * hb.handrail, t.heightAt(p.theta, p.s) - hb.frame.height);
      cache.set(hb.id, g);
    }
    return g;
  };
});

/**
 * How high the walkable top of a harbour is over its water at a point of its frame (x, y), or null off it: the landing
 * and the pier, the pontoon, the fingers.
 */
export function harbourTop(t: Terrain, hb: Harbour, x: number, y: number): number | null {
  const hr = hb.handrail, wide = HARBOUR.pontoon * hr, float = HARBOUR.float * hr;
  if (x < landingOf(hb) || x > hb.reach) return null;
  if (x <= hb.pontoon) return Math.abs(y) <= (HARBOUR.pier * hr) / 2 ? pierTop(hb, landOf(t)(hb), x) : null;
  if (x <= hb.pontoon + wide) return y >= hb.y0 && y <= hb.y1 ? float : null;
  for (const f of hb.fingers) if (Math.abs(y - f.y) <= (HARBOUR.finger * hr) / 2 && x <= hb.pontoon + wide + f.length) return float;
  return null;
}

/**
 * A slab from x0 to x1 and y0 to y1, its top from `top0` at x0 to `top1` at x1, its bottom at `bottom`; its sides in
 * `side` (its top's colour if not given); `open` leaves the bottom out.
 */
function slab(sh: Shape, x0: number, x1: number, y0: number, y1: number, top0: number, top1: number, bottom: number, col: RGB, open = true, side = col): void {
  const a: Vec3 = [x0, y0, top0], b: Vec3 = [x1, y0, top1], c: Vec3 = [x1, y1, top1], d: Vec3 = [x0, y1, top0];
  const lo = (p: Vec3): Vec3 => [p[0], p[1], bottom];
  sh.faceToward(a, b, c, d, [0, 0, 1], col);
  sh.faceToward(a, b, lo(b), lo(a), [0, -1, 0], side);
  sh.faceToward(d, c, lo(c), lo(d), [0, 1, 0], side);
  sh.faceToward(a, d, lo(d), lo(a), [-1, 0, 0], side);
  sh.faceToward(b, c, lo(c), lo(b), [1, 0, 0], side);
  if (!open) sh.faceToward(lo(a), lo(b), lo(c), lo(d), [0, 0, -1], col);
}

/** A round pile standing from `bed` up to `top` at (x, y). */
function pile(sh: Shape, x: number, y: number, bed: number, top: number, r: number, sides: number, col: RGB): void {
  sh.prism([x, y, bed], [1, 0, 0], [0, 1, 0], [0, 0, 1], r, top - bed, sides, col);
}

/** A harbour at a detail, in its frame. */
export function buildHarbour(t: Terrain, hb: Harbour, detail: SiteDetail): Shape {
  const h = t.habitat, hr = hb.handrail, sh = new Shape(8, true, true), far = detail === 'far', near = detail === 'near', solid = detail === 'solid';
  const deck = HARBOUR.deck * hr, float = HARBOUR.float * hr, thick = DECK_DEEP * hr, wide = HARBOUR.pontoon * hr, half = (HARBOUR.pier * hr) / 2;
  const x0 = landingOf(hb), land = landOf(t)(hb), hinge = Math.min(hr, hb.pontoon / 2), p0 = hb.pontoon, p1 = p0 + wide;
  const ground = (x: number, y: number): number => { const p = floorAt(h, hb.frame, x, y); return t.heightAt(p.theta, p.s) - hb.frame.height; };
  const bedAt = (x: number, y: number): number => Math.min(ground(x, y), -0.2 * hr) - BURY * hr;
  const at = floorAt(h, hb.frame, x0, 0), style = planOf(h).districtAt(at.theta, at.s)?.style;
  const stone = (style && STYLE_STONE[style]) ?? { stone: PLAIN_STONE, finish: FINISH.stone };

  // The landing: stone, from the ground down to the pier's deck at the shore, its footing in the bank.
  sh.finish = stone.finish;
  const foot = Math.min(ground(x0, 0), ground(0, 0), 0) - BURY * hr;
  slab(sh, x0, 0, -half - 0.15 * hr, half + 0.15 * hr, land, deck, solid ? deck - thick : foot, stone.stone);
  // The pier's deck, level out to the hinge, then the hinged plate down to the pontoon.
  sh.finish = FINISH.timber;
  slab(sh, 0, p0 - hinge, -half, half, deck, deck, deck - thick, DECK);
  slab(sh, p0 - hinge, p0, -half * 0.92, half * 0.92, deck, float, Math.min(deck, float) - thick * 0.6, shade(DECK, 0.95));
  // The pontoon and its fingers: the timber deck on the float (far off, one slab each: the deck's top, the float's sides).
  const fw = (HARBOUR.finger * hr) / 2, draught = -DRAUGHT * hr;
  slab(sh, p0, p1, hb.y0, hb.y1, float, float, far ? draught : float - thick, DECK, true, far ? FLOAT : DECK);
  for (const f of hb.fingers) slab(sh, p1, p1 + f.length, f.y - fw, f.y + fw, float, float, far ? draught : float - thick, DECK, true, far ? FLOAT : DECK);
  if (solid || far) return sh;
  // The float under the deck: pale composite panels down into the water.
  sh.finish = FINISH.panel;
  const under = float - thick;
  slab(sh, p0 + 0.02 * hr, p1 - 0.02 * hr, hb.y0 + 0.02 * hr, hb.y1 - 0.02 * hr, under, under, draught, FLOAT);
  for (const f of hb.fingers) slab(sh, p1, p1 + f.length - 0.02 * hr, f.y - fw + 0.03 * hr, f.y + fw - 0.03 * hr, under, under, draught * 0.8, FLOAT);
  // The rubbing strake round the pontoon's top edge and down each finger.
  sh.finish = FINISH.plain;
  const sTop = float - 0.02 * hr, sBot = float - STRAKE_HIGH * hr, out = STRAKE_OUT * hr;
  slab(sh, p0 - out, p0, hb.y0 - out, hb.y1 + out, sTop, sTop, sBot, STRAKE);
  slab(sh, p1, p1 + out, hb.y0 - out, hb.y1 + out, sTop, sTop, sBot, STRAKE);
  for (const [ya, yb] of [[hb.y0 - out, hb.y0], [hb.y1, hb.y1 + out]]) slab(sh, p0, p1, ya, yb, sTop, sTop, sBot, STRAKE);
  for (const f of hb.fingers) {
    for (const s of [-1, 1]) slab(sh, p1 + out, p1 + f.length, f.y + s * fw, f.y + s * (fw + out * 0.7), sTop, sTop, sBot, STRAKE);
    slab(sh, p1 + f.length, p1 + f.length + out, f.y - fw - out * 0.7, f.y + fw + out * 0.7, sTop, sTop, sBot, STRAKE);
  }
  // The pier's piles in pairs from the bed up under its deck, each pair under a cross-head; spaced from the pontoon in.
  sh.finish = FINISH.bronze;
  const r = HARBOUR.pile * hr, sides = near ? 12 : 6, py = half - 0.2 * hr, step = HARBOUR.piles * hr;
  for (let x = p0 - hinge; x > 0.6 * hr; x -= step) {
    for (const s of [-1, 1]) pile(sh, x, s * py, bedAt(x, s * py), deck - thick, r, sides, PILE);
    if (near) slab(sh, x - r, x + r, -half + 0.05 * hr, half - 0.05 * hr, deck - thick, deck - thick, deck - thick - 0.22 * hr, shade(PILE, 1.1), false);
  }
  // The guide piles along the pontoon's landward side, standing tall; one at each end.
  const high = HARBOUR.guideHigh * hr, gx = p0 + 0.25 * hr, n = Math.max(1, Math.round((hb.y1 - hb.y0) / (HARBOUR.guide * hr)));
  const guides = Array.from({ length: n + 1 }, (_, k) => hb.y0 + 0.3 * hr + ((hb.y1 - hb.y0 - 0.6 * hr) * k) / n).filter((y) => Math.abs(y) > half + r * 2);
  for (const y of guides) {
    pile(sh, gx, y, bedAt(gx, y), high, r * 1.6, sides, PILE);
    if (near) pile(sh, gx, y, high, high + 0.08 * hr, r * 1.75, sides, CAP);
  }
  // A mooring pile at each finger's tip.
  for (const f of hb.fingers) {
    const fx = p1 + f.length + r * 1.3;
    pile(sh, fx, f.y, bedAt(fx, f.y), float + 0.75 * hr, r * 1.3, sides, PILE);
    if (near) pile(sh, fx, f.y, float + 0.75 * hr, float + 0.8 * hr, r * 1.4, sides, CAP);
  }
  if (!near) return sh;
  // A cleat each side of each berth on the pontoon's outer edge: a low bronze horn on a foot.
  for (const b of hb.berths) {
    for (const s of [-1, 1]) {
      const y = b.y + s * (b.width / 2 - (HARBOUR.finger * hr) / 2 - 0.35 * hr), x = p1 - 0.2 * hr;
      slab(sh, x - 0.04 * hr, x + 0.04 * hr, y - 0.05 * hr, y + 0.05 * hr, float + 0.07 * hr, float + 0.07 * hr, float, PILE);
      slab(sh, x - 0.045 * hr, x + 0.045 * hr, y - 0.16 * hr, y + 0.16 * hr, float + 0.11 * hr, float + 0.11 * hr, float + 0.07 * hr, PILE);
    }
  }
  // Lamp bollards: at the pier's root both sides, at the pontoon's two ends; a slender post, a pale head.
  const bollard = (x: number, y: number, base: number): void => {
    pile(sh, x, y, base - 0.1 * hr, base + 0.85 * hr, 0.06 * hr, 8, PILE);
    sh.finish = FINISH.plain;
    slab(sh, x - 0.09 * hr, x + 0.09 * hr, y - 0.09 * hr, y + 0.09 * hr, base + 0.97 * hr, base + 0.97 * hr, base + 0.85 * hr, CAP, false);
    sh.finish = FINISH.bronze;
  };
  for (const s of [-1, 1]) bollard(-0.3 * hr, s * (half + 0.35 * hr), pierTop(hb, land, -0.3 * hr));
  for (const y of [hb.y0 + 0.4 * hr, hb.y1 - 0.4 * hr]) bollard(p0 + 0.45 * hr, y, float);
  // A swimming ladder down the pontoon's far end into the water.
  const ly = hb.y1 + out, lx = (p0 + p1) / 2;
  for (const s of [-1, 1]) slab(sh, lx + s * 0.25 * hr - 0.025 * hr, lx + s * 0.25 * hr + 0.025 * hr, ly, ly + 0.05 * hr, float + 0.5 * hr, float + 0.5 * hr, -0.9 * hr, PILE, false);
  for (let k = 0; k < 4; k++) {
    const z = float - 0.2 * hr - k * 0.28 * hr;
    slab(sh, lx - 0.25 * hr, lx + 0.25 * hr, ly + 0.005 * hr, ly + 0.045 * hr, z, z, z - 0.03 * hr, PILE, false);
  }
  return sh;
}

/** Every harbour as a site on the floor: the middle of what it covers, and how far it reaches from there. */
const sitesOf = kept((t: Terrain): Site[] => fleetOf(t.habitat).harbours.map((hb) => {
  const x0 = landingOf(hb), m = floorAt(t.habitat, hb.frame, (x0 + hb.reach) / 2, (hb.y0 + hb.y1) / 2);
  return { theta: m.theta, s: m.s, reach: Math.hypot(hb.reach - x0, hb.y1 - hb.y0) / 2 };
}));

/** The index of the harbour over (θ, s) (within `margin` of what it covers), or null. */
function harbourNear(t: Terrain, theta: number, s: number, margin: number): number | null {
  const h = t.habitat, all = fleetOf(h).harbours, sites = sitesOf(t);
  for (let i = 0; i < all.length; i++) {
    const hb = all[i];
    if (Math.abs(s - sites[i].s) > sites[i].reach + margin) continue;
    const [x, y] = inFloorFrame(h, hb.frame, theta, s);
    if (x >= landingOf(hb) - margin && x <= hb.reach + margin && y >= hb.y0 - margin && y <= hb.y1 + margin) return i;
  }
  return null;
}

/** The harbours as things at sites (gen/siteTiles.ts): their grid, tiles, solids and the top one stands on. */
export const harbourSites = siteParts({
  sites: sitesOf,
  frame: (t, i) => fleetOf(t.habitat).harbours[i].frame,
  build: (t, i, detail) => buildHarbour(t, fleetOf(t.habitat).harbours[i], detail),
  at: (t, theta, s) => harbourNear(t, theta, s, 0),
  top: (t, i, x, y) => harbourTop(t, fleetOf(t.habitat).harbours[i], x, y),
});

/** Whether plants keep off a point: on a harbour, its berths and its landing, or within a handrail of them. */
export function harbourKeepsClear(t: Terrain, theta: number, s: number): boolean {
  const hr = harbourRail(t.habitat);
  return hr !== null && harbourNear(t, theta, s, hr) !== null;
}

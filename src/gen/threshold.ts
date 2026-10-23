/**
 * The Threshold (plan "The Threshold", step 3 "the Threshold's frame"): the habitat's front porch, where every newcomer
 * steps out of the port passage onto the Lift Stair's top terrace. A 200-year-old habitat makes its front door a place
 * people come to, so the terrace does not stay a slab on a cliff: it grows into galleries stepping down the Gate face
 * beside it, like a cliff monastery, each a little heavier than the one above.
 *
 * Near the hub the Gate face is nearly sheer (74° in the reference), so a deep terrace would stand on walls taller than
 * it is deep. Level ground runs round the axis, so the galleries are long and shallow: each runs along the ramp at one
 * height (a constant e is a constant radius, so a gallery is an arc round the axis), out from the side of the top terrace
 * away from where the stair arrives:
 *
 * - the upper gallery is the top terrace's own depth and height, so the terrace opens sideways into it;
 * - each lower gallery stands in front of the one above (toward the floor), a flight of broad steps lower, against its
 *   wall; the flight climbs that wall in a notch in the lower gallery's floor, at the far end of the gallery above for
 *   the first, the near end for the next, so one walks the galleries' length going down;
 * - the capsule berth (thread "Transport capsules") is on the lowest, at its end away from the flight that comes down.
 *
 * A gallery is laid as bays along its length, each short enough that its flat floor stays on the arc
 * (`SAG`), so a gallery is drawn, stood on and walked as the stair's platforms are (gen/liftStair.ts: the bays are
 * platforms of kind 'gallery', the flights its legs). Every size comes from the ramp's width, the stair's legs' width
 * and the handrail; where the ramp has no room beside the top terrace (a narrow habitat's stair tops out at the ramp's
 * edge) there is no Threshold. Pure.
 */
import { centreOf, type PlanPoint, type Ramp, type StairLeg, type StairPlatform } from './liftStair';

/** How many galleries step down the face, and the steps of each flight between two. */
export const TIERS = 3;
export const FLIGHT_STEPS = 4;
/** A flight's treads (handrails): broad, for low gravity, where a step is a ledge one bounds down. */
const BROAD = 1.5;
/** How far a gallery reaches along the ramp at most (a share of the ramp's half width), and at least (legs' widths). */
const LENGTH = 0.75;
const LENGTH_MIN = 3;
/** How far the galleries keep from the ramp's edges (legs' widths), as the stair's turns do. */
const EDGE = 0.25;
/** The most a bay's flat floor may lie under the arc of its height (handrails). */
const SAG = 0.01;
/** A lower gallery's depth beyond its flight's run (legs' widths): the walk past the flight's foot. */
const WALK = 1;

/** One gallery: its height, its extent in plan (its bays fill it, less its notch), and its bays. */
export interface Gallery {
  tier: number;
  e: number;
  z0: number;
  z1: number;
  w0: number;
  w1: number;
  bays: StairPlatform[];
}

export interface Threshold {
  /** The side of the top terrace the galleries run out to (+1 spinward, −1 the other way). */
  side: number;
  /** From the top down. */
  galleries: Gallery[];
  /** Flight i climbs from gallery i + 1 to gallery i. */
  flights: StairLeg[];
  /** The capsule berth on the lowest gallery: its middle in plan, its height, the way its door faces in plan. */
  berth: { at: PlanPoint; e: number; toward: PlanPoint } | null;
}

/** What the galleries are laid from: the stair's ramp and its sizes, its top terrace, and what of it stands where. */
export interface ThresholdSite {
  ramp: Ramp;
  handrail: number;
  /** The stair's legs' width, its parapets' thickness, and how far a floor stands over the ground at least. */
  width: number;
  parapet: number;
  clearance: number;
  top: StairPlatform;
  /** The plan w the stair's last leg comes onto the top terrace from. */
  arrives: number;
  /** The riser at height e, and a rest landing's depth. */
  riserAt: (e: number) => number;
  rest: number;
  /** The radius kept clear round the capsule berth (m). */
  berthClear: number;
  /** Whether nothing of the stair stands in a box in plan (z0, z1, w0, w1). */
  free: (z0: number, z1: number, w0: number, w1: number) => boolean;
}

/** The Threshold beside a stair's top terrace, or null where the ramp has no room for it. */
export function layThreshold(t: ThresholdSite): Threshold | null {
  const { ramp, handrail: hr, width: W, parapet: p, top } = t;
  const limit = ramp.halfWidth - W * EDGE, most = ramp.halfWidth * LENGTH, least = W * LENGTH_MIN;
  // How far a strip of the ramp from `from` toward `dir` is free, between z0 and z1, up to `most`.
  const freeRun = (z0: number, z1: number, from: number, dir: number, cap = most): number => {
    let got = 0;
    while (got + hr <= cap + 1e-9) {
      const a = from + dir * got, b = from + dir * (got + hr);
      if (Math.abs(b) > limit || !t.free(z0, z1, Math.min(a, b), Math.max(a, b))) break;
      got += hr;
    }
    // The last piece short of a whole step, so a gallery ends where it is meant to.
    const a = from + dir * got, b = from + dir * cap;
    if (cap - got < hr && cap > got && Math.abs(b) <= limit && t.free(z0, z1, Math.min(a, b), Math.max(a, b))) got = cap;
    return got;
  };
  // The upper gallery: out from the side of the top terrace away from where the stair arrives, or the roomier side.
  const away = t.arrives > centreOf(top)[1] ? -1 : 1;
  const sides = [away, -away].map((s) => ({ s, len: freeRun(top.z0, top.z1, s < 0 ? top.w0 : top.w1, s) }));
  const best = sides[0].len >= least ? sides[0] : sides[1];
  if (best.len < least) return null;
  const side = best.s, inner = side < 0 ? top.w1 : top.w0, base = side < 0 ? top.w0 : top.w1;
  const outer = base + side * best.len;
  const galleries: Gallery[] = [gallery(t, 0, top.e, top.z0, top.z1, Math.min(base, outer), Math.max(base, outer), null)];
  const flights: StairLeg[] = [];
  // The lower galleries: in front of the one above, a flight lower, within the span of the top terrace and the upper
  // gallery, where nothing of the stair stands.
  const span: [number, number] = [Math.min(inner, outer), Math.max(inner, outer)];
  for (let k = 1; k < TIERS; k++) {
    const above = galleries[k - 1], riser = t.riserAt(above.e), rise = FLIGHT_STEPS * riser;
    const tread = BROAD * hr, run = FLIGHT_STEPS * tread, depth = run + W * WALK;
    const Z = above.z0, e = above.e - rise;
    if (e < ramp.groundAt(Z) + t.clearance) break;
    // The flight at the far end of the gallery above for the first, then back at the near end: within the gallery
    // above, its parapets inside that gallery's ends.
    const far = k % 2 === 1, end = far ? outer : inner, dir = far ? -side : side;
    const lo = Math.max(span[0], above.w0) + W / 2 + p, hi = Math.min(span[1], above.w1) - W / 2 - p;
    if (lo > hi) break;
    const wf = Math.min(hi, Math.max(lo, end + dir * (W / 2 + p + W * 0.5)));
    // Free from the flight's notch both ways, within the span.
    if (!t.free(Z - depth, Z, wf - W / 2, wf + W / 2)) break;
    const down = freeRun(Z - depth, Z, wf - W / 2, -1, wf - W / 2 - span[0]), up = freeRun(Z - depth, Z, wf + W / 2, 1, span[1] - wf - W / 2);
    const w0 = wf - W / 2 - down, w1 = wf + W / 2 + up;
    if (w1 - w0 < least) break;
    galleries.push(gallery(t, k, e, Z - depth, Z, w0, w1, { w: wf, run }));
    flights.push({
      from: { z: Z - run, w: wf, alongZ: false }, to: { z: Z, w: wf, alongZ: false },
      e0: e, e1: above.e, width: W, steps: FLIGHT_STEPS, riser: rise / FLIGHT_STEPS, tread, flight: FLIGHT_STEPS, rest: t.rest,
    });
  }
  return { side, galleries, flights, berth: berthAtEnd(t, galleries[galleries.length - 1], flights[flights.length - 1] ?? null) };
}

/**
 * A gallery's bays: along it, each short enough to stay on its arc; where a flight climbs from it (`notch`: its middle
 * and its run), the bay round the flight only in front of it.
 */
function gallery(t: ThresholdSite, tier: number, e: number, z0: number, z1: number, w0: number, w1: number, notch: { w: number; run: number } | null): Gallery {
  const r = t.ramp.habitat.radius - e, longest = Math.sqrt(8 * Math.max(r, 1) * SAG * t.handrail);
  const bays: StairPlatform[] = [];
  const lay = (a: number, b: number, front = z1): void => {
    const n = Math.max(1, Math.ceil((b - a) / longest - 1e-9));
    for (let i = 0; i < n; i++) bays.push({ kind: 'gallery', z0, z1: front, w0: a + ((b - a) * i) / n, w1: a + ((b - a) * (i + 1)) / n, e, bay: { tier, index: bays.length } });
  };
  if (!notch) lay(w0, w1);
  else {
    const a = notch.w - t.width / 2, b = notch.w + t.width / 2;
    if (a - w0 > 1e-9) lay(w0, a);
    lay(a, b, z1 - notch.run);
    if (w1 - b > 1e-9) lay(b, w1);
  }
  return { tier, e, z0, z1, w0, w1, bays };
}

/**
 * The capsule berth: on the lowest gallery, at its end away from the flight that comes down to it (on the upper gallery
 * when there is no other), against its front parapet and inside its end's; its door faces the flight's foot. Null where
 * the gallery is too shallow for a capsule and room round it.
 */
function berthAtEnd(t: ThresholdSite, g: Gallery, flight: StairLeg | null): Threshold['berth'] {
  const edge = t.parapet + t.berthClear;
  if (g.z1 - g.z0 < 2 * edge) return null;
  const foot: PlanPoint = flight ? [flight.from.z, flight.from.w] : centreOf(g);
  const w = foot[1] - g.w0 > g.w1 - foot[1] ? g.w0 + edge : g.w1 - edge;
  const at: PlanPoint = [g.z0 + edge, w];
  // Clear of the flight's notch and parapets.
  if (flight && Math.abs(w - flight.from.w) < flight.width / 2 + t.berthClear) return null;
  return { at, e: g.e, toward: foot };
}

/**
 * What built surfaces look like up close (the BUILT kind, materials.ts; gen/pavilion.ts builds them): each finish draws
 * its own pattern over the vertex albedo, in metres along the surface (the `uv` attribute, gen/shapes.ts), in layers
 * from the scale of a building down to a finger's breadth. Each layer fades to its mean before it could shimmer
 * (`shows`), so a landmark keeps gaining detail as the eye comes closer, and stays calm from far away.
 *
 * And the shelter a round roof gives what stands under it (`roofHorizons`): the sunline is a line along the axis, so
 * under the roof its light comes in only past the eaves (toward either end) and down through the oculus.
 */
import { Fn, If, abs, atan, float, floor, hash, max, mix, mx_noise_float, select, smoothstep, sqrt, vec2, vec3 } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { OPEN_SKY } from '../gen/horizon';
import { keepMean, lineAt, shows } from './shaderMath';

type F = Node<'float'>;
type V2 = Node<'vec2'>;
type V3 = Node<'vec3'>;
type V4 = Node<'vec4'>;

/** Stone in ashlar: courses and blocks (m); the joints' width as a share of a block. */
const COURSE = 0.6;
const BLOCK = 1.2;
/** Deck planks: width and length (m). */
const PLANK = 0.14;
const PLANK_LENGTH = 2.4;
/** Roof tiles: length along the slope, width (m). */
const TILE = { across: 0.9, along: 0.45 };
/** Bronze's patina where it has weathered (linear). */
const VERDIGRIS = vec3(0.1, 0.2, 0.16);

/** A seeded value 0 … 1 for a whole cell of a pattern (its row and column, whole numbers). */
const cellHash = (a: F, b: F): F => hash(a.add(b.mul(1013)).add(1e6));

/** Fine noise layers over a surface: each a scale (per metre) and a strength, each faded by its own scale. */
function grain(st: V2, layers: readonly (readonly [number, number])[], seed: number): F {
  let g: F = float(0);
  layers.forEach(([scale, strength], k) => {
    const at = st.mul(scale);
    g = g.add(mx_noise_float(vec3(at, seed + k * 1.7)).mul(strength).mul(shows(at)));
  });
  return g;
}

/**
 * Cells laid in courses over a surface (blocks, planks, tiles): courses `high` m apart, cells `long` m along them, each
 * course shifted by `shift(row)` cells. Gives the joints' darkening (`joint` widths along and across, as shares of a
 * cell; `mean` the joints' share of the surface and `dark` their brightness, kept to the mean far away), each cell's
 * own tint (± `tint`/2), and the course's number.
 */
function courses(st: V2, long: number, high: number, shift: (row: F) => F, joint: readonly [number, number], mean: number, dark: number, tint: number): { joints: F; tint: F; row: F } {
  const v = st.y.div(high), row = floor(v);
  const u = st.x.div(long).add(shift(row)), col = floor(u);
  const r = shows(vec2(u, v));
  return {
    joints: keepMean(max(lineAt(u, joint[0]), lineAt(v, joint[1])), mean, dark, r),
    tint: cellHash(col, row).sub(0.5).mul(tint).mul(r),
    row,
  };
}

const halfBond = (row: F): F => row.mul(0.5);

/** How cells are laid in courses: `courses`' arguments after the surface's place. */
type Lay = [long: number, high: number, shift: (row: F) => F, joint: readonly [number, number], mean: number, dark: number, tint: number];

/**
 * A finish of cells laid in courses (`lay`), over the vertex colour: each cell's own tint, the grain's layers (`grain`,
 * from `seed`) and whatever more it shows (`more`, given the place and the course), darkened at the joints.
 */
const coursed = (lay: Lay, layers: readonly (readonly [number, number])[], seed: number, more?: (st: V2, row: F) => F) => (albedo: V3, st: V2): V3 => {
  const c = courses(st, ...lay);
  return albedo.mul(float(1).add(c.tint).add(more ? more(st, c.row) : float(0)).add(grain(st, layers, seed))).mul(c.joints);
};

/** Bricks with their mortar: a brick's length and course (m). */
const BRICK = { long: 0.24, high: 0.075 };
/** Rammed earth: the height of one lift of the formwork (m). */
const LIFT_HIGH = 0.6;
/** The screen era's panels, stripped of their screens: width and height (m). */
const PANEL = { wide: 1.2, high: 2.4 };

// Rain never falls here, but cleaning and two centuries leave streaks down the walls.
const ashlar = coursed([BLOCK, COURSE, halfBond, [0.01, 0.02], 0.03, 0.4, 0.14], [[0.15, 0.06], [4, 0.07], [20, 0.05], [90, 0.035]], 1.3,
  (st) => mx_noise_float(vec3(st.x.mul(1.2), st.y.mul(0.08), 4.7)).mul(0.08).mul(shows(st.x.mul(1.2))));

// Boards of a plank's width, butted end to end at random along their row; the grain runs along the board (stretched noise).
const timber = coursed([PLANK_LENGTH, PLANK, (row) => cellHash(row, float(3)), [0.002, 0.03], 0.035, 0.35, 0.24], [[0.2, 0.08], [30, 0.04]], 2.9, (st, row) => {
  const along = vec2(st.x.mul(2), st.y.mul(60));
  return mx_noise_float(vec3(along, row.mul(0.37))).mul(0.12).mul(shows(along.y));
});

function bronze(albedo: V3, st: V2): V3 {
  const at = st.mul(1.7);
  const patina = mx_noise_float(vec3(at, 5.3)).mul(0.5).add(0.5).mul(shows(at));
  const weathered = mix(albedo, VERDIGRIS, patina.mul(patina).mul(0.6));
  return weathered.mul(float(1).add(grain(st, [[12, 0.08], [60, 0.05]], 6.1)));
}

// Broad patches of weathering read from afar; pitting up close.
const ceramic = coursed([TILE.across, TILE.along, halfBond, [0.015, 0.03], 0.04, 0.55, 0.1], [[0.04, 0.07], [0.3, 0.05], [40, 0.04]], 8.3);

const brick = coursed([BRICK.long, BRICK.high, halfBond, [0.04, 0.13], 0.14, 0.75, 0.3], [[0.3, 0.05], [30, 0.06], [120, 0.04]], 3.7);

function plaster(albedo: V3, st: V2): V3 {
  // Broad mottling where it was patched over the years, the trowel's sweeps, and its grit.
  const sweep = mx_noise_float(vec3(st.mul(vec2(2.2, 1.1)), 7.9)).mul(0.04).mul(shows(st.mul(2.2)));
  return albedo.mul(float(1).add(sweep).add(grain(st, [[0.12, 0.09], [0.7, 0.04], [60, 0.04]], 4.3)));
}

// Rammed in lifts: each a band of its own tint, the formwork's line between, the layers rammed into it fine and wavy.
const earth = coursed([1e3, LIFT_HIGH, halfBond, [0, 0.012], 0.012, 0.6, 0.12], [[0.25, 0.05], [50, 0.06]], 5.9,
  (st) => mx_noise_float(vec3(st.x.mul(0.6), st.y.mul(14), 2.3)).mul(0.09).mul(shows(st.y.mul(14))));

// Smooth panels a screen once covered: fine seams, and the paler ghost of the screen's frame where it hung.
const panel = coursed([PANEL.wide, PANEL.high, (row) => row.mul(0), [0.006, 0.003], 0.006, 0.45, 0.05], [[0.5, 0.03], [80, 0.02]], 9.1, (st) => {
  const u = st.x.div(PANEL.wide).fract(), v = st.y.div(PANEL.high).fract();
  const ghost = smoothstep(0.05, 0.07, u).mul(smoothstep(0.95, 0.93, u)).mul(smoothstep(0.05, 0.07, v)).mul(smoothstep(0.95, 0.93, v));
  return ghost.mul(0.05).mul(shows(st.div(PANEL.wide)));
});

/**
 * A built surface's albedo: its finish over the vertex colour (`FINISH` in gen/pavilion.ts: 0 stone, 1 timber, 2
 * bronze, 3 ceramic, 6 brick, 7 plaster, 8 earth, 9 panel; anything else plain). One plain If each.
 */
export function builtAlbedo(albedo: V3, st: V2, finish: F): V3 {
  return Fn(() => {
    const out = vec3(albedo).toVar();
    const is = (k: number): Node<'bool'> => abs(finish.sub(k)).lessThan(0.5);
    If(is(0), () => { out.assign(ashlar(albedo, st)); });
    If(is(1), () => { out.assign(timber(albedo, st)); });
    If(is(2), () => { out.assign(bronze(albedo, st)); });
    If(is(3), () => { out.assign(ceramic(albedo, st)); });
    If(is(6), () => { out.assign(brick(albedo, st)); });
    If(is(7), () => { out.assign(plaster(albedo, st)); });
    If(is(8), () => { out.assign(earth(albedo, st)); });
    If(is(9), () => { out.assign(panel(albedo, st)); });
    return out;
  })() as unknown as V3;
}

/**
 * The horizons (for `sunlit`, materials.ts) of the three openings a point under a round roof sees the sunline
 * through: past the eaves toward +x, past them toward −x, and up through the oculus. `p` is the point in the roof's
 * own frame (x along the axis, z up); `roof` is its outer radius, the eaves' height, the oculus's radius and height
 * (radius 0: no roof). A point not under the roof gets the whole sky in the first and nothing in the others.
 */
export function roofHorizons(p: V3, roof: V4): { past: V2; back: V2; oculus: V2 } {
  const reach = roof.x, eaves = roof.y, oc = roof.z, ocHeight = roof.w;
  const covered = reach.greaterThan(0).and(p.xy.length().lessThan(reach)).and(p.z.lessThan(eaves));
  const xe = sqrt(max(reach.mul(reach).sub(p.y.mul(p.y)), 0)), up = max(eaves.sub(p.z), 0.01);
  // Angles from straight up toward +x (positive) to the eaves' edge on either side, and to the oculus's rim.
  const past = atan(xe.sub(p.x), up), back = atan(xe.add(p.x), up);
  const xo = sqrt(max(oc.mul(oc).sub(p.y.mul(p.y)), 0)), toOc = max(ocHeight.sub(p.z), 0.01);
  const c0 = atan(xo.negate().sub(p.x), toOc), c1 = atan(xo.sub(p.x), toOc);
  const open = float(OPEN_SKY), none = float(-OPEN_SKY);
  return {
    past: vec2(open, select(covered, past.negate(), open)),
    back: vec2(select(covered, back.negate(), none), open),
    oculus: select(covered, vec2(c1, c0.negate()), vec2(0, 0)),
  };
}

/**
 * The handover between levels of detail: the one rule for every LOD in Solarpolis (Arnd, 2026-10-21): a level is never
 * taken away before the level that replaces it is built and drawn. Nothing may blink out while the finer level is
 * still being made; the coarser one stays until then, and only then hands over.
 *
 * A thing drawn at several levels by distance (a plant species: full, lite, hull) has per level a band (m from the eye:
 * fades in over x..y, out over z..w; each level fades in exactly where the one before fades out). Each level streams
 * its pieces (cells) around the eye. `handover` moves each boundary between two levels in to the nearest piece of the
 * finer level that is not built yet, so the coarser level draws everything the finer one cannot yet; `holes` checks
 * the other way round, for the guard: a piece not built inside the range its level draws. Pure: tests run it headless.
 */

/** A level's band (m from the eye): fades in over [0]..[1], out over [2]..[3]. */
export type Band = [number, number, number, number];

/** One streamed piece of a level: the nearest and farthest anything in it can be from the eye (m), and whether it is built. */
export interface Piece {
  near: number;
  far: number;
  ready: boolean;
}

/**
 * The bands the levels may be drawn with now: `bands` as configured (near to far), each boundary pulled in to the
 * nearest unbuilt piece of the finer level that reaches past where that level starts, keeping the fade's width. A level
 * with no room left draws nothing (its band folds onto its fade-in), and the next coarser one takes over where the
 * level before it ends. Only the last level's far edge never moves: nothing stands behind it.
 *
 * With `now` (the boundaries as drawn so far, `[z, w]` of each level but the last; updated in place), each boundary
 * moves toward that from where the boundary before it now is, `dt` seconds on (`sweepTo`): in at once, out over a
 * moment, never behind the boundary before it. Judging each level from where it really starts this frame (not where
 * it will start once the sweep is done) is what keeps a level from drawing over its own missing pieces.
 */
export function handover(bands: readonly Band[], pieces: readonly (readonly Piece[])[], now?: [number, number][], dt = 0): Band[] {
  const out = bands.map((b) => [...b] as Band);
  for (let k = 0; k < out.length - 1; k++) {
    const b = out[k], from = k === 0 ? -Infinity : b[0];
    let gap = Infinity;
    for (const p of pieces[k] ?? []) if (!p.ready && p.far > from && p.near < gap) gap = p.near;
    if (gap < b[3]) {
      if (gap <= b[1]) { b[2] = b[0]; b[3] = b[1]; } // no room: draws nothing
      else { b[2] = Math.max(b[1], gap - (b[3] - b[2])); b[3] = gap; }
    }
    if (now) {
      let [z, w] = sweepTo(now[k], [b[2], b[3]], dt);
      // Never nearer than the boundary before it: the level between would draw nothing and the two around it both.
      if (z < b[0] || w < b[1]) [z, w] = [b[0], b[1]];
      now[k] = [z, w];
      [b[2], b[3]] = [z, w];
    }
    out[k + 1][0] = b[2];
    out[k + 1][1] = b[3];
  }
  return out;
}

/** Whether a level draws anything with this band: not once it fades out before it has faded in (a folded band). */
export const draws = (b: Band): boolean => b[3] > b[1];

/**
 * Per level, how many of its pieces are not built though the level draws where they lie: for every level but the last
 * a hole (something that was there is missing). Past the last level nothing stands in, so its count is the far edge
 * still streaming in, not a hole.
 */
export function holes(bands: readonly Band[], pieces: readonly (readonly Piece[])[]): number[] {
  return bands.map((b, k) => {
    if (!draws(b)) return 0;
    let n = 0;
    for (const p of pieces[k] ?? []) if (!p.ready && p.near < b[3] && p.far > b[0]) n++;
    return n;
  });
}

/**
 * One step of a boundary's sweep toward where `handover` wants it (`[z, w]`, m), `dt` seconds after the last: in at
 * once (a piece went missing: never a hole), out over about `sweep` seconds (pieces came in: the finer level takes
 * over from the inside out, plant by plant, rather than all at once).
 */
export function sweepTo(now: readonly [number, number], want: readonly [number, number], dt: number, sweep = 0.6): [number, number] {
  if (want[0] <= now[0] || want[1] <= now[1]) return [Math.min(now[0], want[0]), Math.min(now[1], want[1])];
  const f = Math.min(1, dt / sweep), width = Math.max(1, want[1] - want[0]);
  const toward = (a: number, b: number) => Math.min(b, a + Math.max(b - a, width) * f);
  return [toward(now[0], want[0]), toward(now[1], want[1])];
}

/**
 * Plants: each plant's own threshold in a dithered band (0 … 1), from its turn about up (`plantCell`: its lattice spot's
 * hash, the same in every level's cell). The plant kinds (render/materials.ts `plantFrame`) compute the same, so in a
 * band one level draws a plant exactly where the other stops: `out ≤ pick` for the level fading out, `pick ≤ into` for
 * the one fading in.
 */
export const PICK_TURNS = 13;
export const handOverPick = (turn: number): number => {
  const v = (turn * PICK_TURNS) / (2 * Math.PI);
  return v - Math.floor(v);
};

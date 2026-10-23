/**
 * Which names the overlay writes beside things on screen (habitats' points of light outside, and later landmarks,
 * capsules and people): the most important first, at most `most`, and none so close to one already written that the
 * two would overlap. The one way for every name the link draws over the world, so they never pile up.
 */

/** Screen pixels: x right, y down. */
export type ScreenPoint = readonly [number, number];

/** Where a marked point shows: on screen, or held inside the screen's edge pointing toward it (`angle`, rad from +x, y down). */
export interface Sighting {
  readonly at: ScreenPoint;
  readonly on: boolean;
  readonly angle: number;
}

/**
 * From `sorted` (most important first), the ones to name: `place` gives each one's point on screen (null when it is not
 * on screen); a name is left out when its point is within `apart` (x, y) of one chosen before it.
 */
export function pickMarks<T>(sorted: Iterable<T>, place: (t: T) => ScreenPoint | null, most: number, apart: ScreenPoint): { item: T; at: ScreenPoint }[] {
  const chosen: { item: T; at: ScreenPoint }[] = [];
  for (const item of sorted) {
    if (chosen.length >= most) break;
    const at = place(item);
    if (!at || chosen.some((c) => Math.abs(c.at[0] - at[0]) < apart[0] && Math.abs(c.at[1] - at[1]) < apart[1])) continue;
    chosen.push({ item, at });
  }
  return chosen;
}

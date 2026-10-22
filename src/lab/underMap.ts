/**
 * The Understorey's plan (gen/under.ts) drawn as maps from above, for the Blueprint tab's "Under the floor": the whole
 * floor unrolled like the land plan's map (the wild end left, the port end right, once round the axis top to bottom),
 * each pixel coloured by the use of the bay under it; and one hamlet close up, a pixel square per bay share, with a
 * dot for every pillar once the bays are large enough to show them.
 *
 * Plain arrays, no DOM: the Lab puts them on a canvas, and a script can write them out as pictures.
 */
import { wrapAngle } from '../blueprint';
import { edgeAt, type BayUse, type Hamlet, type Under } from '../gen/under';
import { dot, emptyImage, type PlanImage } from './planMap';

type Rgb = readonly [number, number, number];

/** The maps' colours by use (sRGB, 0 … 1): light where people live, water blue, the Dim and the works dark. */
export const USE_COLORS: Readonly<Record<BayUse, Rgb>> = {
  well: [1, 0.95, 0.55],
  hall: [0.93, 0.55, 0.32],
  home: [0.88, 0.84, 0.74],
  lane: [0.66, 0.62, 0.55],
  gallery: [0.98, 0.95, 0.88],
  cistern: [0.27, 0.5, 0.72],
  lake: [0.4, 0.66, 0.78],
  works: [0.19, 0.22, 0.2],
  dim: [0.29, 0.28, 0.27],
};
const PILLAR: Rgb = [0.1, 0.09, 0.08];

/** Fills each pixel with the colour of the bay under it ((i, j) of the pixel's middle, or null for none). */
function paint(under: Under, img: PlanImage, bayOf: (x: number, y: number) => { i: number; j: number } | null): void {
  const { width, height, data } = img;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const b = bayOf(x + 0.5, y + 0.5), k = (y * width + x) * 4;
    if (!b) continue;
    const c = USE_COLORS[under.useAt(b.i, b.j)];
    data[k] = c[0] * 255; data[k + 1] = c[1] * 255; data[k + 2] = c[2] * 255; data[k + 3] = 255;
  }
}

/** The whole floor unrolled, `width` pixels from the Mountain's foot to the Gate's, as tall as the circumference. */
export function underFloorMap(under: Under, width: number): PlanImage {
  const { profile } = under.habitat, R = under.habitat.radius;
  const s0 = profile.floorStart, scale = width / (profile.floorEnd - s0);
  const height = Math.max(1, Math.round(2 * Math.PI * R * scale));
  const img = emptyImage(width, height);
  paint(under, img, (x, y) => under.bayAt((y / height) * 2 * Math.PI, s0 + x / scale));
  return img;
}

/**
 * One hamlet close up: a square `size` pixels across round its court, wide enough for its furthest edge and some of
 * the ground beyond. Along the axis runs left to right, round it top to bottom, as on the floor map.
 */
export function hamletMap(under: Under, hamlet: Hamlet, size: number): PlanImage {
  let reach = 0;
  for (let k = 0; k < 64; k++) reach = Math.max(reach, edgeAt(hamlet, (k / 64) * 2 * Math.PI));
  const span = 2 * Math.ceil(reach * 1.3), perBay = size / span, half = span / 2;
  const img = emptyImage(size, size);
  // Bay offsets from the hamlet's own bay, so the court sits in the middle whatever its column.
  const bayOf = (x: number, y: number): { i: number; j: number } | null => {
    const j = hamlet.j + Math.floor(x / perBay - half), i = hamlet.i + Math.floor(y / perBay - half);
    return j < 0 || j >= under.along ? null : { i, j };
  };
  paint(under, img, bayOf);
  if (perBay >= 6) for (let a = 0; a <= span; a++) for (let b = 0; b <= span; b++) dot(img, b * perBay, a * perBay, Math.max(0.8, perBay / 10), PILLAR);
  // The court above, as a ring where the light well opens.
  const { theta, s } = under.centreOf(hamlet.i, hamlet.j), R = under.habitat.radius;
  const cx = (half + (hamlet.site.s - s) / under.bay + 0.5) * perBay, cy = (half + (wrapAngle(hamlet.site.theta - theta + Math.PI) - Math.PI) * R / under.bay + 0.5) * perBay;
  const r = (hamlet.site.size / under.bay) * perBay;
  for (let k = 0; k < 96; k++) { const a = (k / 96) * 2 * Math.PI; dot(img, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.9, [1, 1, 1]); }
  return img;
}

/**
 * The reference system (example values, like the reference habitat): some forty thousand habitats beyond the Necklace,
 * three to four billion people, about ten times Earth's few hundred million (world bible, Part I: most people live in
 * built habitats). The Belt holds the most, in its own rock; names get wilder and markets harder toward the outer dark. Placements and schedules that the world bible does not fix are ours to change: the
 * Assembly sits at Thraxipolis, the first ark leaves in February 3026 and the next about every eleven weeks, Velloran
 * Reach votes every four years from May 3026.
 */
import { DAY } from '../space/constants';
import { julianDay } from '../space/time';
import type { SystemParams } from './params';

const D = Math.PI / 180;
const YEAR = 365.25 * DAY;
const INNER = { grave: 0.3, plain: 0.4, mind: 0.25, punk: 0.05 };
const MIDDLE = { grave: 0.2, plain: 0.4, mind: 0.25, punk: 0.15 };
const OUTER = { grave: 0.08, plain: 0.37, mind: 0.2, punk: 0.35 };
const FAIR = { commons: 0.35, dividend: 0.62, market: 0.03 };
const HARD = { commons: 0.4, dividend: 0.48, market: 0.12 };
const BUILT = { cylinder: 0.6, torus: 0.25, bubble: 0.1, water: 0.05 };
const ROCKS = { asteroid: 0.6, cylinder: 0.25, torus: 0.1, swarm: 0.05 };

export const REFERENCE_SYSTEM: SystemParams = {
  regions: [
    { id: 'necklace', name: 'the Necklace', count: 0, place: { kind: 'necklace' }, forms: { cylinder: 1 }, styles: INNER, economies: FAIR, radius: [0, 0], aspect: [0, 0] },
    { id: 'l4', name: 'Earth–Moon L4', count: 2000, place: { kind: 'lagrange', point: 4, spread: 0.12 }, forms: BUILT, styles: INNER, economies: FAIR, radius: [600, 6000], aspect: [3, 8] },
    { id: 'l5', name: 'Earth–Moon L5', count: 2000, place: { kind: 'lagrange', point: 5, spread: 0.12 }, forms: BUILT, styles: INNER, economies: FAIR, radius: [600, 6000], aspect: [3, 8] },
    { id: 'mercury', name: 'Mercury orbit', count: 400, place: { kind: 'circle', body: 'mercury', distance: [2, 12], inclination: 10 * D }, forms: BUILT, styles: INNER, economies: FAIR, radius: [800, 5000], aspect: [3, 8] },
    { id: 'venus', name: 'Venus orbit', count: 2500, place: { kind: 'circle', body: 'venus', distance: [3, 40], inclination: 20 * D }, forms: BUILT, styles: INNER, economies: FAIR, radius: [600, 6000], aspect: [3, 8] },
    { id: 'mars', name: 'Mars orbit', count: 4000, place: { kind: 'circle', body: 'mars', distance: [3, 60], inclination: 25 * D }, forms: BUILT, styles: INNER, economies: FAIR, radius: [500, 5000], aspect: [3, 8] },
    { id: 'belt', name: 'the Belt', count: 20000, place: { kind: 'belt', belt: 'main', within: 60000 }, forms: ROCKS, styles: MIDDLE, economies: FAIR, radius: [300, 3000], aspect: [2, 6] },
    { id: 'trojans', name: 'the Trojans', count: 4000, place: { kind: 'belt', belt: 'trojan', within: 20000 }, forms: ROCKS, styles: MIDDLE, economies: HARD, radius: [300, 2500], aspect: [2, 6] },
    { id: 'jupiter', name: 'Jupiter orbit', count: 3000, place: { kind: 'circle', body: 'jupiter', distance: [20, 150], inclination: 8 * D }, forms: BUILT, styles: MIDDLE, economies: FAIR, radius: [600, 5000], aspect: [3, 8] },
    { id: 'saturn', name: 'Saturn orbit', count: 2500, place: { kind: 'circle', body: 'saturn', distance: [3, 40], inclination: 8 * D }, forms: BUILT, styles: OUTER, economies: HARD, radius: [500, 4000], aspect: [3, 8] },
    { id: 'uranus', name: 'Uranus orbit', count: 500, place: { kind: 'circle', body: 'uranus', distance: [4, 40], inclination: 8 * D }, forms: BUILT, styles: OUTER, economies: HARD, radius: [400, 3000], aspect: [3, 8] },
    { id: 'neptune', name: 'Neptune orbit', count: 500, place: { kind: 'circle', body: 'neptune', distance: [4, 40], inclination: 8 * D }, forms: BUILT, styles: OUTER, economies: HARD, radius: [400, 3000], aspect: [3, 8] },
    { id: 'kuiper', name: 'the outer dark', count: 1500, place: { kind: 'belt', belt: 'kuiper', within: 6000 }, forms: { asteroid: 0.45, swarm: 0.4, cylinder: 0.15 }, styles: OUTER, economies: HARD, radius: [200, 1500], aspect: [2, 5] },
  ],
  crowding: { cylinder: 1, torus: 1, bubble: 0.6, asteroid: 1, swarm: 2.5, water: 0.15 },
  canon: true,
  news: {
    flare: { every: 3 * DAY, chance: 0.7, great: 0.15 },
    arks: { count: 20, firstJd: julianDay(3026, 2, 17), every: 77 * DAY, jitter: 0.2 },
    assembly: { every: 61 * DAY, seat: 'thraxipolis' },
    election: { firstJd: julianDay(3026, 5, 9), every: 4 * YEAR },
    spread: 10 * 3600,
    recent: 6 * DAY,
  },
  // A sail at a thousandth of a g up to 100 km/s; a coasting torch ship at a tenth of a g up to 150 km/s; a hurry at
  // a full g all the way. Earth to Mars at its nearest: about two months, a week, two days; to Saturn about nine
  // months, three months, eight days.
  travel: {
    sail: { accel: 0.01, cruise: 1e5 },
    coast: { accel: 0.1 * 9.81, cruise: 1.5e5 },
    hurry: { accel: 9.81, cruise: Infinity },
  },
};

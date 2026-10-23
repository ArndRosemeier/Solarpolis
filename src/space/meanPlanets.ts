/**
 * Where the planets are without the ephemeris pack: Keplerian mean elements with linear rates and the extra terms for
 * the giant planets (E. M. Standish, JPL "Approximate Positions of the Planets", Table 2a/2b, fitted for 3000 BC to
 * 3000 AD). Heliocentric J2000 ecliptic metres, like `SolarSystem.position`.
 *
 * The data-free counterpart of `SolarSystem` for callers that need the planets everywhere at once but cheaply: light
 * time between habitats (src/system), anywhere the 4 MB pack is not loaded. test/system.test.ts measures it against
 * the DE441 pack over 3020–3080: within a light-second for the inner planets, within 75 light-seconds for Uranus (under
 * 1 % of its light time from the Sun). Earth here is the Earth–Moon barycentre (the Moon's pull moves Earth by
 * 4,700 km, 16 light-milliseconds).
 */
import type { Vec3 } from '@futuremagic/core';
import { AU, JD_J2000, JULIAN_CENTURY } from './constants';
import { ellipseAt } from './orbits';

/** The planets the table covers (Earth meaning the Earth–Moon barycentre). */
export const MEAN_PLANETS = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const;
export type MeanPlanet = (typeof MEAN_PLANETS)[number];

// a (AU), e, I, L, ϖ (long. of perihelion), Ω (deg), each with its rate per Julian century; then b, c, s, f for the outer planets.
type Row = [number, number, number, number, number, number, number, number, number, number, number, number, number?, number?, number?, number?];
const TABLE: Record<MeanPlanet, Row> = {
  mercury: [0.38709843, 0, 0.20563661, 0.00002123, 7.00559432, -0.00590158, 252.25166724, 149472.67486623, 77.45771895, 0.15940013, 48.33961819, -0.12214182],
  venus: [0.72332102, -0.00000026, 0.00676399, -0.00005107, 3.39777545, 0.00043494, 181.9797085, 58517.8156026, 131.76755713, 0.05679648, 76.67261496, -0.27274174],
  earth: [1.00000018, -0.00000003, 0.01673163, -0.00003661, -0.00054346, -0.01337178, 100.46691572, 35999.37306329, 102.93005885, 0.3179526, -5.11260389, -0.24123856],
  mars: [1.52371243, 0.00000097, 0.09336511, 0.00009149, 1.85181869, -0.00724757, -4.56813164, 19140.29934243, -23.91744784, 0.45223625, 49.71320984, -0.26852431],
  jupiter: [5.20248019, -0.00002864, 0.0485359, 0.00018026, 1.29861416, -0.00322699, 34.33479152, 3034.90371757, 14.27495244, 0.18199196, 100.29282654, 0.13024619, -0.00012452, 0.0606406, -0.35635438, 38.35125],
  saturn: [9.54149883, -0.00003065, 0.05550825, -0.00032044, 2.49424102, 0.00451969, 50.07571329, 1222.11494724, 92.86136063, 0.54179478, 113.63998702, -0.25015002, 0.00025899, -0.13434469, 0.87320147, 38.35125],
  uranus: [19.18797948, -0.00020455, 0.0468574, -0.0000155, 0.77298127, -0.00180155, 314.20276625, 428.49512595, 172.43404441, 0.09266985, 73.96250215, 0.05739699, 0.00058331, -0.97731848, 0.17689245, 7.67025],
  neptune: [30.06952752, 0.00006447, 0.00895439, 0.00000818, 1.7700552, 0.000224, 304.22289287, 218.46515314, 46.68158724, 0.01009938, 131.78635853, -0.00606302, -0.00041348, 0.68346318, -0.10162547, 7.67025],
  pluto: [39.48686035, 0.00449751, 0.24885238, 0.00006016, 17.1410426, 0.00000501, 238.96535011, 145.18042903, 224.09702598, -0.00968827, 110.30167986, -0.00809981, -0.01262724, 0, 0, 0],
};
const D = Math.PI / 180;

/** A planet's heliocentric position at a Julian date (J2000 ecliptic, m), from its mean elements. */
export function meanPlanetAt(id: MeanPlanet, jd: number): Vec3 {
  const r = TABLE[id], T = (jd - JD_J2000) / JULIAN_CENTURY;
  const a = r[0] + r[1] * T, e = r[2] + r[3] * T, inc = r[4] + r[5] * T, L = r[6] + r[7] * T, peri = r[8] + r[9] * T, node = r[10] + r[11] * T;
  const [b = 0, c = 0, s = 0, f = 0] = r.slice(12) as number[];
  const mean = L - peri + b * T * T + c * Math.cos(f * T * D) + s * Math.sin(f * T * D);
  return ellipseAt(a * AU, e, mean * D, inc * D, node * D, (peri - node) * D);
}

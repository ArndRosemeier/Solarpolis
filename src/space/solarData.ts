/** Real body dimensions / IAU mean poles; JPL physical parameters. SI internally.
 * Detailed provenance and accuracy limits: docs/solar-system.md. */
export interface SolarBody {
  id: string; name: string; parent: string; kind: 'star' | 'planet' | 'dwarf' | 'moon' | 'asteroid';
  radius: number; polar: number; colour: [number, number, number]; albedo: number;
  pole: [number, number]; rotation: number; appearance: number;
  rings?: { inner: number; outer: number; opacity: number };
  radiusKnown?: boolean;
}

type Row = [string, string, number, number, number, number, number, number, [number, number, number], number, number];
// id, name, equatorial/polar radii km, pole RA/Dec, rotation days, albedo, linear surface colour, appearance, GM km³/s².
const ROWS: Row[] = [
  ['sun', 'Sun', 695700, 695700, 286.13, 63.87, 25.38, 1, [1, .92, .76], 9, 132712440041.94],
  ['mercury', 'Mercury', 2439.7, 2439.7, 281.01, 61.45, 58.646, .142, [.23, .21, .19], 0, 22031.87],
  ['venus', 'Venus', 6051.8, 6051.8, 272.76, 67.16, -243.025, .689, [.68, .57, .37], 1, 324858.592],
  ['earth', 'Earth', 6378.137, 6356.752, 0, 90, .99726968, .434, [.2, .35, .5], 7, 398600.436],
  ['mars', 'Mars', 3396.19, 3376.2, 317.681, 52.887, 1.025957, .17, [.42, .18, .085], 2, 42828.374],
  ['jupiter', 'Jupiter', 71492, 66854, 268.057, 64.495, .41354, .538, [.65, .47, .32], 6, 126686531.9],
  ['saturn', 'Saturn', 60268, 54364, 40.589, 83.537, .44401, .499, [.64, .56, .37], 3, 37931206.23],
  ['uranus', 'Uranus', 25559, 24973, 257.311, -15.175, -.71833, .488, [.28, .57, .61], 4, 5793951.3],
  ['neptune', 'Neptune', 24764, 24341, 299.36, 43.46, .67125, .442, [.18, .36, .54], 4, 6835099.97],
  ['pluto', 'Pluto', 1188.3, 1188.3, 132.993, -6.163, -6.38723, .575, [.49, .39, .30], 0, 869.3],
  ['ceres', 'Ceres', 482, 446, 291.418, 66.764, .37809, .09, [.13, .14, .14], 0, 62.63],
  ['haumea', 'Haumea', 816, 513, 285.1, -10.6, .16315, .51, [.58, .57, .55], 0, 267],
  ['makemake', 'Makemake', 715, 715, 0, 90, .937, .77, [.57, .38, .24], 0, 206],
  ['eris', 'Eris', 1163, 1163, 0, 90, 15.786, .96, [.78, .77, .73], 0, 1108],
  ['vesta', 'Vesta', 286, 223, 309.03, 42.23, .2226, .42, [.34, .31, .27], 0, 17.29],
  ['pallas', 'Pallas', 275, 238, 33, -3, .32555, .16, [.18, .17, .15], 0, 13.74],
  ['hygiea', 'Hygiea', 217, 217, 117, -29, .576, .072, [.09, .09, .085], 0, 5.78],
];

export const PLANET_GM = Object.fromEntries(ROWS.map(r => [r[0], r[10] * 1e9]));
export const SOLAR_BODIES: SolarBody[] = ROWS.map(([id, name, radius, polar, ra, dec, rotation, albedo, colour, appearance]) => ({
  id, name, parent: id === 'sun' ? '' : 'sun', kind: id === 'sun' ? 'star' : ['pluto', 'ceres', 'haumea', 'makemake', 'eris'].includes(id) ? 'dwarf' : ['vesta', 'pallas', 'hygiea'].includes(id) ? 'asteroid' : 'planet',
  radius: radius * 1000, polar: polar * 1000, pole: [ra, dec], rotation, albedo, colour, appearance,
  rings: id === 'saturn' ? { inner: 66900e3, outer: 140180e3, opacity: .8 }
    : id === 'uranus' ? { inner: 41837e3, outer: 51149e3, opacity: .17 }
    : id === 'neptune' ? { inner: 41900e3, outer: 62930e3, opacity: .07 }
    : id === 'jupiter' ? { inner: 92000e3, outer: 226000e3, opacity: .025 }
    : id === 'haumea' ? { inner: 2252e3, outer: 2322e3, opacity: .45 } : undefined,
}));

export interface MoonRecord {
  id: string; name: string; code: string; parent: string; epoch: number;
  frame: 'laplace' | 'ecliptic' | 'equatorial'; pole: [number, number] | null;
  a: number; e: number; peri: number; anomaly: number; inclination: number; node: number;
  period: number; apsisPeriod: number; nodePeriod: number; radius: number; radiusKnown: boolean;
}
export interface SmallRecord { id: string; epoch: number; a: number; e: number; i: number; om: number; w: number; ma: number; n: number }

/** Dwarf-planet moon orbits remain uncertain; phases are illustrative, not measured 3026 ephemerides. */
export const DWARF_MOONS: MoonRecord[] = [
  ['dysnomia', 'Dysnomia', 'eris', 37273, 15.7859, 350, .006, 0],
  ['hiiaka', "Hiʻiaka", 'haumea', 49880, 49.462, 160, .051, 0],
  ['namaka', 'Namaka', 'haumea', 25657, 18.2783, 85, .249, 13],
  ['mk2', 'S/2015 (136472) 1 · MK 2', 'makemake', 21000, 12.4, 87.5, 0, 0],
].map(r => ({ id: r[0] as string, code: r[0] as string, name: r[1] as string, parent: r[2] as string, a: r[3] as number, period: r[4] as number, radius: r[5] as number,
  e: r[6] as number, inclination: r[7] as number, epoch: 2451545, frame: 'equatorial', pole: null, peri: 0, anomaly: 0, node: 0, apsisPeriod: 0, nodePeriod: 0, radiusKnown: false }));

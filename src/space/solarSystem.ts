/** Offline astronomy: DE441 Chebyshev fits for major bodies, mean ellipses for the satellite catalogue.
 * Dates are TDB (the game's uniform TT differs by milliseconds), positions J2000 ecliptic metres.
 * The model accepts data; no I/O, rendering dependencies, or implicit clock. */
import { v3add, v3cross, v3dot, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { AU, DAY, JD_J2000, MOON } from './constants';
import { earthAxesAt } from './ephemeris';
import { apply, IDENTITY, mul, rotZ, type Mat3 } from './pose';
import { ellipseAt, polePlane } from './orbits';
import { DWARF_MOONS, SOLAR_BODIES, type MoonRecord, type SmallRecord, type SolarBody } from './solarData';

/**
 * The light of a body too small to show a disc, as flux at the eye relative to the Sun's at 1 AU (linear RGB, its
 * colour at luminance 1): its albedo, the Lambert phase seen from the eye, its solid angle and the sunlight on it
 * (`light`, relative to 1 AU). `solar` and `eyeSolar` are heliocentric (m), `distance` from the eye.
 */
export function bodyPointFlux(body: SolarBody, solar: Vec3, eyeSolar: Vec3, distance: number, light: number): Vec3 {
  const alpha = Math.acos(Math.max(-1, Math.min(1, v3dot(v3norm(v3scale(solar, -1)), v3norm(v3sub(eyeSolar, solar))))));
  const phase = (Math.sin(alpha) + (Math.PI - alpha) * Math.cos(alpha)) / Math.PI;
  const flux = body.albedo * phase * (body.radius / distance) ** 2 * light;
  const luminance = Math.max(.01, .2126 * body.colour[0] + .7152 * body.colour[1] + .0722 * body.colour[2]);
  return v3scale(body.colour, flux / luminance);
}

export interface EphemerisPack { start: number; stop: number; degree: number; bodies: Record<string, { span: number; maxErrorKm: number; coefficients: number[] }> }
const D = Math.PI / 180;

/** Clenshaw evaluation, with no allocation proportional to the ephemeris's duration. */
export function ephemerisAt(pack: EphemerisPack, id: string, jd: number): Vec3 {
  if (jd < pack.start || jd > pack.stop) throw new RangeError('The offline ephemeris covers 3020–3080');
  const body = pack.bodies[id];
  if (!body) throw new Error(`No ephemeris for ${id}`);
  const width = pack.degree + 1, k = Math.floor((jd - pack.start) / body.span), x = 2 * ((jd - pack.start) / body.span - k) - 1;
  return [0, 1, 2].map(axis => {
    const offset = (k * 3 + axis) * width;
    let b1 = 0, b2 = 0;
    for (let j = pack.degree; j > 0; j--) { const b = 2 * x * b1 - b2 + body.coefficients[offset + j]; b2 = b1; b1 = b; }
    return (x * b1 - b2 + body.coefficients[offset]) * 1000;
  }) as Vec3;
}

export class SolarSystem {
  readonly bodies: SolarBody[];
  readonly byId: Map<string, SolarBody>;
  readonly moons: Map<string, MoonRecord>;
  private readonly small: Map<string, SmallRecord>;
  private cache = new Map<string, Vec3>();
  private date = NaN;

  constructor(readonly ephemeris: EphemerisPack, satellites: MoonRecord[], small: SmallRecord[]) {
    this.moons = new Map([...satellites, ...DWARF_MOONS].map(m => [m.code === '301' ? 'moon' : m.id, m]));
    this.small = new Map(small.map(s => [s.id, s]));
    this.bodies = [...SOLAR_BODIES, ...Array.from(this.moons, ([id, m]): SolarBody => {
      const icy = !['earth', 'mars'].includes(m.parent), io = m.code === '501', titan = m.code === '606';
      return { id, name: m.name.replace(/^S(\d+)_(\w)_(\d+)$/, 'S/$1 $2 $3'), parent: m.parent, kind: 'moon', radius: m.radius * 1000, polar: m.radius * 1000,
        radiusKnown: m.radiusKnown, pole: m.pole ?? SOLAR_BODIES.find(b => b.id === m.parent)!.pole, rotation: m.period,
        colour: io ? [.67, .52, .18] : titan ? [.57, .32, .10] : icy ? [.47, .46, .43] : [.20, .19, .18],
        albedo: io ? .63 : titan ? .22 : icy ? .45 : .12, appearance: id === 'moon' ? 8 : titan ? 1 : m.code === '502' ? 5 : 0 };
    })];
    this.byId = new Map(this.bodies.map(b => [b.id, b]));
  }

  /** Position relative to a moon's primary. Mean orbit shapes are measured; phases far beyond their fit epochs are approximate. */
  moonOffset(id: string, jd: number): Vec3 {
    if (id === 'moon') return ephemerisAt(this.ephemeris, 'moon', jd);
    const m = this.moons.get(id)!;
    const years = (jd - m.epoch) / 365.25;
    const peri = m.peri * D + (m.apsisPeriod ? 2 * Math.PI * years / m.apsisPeriod : 0);
    const node = m.node * D - (m.nodePeriod ? 2 * Math.PI * years / m.nodePeriod : 0);
    const mean = m.anomaly * D + 2 * Math.PI * (jd - m.epoch) / m.period;
    const p = ellipseAt(m.a * 1000, m.e, mean, m.inclination * D, node, peri);
    const plane = m.frame === 'ecliptic' ? IDENTITY : polePlane(...(m.pole ?? this.byId.get(m.parent)!.pole));
    return apply(plane, p);
  }

  position(id: string, jd: number): Vec3 {
    if (jd !== this.date) { this.cache.clear(); this.date = jd; }
    const old = this.cache.get(id);
    if (old) return old;
    let p: Vec3;
    if (id === 'sun') p = [0, 0, 0];
    else if (id === 'earth') p = v3sub(ephemerisAt(this.ephemeris, 'emb', jd), v3scale(this.moonOffset('moon', jd), MOON.barycentreShare));
    else if (this.moons.has(id)) p = v3add(this.position(this.byId.get(id)!.parent, jd), this.moonOffset(id, jd));
    else if (this.small.has(id)) {
      const o = this.small.get(id)!;
      p = ellipseAt(o.a * AU, o.e, (o.ma + o.n * (jd - o.epoch)) * D, o.i * D, o.om * D, o.w * D);
    } else p = ephemerisAt(this.ephemeris, id, jd);
    this.cache.set(id, p);
    return p;
  }

  axes(id: string, jd: number): Mat3 {
    if (id === 'earth') return earthAxesAt(jd);
    const b = this.byId.get(id)!;
    if (b.kind === 'moon') {
      const x = v3norm(v3scale(this.moonOffset(id, jd), -1));
      const north: Vec3 = id === 'moon' ? [0, 0, 1] : apply(polePlane(...b.pole), [0, 0, 1]);
      const y = v3norm(v3cross(north, x)), z = v3cross(x, y);
      return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
    }
    return mul(polePlane(...b.pole), rotZ(2 * Math.PI * ((jd - JD_J2000) / b.rotation % 1)));
  }

  /** SI velocity; useful to future travel code without differencing large heliocentric coordinates itself. */
  velocity(id: string, jd: number): Vec3 {
    const seconds = 30, step = seconds / DAY;
    return v3scale(v3sub(this.position(id, jd + step), this.position(id, jd - step)), 1 / (2 * seconds));
  }

  bytes(): number {
    return Object.values(this.ephemeris.bodies).reduce((sum, b) => sum + b.coefficients.length * 8, 0) + this.bodies.length * 1024;
  }
}

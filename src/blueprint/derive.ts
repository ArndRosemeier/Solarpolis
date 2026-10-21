/**
 * Everything that follows from a habitat's parameters: spin, gravity and air as functions of radius, the layer
 * radii, masses, power, light and heat. Each derived number has its formula here and only here; the rest of the
 * code reads it from the `Habitat` (docs/ARCHITECTURE.md: "How strong is gravity here?" and friends).
 *
 * Pure: no three.js, no DOM, no randomness. The reference numbers in the design doc are pinned by test/blueprint.test.ts.
 */
import type { HabitatParams } from './params';
import { makeProfile, type Profile } from './profile';

/** Solar constant at 1 AU (W/m²). */
export const SOLAR_CONSTANT = 1361;
/** Stefan–Boltzmann constant (W/(m² K⁴)). */
export const STEFAN_BOLTZMANN = 5.670374419e-8;

/** The radius at which each layer begins (its inner face, nearest the axis), from the floor out (m). */
export interface LayerRadii {
  /** The mean ground surface: the floor radius R. */
  surface: number;
  /** Top of the ceiling deck (the bottom of the deepest soil). */
  ceilingDeck: number;
  /** The living layer's ceiling (underside of the ceiling deck). */
  living: number;
  /** The living layer's floor (top of the floor deck). */
  floorDeck: number;
  service: number;
  hull: number;
  padding: number;
  solarSkin: number;
  /** The outermost radius of the habitat. */
  outer: number;
}

export interface Habitat {
  readonly params: HabitatParams;
  readonly seed: number;
  /** Floor radius R and length L (m). */
  readonly radius: number;
  readonly length: number;
  /** Spin rate ω (rad/s), period (s), revolutions per minute, floor speed relative to the stars (m/s). */
  readonly spin: number;
  readonly period: number;
  readonly rpm: number;
  readonly floorSpeed: number;
  readonly layers: LayerRadii;
  /** Hull thickness needed to carry air pressure, contents, padding and itself at the hull radius (m); NaN if no thickness can. */
  readonly hullThickness: number;
  /** Hoop stress the hull is designed to (Pa). */
  readonly hullStress: number;
  /** The largest radius this hull material can spin at the given gravity (m). */
  readonly maxRadius: number;
  readonly paddingThickness: number;
  /** Interior floor area 2πRL (m²), without the endcap slopes. */
  readonly floorArea: number;
  /** One endcap disc at the outer radius (m²). */
  readonly endcapArea: number;
  /** The rubble padding's mass (kg). */
  readonly paddingMass: number;
  /** Sunlight falling on the habitat and its collectors (W), and the electricity made from it (W). */
  readonly sunlight: number;
  readonly solarPower: number;
  /** Visible light the sunline must deliver to the floor (W). */
  readonly lightPower: number;
  /** Heat to radiate: all intercepted sunlight ends as heat (W). */
  readonly heat: number;
  /** Radiator area needed, both faces of the fins counted (m²), and as a multiple of the two endcap discs. */
  readonly radiatorArea: number;
  readonly radiatorToEndcaps: number;
  readonly population: number;
  /** People per km² of floor. */
  readonly density: number;
  /** The meridian curve of the interior: wild axis, wild endcap, floor, port endcap, hub. */
  readonly profile: Profile;
  /** Apparent gravity at radius r (m/s²), pointing away from the axis. */
  gravityAt(r: number): number;
  /** Air pressure at radius r (Pa), in the rotating, isothermal atmosphere. */
  pressureAt(r: number): number;
  /** How far antispinward something dropped from height h above the floor lands from the point straight below (m). */
  dropOffset(h: number): number;
}

/** Turn parameters into a habitat. Throws on parameters that make no habitat at all (see `validate` for the rest). */
export function derive(p: HabitatParams): Habitat {
  const R = p.radius, L = p.length, g = p.floorGravity;
  if (!(R > 0) || !(L > 0) || !(g > 0)) throw new Error(`derive: radius, length and gravity must be positive (got R=${R}, L=${L}, g=${g})`);
  const spin = Math.sqrt(g / R);
  const period = (2 * Math.PI) / spin;
  const ly = p.layers;

  const surface = R;
  const ceilingDeck = surface + ly.soilMax;
  const living = ceilingDeck + ly.ceilingDeck;
  const floorDeck = living + ly.living;
  const service = floorDeck + ly.floorDeck;
  const hull = service + ly.service;
  const paddingThickness = p.shieldingDensity / p.paddingDensity;

  // Hoop stress of a thin spinning shell: σ = (p_air + m g) r / t, where m includes the hull's own ρ t.
  // Solve σ_allow = SF (p + (m_ext + ρ t) g_h) r / t for t; no t exists when ρ g_h r SF reaches σ_allow.
  const gHull = spin * spin * hull;
  const sf = p.hull.safetyFactor, rho = p.hull.density, sigma = p.hull.strength;
  const externalLoad = p.air.floorPressure + (p.interiorLoad + p.shieldingDensity) * gHull;
  const denom = sigma - rho * gHull * hull * sf;
  const hullThickness = denom > 0 ? (externalLoad * hull * sf) / denom : NaN;
  const hullStress = sigma / sf;
  // Max radius: ρ ω² r² SF = σ with ω² = g / R and r ≈ R (the hull's own weight alone).
  const maxRadius = sigma / (rho * g * sf);

  const padding = hull + (Number.isFinite(hullThickness) ? hullThickness : 0);
  const solarSkin = padding + paddingThickness;
  const outer = solarSkin + ly.solarSkin;
  const layers: LayerRadii = { surface, ceilingDeck, living, floorDeck, service, hull, padding, solarSkin, outer };

  const floorArea = 2 * Math.PI * R * L;
  const endcapArea = Math.PI * outer * outer;
  const paddingMass = p.shieldingDensity * (2 * Math.PI * solarSkin * L + 2 * Math.PI * solarSkin * solarSkin);

  const flux = SOLAR_CONSTANT / (p.sunDistanceAu * p.sunDistanceAu);
  const crossSection = p.axisOrientation === 'side-on' ? 2 * outer * L : endcapArea;
  const sunlight = flux * crossSection * p.collectorRatio;
  const solarPower = sunlight * p.solarEfficiency;
  const lightPower = p.lightTarget * floorArea;
  const heat = sunlight;
  const T = p.radiator.temperature;
  const radiatorArea = heat / (p.radiator.emissivity * STEFAN_BOLTZMANN * T * T * T * T);
  const radiatorToEndcaps = radiatorArea / (2 * endcapArea);

  const profile = makeProfile(R, L, p.hubRadius, p.endcaps);
  const Rs = p.air.gasConstant, Tair = p.air.temperature, p0 = p.air.floorPressure;

  return {
    params: p,
    seed: p.seed,
    radius: R,
    length: L,
    spin,
    period,
    rpm: 60 / period,
    floorSpeed: spin * R,
    layers,
    hullThickness,
    hullStress,
    maxRadius,
    paddingThickness,
    floorArea,
    endcapArea,
    paddingMass,
    sunlight,
    solarPower,
    lightPower,
    heat,
    radiatorArea,
    radiatorToEndcaps,
    population: p.population,
    density: p.population / (floorArea / 1e6),
    profile,
    gravityAt: (r) => spin * spin * r,
    // dp/dr = ρ ω² r with ρ = p / (Rs T): p(r) = p0 exp(−ω² (R² − r²) / (2 Rs T)).
    pressureAt: (r) => p0 * Math.exp((-spin * spin * (R * R - r * r)) / (2 * Rs * Tair)),
    dropOffset: (h) => {
      if (!(h > 0)) return 0;
      const hh = Math.min(h, R * (1 - 1e-9)); // from the axis itself it never lands
      // Released at r = R − h with the floor's angular speed, it flies straight; meanwhile the floor turns ahead.
      const x = Math.sqrt(2 * R * hh - hh * hh) / (R - hh);
      return R * (x - Math.atan(x));
    },
  };
}

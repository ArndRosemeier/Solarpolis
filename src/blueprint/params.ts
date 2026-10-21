/**
 * The inputs of a habitat: everything a cylinder is made from, and nothing derived. Every number any other code
 * uses about a habitat comes from these through `derive` (./derive.ts). Units are SI throughout (m, s, kg, Pa, K, W),
 * except `sunDistanceAu` (astronomical units) and `age` (years).
 */

/** The layers under the surface, from the soil down to the outer skin (metres). The hull is derived, not given. */
export interface LayerDepths {
  /** Soil over the ceiling deck: the thinnest and the deepest (pockets for big trees). */
  soilMin: number;
  soilMax: number;
  /** The structure carrying the soil; its underside is the living layer's ceiling screen. */
  ceilingDeck: number;
  /** Clear height of the living layer. */
  living: number;
  floorDeck: number;
  /** Transit, freight, fabrication, farms, compute, water storage. */
  service: number;
  /** The outermost layer: solar panels and sunlight collectors. */
  solarSkin: number;
}

/** What the pressure hull is made of. Its thickness follows from the load (see `derive`). */
export interface HullMaterial {
  density: number; // kg/m³
  /** Allowable working stress before the safety factor (Pa). */
  strength: number;
  safetyFactor: number;
}

/** The shape of the endcap mountains: how far each one reaches into the floor, and how it rises to the axis. */
export interface EndcapShape {
  /** How far the slope's foot reaches along the axis from the endcap wall, as a fraction of the radius. */
  reach: number;
  /** Rise curve exponent: height above the floor = R * u^rise, u going 0 at the foot to 1 at the wall. */
  rise: number;
}

export type AxisOrientation = 'side-on' | 'end-on';

export interface HabitatParams {
  /** Floor radius R: from the axis to the mean ground surface (m). */
  radius: number;
  /** Floor length L between the two endcap walls (m). */
  length: number;
  /** Apparent gravity at the floor (m/s²). Sets the spin. */
  floorGravity: number;
  sunDistanceAu: number;
  axisOrientation: AxisOrientation;
  air: {
    /** Pressure at the floor (Pa). */
    floorPressure: number;
    /** Mean air temperature (K), for the pressure profile. */
    temperature: number;
    /** Specific gas constant (J/(kg K)); 287 for Earth air. */
    gasConstant: number;
  };
  layers: LayerDepths;
  hull: HullMaterial;
  /** Mass the hull carries from inside: soil, decks, water and contents (kg/m² of floor). */
  interiorLoad: number;
  /** Cosmic-ray shielding needed at this location (kg/m²), carried as asteroid rubble outside the hull. */
  shieldingDensity: number;
  /** Bulk density of the packed rubble (kg/m³), for the padding's thickness. */
  paddingDensity: number;
  /** Extra collector or mirror area per unit of sunlit hull area (1 = none extra). */
  collectorRatio: number;
  /** Fraction of collected sunlight turned into electricity. */
  solarEfficiency: number;
  /** Visible light the sunline delivers to the floor, as a daily mean (W/m²). */
  lightTarget: number;
  /** The endcap radiators: emissivity and working temperature (K). */
  radiator: { emissivity: number; temperature: number };
  /** Radius of the non-rotating dock hub at the port end's axis (m). The wild end climbs to the axis itself. */
  hubRadius: number;
  /** Radius of the sunline, the light tube along the axis (m). It ends in the dock hub, so it is thinner than the hub. */
  sunlineRadius: number;
  endcaps: { wild: EndcapShape; port: EndcapShape };
  /** The climate and biome profile, by name (catalogue comes with the ecology stage). */
  climate: string;
  population: number;
  /** Years since the habitat was finished: drives history (rebuilds, abandoned chambers, overgrowth). */
  age: number;
  /** The culture profile, by name (catalogue comes with the macro layout stage). */
  culture: string;
  /** Same parameters and same seed give the same habitat. */
  seed: number;
}

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

/**
 * The land's relief. Hills and lakes are built: the ceiling deck rises under a hill and dips under a lake, and the
 * living layer below follows it, so relief is not limited by the soil's depth (Arnd's decision card, 2026-10-21).
 */
/**
 * The day of the travelling sun: the sunline's brightest stretch moves from the wild end to the port end over the
 * daylight hours, so shadows move and mornings have a direction; at night the whole tube dims.
 */
export interface DayCycle {
  /** One day (s). */
  length: number;
  /** Share of the day the sunline is lit (0 … 1). */
  daylight: number;
  /** Width of the bright stretch, as a share of the habitat's length (one standard deviation). */
  peakWidth: number;
  /** Share of the daytime light the whole tube gives evenly, the rest is the bright stretch (0 … 1). */
  base: number;
  /** Night light, as a share of the daytime mean (0 … 1). */
  night: number;
}

export interface Relief {
  /** The highest hills on the floor, above the mean surface (m). */
  hills: number;
  /** The ring lake around the whole floor: its width along the axis and its depth (m); null for none. */
  ringLake: { width: number; depth: number } | null;
  /** Height of one terrace step on the endcap slopes (m). */
  terraceStep: number;
}

export type AxisOrientation = 'side-on' | 'end-on';

/**
 * The outside: radiator brims, the despun dock spindle and the wild end's mast (design "Solarpolis: the outside").
 * Brims are flat rings around the endcaps, in the endcap's plane: the only radiator that keeps its edge to the Sun at
 * every angle of spin. When one ring per end is not enough, more are stacked inward along the drum.
 */
export interface ExteriorShape {
  /** The largest brim tip radius, as a multiple of the outer radius. */
  brimReach: number;
  /** Gap between stacked brims along the axis, as a multiple of the outer radius. */
  brimSpacing: number;
  /** The most brims one end may carry. */
  maxBrims: number;
  brimThickness: number;
  /** What the brims are made of: a light, strong composite, since their tips move faster than the hull. */
  brimMaterial: HullMaterial;
  /** How far the despun spindle reaches out from the port endcap, as a multiple of the outer radius. Its radius is `hubRadius`. */
  spindleLength: number;
  /** How far the wild end's maintenance mast reaches out, as a multiple of the outer radius. */
  mastLength: number;
  /** Berth arms on the spindle. */
  berthArms: number;
  /** Torch ships cut their drive this far out (in outer radii): their exhaust would scorch the skin. */
  keepOut: number;
  /** Edge of one skin panel (m): the solar skin is a grid of panels this size around and along the drum. */
  panel: number;
  /** A repair campaign renews a patch of the skin this many panels around and along at once. */
  campaign: { around: number; along: number };
  /** Mean working life of a skin panel (years): the older a repair campaign, the more of its panels were swapped since. */
  panelLife: number;
  /** Share of the solar panels that are starfloor windows: rooms in the living layer looking out through the hull. */
  starfloors: number;
  /**
   * Maintenance drones that swap panels and clean glass, each running back and forth along its own stretch of a track
   * laid in the seam between two columns of panels: a track every `trackEvery` columns, a drone every `spacing` m
   * of track, each `size` m long, moving at about `speed` m/s.
   */
  drones: { trackEvery: number; spacing: number; size: number; speed: number };
  /** Antennas: how many dishes the spindle's tip carries, and the largest one's diameter as a multiple of `hubRadius`. */
  antennas: { count: number; dish: number };
  /**
   * What a panel is made of up close: solar modules about `module` m a side (each panel holds a whole number of them
   * around and along), each a grid of cells about `cell` m a side. Light collectors hold lenses in the cells' place.
   * The spindle's plating, and the dishes' petals, are about `plate` m a side; `handrail` is how high handrails stand
   * for people working outside (m), the one human-scale size of the hardware.
   */
  parts: { module: number; cell: number; plate: number; handrail: number };
}

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
  /** Share of the sunline's light that is sunlight piped in from the collectors (0–1); the rest is made from electricity. */
  pipedLight: number;
  /** Share of the visible sunlight falling on a collector strip that reaches the sunline through the light pipes (0–1). */
  collectorEfficiency: number;
  /** The endcap radiators: emissivity and working temperature (K). */
  radiator: { emissivity: number; temperature: number };
  /** Radius of the non-rotating dock hub at the port end's axis (m). The wild end climbs to the axis itself. */
  hubRadius: number;
  /** Radius of the sunline, the light tube along the axis (m). It ends in the dock hub, so it is thinner than the hub. */
  sunlineRadius: number;
  endcaps: { wild: EndcapShape; port: EndcapShape };
  relief: Relief;
  day: DayCycle;
  exterior: ExteriorShape;
  /** The climate and biome profile, by name (`CLIMATES` in climates.ts; laid out by the ecology stage). */
  climate: string;
  population: number;
  /** Years since the habitat was finished: drives history (rebuilds, abandoned chambers, overgrowth). */
  age: number;
  /** The culture profile, by name (catalogue comes with the macro layout stage). */
  culture: string;
  /** Same parameters and same seed give the same habitat. */
  seed: number;
}

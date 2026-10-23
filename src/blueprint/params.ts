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

/**
 * The cloud layer: a slab of air a kilometre or two above the floor where the habitat lets clouds form, on a schedule
 * of its own choosing (every shower is a choice). Seen from the floor: their undersides overhead, their sunlit tops on
 * the far side of the axis, and their shadows drifting over the land.
 */
export interface CloudLayer {
  /** How high the clouds' flat bases are above the floor, and how thick the layer is (m). */
  base: number;
  thickness: number;
  /** How much of the sky they cover on an average day (0 … 1). The schedule varies it by hour and by day. */
  cover: number;
  /** How wide one cloud is, about (m). */
  size: number;
  /** The wind that carries them along the axis and around it (m/s). */
  wind: { along: number; around: number };
}

/**
 * The landmarks: the few buildings on a surface that is otherwise park, at most one to a district, each one seen from
 * across the habitat and so a way to find one's bearings. `size` is how wide the largest one is (m); `handrail` is how
 * high a railing stands, the one human size, from which steps, seats, posts and benches follow (m).
 */
export interface Landmarks {
  size: number;
  handrail: number;
}

export interface Relief {
  /** The highest hills on the floor, above the mean surface (m). */
  hills: number;
  /** The ring lake around the whole floor: its width along the axis and its depth (m); null for none. */
  ringLake: { width: number; depth: number } | null;
  /** Height of one terrace step on the endcap slopes (m). */
  terraceStep: number;
  /**
   * How far the endcaps' big landforms stand out of the slope (m): the Mountain's spurs between its couloirs, its
   * summit horn and its cirque, the Gate's buttresses between its faces (gen/terrain.ts).
   */
  massif: number;
  /**
   * Rivers from springs on the endcaps into the ring lake: how many (half from each end), their width at the mouth and
   * their depth (m); null (or no lake) for none.
   */
  rivers: { count: number; width: number; depth: number } | null;
  /**
   * The big landforms the habitat mind built on the floor (design "Shaped ground", Arnd 2026-10-22): the Rings, ridges
   * running round the whole cylinder across its axis, `ringEvery` radii apart along it and at most `ring` radii high;
   * and `heights` lone mounts on the ridges between the valleys, the tallest `height` radii high. Absent or null: none.
   * Built hollow (the living layer's great halls stand in them) and placed by the plan (gen/plan.ts, `grounds`).
   * Inside that frame each district shapes its own ground in its style (gen/works.ts): the tallest of those works is
   * `works` radii high. The wild grows bolder natural relief: up the valleys' sides the hills stand `wild` times
   * higher again where the land is let be (the reserve, care 0). Absent: no works, no wilder relief. And `signature`
   * signature works, made by the habitat's people together (0 … 3: the Spiral, the Wave Field, the Tilt, in turn; sized
   * as shares of the radius, `SIGNATURE_KINDS`). Absent: none. The rooms between the Rings step down toward the lake,
   * `fall` of a Ring's height at each on average (both ends of the floor stand equally high over the lake, so a side
   * with fewer Rings has taller steps), so every river falls through each Ring's gorge. Absent: level rooms.
   */
  landforms?: { ring: number; ringEvery: number; height: number; heights: number; works?: number; wild?: number; signature?: number; fall?: number } | null;
  /**
   * The lakes on the floor besides the ring lake (gen/plan.ts, `meres`; Arnd 2026-10-23): the great lake where the great
   * river leaves the Mountain's foot, `great.length` radii along the axis and `great.width` radii around it (null: none),
   * and `count` smaller lakes in the rooms between the Rings, `size` radii across on average. Each is `depth` of its
   * width deep. Absent or null: none.
   */
  lakes?: { great: { length: number; width: number } | null; count: number; size: number; depth: number } | null;
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
  /**
   * The bore people cross into the spin by, on the axis from the berth arms through the bearing at the port face to
   * the Hub: its radius as a share of `hubRadius`.
   */
  bore: number;
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

/**
 * The habitat's plan for its land (gen/plan.ts): the big shapes its mind decided on before anything grew. Valleys run
 * along the axis, evenly round it, with ridges between; the wild end of the floor is a reserve; the rest is cut into
 * districts, one above each neighbourhood of the living layer, each shaping its commons in a style of the habitat's
 * culture, with entrances down to the people living below.
 */
export interface LandPlan {
  /** Long valleys along the axis, evenly round it, with a ridge between each two (a whole number, at least 1). */
  valleys: number;
  /** Share of the floor's length, from the wild end, that is the reserve: no districts, only trails (0 … 0.9). */
  reserve: number;
  /** About how many people live under one district; with the population it sets how many districts there are. */
  districtPeople: number;
  /** About how far apart the entrances down to the living layer lie (m): how far people walk to reach one. */
  entranceSpacing: number;
  /**
   * How far the valleys turn spinward as they climb the endcaps, from the foot to the axis (radians). Water running down
   * an endcap is pushed against the spin (Coriolis), so its channels, and the valleys that carry them, spiral.
   */
  spiral: number;
  /**
   * How wide the paths are (m): the Sunwalk (the habitat's processional way, walked by crowds at its festivals), the
   * ways between the entrances, and the trail up the Mountain. Human sizes: they do not grow with the habitat.
   */
  pathWidth: { sunwalk: number; way: number; trail: number };
  /**
   * How big the planted places are (m, gen/places.ts): an orchard block's length near an entrance, and how wide one
   * parcel of the Vine face's terraces is around the axis (vines, an orchard or meadow); how long a grown hall's nave is
   * (gen/planted.ts, at least three bays). Human sizes, like the paths.
   */
  places: { orchard: number; parcel: number; hall: number };
}

/**
 * The Understorey: the living layer under the land (design "The Understorey: life below the land", 2026-10-22). The land
 * rests on pillars on a grid of bays; each pillar fans out into vault ribs that carry the ceiling deck, and every place
 * below (a home, a hall, a cistern, an empty bay) is that one structure filled differently. Under each entrance court
 * lies a hamlet: its wellhead under the court's light well, a ring of halls, then homes in lanes; galleries follow the
 * land's ways from hamlet to hamlet; cisterns hold the water the habitat moves to keep its spin balanced; the rest is the
 * Dim, open pillar forest. Sizes are structural (the bay) or human (households): they do not grow with the habitat.
 */
export interface Understorey {
  /** Distance between pillar centres, around the axis and along it (m). */
  bay: number;
  /** What the pillars are cast from: its density, crushing strength, stiffness (Pa) and safety factor. */
  stone: { density: number; strength: number; modulus: number; safetyFactor: number };
  /** What one square metre of the ceiling deck carries: soil, water, roots and the deck itself (kg/m²). */
  land: number;
  /** Where the vault ribs spring from a pillar, as a share of the living layer's height (0 … 1). */
  spring: number;
  /** People in a household, on average, and how many bays one household's home takes. */
  household: { people: number; bays: number };
  /** Bays of halls round each wellhead for every bay of homes. */
  halls: number;
  /** Every this-many bay lines through a hamlet's homes stays open as a lane (a whole number, at least 2). */
  lanes: number;
  /** Share of the layer under the worked floor (outside the hamlets, galleries and the lake) that is cisterns (0 … 1). */
  cisterns: number;
  /**
   * The steepest the layer's floor may climb (rise per run): it follows the land's shape (`relief`), and where the land
   * is steeper, its ceiling is set deeper (more soil over it) so the floor below stays this gentle.
   */
  grade: number;
  /** The lamps' light on the floor below, as a share of the daylight on the open land at midday (0 … 1). */
  lamp: number;
  /** The air below is moist and still: over this many metres it keeps only a quarter of the light through it (m). */
  mist: number;
  /** Ceiling display modules: width, height and the dark joint between them (m). */
  screen: { width: number; height: number; joint: number };
}

/**
 * Who goes up on the land, and how (src/sim; design "Who is out on the land", 2026-10-22). Nobody is simulated: each
 * resident's outings are derived from the seed and the clock. People come up from the living layer at the entrance
 * nearest where they want to be (the city below has its own transit), walk the paths, stay a while and go back down.
 * Shares are of the residents or of their outings; the walking speed and how far people go from their court are human
 * sizes and do not grow with the habitat.
 */
export interface Life {
  /** How often a resident goes up on the land: the chance on any one day (0 … 1). */
  outings: number;
  /** How long an outing lasts on average, from the court back down (s). */
  stay: number;
  /**
   * How long people stay on average when the court they came up at is where they meet (s): the courts are the
   * entrances to the living layer, places of coming and going, not of whole afternoons.
   */
  pause: number;
  /**
   * How many go up together: the share of parties of one, two, three … people (they sum to 1). A party comes up
   * together, walks together and stands or sits together at its place.
   */
  parties: number[];
  /** Share of residents who keep a rhythm: the same weekdays, the same hour, the same place near home (0 … 1). */
  regulars: number;
  /** Share of outings that walk the Sunwalk with the bright stretch, for hours (0 … 1). */
  sunwalk: number;
  /** Share of outings made at night (stargazers, a late hearth) (0 … 1). */
  night: number;
  /** Share of bodies that are shells: plated humanoid bodies, worn by minds or by people from elsewhere (0 … 1). */
  shells: number;
  /** Share of beings who are minds. Never shown by their bodies (0 … 1). */
  minds: number;
  /** How fast people walk (m/s). */
  walk: number;
  /** How far from the court they came up at people usually go (m). */
  reach: number;
  /** The drones that work the land (sim/air.ts), and the share of residents who wear a drone's body. */
  drones: Drones;
  /** The animals that live on the land (sim/fauna.ts). */
  animals: Animals;
  /** The birds of the land (sim/birds.ts). */
  birds: Birds;
  /** How people talk: silent speech bubbles over those near (src/talk). */
  talk: Talking;
  /** The boats sailed on the habitat's water (sim/sailing.ts). */
  sailing: Sailing;
  /** The transport capsules anyone calls through the neural link (world/capFlight.ts, gen/capsules.ts). */
  caps: Caps;
  /** How nobody is hurt by a fall: the Mind foresees it, the guardians catch it (world/fall.ts, world/catch.ts). */
  guard: Guard;
}

/**
 * How the habitat keeps anyone from being hurt by a fall (design "Nobody falls far", Arnd 2026-10-23: no security
 * against deep falls is unrealistic in such a future). The land keeps its cliffs open; its Mind foresees every fall
 * from the same forces the physics uses, and a fall that would land faster than `harm` m/s into the ground (across it;
 * `water` times that into water) is caught by the guardians posted along the drops, one per `posts` m: `hands` of them
 * fly to meet the body (at most `speed` m/s, their fans pushing at most `thrust` m/s² beyond holding them up), fall
 * with it, take hold, slow it by at most `brake` floor gravities as felt, and carry it back to stand at `carry` m/s.
 * The Long Drop is caught late: `late` (a share of the radius) over the ground. Where no guardian is close enough to
 * catch a fall gently, the last resort (Arnd, 2026-10-23: "an airbag, out of the ground"): the ground under where it
 * lands bursts a bag up to `bag` m tall, which stops the body at about `cushion` floor gravities as felt.
 */
export interface Guard {
  harm: number;
  water: number;
  brake: number;
  speed: number;
  thrust: number;
  carry: number;
  posts: number;
  hands: number;
  late: number;
  bag: number;
  cushion: number;
}

/**
 * The transport capsules (Arnd 2026-10-23: call a cap through the neural link, choose where to go, no steering): small
 * glass pods flown by tiny minds on four ducted fans. A called cap comes from about `call` m away and sets down on open
 * ground within `reach` m of the one who called it (or of where they go). Along its way it keeps at most `cruise` m/s,
 * `climb` m/s up from a pad and down onto one, at most `accel` m/s² along its way (eased into over `ease` s, never at
 * once) and `turn` m/s² across it, at least
 * `over` m over the ground and the crowns, and at least `axis` (a share of the radius) from the axis and the sunline on
 * it. It flies as fast as is comfortable: what its passenger feels stays under `comfort` times the floor's gravity
 * (flying spinward makes one heavier), and its floor banks into what they feel by at most `tilt` radians from true up.
 */
export interface Caps {
  cruise: number;
  climb: number;
  accel: number;
  ease: number;
  turn: number;
  over: number;
  axis: number;
  comfort: number;
  tilt: number;
  call: number;
  reach: number;
}

/**
 * The boats on the habitat's water (Arnd 2026-10-23: sail boats, slick and futuristic, on the lakes and the ring lake):
 * how many per km² of water, the chance a boat goes out on a day (fewer in a calm or a gale), and how long it is out on
 * average (s).
 */
export interface Sailing {
  boats: number;
  outings: number;
  stay: number;
}

/**
 * The birds of the land (thread "Birds in the interior"), each a pure function of the seed, the land and the clock.
 * Songbirds hold territories in the woods round trees the scatter really planted (gen/scatter.ts): they feed on the
 * ground or in the bushes, sing from their song posts (the dawn chorus as the light comes up over them) and roost at
 * night. Skylarks live on the open meadows and sing high over them; tawny owls hunt the woods at night.
 */
export interface Birds {
  /** Songbird territories per hectare where the crowns close over the ground (blackbirds, robins, wrens, thrushes, woodpeckers, wood pigeons). */
  woods: number;
  /** How far a songbird's territory reaches from its home tree (m). */
  territory: number;
  /** Skylarks per hectare of open meadow. */
  larks: number;
  /** Tawny owls per km² of woods. */
  owls: number;
  /**
   * The birds of the air, each flock a pure function of the seed and the clock too: barn swallows nesting under each
   * arch and timber bridge (how many to a bridge), hawking low over the river and the meadows round it; swifts nesting
   * in the walls of the Lift Stair (how many), feeding high over the floor by day, screaming round the stair at dusk
   * and sleeping on the wing near the axis; starlings roosting in the woods by each lake (how many to a roost), out
   * feeding in parties by day and gathering over the water at dusk in a murmuration before they drop in to roost.
   */
  swallows: number;
  swifts: number;
  starlings: number;
}

/**
 * How people talk (design "Speech bubbles: how people talk in Solarpolis", Arnd 2026-10-23: no voices, no murmur,
 * speech bubbles). A party that stops to talk holds a conversation; its words show over the speaker near the eye, a
 * small bubble farther out says someone is speaking, and beyond that the gestures carry it.
 */
export interface Talking {
  /** How far from the eye a speaker's words show (m). */
  words: number;
  /** How far a bubble without words still shows that someone speaks (m; at least `words`). */
  dots: number;
  /** How many parties show their words at once, the nearest first. */
  parties: number;
  /** How fast people read (characters per second): a bubble stays as long as it takes, within bounds. */
  read: number;
  /** How long a party falls quiet between two conversations, on average (s). */
  quiet: number;
}

/**
 * The animals that live on the land (design "Who is out on the land"), each a pure function of the seed, the land and
 * the clock, like the people. Squirrels live in the woods: each has a home tree (a tree the scatter planted, gen/scatter.ts),
 * comes down from it in the bright hours and forages round it. Deer live in herds on the wild land (sim/herds.ts).
 */
export interface Animals {
  /** Squirrels per hectare where the crowns close over the ground (fewer where they open up; none outside the woods). */
  squirrels: number;
  /** How far a squirrel goes from its home tree (m). */
  range: number;
  /** The share of a place's bright hours its squirrels are down on the ground, round the hour the light peaks there (0 … 1). */
  out: number;
  /**
   * Deer per km² of the land left to them: the wild reserve and the districts kept for herds or let go. They live in
   * herds, out on the open ground at dawn and dusk and lying up in the woods round noon and at night.
   */
  deer: number;
  /** How many deer a herd has, on average. */
  herd: number;
  /** How far a herd ranges from its home (m). */
  roam: number;
}

/**
 * The drones that work the land (design "Who is out on the land": each a small mind with a job, built from Actors'
 * drone kit). How many of each role, by what there is to do:
 *
 *   couriers   per entrance court: they carry food, wine and parcels from it to the places around it and back;
 *   tenders    per orchard block, and as many per row of the Vine face's parcels: they prune and pick beside people;
 *   surveyors  per hike point of the reserve, and at the Mountain's flight launch: they circle, map and measure;
 *   lifters    at the Gate, bringing loads down its face from the hub, and one per makers' commons, moving stone;
 *   gliders    per km of the floor's length: they ride the still, thin air near the axis;
 *   guardians  per km of the ring lake's shores, and at the flight launch: they hover, ready to catch a flyer or a swimmer;
 *   watchers   per place people go: the habitat Mind's eyes, small camera drones with one big lens, hovering a while over
 *              the people there, then moving on (design "Nobody falls far": how the Mind sees a fall coming).
 *
 * And persons: residents who wear a drone's body (`persons`), out on the land as anyone is, in their parties and at
 * their places, at the height of the faces they talk to. Their bodies are their own designs (`bodies` of them), the
 * `person` role's kit. (Small tool drones, a tender's pruner or a lifter's grab, are part of their drone, never persons.)
 */
/** The drones' roles, in the order the fleet and the designs list them (sim/air.ts, gen/drone.ts). */
export const DRONE_ROLES = ['courier', 'tender', 'surveyor', 'lifter', 'glider', 'guardian', 'watcher', 'person'] as const;
export type DroneRole = (typeof DRONE_ROLES)[number];

export interface Drones {
  couriers: number;
  tenders: number;
  surveyors: number;
  lifters: number;
  gliders: number;
  guardians: number;
  watchers: number;
  /** How fast they cruise (m/s). */
  cruise: number;
  /** How high the couriers' lanes run over the ground (m), clear of the trees. */
  lane: number;
  /** How long a courier's round lasts (s): up, out to a place near its court, a stop, back, and a rest on its pad. */
  round: number;
  /** How many designs each working role is built in (each made once from the kit, a whole number, at least 1). */
  designs: number;
  /** Share of residents whose body is a drone (0 … 1, with `shells` at most all of them). */
  persons: number;
  /** How many drone bodies residents wear, each its own design of the `person` kit (a whole number, at least 1). */
  bodies: number;
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
    /**
     * How clear the air is: across this much air at floor density only a quarter of a surface's light gets through (m).
     * A designed habitat filters its air far cleaner than a city's; the far side then reads clearly across the axis.
     */
    hazeDistance: number;
    /**
     * The breeze over the floor (world/wind.ts): the habitat's own ventilation, a prevailing wind along the axis and
     * around it (m/s, around positive spinward), how much it gusts (a share of its mean, 0 … 1), and how strongly the
     * land under the sunline's bright stretch draws the air along the axis toward it as it warms (m/s at the most).
     */
    wind: { along: number; around: number; gust: number; sun: number };
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
  /** The cloud layer, or null for a sky without clouds (too small a habitat for them, or none wanted). */
  clouds: CloudLayer | null;
  /** The landmarks' scale, or null for a habitat with none. */
  landmarks: Landmarks | null;
  day: DayCycle;
  exterior: ExteriorShape;
  /** The climate and biome profile, by name (`CLIMATES` in climates.ts; laid out by the ecology stage). */
  climate: string;
  population: number;
  /** The living layer under the land: its pillars, hamlets, galleries and cisterns (gen/under.ts). */
  under: Understorey;
  /** Who goes up on the land, how often and for how long (src/sim). */
  life: Life;
  /** Years since the habitat was finished: drives history (rebuilds, abandoned chambers, overgrowth). */
  age: number;
  /** The plan for the land: valleys, the reserve, districts and their entrances (gen/plan.ts). */
  plan: LandPlan;
  /** The culture, by name (`CULTURES` in cultures.ts): the styles its districts shape their commons in. */
  culture: string;
  /** The habitat's steward Mind, whose name is the habitat's own (the arrival's welcome shows it). */
  mind: string;
  /** Same parameters and same seed give the same habitat. */
  seed: number;
}

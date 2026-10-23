/** The space around the habitats (pure): clock, ephemeris, frames, the Necklace. See space.ts. */
export { AU, DAY, EARTH, MOON, SUN, JD_J2000 } from './constants';
export { julianDay, calendarOf, jdAt, centuries } from './time';
export { IDENTITY, rotX, rotZ, mul, transpose, apply, compose, invert, type Mat3, type Pose } from './pose';
export { barycentreAt, earthAt, moonAt, moonFromEarthAt, earthAxesAt, eclipticAxesAt, siderealTimeAt, obliquityAt, precessionAt } from './ephemeris';
export { FrameTree, type Frame } from './frames';
export { necklace, geostationaryRadius, type NecklaceParams, type Placement } from './necklace';
export { makeSpace, type Space, type SpaceParams, type PlacedHabitat } from './space';
export { REFERENCE_SPACE } from './reference';
export { decodeStars, fluxOfMagnitude, temperatureOfColorIndex, colorOfTemperature, SUN_MAGNITUDE, type StarField } from './stars';
export { SpaceFlyer, MIN_CLEARANCE, MAX_RANGE, type FlyInput } from './flyer';
export { skyFrom, sunlightFrom, circleOverlap, type SkyView, type SkyBody } from './sky';
export { attractLoop, chooseStart, arrival, hubView, SHOTS, LOOP, ARRIVAL, ARRIVAL_SHOTS, SPIN_UP, LIT_FROM, LIT_TO, type Arrival, type ArrivalFrame, type ArrivalMoments, type Cinema, type Frame as CinemaFrame } from './cinema';
export { torchShip, sailShip, shipShape, deriveShip, partSpan, SHIP_DESIGN, TORCH_SHIP, ROLE_ALBEDO, type Drive, type ShipParams, type ShipPart, type ShipShape, type ShipRole } from './ship';
export { approachOf, berthOf, shipAt, trafficAt, guestShip, guestVisit, arrivalTime, beforeBerth, slotLength, visitIn, visitsAt, DOCK_SPEED, FINAL_LENGTHS, TORCH_SHOWN, TURN, type Approach, type Phase, type ShipNow, type TrafficParams, type Visit } from './traffic';
export { hullLightsOf, shipLightsOf, lampHidden, shineAt, lampFlux, LIGHTS, LIGHT_COLOUR, SUN_LUX, type Blink, type HullLight, type LightFrame } from './lights';
export { arrivalScore, captionAt, MIND_LINES, SHIP_BEDS, type ArrivalScore, type Caption, type ScoreCue, type ShipBed } from './arrivalScore';
export { CLAMPS, CLAMP_CLUNKS, CLAMP_SWING, DOCK, FLOODS, RELEASE, SEALED, SIGNALS, berthDockOf, clampPose, closedSwing, dockAt, dockLightsAt, dockShows, reachAt, signalBlink, signalColour, signalSpoke, umbilicalPath, UMBILICAL, type Berth, type DockNow, type Signal } from './dock';
export { INSPECTORS, INSPECTOR_SIZE, TUG_HOLD, TUG_TRANSIT, craftAt, craftShape, inspectorsAt, tugCradle, tugLength, tugsAt, type CraftKind, type CraftNow } from './portCraft';

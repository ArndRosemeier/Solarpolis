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
export { attractLoop, chooseStart, arrival, hubView, SHOTS, LOOP, ARRIVAL, ARRIVAL_SHOTS, SPIN_UP, LIT_FROM, LIT_TO, type Arrival, type ArrivalFrame, type Cinema, type Frame as CinemaFrame } from './cinema';
export { torchShip, sailShip, shipShape, deriveShip, SHIP_DESIGN, TORCH_SHIP, type Drive, type ShipParams, type ShipPart, type ShipShape, type ShipRole } from './ship';
export { berthOf, shipAt, trafficAt, guestShip, guestVisit, arrivalTime, beforeBerth, slotLength, visitIn, visitsAt, DOCK_SPEED, FINAL_LENGTHS, TORCH_SHOWN, TURN, type Phase, type ShipNow, type TrafficParams, type Visit } from './traffic';

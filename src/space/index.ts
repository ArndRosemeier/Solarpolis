/** The space around the habitats (pure): clock, ephemeris, frames, the Necklace. See space.ts. */
export { AU, DAY, EARTH, MOON, SUN, JD_J2000 } from './constants';
export { julianDay, jdAt, centuries } from './time';
export { IDENTITY, rotX, rotZ, mul, transpose, apply, compose, invert, type Mat3, type Pose } from './pose';
export { barycentreAt, earthAt, moonAt, moonFromEarthAt, earthAxesAt, eclipticAxesAt, siderealTimeAt, obliquityAt, precessionAt } from './ephemeris';
export { FrameTree, type Frame } from './frames';
export { necklace, geostationaryRadius, type NecklaceParams, type Placement } from './necklace';
export { makeSpace, type Space, type SpaceParams, type PlacedHabitat } from './space';
export { REFERENCE_SPACE } from './reference';

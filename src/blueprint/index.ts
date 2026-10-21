/** The habitat blueprint: parameters in, a derived habitat out. Pure; the root every other layer builds on. */
export type { HabitatParams, LayerDepths, HullMaterial, EndcapShape, AxisOrientation, Relief, DayCycle } from './params';
export { derive, SOLAR_CONSTANT, STEFAN_BOLTZMANN, type Habitat, type LayerRadii } from './derive';
export { makeProfile, type Profile, type ProfilePoint } from './profile';
export { toWorld, fromWorld, toView, groundNormal, wrapAngle, type Interior, type Vec3 } from './frame';
export { validate, isValid, COMFORT_RPM, FLYABLE_AXIS_PRESSURE, HAZE_DIAMETER, BIG_FINS, THICK_HULL, type Finding, type Severity } from './validate';
export { REFERENCE, MATRIX, withParams } from './reference';

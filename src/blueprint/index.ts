/** The habitat blueprint: parameters in, a derived habitat out. Pure; the root every other layer builds on. */
export type { HabitatParams, LayerDepths, HullMaterial, EndcapShape, AxisOrientation, Relief, DayCycle, ExteriorShape } from './params';
export { derive, SOLAR_CONSTANT, SUNLIGHT_VISIBLE, STEFAN_BOLTZMANN, type Habitat, type LayerRadii } from './derive';
export { makeExterior, exteriorDistance, type Exterior, type Bore, type Brim, type Piece } from './exterior';
export { makeProfile, type Profile, type ProfilePoint } from './profile';
export { toWorld, fromWorld, toView, groundNormal, wrapAngle, type Interior, type Vec3 } from './frame';
export { validate, isValid, COMFORT_RPM, FLYABLE_AXIS_PRESSURE, BIG_FINS, THICK_HULL, type Finding, type Severity } from './validate';
export { REFERENCE, MATRIX, withParams } from './reference';
export { CLIMATES, PLANT_FORMS, FLOOR_LAYERS, COVER_FORMS, DEBRIS_FORMS, climateOf, type Climate, type BiomeSpec, type PlantSpec, type PlantForm, type FloorLayer, type CoverSpec, type CoverForm, type DebrisSpec, type DebrisForm, type Rgb } from './climates';

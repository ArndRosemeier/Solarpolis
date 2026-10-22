/** The habitat blueprint: parameters in, a derived habitat out. Pure; the root every other layer builds on. */
export type { HabitatParams, LandPlan, LayerDepths, HullMaterial, EndcapShape, AxisOrientation, Relief, CloudLayer, Landmarks, DayCycle, ExteriorShape, Life, Drones, DroneRole, Animals, Understorey } from './params';
export { DRONE_ROLES } from './params';
export { derive, SOLAR_CONSTANT, SUNLIGHT_VISIBLE, STEFAN_BOLTZMANN, type Habitat, type LayerRadii } from './derive';
export { makeExterior, exteriorDistance, berthArmAt, type Exterior, type Bore, type Brim, type Piece } from './exterior';
export { makeProfile, type Profile, type ProfilePoint } from './profile';
export { toWorld, fromWorld, toView, groundNormal, wrapAngle, apart, type Interior, type Vec3 } from './frame';
export { validate, isValid, COMFORT_RPM, FLYABLE_AXIS_PRESSURE, BIG_FINS, THICK_HULL, PILLAR_STOUT, PILLAR_MOST, type Finding, type Severity } from './validate';
export { REFERENCE, MATRIX, withParams } from './reference';
export { CLIMATES, PLANT_FORMS, FLOOR_LAYERS, COVER_FORMS, DEBRIS_FORMS, climateOf, type Climate, type BiomeSpec, type PlantSpec, type PlantForm, type FloorLayer, type CoverSpec, type CoverForm, type DebrisSpec, type DebrisForm, type Rgb } from './climates';
export { CULTURES, DISTRICT_STYLES, FACE_KINDS, STYLE_LAND, cultureOf, type Culture, type DistrictStyle, type FaceKind, type StyleLand, type StyleSpec } from './cultures';

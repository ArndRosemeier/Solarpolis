/** The whole system (pure): the ledger of habitats and polities, light time, and the news (plan "The Whole System"). */
export { C, lightTime, arrivalOf, departureOf } from './light';
export { NAME_STYLES, habitatName, mindName, uniqueName, type NameStyle } from './names';
export { FORMS, ECONOMIES, TIERS, type Form, type Economy, type Tier, type Body, type Orbit, type RegionPlace, type RegionParams, type NewsParams, type SystemParams } from './params';
export { CANON, type CanonPolity, type CanonHabitat } from './polities';
export { makeLedger, meanBodyAt, sunDistance, centreOf, type Ledger, type HabitatRecord, type Polity, type BodyAt, type Reach } from './ledger';
export { newsIn, newsHeard, heardAt, NEWS_KINDS, MOTIONS, OUTCOMES, WINNERS, FLARES, type News, type NewsKind, type Heard, type Motion } from './news';
export { REFERENCE_SYSTEM } from './reference';

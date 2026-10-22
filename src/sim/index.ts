/** The society: who lives in the habitat and what they are doing now, derived from the seed and the clock. Pure. */
export { residentOf, personKey, peopleAt, whereIs, busiestNear, lifeBytes, type Resident, type Person, type Near } from './population';
export { venuesOf, ACTIVITIES, STYLE_ACTIVITY, LANDMARK_SHARE, type Activity, type Venue, type VenueKind, type Venues } from './venues';
export { walksOf, pointAlong, floorGap, sunwalkOf, type Route, type WalkNet } from './walks';
export { shuffleOf, type Shuffle } from './permute';
export { footingOf, postureOf, SWIM_DEPTH, SWIM_WATER, type Footing } from './footing';
export { fleetOf, flierAt, fliersAt, airBytes, ROLES, type Role, type Job, type Flier, type Doing } from './air';
export { densNear, squirrelAt, densBytes, SLOT, HOP, RUN, type Den, type Squirrel, type SquirrelDoing } from './fauna';

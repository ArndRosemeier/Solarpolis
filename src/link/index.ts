/** The player's neural link (pure): what systems offer through it, finding in its lists, and which names it writes. */
export type { LinkService, LinkOffer, LinkChoice, LinkStatus, LinkLine } from './service';
export { LINK_KEY } from './service';
export { choiceMatch, findChoices } from './choices';
export { pickMarks, type ScreenPoint, type Sighting } from './marks';
export { nameUnder, groundUnder, shownOf, shownName, personNamed, POINT_SLACK, type Nameable, type Named, type Shown } from './names';
export { Namer, NAMES_REACH } from './naming';

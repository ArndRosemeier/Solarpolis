/** The reference world: the reference habitat on the geostationary ring, with the clock starting on 1 January 3026. */
import { REFERENCE } from '../blueprint';
import type { SpaceParams } from './space';
import { julianDay } from './time';

export const REFERENCE_SPACE: SpaceParams = {
  epochJd: julianDay(3026, 1, 1),
  home: REFERENCE,
  // Home over 10° E (Europe and Africa below); 24 habitats on the ring, about 11,000 km apart.
  necklace: { count: 24, homeLongitude: (10 * Math.PI) / 180, slotJitter: 0.3, sizeSpread: 2 },
  seed: 1,
};

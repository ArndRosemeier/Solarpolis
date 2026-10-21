/**
 * Physical constants of the real solar system, in SI units. These are facts about the Sun, Earth and Moon, not about a
 * habitat, so they may be constants (habitat numbers come from `HabitatParams` through `derive`).
 */

/** Astronomical unit (m). */
export const AU = 1.495978707e11;
/** Seconds per day. */
export const DAY = 86400;
/** Julian date of J2000.0 (2000-01-01 12:00 TT). */
export const JD_J2000 = 2451545.0;
/** Days per Julian century. */
export const JULIAN_CENTURY = 36525;

export const EARTH = {
  /** Gravitational parameter GM (m³/s²). */
  gm: 3.986004418e14,
  /** Equatorial radius (m). */
  radius: 6.378137e6,
  /** One turn relative to the stars (s). */
  siderealDay: 86164.0905,
};

export const MOON = {
  radius: 1.7374e6,
  /** Moon mass / (Earth mass + Moon mass): how far Earth sits from the Earth–Moon barycentre, as a share of the Moon's distance. */
  barycentreShare: 0.0121505,
};

export const SUN = {
  radius: 6.957e8,
};

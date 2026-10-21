/**
 * Where the Sun, Earth and Moon are, and which way Earth faces, at a Julian date. Pure and analytic, so any time can be
 * asked in any order.
 *
 * Positions are in the heliocentric ecliptic frame of J2000 (x toward the J2000 equinox, z toward the ecliptic north
 * pole), in metres.
 * - Earth–Moon barycentre: Standish's approximate Keplerian elements for 3000 BC – 3000 AD (JPL, "Keplerian Elements
 *   for Approximate Positions of the Major Planets", table 2a). The game runs a few decades past that range, where the
 *   drift is still far below what anyone can see.
 * - Moon: the Astronomical Almanac's low-precision series (about 0.3° and 0.2 Earth radii), given in the ecliptic of
 *   date and turned back to J2000 by the general precession in longitude.
 * - Earth's orientation: mean sidereal time, mean obliquity and precession of the equinox (14° over 1000 years, so the
 *   pole star of 3026 is no longer Polaris). Nutation (under 20") is left out.
 */
import { v3scale, v3sub, v3add, type Vec3 } from '@futuremagic/core';
import { AU, EARTH, JD_J2000, MOON } from './constants';
import { centuries } from './time';
import { mul, rotX, rotZ, type Mat3 } from './pose';

const D = Math.PI / 180;

/** Solve Kepler's equation E − e sin E = M (radians). */
function eccentricAnomaly(M: number, e: number): number {
  let E = M + e * Math.sin(M);
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  return E;
}

/** Inclination and ascending node of Earth's orbit on the J2000 ecliptic (radians). */
function orbitPlaneAt(T: number): { I: number; Omega: number } {
  return { I: (-0.00054346 - 0.01337178 * T) * D, Omega: (-5.11260389 - 0.24123856 * T) * D };
}

/**
 * The ecliptic of date (the plane of Earth's orbit at that time) in J2000 ecliptic axes: x toward its ascending node,
 * z toward its north pole. It drifts by about 0.14° in 1000 years; habitats keep their axis on its pole.
 */
export function eclipticAxesAt(jd: number): Mat3 {
  const { I, Omega } = orbitPlaneAt(centuries(jd));
  return mul(rotZ(Omega), rotX(I));
}

/** Heliocentric position of the Earth–Moon barycentre (m). */
export function barycentreAt(jd: number): Vec3 {
  const T = centuries(jd);
  const a = (1.00000018 - 0.00000003 * T) * AU;
  const e = 0.01673163 - 0.00003661 * T;
  const { I, Omega } = orbitPlaneAt(T);
  const L = 100.46691572 + 35999.37306329 * T;
  const varpi = 102.93005885 + 0.3179526 * T;
  const omega = varpi * D - Omega;
  const M = ((((L - varpi) % 360) + 540) % 360 - 180) * D;
  const E = eccentricAnomaly(M, e);
  const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
  const co = Math.cos(omega), so = Math.sin(omega), cO = Math.cos(Omega), sO = Math.sin(Omega), cI = Math.cos(I), sI = Math.sin(I);
  return [
    (co * cO - so * sO * cI) * xp + (-so * cO - co * sO * cI) * yp,
    (co * sO + so * cO * cI) * xp + (-so * sO + co * cO * cI) * yp,
    so * sI * xp + co * sI * yp,
  ];
}

/** General precession in ecliptic longitude since J2000 (radians): how far the equinox of date has slid west. */
export function precessionAt(jd: number): number {
  const T = centuries(jd);
  return (5028.796195 * T + 1.1054348 * T * T) / 3600 * D;
}

/** Mean obliquity of the ecliptic (radians). */
export function obliquityAt(jd: number): number {
  const T = centuries(jd);
  return (84381.406 - 46.836769 * T - 0.0001831 * T * T + 0.0020034 * T * T * T) / 3600 * D;
}

/** Greenwich mean sidereal time (radians in [0, 2π)): Earth's turn measured from the equinox of date. */
export function siderealTimeAt(jd: number): number {
  const d = jd - JD_J2000, T = centuries(jd);
  const deg = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T;
  return (((deg % 360) + 360) % 360) * D;
}

/** Geocentric position of the Moon (m), J2000 ecliptic axes. */
export function moonFromEarthAt(jd: number): Vec3 {
  const T = centuries(jd);
  const s = (a: number, b: number): number => Math.sin((a + b * T) * D);
  const c = (a: number, b: number): number => Math.cos((a + b * T) * D);
  const lon = 218.32 + 481267.881 * T
    + 6.29 * s(134.9, 477198.85) - 1.27 * s(259.2, -413335.38) + 0.66 * s(235.7, 890534.23)
    + 0.21 * s(269.9, 954397.7) - 0.19 * s(357.5, 35999.05) - 0.11 * s(186.6, 966404.05);
  const lat = 5.13 * s(93.3, 483202.03) + 0.28 * s(228.2, 960400.87) - 0.28 * s(318.3, 6003.18) - 0.17 * s(217.6, -407332.2);
  const parallax = 0.9508 + 0.0518 * c(134.9, 477198.85) + 0.0095 * c(259.2, -413335.38) + 0.0078 * c(235.7, 890534.23) + 0.0028 * c(269.9, 954397.7);
  const r = EARTH.radius / Math.sin(parallax * D);
  const l = lon * D - precessionAt(jd), b = lat * D;
  return [r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b)];
}

/** Heliocentric position of Earth's centre (m). */
export function earthAt(jd: number): Vec3 {
  return v3sub(barycentreAt(jd), v3scale(moonFromEarthAt(jd), MOON.barycentreShare));
}

/** Heliocentric position of the Moon's centre (m). */
export function moonAt(jd: number): Vec3 {
  return v3add(earthAt(jd), moonFromEarthAt(jd));
}

/**
 * Earth's turning frame (x toward Greenwich on the equator, z toward the north pole) written in J2000 ecliptic axes:
 * precession · obliquity · sidereal time.
 */
export function earthAxesAt(jd: number): Mat3 {
  return mul(mul(rotZ(-precessionAt(jd)), rotX(-obliquityAt(jd))), rotZ(siderealTimeAt(jd)));
}

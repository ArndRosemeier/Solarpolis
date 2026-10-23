/** Elliptic two-body orbits, metres and radians, in any orthonormal reference plane. */
import type { Vec3 } from '@futuremagic/core';
import { apply, mul, rotX, rotZ, type Mat3 } from './pose';

export function eccentricAnomaly(mean: number, e: number): number {
  const m = Math.atan2(Math.sin(mean), Math.cos(mean));
  let a = e < 0.8 ? m : Math.sign(m || 1) * Math.PI;
  for (let k = 0; k < 16; k++) {
    const step = (a - e * Math.sin(a) - m) / (1 - e * Math.cos(a));
    a -= step;
    if (Math.abs(step) < 1e-13) break;
  }
  return a;
}

export function ellipseAt(a: number, e: number, mean: number, inclination: number, node: number, peri: number): Vec3 {
  const E = eccentricAnomaly(mean, e);
  return apply(mul(mul(rotZ(node), rotX(inclination)), rotZ(peri)), [a * (Math.cos(E) - e), a * Math.sqrt(1 - e * e) * Math.sin(E), 0]);
}

/** Equatorial plane's ascending node on ICRF, then converted to J2000 ecliptic. */
export function polePlane(ra: number, dec: number): Mat3 {
  const d = Math.PI / 180;
  return mul(rotX(-23.439291111 * d), mul(rotZ((ra + 90) * d), rotX((90 - dec) * d)));
}

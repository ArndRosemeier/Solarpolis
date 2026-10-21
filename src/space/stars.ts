/**
 * The star catalogue (public/sky/stars.bin, see public/sky/CREDITS.md): Hipparcos stars to magnitude 8, as directions
 * in the J2000 ecliptic frame (the space model's root axes), brightness relative to the Sun and colour.
 *
 * Proper motion is not applied yet: the packaged catalogue carries none. Over 1000 years only a handful of nearby
 * stars move visibly (Barnard's Star by about 3°); that comes with a catalogue that has the motions.
 */
import { obliquityAt } from './ephemeris';
import { JD_J2000 } from './constants';
import { rotX, apply } from './pose';

/** The Sun's apparent V magnitude at 1 AU. */
export const SUN_MAGNITUDE = -26.74;

export interface StarField {
  count: number;
  /** Unit directions, xyz per star. */
  dir: Float32Array;
  /** Irradiance relative to the Sun's at 1 AU. */
  flux: Float32Array;
  /** Linear RGB colour per star, luminance 1, the Sun's colour white. */
  color: Float32Array;
  magnitude: Float32Array;
}

/** Irradiance of a star of V magnitude m, relative to the Sun's at 1 AU. */
export function fluxOfMagnitude(m: number): number {
  return Math.pow(10, -0.4 * (m - SUN_MAGNITUDE));
}

/** Effective temperature from the B−V colour index (K), after Ballesteros (2012). */
export function temperatureOfColorIndex(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/** Planck spectral radiance (arbitrary units) at wavelength λ (m) and temperature T (K). */
function planck(lambda: number, T: number): number {
  return 1 / (Math.pow(lambda, 5) * (Math.exp(0.014388 / (lambda * T)) - 1));
}

const BANDS = [610e-9, 550e-9, 465e-9];
const SUN_T = 5778;
const SUN_RGB = BANDS.map((l) => planck(l, SUN_T));

/** Linear RGB of a black body at T, relative to the Sun's colour, scaled to luminance 1. */
export function colorOfTemperature(T: number): [number, number, number] {
  const c = BANDS.map((l, i) => planck(l, T) / SUN_RGB[i]);
  const lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  return [c[0] / lum, c[1] / lum, c[2] / lum];
}

/** Decode the catalogue: float32 records [right ascension (rad), declination (rad), V magnitude, B−V], J2000 equatorial. */
export function decodeStars(bytes: ArrayBuffer): StarField {
  const rec = new Float32Array(bytes);
  const count = Math.floor(rec.length / 4);
  const dir = new Float32Array(count * 3), flux = new Float32Array(count), color = new Float32Array(count * 3), magnitude = new Float32Array(count);
  // Equatorial to ecliptic: turn back about the equinox direction by the obliquity of J2000.
  const toEcliptic = rotX(-obliquityAt(JD_J2000));
  for (let i = 0; i < count; i++) {
    const ra = rec[i * 4], dec = rec[i * 4 + 1], m = rec[i * 4 + 2], bv = rec[i * 4 + 3];
    const d = apply(toEcliptic, [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)]);
    dir.set(d, i * 3);
    flux[i] = fluxOfMagnitude(m);
    magnitude[i] = m;
    color.set(colorOfTemperature(temperatureOfColorIndex(bv)), i * 3);
  }
  return { count, dir, flux, color, magnitude };
}

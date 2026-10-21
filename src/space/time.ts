/**
 * Calendar and clock. The simulation clock is seconds since a world's epoch (`SpaceParams.epochJd`); astronomy works
 * in Julian dates and Julian centuries since J2000. No wall clock here: time is always passed in.
 *
 * The clock is treated as uniform time (TT) throughout. The difference to Earth's rotation time (ΔT) a thousand years
 * ahead is unknowable today (likely tens of minutes), so the game simply defines Earth's rotation from this clock.
 */
import { DAY, JD_J2000, JULIAN_CENTURY } from './constants';

/** Julian date of a Gregorian calendar date; `day` may carry a fraction (Meeus, Astronomical Algorithms, ch. 7). */
export function julianDay(year: number, month: number, day: number): number {
  let y = year, m = month;
  if (m <= 2) { y -= 1; m += 12; }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/** Julian date at clock time t (s since the epoch). */
export function jdAt(epochJd: number, t: number): number {
  return epochJd + t / DAY;
}

/** Julian centuries since J2000 at a Julian date. */
export function centuries(jd: number): number {
  return (jd - JD_J2000) / JULIAN_CENTURY;
}

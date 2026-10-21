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

/** The Gregorian calendar date of a Julian date, the day with its fraction (Meeus, chapter 7): the inverse of `julianDay`. */
export function calendarOf(jd: number): { year: number; month: number; day: number } {
  const z = Math.floor(jd + 0.5), f = jd + 0.5 - z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + alpha - Math.floor(alpha / 4), b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25), d = Math.floor(365.25 * c), e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e) + f;
  const month = e < 14 ? e - 1 : e - 13;
  return { year: month > 2 ? c - 4716 : c - 4715, month, day };
}

/**
 * The person's settings in this browser (sound on or off, and later more): small strings kept in `localStorage`, the
 * one place that touches it. Storage can be missing or refuse (a private window, blocked site data), so a read then
 * gives the default and a write is kept only for this visit.
 */
const PREFIX = 'solarpolis.';

/** A setting, or `fallback` when it was never set or storage is unavailable. */
export function readSetting(key: string, fallback: string): string {
  try { return localStorage.getItem(PREFIX + key) ?? fallback; } catch { return fallback; }
}

/** Keep a setting for the next visit (silently only for this one where storage is unavailable). */
export function writeSetting(key: string, value: string): void {
  try { localStorage.setItem(PREFIX + key, value); } catch { /* storage unavailable */ }
}

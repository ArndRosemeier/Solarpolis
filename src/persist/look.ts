/**
 * The player's own look, as they made it in the creator (app/creator.ts): Actors' character config as JSON, kept in
 * this browser for the next visit. Without one (never made, unreadable, storage unavailable) the player is the person
 * the world's seed makes (render/actors/looks.ts `playerLook`).
 */
import { readSetting, writeSetting } from './settings';

const SETTING = 'player.look';

/** The kept look: a JSON object, or null when there is none or it does not read as one. */
export function readLook(): Record<string, unknown> | null {
  return parseLook(readSetting(SETTING, ''));
}

/** Keep a look for the next visit; null forgets it (the seed's person again). */
export function writeLook(look: object | null): void {
  writeSetting(SETTING, look ? JSON.stringify(look) : '');
}

/** A kept look's text as an object, or null (empty, not JSON, or not an object with a body). */
export function parseLook(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text), body = (v as { body?: unknown } | null)?.body;
    return v && typeof v === 'object' && !Array.isArray(v) && body && typeof body === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

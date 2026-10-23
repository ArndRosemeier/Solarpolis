/**
 * A conversation's lines and their timing (src/talk/conversations.ts), apart from the engine so the renderer can read
 * them without loading it.
 */

/** One piece of what someone says: who (their place in the party), the words, and from when to when (clock, s). */
export interface Line {
  member: number;
  text: string;
  t0: number;
  t1: number;
}

/** How long a piece stays up (s): as long as it takes to read at `read` characters a second, within bounds. */
export const PIECE = { least: 2.2, most: 8, settle: 1.2 };

export function readFor(text: string, read: number): number {
  return Math.min(PIECE.most, Math.max(PIECE.least, PIECE.settle + [...text].length / read));
}

/** The line being said at clock time t, or null between them. */
export function lineAt(lines: readonly Line[] | null, t: number): Line | null {
  if (!lines) return null;
  for (let k = lines.length - 1; k >= 0; k--) {
    const l = lines[k];
    if (l.t0 <= t) return t < l.t1 ? l : null;
  }
  return null;
}

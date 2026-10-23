/** One shared toss clock for the throw animation and the visible ball. Seconds since the catch beat began. */
export const TOSS = { turn: 3, release: 0.45, flight: 0.9, gesture: 1.1 } as const;
export function tossAt(since: number): { thrower: number; phase: number; flight: number } {
  const turn = Math.floor(Math.max(0, since) / TOSS.turn), phase = Math.max(0, since) - turn * TOSS.turn;
  return { thrower: turn % 2, phase, flight: Math.min(1, Math.max(0, (phase - TOSS.release) / TOSS.flight)) };
}

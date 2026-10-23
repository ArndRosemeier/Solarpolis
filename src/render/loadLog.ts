/**
 * Where the views say what they load and when (the app's arrival timing listens: app/arrivalTiming.ts), so the
 * arrival can be planned round it. The render layer only says it; the app sets `loadLog.note`.
 */
export const loadLog: { note: (what: string) => void } = { note: () => undefined };

/** Run `load`, saying when it starts and when it is done. */
export async function logged<T>(what: string, load: () => Promise<T>): Promise<T> {
  loadLog.note(`${what} …`);
  try { return await load(); } finally { loadLog.note(`${what} ✓`); }
}

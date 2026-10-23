/**
 * Finding an entry in an offer's list as the player types (the link's search): every word typed must begin a word of
 * the entry's title, detail or group, in any order ('lift st' finds 'Lift Stair'), or appear inside its title. Groups
 * keep the order the service gives them in; inside a group, titles that match at their start come first, then the
 * nearest (`near`), then the list's own order.
 */
import type { LinkChoice } from './service';

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** How well a choice matches the typed words: 0 not at all, higher better. */
export function choiceMatch(choice: LinkChoice, typed: string): number {
  const want = words(typed);
  if (!want.length) return 1;
  const title = choice.title.toLowerCase();
  const own = [...words(choice.title), ...words(choice.detail ?? ''), ...words(choice.group ?? '')];
  if (!want.every((w) => own.some((o) => o.startsWith(w)) || title.includes(w))) return 0;
  return title.startsWith(want[0]) ? 3 : words(choice.title).some((o) => o.startsWith(want[0])) ? 2 : 1;
}

/** The choices matching `typed`, in their groups, best first in each. */
export function findChoices(choices: readonly LinkChoice[], typed: string): LinkChoice[] {
  const groups = new Map<string, { c: LinkChoice; i: number; m: number }[]>();
  choices.forEach((c, i) => {
    const m = choiceMatch(c, typed), g = c.group ?? '';
    if (!groups.has(g)) groups.set(g, []);
    if (m > 0) groups.get(g)!.push({ c, i, m });
  });
  const far = (c: LinkChoice): number => c.near ?? Infinity;
  return [...groups.values()].flatMap((list) => list.sort((a, b) => b.m - a.m || far(a.c) - far(b.c) || a.i - b.i).map((x) => x.c));
}

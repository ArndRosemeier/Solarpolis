/**
 * The speck list of a habitat at two moments a little apart (the second takes the still people's footing from the
 * first): everyone up on the land, each once, in key order, where the near levels stand them, carried on the way
 * they walk. `sample`: how many people to check of each list (all by default).
 */
import assert from 'node:assert/strict';
import { toWorld } from '../src/blueprint';
import { landmarkTopAt } from '../src/gen/landmarks';
import { MEAN_HEIGHT, SPECK_STRIDE } from '../src/gen/standIn';
import { footingOf, peopleAt, whereIs } from '../src/sim';
import { specksAt } from '../src/sim/specks';
import { terrainOf } from './worlds';

export function checkSpecks(name: string, day: number, sample = Infinity): void {
  const terrain = terrainOf(name), h = terrain.habitat;
  // Twice, a little apart: the second list takes the still people's footing from the first.
  for (const t of [3 * day + 8 * 3600, 3 * day + 8 * 3600 + 3]) {
    const list = specksAt(terrain, t), people = peopleAt(h, t, undefined, terrain);
    assert.equal(list.count, people.length);
    assert.ok(list.count > 0, 'nobody out on a morning');
    for (let i = 1; i < list.count; i++) assert.ok(list.key[i] > list.key[i - 1], 'keys go up, each once');
    const every = Math.max(1, Math.floor(list.count / Math.min(sample, list.count)));
    for (let i = 0; i < list.count; i += every) {
      const p = people.find((q) => q.resident === list.resident[i])!;
      const o = i * SPECK_STRIDE, foot = footingOf(terrain, p, landmarkTopAt(terrain, p.theta, p.s), MEAN_HEIGHT);
      const feet = toWorld(h.profile, { theta: p.theta, s: p.s, h: foot.h });
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(list.data[o + k] - feet[k]) < 0.01, `resident ${p.resident}: feet off by ${list.data[o + k] - feet[k]}`);
      assert.equal(list.data[o + 7], foot.pose);
      // A walker's way, a second on, is where they are a second on (within the curve of the floor).
      const v = Math.hypot(list.data[o + 4], list.data[o + 5], list.data[o + 6]);
      assert.ok(Math.abs(v - (p.moving ? p.speed : 0)) < 1e-3);
      if (p.moving && p.speed > 0) {
        const q = whereIs(h, t + 1, p, terrain);
        if (q?.moving && q.heading === p.heading) {
          const ahead = toWorld(h.profile, { theta: q.theta, s: q.s, h: foot.h });
          const guess = [0, 1, 2].map((k) => list.data[o + k] + list.data[o + 4 + k]);
          assert.ok(Math.hypot(...guess.map((g, k) => g - ahead[k])) < 0.2 + 0.05 * p.speed);
        }
      }
    }
  }
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX } from '../src/blueprint';
import { landmarksOf } from '../src/gen/landmarks';
import { planOf } from '../src/gen/plan';
import { MOMENTS, MOMENT_MUSIC, momentAt } from '../src/sim/moments';
import { lightAt, soundscapeAt, type Listener } from '../src/sim/sounds';
import { readFileSync } from 'node:fs';
import { ecologyOf } from './worlds';

const index = JSON.parse(readFileSync(new URL('../public/sound/index.json', import.meta.url), 'utf8')) as { sounds: Record<string, unknown> };

for (const { name } of MATRIX) {
  test(`moments (${name}): dawn at the summit hut, walking the Sunwalk by day, the lake at night, going below; none on a plain noon`, () => {
    const e = ecologyOf(name), t = e.terrain, h = t.habitat, day = h.params.day.length;
    const at = (theta: number, s: number, speed = 0, below = false): Listener => {
      const ground = t.standAt(theta, s);
      return { theta, s, h: ground + 1.7, ground, below, speed };
    };
    const moment = (time: number, l: Listener) => momentAt(e, time, l, soundscapeAt(e, time, l));
    /** The first clock time in the first day when the light over s is in [lo, hi], and rising if asked. */
    const when = (s: number, lo: number, hi: number, rising: boolean): number => {
      for (let c = 0; c < day; c += day / 96) {
        const x = lightAt(h, s, c);
        if (x >= lo && x <= hi && (!rising || lightAt(h, s, c - 900) < x)) return c;
      }
      return NaN;
    };
    const hut = landmarksOf(t).find((m) => m.kind === 'hut');
    if (hut) {
      const top = at(hut.theta, hut.s), dawn = when(hut.s, 0.1, 0.4, true);
      assert.equal(moment(dawn, top), 'summit');
      assert.notEqual(moment(when(hut.s, 0.9, 1, false), top), 'summit', 'not at noon');
    }
    const walk = planOf(h).paths.find((p) => p.kind === 'sunwalk')!, n = Math.floor(walk.points.length / 4) * 2;
    const theta = walk.points[n], s = walk.points[n + 1], noon = when(s, 0.9, 1, false);
    assert.equal(moment(noon, at(theta, s, 1.4)), 'sunwalk');
    assert.equal(moment(noon, at(theta, s, 0)), null, 'standing still on it');
    if (t.lake) {
      const shore = t.lake.s + t.lake.halfWidth + 2, night = when(shore, 0, 0.01, false);
      assert.equal(moment(night, at(0.3, shore)), 'lake');
      assert.notEqual(moment(when(shore, 0.9, 1, false), at(0.3, shore)), 'lake');
    }
    // Below, whatever is heard there: the moment is being down there.
    assert.equal(momentAt(e, noon, at(theta, s, 0, true), soundscapeAt(e, noon, at(theta, s, 1.4))), 'below');
    for (const m of MOMENTS) assert.ok(index.sounds[MOMENT_MUSIC[m]], m);
  });
}

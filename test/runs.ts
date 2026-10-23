/** Running the player's body over the ground in tests (test/running.test.ts, test/runningWater.test.ts). */
import { fromWorld, type Vec3 } from '../src/blueprint';
import type { Terrain } from '../src/gen/terrain';
import { upAt } from '../src/world/motion';
import { PHYSICS_STEP, type PhysicsWorld } from '../src/physics/world';
import type { Character } from '../src/physics/character';

/** A fast run (m/s): the view's run speed (walk 5 m/s × 8). */
export const RUN = 40;
/**
 * Legs as strong as the debug menu's travel boost gives (`Character.legs`): tests that look at the ground's seams, the
 * water or a trunk at a run want the full speed at once, not the few seconds real grip takes to get there.
 */
export const STRONG = 4;

/** Around the axis at `c`'s feet: +1 spinward (+θ), −1 antispinward. */
export const around = (c: Character, sign: number): Vec3 => {
  const up = upAt(c.feet())!;
  return [-up[1] * -sign, up[0] * -sign, 0];
};

/**
 * Run `seconds` along `dir(c)` at `speed` (with `STRONG` legs) and say how far the feet rose above the highest ground (or water) they have
 * been over so far: a body that is thrown up shows here, one that runs off a crest or a bank does not.
 */
export function rise(world: PhysicsWorld, c: Character, t: Terrain, dir: () => Vec3, speed: number, seconds: number, each?: () => void): number {
  let top = -Infinity, worst = 0;
  c.legs = STRONG;
  for (let i = 0; i < Math.round(seconds / PHYSICS_STEP); i++) {
    const d = dir();
    c.stride.walk = [d[0] * speed, d[1] * speed, d[2] * speed];
    world.advance(PHYSICS_STEP);
    const at = fromWorld(t.habitat.profile, ...c.feet());
    top = Math.max(top, t.standAt(at.theta, at.s));
    worst = Math.max(worst, at.h - top);
    each?.();
  }
  return worst;
}

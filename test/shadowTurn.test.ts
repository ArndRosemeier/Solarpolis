/** The shadow map turns with the light only in held steps (render/lights.ts `heldTurn`), so its shadows do not flicker. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHADOW_TURN, heldTurn } from '../src/render/lights';

test('shadow map: a light that jitters or drifts turns the map only in whole steps, never far from the light', () => {
  // Standing still, the body bobbing a hair either way: the map does not turn at all.
  const first = heldTurn(1.2345, -0.4321);
  for (let k = 0; k < 200; k++) {
    const t = heldTurn(1.2345 + Math.sin(k) * 1e-5, -0.4321 + Math.cos(k * 1.7) * 1e-5);
    assert.ok(t === first, 'the map turned for a jitter');
  }
  // Walking round the axis near it: a hundredth of a degree a frame. It turns a few times, in whole steps, and stays
  // within the step's three quarters of the light.
  let turns = 0, last = first;
  for (let f = 1; f <= 600; f++) {
    const around = 1.2345 + f * 1.7e-4, along = -0.4321 + f * 7e-5, t = heldTurn(around, along);
    if (t !== last) {
      turns++;
      for (const a of [t.around, t.along]) assert.ok(Math.abs(a / SHADOW_TURN - Math.round(a / SHADOW_TURN)) < 1e-9, 'on a whole step');
      last = t;
    }
    assert.ok(Math.abs(t.around - around) <= 0.75 * SHADOW_TURN + 1e-12 && Math.abs(t.along - along) <= 0.75 * SHADOW_TURN + 1e-12, 'never far from the light');
  }
  assert.ok(turns > 0 && turns < 60, `${turns} turns in 600 frames`);
});

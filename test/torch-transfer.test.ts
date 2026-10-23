import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { torchTransfer, transferAt, STANDARD_G } from '../src/space/torchTransfer';

describe('finite fusion transfers', () => {
  it('matches a moving destination without endpoint snapping and uses 1 g burns', () => {
    const initial = { p: [0, 0, 0] as [number, number, number], v: [0, 100, 0] as [number, number, number] };
    const target = (t: number) => ({ p: [1e9, 400*t, 0] as [number, number, number], v: [0, 400, 0] as [number, number, number] });
    const leg = torchTransfer(initial, 0, target, () => [], 5e5);
    assert.ok(leg.positionError < 1);
    assert.ok(leg.velocityError < .001);
    assert.ok(Math.abs(leg.deltaV - (leg.burn1 + leg.burn2) * STANDARD_G) < .0001);
    const before = transferAt(leg, leg.end - .01), end = transferAt(leg, leg.end);
    assert.ok(Math.hypot(...end.p.map((x, i) => x - before.p[i])) < 5);
  });
  it('coasts when reaction mass cannot support a full continuous burn', () => {
    const s = { p: [0, 0, 0] as [number, number, number], v: [0, 0, 0] as [number, number, number] };
    const leg = torchTransfer(s, 0, () => ({ ...s, p: [1e12, 0, 0] }), () => [], 1e6);
    assert.ok(leg.deltaV < 1e6);
    assert.ok(leg.coast > 1e6);
    assert.ok(leg.positionError < 5);
  });
});

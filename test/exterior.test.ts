/** The outside of the habitat (src/blueprint/exterior.ts): heat, radiator brims, spindle and mast over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derive, validate, isValid, withParams, MATRIX, REFERENCE } from '../src/blueprint';

const near = (got: number, want: number, rel: number, what: string): void =>
  assert.ok(Math.abs(got - want) <= Math.abs(want) * rel, `${what}: got ${got}, want ${want} ± ${rel * 100}%`);

test('exterior: the reference sheds 130 GW through one brim per end, 5.0 km out', () => {
  const h = derive(REFERENCE);
  near(h.heat / 1e9, 130, 0.01, 'heat released inside (GW)');
  near(h.heat, h.solarPower + REFERENCE.pipedLight * h.lightPower, 1e-12, 'electricity plus piped light');
  assert.equal(h.exterior.brimsPerEnd, 1);
  near(h.exterior.brims[0].tip / 1000, 5.0, 0.02, 'brim tip radius (km)');
});

test('exterior: piping more light in trades solar cells for collectors, so less heat is released inside and the brims shrink', () => {
  const lo = derive(withParams({ pipedLight: 0 })), hi = derive(withParams({ pipedLight: 1 }));
  assert.equal(lo.collectorShare, 0);
  assert.ok(hi.collectorShare > 0.5 && hi.solarPower < lo.solarPower);
  assert.ok(hi.heat < lo.heat && hi.exterior.brims[0].tip < lo.exterior.brims[0].tip);
});

test('exterior: brims that cannot shed the heat, or fly apart, make the habitat invalid', () => {
  const narrow = derive(withParams({ exterior: { ...REFERENCE.exterior, brimReach: 1.05, maxBrims: 1 } }));
  assert.ok(!narrow.exterior.fits && validate(narrow).some((f) => f.id === 'brims' && f.severity === 'invalid'));
  const heavy = derive(withParams({ exterior: { ...REFERENCE.exterior, brimMaterial: { density: 20000, strength: 1e9, safetyFactor: 1.5 } } }));
  assert.ok(validate(heavy).some((f) => f.id === 'brims' && f.severity === 'invalid'));
});

for (const { name, params } of MATRIX) {
  const h = derive(params);
  const e = h.exterior;

  test(`exterior ${name}: the brims shed the heat within their reach, edge-on rings stacked inward`, () => {
    assert.ok(isValid(validate(h)), validate(h).map((f) => f.message).join('; '));
    assert.ok(e.fits && e.radiatingArea >= h.radiatorArea * (1 - 1e-9), `area ${e.radiatingArea} for ${h.radiatorArea}`);
    assert.ok(h.heat < h.sunlight, 'the panels shed part of the sunlight themselves');
    assert.equal(e.brims.length, 2 * e.brimsPerEnd);
    for (const b of e.brims) {
      assert.ok(b.tip > b.inner && b.tip <= params.exterior.brimReach * e.radius * (1 + 1e-9), `tip ${b.tip}`);
      assert.ok(b.z > e.wildFace && b.z < e.portFace, 'brims sit on the drum');
    }
    const wild = e.brims.filter((b) => b.end === 'wild'), port = e.brims.filter((b) => b.end === 'port');
    assert.ok(wild.at(-1)!.z < port.at(-1)!.z, 'the two stacks do not cross');
  });

  test(`exterior ${name}: the outline runs from the mast tip over the drum to the spindle tip`, () => {
    assert.ok(e.wildFace < 0 && e.portFace > h.length, 'endcap faces lie beyond the walls');
    assert.equal(e.radius, h.layers.outer);
    for (let i = 1; i < e.outline.length; i++) assert.ok(e.outline[i][0] >= e.outline[i - 1][0], 'z never runs backwards');
    assert.ok(e.spindle.to > e.portFace && e.spindle.radius === params.hubRadius && e.mast.from < e.wildFace);
  });

  test(`exterior ${name}: the bore runs on the axis from the Hub through the bearing at the port face to the berth arms`, () => {
    const b = e.spindle.bore;
    assert.ok(b.radius > 0 && b.radius < params.hubRadius);
    assert.ok(b.from === h.length && b.bearing === e.portFace && b.to === e.spindle.arms.z && b.from < b.bearing && b.bearing < b.to);
  });
}

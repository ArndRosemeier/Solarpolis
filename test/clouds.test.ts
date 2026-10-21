import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MATRIX, derive, validate, withParams } from '../src/blueprint';
import { cloudSpan, cloudsAt, coverThreshold } from '../src/world/clouds';

for (const { name, params } of MATRIX) {
  test(`clouds (${name}): a layer over the whole floor, clear of the endcap slopes and the axis`, () => {
    const h = derive(params), span = cloudSpan(h), c = params.clouds;
    if (!c) { assert.equal(span, null); assert.equal(cloudsAt(h, 1000), null); return; }
    assert.ok(span);
    assert.ok(Math.abs(span.base - (h.radius - c.base)) < 1e-9 && Math.abs(span.base - span.top - c.thickness) < 1e-9);
    assert.ok(span.top > h.params.hubRadius, 'clear of the axis');
    const { profile } = h, floor0 = profile.at(profile.floorStart).z, floor1 = profile.at(profile.floorEnd).z;
    assert.ok(span.z0 >= 0 && span.z0 <= floor0 && span.z1 >= floor1 && span.z1 <= h.length, `${span.z0}…${span.z1} spans the floor ${floor0}…${floor1}`);
    assert.ok(span.fade > 0 && span.fade <= (span.z1 - span.z0) / 4);
    // Where the layer ends, the slope below is well under its base.
    for (const s of [0, profile.length]) {
      for (let i = 0; i <= 100; i++) {
        const p = profile.at(s === 0 ? (profile.floorStart * i) / 100 : profile.length - ((profile.length - profile.floorEnd) * i) / 100);
        if (p.z >= span.z0 && p.z <= span.z1) assert.ok(p.r > span.base, `the slope at z ${p.z} stays under the layer`);
      }
    }
  });

  test(`cloud schedule (${name}): cover in range, changing over days, building in the afternoon, carried by the wind`, () => {
    const h = derive(params), c = params.clouds;
    if (!c) return;
    const day = h.params.day.length, light = h.params.day.daylight;
    let lo = 1, hi = 0, sum = 0, n = 0, morning = 0, afternoon = 0;
    for (let d = 0; d < 30; d++) {
      for (let k = 0; k < 24; k++) {
        const t = d * day + (k / 24) * day, s = cloudsAt(h, t)!;
        assert.ok(s.cover >= 0 && s.cover <= 1 && s.turn >= 0 && s.turn < 2 * Math.PI);
        lo = Math.min(lo, s.cover); hi = Math.max(hi, s.cover); sum += s.cover; n++;
      }
      morning += cloudsAt(h, (d + light * 0.15) * day)!.cover;
      afternoon += cloudsAt(h, (d + light * 0.65) * day)!.cover;
    }
    assert.ok(hi - lo > c.cover * 0.5, `the weather changes (${lo.toFixed(2)} … ${hi.toFixed(2)})`);
    assert.ok(Math.abs(sum / n - c.cover) < 0.15, `about the average cover (${(sum / n).toFixed(2)})`);
    assert.ok(afternoon > morning, 'cumulus builds up in the afternoon');
    const t = 12345;
    assert.deepEqual(cloudsAt(derive(params), t), cloudsAt(h, t), 'same seed, same weather');
    assert.ok(Math.abs(cloudsAt(h, t)!.along - c.wind.along * t) < 1e-6);
  });
}

test('clouds: the cover threshold is the normal quantile, and a layer must be valid', () => {
  assert.ok(Math.abs(coverThreshold(0.5)) < 1e-3);
  assert.ok(Math.abs(coverThreshold(0.1) - 1.2816) < 1e-3 && Math.abs(coverThreshold(0.9) + 1.2816) < 1e-3);
  for (let c = 0.05; c < 0.95; c += 0.05) assert.ok(coverThreshold(c) > coverThreshold(c + 0.05), 'more cover, lower threshold');
  assert.ok(coverThreshold(0) > 100 && coverThreshold(1) < -100, 'none, and all');
  const ids = (p: Parameters<typeof withParams>[0]) => validate(derive(withParams(p))).map((f) => `${f.severity}:${f.id}`);
  const c = MATRIX[0].params.clouds!, radius = derive(MATRIX[0].params).radius;
  assert.ok(ids({ clouds: { ...c, base: radius, thickness: 100 } }).includes('invalid:clouds'), 'into the axis');
  assert.ok(ids({ clouds: { ...c, cover: 1.5 } }).includes('invalid:clouds'), 'more than the whole sky');
  assert.deepEqual(ids({ clouds: null }), ids({}), 'none is fine');
});

/** The lights a habitat and its ships show outside (src/space/lights.ts), over the whole matrix. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derive, exteriorDistance, MATRIX } from '../src/blueprint';
import { LIGHTS, SUN_LUX, deriveShip, hullLightsOf, lampFlux, lampHidden, shineAt, shipLightsOf, shipShape, TORCH_SHIP, type Blink, type HullLight } from '../src/space';

const habitats = MATRIX.map(({ name, params }) => ({ name, h: derive(params) }));

/** The share of a period a blink is lit, summed in small steps. */
function lit(b: Blink, from = 0): number {
  const n = 4000, span = b.period || 1;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += shineAt(b, from + (k / n) * span);
  return sum / n;
}

test('lights: every light of every habitat sits on its outside, the berth arms\' on their arm', () => {
  for (const { name, h } of habitats) {
    const s = h.exterior.spindle, w = s.arms.width, tip = s.radius + s.arms.length;
    for (const l of hullLightsOf(h)) {
      const r = Math.hypot(l.at[0], l.at[1]);
      const onArm = l.frame === 'spindle' && r > s.radius * 1.01;
      if (onArm) {
        assert.ok(r <= Math.hypot(tip, w * 1.5), `${name}: an arm's light beyond its tip`);
        assert.ok(Math.abs(l.at[2] - s.arms.z) <= w + 1e-9, `${name}: an arm's light off its arm`);
      } else {
        const d = exteriorDistance(h.exterior, l.at);
        assert.ok(Math.abs(d) <= h.params.hubRadius * 0.02, `${name}: a ${l.frame} light ${d.toFixed(2)} m off the outside`);
      }
    }
  }
});

test('lights: the rims\' lights stand about the same number of hub radii apart in every habitat (nothing fixed in metres)', () => {
  for (const { name, h } of habitats) {
    const pitch = LIGHTS.rim.pitch * h.params.hubRadius, lights = hullLightsOf(h);
    for (const b of h.exterior.brims) {
      const on = lights.filter((l) => l.frame === 'body' && Math.abs(l.at[2] - b.z) < 1e-6 && Math.abs(Math.hypot(l.at[0], l.at[1]) - b.tip) < 1e-6);
      const apart = (2 * Math.PI * b.tip) / on.length;
      assert.ok(on.length >= 8 && apart > pitch * 0.5 && apart < pitch * 1.5, `${name}: a brim's ${on.length} lights ${apart.toFixed(0)} m apart`);
    }
  }
});

test('lights: the arms\' strobes flash one after another round the spindle, never two at once', () => {
  for (const { name, h } of habitats) {
    const strobes = hullLightsOf(h).filter((l) => l.frame === 'spindle' && l.blink.period === LIGHTS.strobe.blink.period);
    assert.equal(strobes.length, h.exterior.spindle.berthArms, name);
    for (let t = 0; t < 4; t += 0.01) assert.ok(strobes.filter((l) => shineAt(l.blink, t) > 0).length <= 1, `${name}: two strobes at once at ${t.toFixed(2)} s`);
  }
});

test('lights: a blink is lit for its share of the period, steady lights always, and no flash is a single frame', () => {
  assert.equal(lit({ period: 0, on: 0, phase: 0 }), 1);
  for (const b of [LIGHTS.obstruction.blink, LIGHTS.strobe.blink, LIGHTS.tip.blink, LIGHTS.navStrobe.blink]) {
    const blink: Blink = { ...b, phase: 0.37 };
    assert.ok(Math.abs(lit(blink) - b.on / b.period) < 0.02, `lit ${lit(blink)} of the period, want ${b.on / b.period}`);
    // Lit through at least 3 frames at 60 Hz.
    let longest = 0, run = 0;
    for (let t = 0; t < b.period; t += 1 / 600) { run = shineAt(blink, t) > 0.5 ? run + 1 : 0; longest = Math.max(longest, run); }
    assert.ok(longest / 600 >= 3 / 60, `a flash lit only ${(longest / 600).toFixed(3)} s`);
  }
  // The lead-in runs out from the spindle to the collar: each light a step after the one inside it.
  const { name, h } = habitats[0], s = h.exterior.spindle;
  const lead = hullLightsOf(h).filter((l) => l.candela === LIGHTS.leadIn.candela && Math.abs(Math.atan2(l.at[1], l.at[0])) < 0.2);
  const byR = [...lead].sort((a, b) => Math.hypot(a.at[0], a.at[1]) - Math.hypot(b.at[0], b.at[1]));
  for (let k = 2; k < byR.length; k += 2) assert.ok(byR[k].blink.phase > byR[k - 2].blink.phase, `${name}: the lead-in out of sequence`);
  assert.ok(byR.length === 2 * LIGHTS.leadIn.lights && Math.hypot(byR[0].at[0], byR[0].at[1]) > s.radius, name);
});

test('lights: a lamp\'s flux falls with the square of the distance, 1 cd at 1 m being 1 lux', () => {
  const l: HullLight = { frame: 'body', at: [0, 0, 0], colour: [1, 1, 1], candela: 1, blink: { period: 0, on: 0, phase: 0 } };
  assert.ok(Math.abs(lampFlux(l, 1, 0)[1] * SUN_LUX - 1) < 1e-12);
  assert.ok(Math.abs(lampFlux(l, 10, 0)[1] / lampFlux(l, 1, 0)[1] - 0.01) < 1e-12);
  // Every colour is luminance 1, so the candela alone says how bright.
  for (const c of hullLightsOf(habitats[0].h).map((x) => x.colour)) assert.ok(Math.abs(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] - 1) < 1e-9);
});

test('lights: ships show red to port and green to starboard at their widest, a strobe on the nose', () => {
  const shapes = [shipShape(TORCH_SHIP), ...[1, 2, 3, 4].flatMap((seed) => [shipShape(deriveShip(seed, 120, 'torch')), shipShape(deriveShip(seed, 120, 'sail'))])];
  for (const shape of shapes) {
    const [red, green, strobe] = shipLightsOf(shape);
    assert.ok(red.at[2] < 0 && green.at[2] > 0 && red.at[2] === -green.at[2], 'port and starboard');
    assert.ok(red.colour[0] > red.colour[1] && green.colour[1] > green.colour[0]);
    assert.ok(green.at[2] >= shape.params.beam / 2, 'at the widest');
    assert.equal(strobe.at[0], shape.params.length);
    assert.ok(strobe.blink.period > 0);
  }
});

test('lights: the body hides a lamp behind it, never the one in front, nor one seen grazing on its own rim', () => {
  for (const { name, h } of habitats) {
    const x = h.exterior, s = x.spindle, z = (s.from + s.to) / 2, beside: [number, number, number] = [s.radius * 6, 0, z];
    assert.ok(!lampHidden(x, beside, [s.radius, 0, z]), `${name}: the spindle's near side`);
    assert.ok(lampHidden(x, beside, [-s.radius, 0, z]), `${name}: the spindle's far side`);
    // From out along the axis beyond the dock, every rim light shows; from inside the bore, none.
    const out: [number, number, number] = [0, s.radius * 3, s.to + x.radius];
    for (const l of hullLightsOf(h).filter((q) => q.frame === 'body' && Math.abs(q.at[2] - x.portFace) < 1e-6)) assert.ok(!lampHidden(x, out, l.at), `${name}: a rim light hidden`);
    assert.ok(lampHidden(x, [0, 0, s.bore.bearing + 1], [s.radius, 0, z]), `${name}: seen from inside the bore`);
  }
});

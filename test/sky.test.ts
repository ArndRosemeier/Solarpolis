/**
 * The sky (src/space/stars.ts, sky.ts): the star catalogue lands where the sky has those stars, star colours, and
 * what the home habitat sees: Earth's size from the geostationary ring, and Earth's shadow in the eclipse seasons.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v3dot, v3scale, type Vec3 } from '@futuremagic/core';
import {
  DAY, circleOverlap, colorOfTemperature, decodeStars, fluxOfMagnitude, julianDay, obliquityAt, skyFrom,
  temperatureOfColorIndex, JD_J2000, type Space,
} from '../src/space';
import { spaceOf } from './worlds';

const D = Math.PI / 180;
const near = (got: number, want: number, tol: number, what: string): void =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want} ± ${tol}`);
const tOf = (s: Space, y: number, m: number, d: number): number => (julianDay(y, m, d) - s.params.epochJd) * DAY;

const file = readFileSync(new URL('../public/sky/stars.bin', import.meta.url));
const stars = decodeStars(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));

test('stars: the catalogue holds the naked-eye sky and more, Sirius brightest, where Sirius is', () => {
  assert.ok(stars.count > 40000, `${stars.count} stars`);
  let brightest = 0;
  for (let i = 1; i < stars.count; i++) if (stars.magnitude[i] < stars.magnitude[brightest]) brightest = i;
  near(stars.magnitude[brightest], -1.46, 0.05, 'Sirius (V)');
  // Sirius: RA 6h 45m 08.9s, Dec −16° 42′ 58″ (J2000), turned into the ecliptic frame.
  const ra = (6 + 45 / 60 + 8.9 / 3600) * 15 * D, dec = -(16 + 42 / 60 + 58 / 3600) * D, e = obliquityAt(JD_J2000);
  const q: Vec3 = [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
  const want: Vec3 = [q[0], Math.cos(e) * q[1] + Math.sin(e) * q[2], -Math.sin(e) * q[1] + Math.cos(e) * q[2]];
  const got: Vec3 = [stars.dir[brightest * 3], stars.dir[brightest * 3 + 1], stars.dir[brightest * 3 + 2]];
  near(Math.acos(Math.min(1, v3dot(got, want))) / D, 0, 0.02, 'Sirius direction (°)');
  // Sirius gives about a ten-billionth of the Sun's light.
  near(Math.log10(stars.flux[brightest]), -10.11, 0.05, 'log10 flux relative to the Sun');
});

test('stars: Polaris sits near the celestial pole, 23.4° from the ecliptic pole', () => {
  // The celestial pole in the ecliptic frame, and the brightest-class star nearest to it.
  const e = obliquityAt(JD_J2000), pole: Vec3 = [0, Math.sin(e), Math.cos(e)];
  let polaris = -1, best = -1;
  for (let i = 0; i < stars.count; i++) {
    const c = v3dot(pole, [stars.dir[i * 3], stars.dir[i * 3 + 1], stars.dir[i * 3 + 2]]);
    if (stars.magnitude[i] < 2.5 && c > best) { best = c; polaris = i; }
  }
  near(stars.magnitude[polaris], 1.97, 0.1, 'Polaris (V)');
  near(Math.acos(best) / D, 0.74, 0.05, 'Polaris from the celestial pole in J2000 (°)');
  near(Math.acos(stars.dir[polaris * 3 + 2]) / D, 23.4, 1, 'Polaris from the ecliptic pole (°)');
});

test('stars: colours run from red to blue, the Sun white', () => {
  const sun = colorOfTemperature(5778);
  for (const c of sun) near(c, 1, 1e-9, 'the Sun is white');
  near(temperatureOfColorIndex(0.65), 5800, 150, 'B−V 0.65 is Sun-like (K)');
  const red = colorOfTemperature(temperatureOfColorIndex(1.8)), blue = colorOfTemperature(temperatureOfColorIndex(-0.3));
  assert.ok(red[0] > red[2] * 2, `a cool giant is orange-red: ${red}`);
  assert.ok(blue[2] > blue[0], `a hot star is blue: ${blue}`);
  near(fluxOfMagnitude(-26.74), 1, 1e-12, 'the Sun itself');
  near(fluxOfMagnitude(-21.74), 0.01, 1e-12, 'five magnitudes is a hundredfold');
});

test('sky: circle overlap at the edges and in between', () => {
  assert.equal(circleOverlap(1, 1, 2), 0);
  near(circleOverlap(1, 0.5, 0.2), Math.PI * 0.25, 1e-12, 'inside');
  near(circleOverlap(1, 1, 0), Math.PI, 1e-12, 'same circle');
  near(circleOverlap(1, 1, 1), 2 * Math.PI / 3 - Math.sqrt(3) / 2, 1e-12, 'two unit circles 1 apart');
});

test('sky: from the geostationary ring Earth is 17.4° across and the Sun half a degree', () => {
  const s = spaceOf('reference');
  const v = skyFrom(s, s.home.bodyFrame, [0, 0, s.home.habitat.length / 2], tOf(s, 3026, 5, 1));
  const d = Math.hypot(...v.earth.center);
  near(2 * Math.asin(v.earth.radius / d) / D, 17.4, 0.1, 'Earth (°)');
  near(2 * v.sunRadius / D, 0.53, 0.02, 'Sun (°)');
  near(v.sunlight, 1, 0, 'no eclipse in May');
});

test('sky: Earth hides the Sun around local midnight near the equinox, for about 70 minutes, never at the solstice', () => {
  const s = spaceOf('reference');
  const eye: Vec3 = [0, 0, s.home.habitat.length / 2];
  const minutesDark = (y: number, m: number, d: number): number => {
    const t0 = tOf(s, y, m, d);
    let dark = 0;
    for (let k = 0; k < 24 * 60; k += 2) if (skyFrom(s, s.home.bodyFrame, eye, t0 + k * 60).sunlight < 0.5) dark += 2;
    return dark;
  };
  near(minutesDark(3026, 3, 20), 70, 6, 'March equinox: Earth shadow (min)');
  assert.equal(minutesDark(3026, 6, 21), 0, 'June solstice: no shadow');
});

test('exposure: full Earth in view sets it near 0.6, a sunlit hull against black keeps its highlights, empty sky opens the eyes', async () => {
  const { exposureFor, rayLuminance, adapt, KEY, DARKEST, HIGHLIGHT_LEVEL, ANCHOR_LEVEL } = await import('../src/render/exposure');
  const s = spaceOf('reference');
  // Local noon at the equinox: the Sun behind the eye, Earth full.
  const t0 = tOf(s, 3026, 3, 20);
  let t = t0, best = 1;
  for (let k = 0; k < 288; k++) {
    const v = skyFrom(s, s.home.orbitFrame, [0, 0, 0], t0 + k * 300);
    const c = v3dot(v.sunDir, v.earth.center) / Math.hypot(...v.earth.center);
    if (c < best) { best = c; t = t0 + k * 300; }
  }
  const sky = skyFrom(s, s.home.orbitFrame, [0, 0, 0], t);
  const toEarth = sky.earth.center.map((c) => c / Math.hypot(...sky.earth.center)) as Vec3;
  const away = toEarth.map((c) => -c) as Vec3;
  near(exposureFor({ sky, hulls: [], earthshine: 0 }, [toEarth], DARKEST.plain), KEY / 0.3, 0.05, 'exposure on full Earth (albedo 0.3)');
  // One ray in five on a hull lit face-on by the Sun (seen from the Sun's side), the rest black: the hull sets it.
  const sun = sky.sunDir, back = v3scale(sun, -1), hull = { center: v3scale(back, 1e5), axis: [0, 0, 1] as Vec3, radius: 4000, halfLength: 15000, albedo: 0.08 };
  const pole: Vec3 = [0, 0, 1];
  const rays: Vec3[] = [back, pole, pole, pole, pole];
  const lit = exposureFor({ sky: { ...sky, sunlight: 1 }, hulls: [hull], earthshine: 0 }, rays, DARKEST.plain);
  near(lit, Math.min(HIGHLIGHT_LEVEL / 0.08, ANCHOR_LEVEL), 1e-6, 'the sunlight on the hull sets the exposure: a dark hull stays dark');
  // In a room with a window: the rays it lets out see the lit hull, the rest the room's dim walls.
  const room = { luminance: 0.004, light: 0.01, open: (d: Vec3) => v3dot(d, back) > 0.99 };
  assert.ok(rayLuminance({ sky: { ...sky, sunlight: 1 }, hulls: [hull], earthshine: 0, room }, back) > 0.07, 'out of the window: the hull');
  assert.equal(rayLuminance({ sky: { ...sky, sunlight: 1 }, hulls: [hull], earthshine: 0, room }, pole), 0.004, 'the wall');
  // Out of the window only black space: the eyes settle on the room, not on the dark beyond the glass.
  const blackOut = { ...room, open: (d: Vec3) => v3dot(d, pole) < 0.99 };
  near(exposureFor({ sky: { ...sky, sunlight: 0 }, hulls: [], earthshine: 0, room: blackOut }, [pole, away, away, away], DARKEST.plain), KEY / 0.004, 1e-6 * KEY / 0.004, 'the room sets it');
  const dark = exposureFor({ sky: { ...sky, sunlight: 0 }, hulls: [], earthshine: 0 }, [away], DARKEST.plain);
  near(dark, KEY / DARKEST.plain, 1e-6 * KEY / DARKEST.plain, 'eyes open to their limit');
  // Adapting: a second in the light gets most of the way; the dark takes longer.
  const target = KEY / 0.3;
  assert.ok(Math.abs(Math.log(adapt(1e3, target, 1) / target)) < 0.25 * Math.log(1e3 / target), 'quick into the light');
  assert.ok(adapt(1, dark, 1) < 0.5 * dark, 'slow into the dark');
});

test('heroic stars: without the Sun in view a magnitude-0 star peaks at HEROIC_PEAK; with it, the eyes\' own exposure', async () => {
  const { starExposure, sunInView, HEROIC_PEAK, STAR_SIGMA, PERIPHERY } = await import('../src/render/exposure');
  for (const omega of [1e-7, 1.2e-6, 1e-5]) {
    const e = starExposure(2.5, omega, 0);
    const peak = ((fluxOfMagnitude(0) * Math.PI) / omega / (2 * Math.PI * STAR_SIGMA * STAR_SIGMA)) * e;
    assert.ok(Math.abs(peak / HEROIC_PEAK - 1) < 1e-9);
    assert.equal(starExposure(1e12, omega, 0), 1e12);
    assert.equal(starExposure(2.5, omega, 1), 2.5);
    assert.equal(starExposure(2.5, omega, 0, false), 2.5);
    const half = starExposure(2.5, omega, 0.5);
    assert.ok(Math.abs(half - Math.sqrt(2.5 * e)) < 1e-6 * half);
  }
  assert.equal(sunInView(0.3, 0.5, 1), 1);
  assert.equal(sunInView(0.5 * PERIPHERY, 0.5, 1), 0);
  assert.equal(sunInView(0.3, 0.5, 0), 0);
  const mid = sunInView(0.5 * (1 + PERIPHERY) / 2, 0.5, 1);
  assert.ok(mid > 0.45 && mid < 0.55);
});

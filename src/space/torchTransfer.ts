/** Constant proper-thrust transfers, solved against a moving rendezvous.
 * Newtonian point-mass gravity; RK4 propagation, two steered burns and an unpowered turnover/coast.
 * Impulse-vector magnitudes determine burn duration, so every powered step is exactly 1 g.
 * No interpolation of endpoints pretending to be propulsion. SI, explicit simulation seconds. */
import { v3add, v3len, v3scale, v3sub, type Vec3 } from '@futuremagic/core';

export const STANDARD_G = 9.80665;
export interface FlightState { p: Vec3; v: Vec3 }
export interface GravitySource { p: Vec3; gm: number; radius: number; name: string }
export type GravityField = (t: number) => GravitySource[];
export interface FlightSample extends FlightState { t: number; a: Vec3; dv: number }
export interface TorchTransfer {
  start: number; end: number; burn1: number; coast: number; burn2: number;
  impulse1: Vec3; impulse2: Vec3; samples: FlightSample[]; deltaV: number;
  positionError: number; velocityError: number;
}

/** Small pivoted solve for the six rendezvous constraints. */
function solve(a: number[][], b: number[]): number[] {
  const m = a.map((r, i) => [...r, b[i]]), n = b.length;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let j = k + 1; j < n; j++) if (Math.abs(m[j][k]) > Math.abs(m[pivot][k])) pivot = j;
    [m[k], m[pivot]] = [m[pivot], m[k]];
    if (Math.abs(m[k][k]) < 1e-14) throw new Error('Rendezvous is singular');
    const d = m[k][k]; for (let j = k; j <= n; j++) m[k][j] /= d;
    for (let i = 0; i < n; i++) if (i !== k) {
      const f = m[i][k]; for (let j = k; j <= n; j++) m[i][j] -= f * m[k][j];
    }
  }
  return m.map(r => r[n]);
}

function force(p: Vec3, sources: GravitySource[], thrust: Vec3): Vec3 {
  const a: Vec3 = [...thrust];
  for (const s of sources) {
    const d = v3sub(s.p, p), r = Math.max(v3len(d), s.radius * .5), f = s.gm / (r * r * r);
    for (let k = 0; k < 3; k++) a[k] += d[k] * f;
  }
  return a;
}

function propagate(initial: FlightState, start: number, impulses: number[], coast: number, field: GravityField, keep: boolean): FlightSample[] {
  let p = initial.p, v = initial.v, t = start, dv = 0;
  const firstSources = field(start), nextSources = field(start + 1);
  let sourceVelocities = firstSources.map((s, i) => v3sub(nextSources[i].p, s.p));
  const result: FlightSample[] = [], segments: [Vec3, number][] = [];
  const i1 = impulses.slice(0, 3) as Vec3, i2 = impulses.slice(3, 6) as Vec3;
  segments.push([v3scale(i1, STANDARD_G / v3len(i1)), v3len(i1) / STANDARD_G], [[0, 0, 0], coast], [v3scale(i2, STANDARD_G / v3len(i2)), v3len(i2) / STANDARD_G]);
  let steps = 0;
  for (const [thrust, duration] of segments) {
    const end = t + duration, powered = v3len(thrust) > 0;
    if (keep) result.push({ t, p, v, a: force(p, field(t), thrust), dv });
    while (t < end - 1e-7) {
      if (++steps > 16000) throw new Error('Trajectory entered an unresolved gravity encounter');
      const sources = field(t);
      let h = Math.min(end - t, duration / (keep ? 240 : 96));
      for (const [i, s] of sources.entries()) {
        const r = Math.max(v3len(v3sub(s.p, p)), s.radius);
        // Encounter sampling depends on velocity relative to the body, not a shared solar velocity.
        h = Math.min(h, .06 * Math.sqrt(r * r * r / s.gm), .15 * r / (v3len(v3sub(v, sourceVelocities[i])) + 1000));
      }
      const a1 = force(p, sources, thrust), p2 = v3add(p, v3scale(v, h / 2)), v2 = v3add(v, v3scale(a1, h / 2));
      const mid = field(t + h / 2), a2 = force(p2, mid, thrust), p3 = v3add(p, v3scale(v2, h / 2)), v3 = v3add(v, v3scale(a2, h / 2));
      const a3 = force(p3, mid, thrust), p4 = v3add(p, v3scale(v3, h)), v4 = v3add(v, v3scale(a3, h));
      const endSources = field(t + h), a4 = force(p4, endSources, thrust);
      sourceVelocities = sources.map((s, i) => v3scale(v3sub(endSources[i].p, s.p), 1 / h));
      p = p.map((x, k) => x + h / 6 * (v[k] + 2 * v2[k] + 2 * v3[k] + v4[k])) as Vec3;
      v = v.map((x, k) => x + h / 6 * (a1[k] + 2 * a2[k] + 2 * a3[k] + a4[k])) as Vec3;
      t += h; dv += powered ? h * STANDARD_G : 0;
      if (keep) result.push({ t, p, v, a: force(p, field(t), thrust), dv });
    }
  }
  if (!keep) result.push({ t, p, v, a: [0, 0, 0], dv });
  return result;
}

/** A finite-fuel leg. Increases the coast until both burns fit the allocated delta-v. */
export function torchTransfer(initial: FlightState, start: number, destination: (t: number) => FlightState, field: GravityField, budget: number): TorchTransfer {
  const distance = v3len(v3sub(destination(start).p, initial.p));
  let coast = 120;
  const full = 2 * Math.sqrt(distance * STANDARD_G);
  if (full > budget * .96) coast = Math.max(coast, 2 * distance / (budget * .94) - budget * .94 / (2 * STANDARD_G));
  for (let attempt = 0; attempt < 9; attempt++) {
    const burn = (Math.sqrt(coast * coast + 4 * distance / STANDARD_G) - coast) / 2;
    const total = 2 * burn + coast, dest = destination(start + total);
    const d = v3sub(v3sub(dest.p, initial.p), v3scale(initial.v, total)), change = v3sub(dest.v, initial.v);
    const i1 = v3scale(v3sub(d, v3scale(change, burn / 2)), 1 / (burn + coast));
    let x = [...i1, ...v3sub(change, i1)];
    const residual = (q: number[], dense = false): { error: number[]; samples: FlightSample[] } => {
      const samples = propagate(initial, start, q, coast, field, dense), last = samples[samples.length - 1], target = destination(last.t);
      return { error: [...v3scale(v3sub(last.p, target.p), 1 / total), ...v3sub(last.v, target.v)], samples };
    };
    let current = residual(x);
    for (let iteration = 0; iteration < 22; iteration++) {
      const error = Math.hypot(...current.error);
      if (error < 2e-5) break;
      const columns = x.map((_, j) => {
        const step = Math.max(.05, Math.abs(x[j]) * 1e-5), trial = [...x]; trial[j] += step;
        return residual(trial).error.map((e, k) => (e - current.error[k]) / step);
      });
      const delta = solve(current.error.map((_, i) => columns.map(c => c[i])), current.error.map(e => -e));
      let accepted = false;
      for (let fraction = 1; fraction >= 1 / 64; fraction /= 2) {
        const next = x.map((v, i) => v + delta[i] * fraction), trial = residual(next);
        if (Math.hypot(...trial.error) < error) { x = next; current = trial; accepted = true; break; }
      }
      if (!accepted) break;
    }
    const deltaV = v3len(x.slice(0, 3) as Vec3) + v3len(x.slice(3) as Vec3);
    if (deltaV > budget) { coast = Math.max(coast * 1.35, total * .3); continue; }
    // Re-solve against the same dense integration used for playback; no final-position snap.
    for (let i = 0; i < 16; i++) {
      current = residual(x, true);
      if (Math.hypot(...current.error.slice(0, 3)) * total < 8 && Math.hypot(...current.error.slice(3)) < .002) break;
      const columns = x.map((_, j) => {
        const step = 5, q = [...x]; q[j] += step;
        return residual(q, true).error.map((e, k) => (e - current.error[k]) / step);
      });
      const d = solve(current.error.map((_, k) => columns.map(c => c[k])), current.error.map(e => -e));
      x = x.map((v, j) => v + d[j]);
    }
    current = residual(x, true);
    const last = current.samples[current.samples.length - 1], target = destination(last.t);
    const positionError = v3len(v3sub(last.p, target.p)), velocityError = v3len(v3sub(last.v, target.v));
    if (positionError > 25 || velocityError > .02) throw new Error(`The Mind could not converge on a safe rendezvous at this departure date (${positionError.toFixed(1)} m, ${velocityError.toFixed(3)} m/s).`);
    for (const s of current.samples) for (const body of field(s.t)) {
      if (v3len(v3sub(s.p, body.p)) < body.radius * 1.02) throw new Error(`The route intersects ${body.name}; another approach is required.`);
    }
    const impulse1 = x.slice(0, 3) as Vec3, impulse2 = x.slice(3) as Vec3;
    return { start, end: last.t, impulse1, impulse2, burn1: v3len(impulse1) / STANDARD_G, burn2: v3len(impulse2) / STANDARD_G, coast, samples: current.samples, deltaV: last.dv, positionError, velocityError };
  }
  throw new Error('This rendezvous exceeds the available reaction mass.');
}

/** Cubic Hermite output of the integrated trajectory. Binary search keeps accelerated time cheap. */
export function transferAt(leg: TorchTransfer, t: number): FlightSample {
  const samples = leg.samples;
  if (t <= leg.start) return samples[0];
  if (t >= leg.end) return samples[samples.length - 1];
  let lo = 0, hi = samples.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m].t <= t) lo = m; else hi = m; }
  const a = samples[lo], b = samples[hi], h = b.t - a.t, u = (t - a.t) / h;
  const p = a.p.map((x, k) => (2*u**3-3*u*u+1)*x + (u**3-2*u*u+u)*h*a.v[k] + (-2*u**3+3*u*u)*b.p[k] + (u**3-u*u)*h*b.v[k]) as Vec3;
  const v = a.p.map((x, k) => ((6*u*u-6*u)*x + (3*u*u-4*u+1)*h*a.v[k] + (-6*u*u+6*u)*b.p[k] + (3*u*u-2*u)*h*b.v[k])/h) as Vec3;
  return { t, p, v, a: a.a, dv: a.dv + (b.dv - a.dv) * u };
}

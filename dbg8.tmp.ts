import { REFERENCE, derive, toWorld } from './src/blueprint';
import { sunlineEmission } from './src/world/sunline';
import { insideGlare, viewRays, referenceInsideEye } from './src/render/exposure';
const h = derive(REFERENCE), P = h.profile, R = h.radius, ext = Math.log(4) / REFERENCE.air.hazeDistance, sky = 0.35, hz = 0.6676;
const fov = 70 * Math.PI / 180, asp = 16 / 9;
const ref = referenceInsideEye(h), refRays = viewRays(ref.look, ref.up, fov, asp);
const norm = (v: number[]) => { const l = Math.hypot(...v); return v.map((x) => x / l) as [number, number, number]; };
const look = (eye: number[], at: number[]) => norm([at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]);
const upOf = (eye: number[], lk: number[]) => { const u = norm([-eye[0], -eye[1], 0]); const k = u[0]*lk[0]+u[1]*lk[1]+u[2]*lk[2]; return norm([u[0]-k*lk[0], u[1]-k*lk[1], u[2]-k*lk[2]]); };
for (const frac of [0.5, 0.25]) {
  const em = sunlineEmission(h, REFERENCE.day.length * REFERENCE.day.daylight * frac);
  const views: [string, number[], number[]][] = [];
  const mid = (P.floorStart + P.floorEnd) / 2;
  const vp = (name: string, up: number, around: number, along: number, s0: number) => {
    const s = P.floorStart + (P.floorEnd - P.floorStart) * s0, to = Math.min(P.length, Math.max(0, s + along * R));
    views.push([name, toWorld(P, { theta: 0, s, h: up * R }), toWorld(P, { theta: around, s: to, h: 0 })]);
  };
  vp('far-low', 0.05, 0, 2.5, 0.5); vp('far-across', 0.25, Math.PI / 2, 0.4, 0.5); vp('far-side', 0.5, Math.PI, 0.6, 0.5); vp('far-down', 0.6, 0.05, 0.25, 0.5); vp('far-tube', 0.9, 0.02, 3, 0);
  views.push(['meadow-up', toWorld(P, { theta: 0, s: mid, h: 1.7 }), toWorld(P, { theta: Math.PI, s: mid + 2000, h: 0 })]);
  views.push(['floor-level', toWorld(P, { theta: 0, s: mid, h: 1.7 }), toWorld(P, { theta: 0.02, s: mid + 3000, h: 0 })]);
  for (const [name, eye, at] of views) {
    const lk = look(eye, at), rays = viewRays(lk, upOf(eye, lk), fov, asp);
    console.log(frac, name, insideGlare(h, em, ext, sky, hz, eye as any, rays, refRays).toFixed(2));
  }
}

/**
 * The lounge under the arriving ship's nose (space/lounge.ts, render/lounge.ts), lit three ways: its own lamps (a cove
 * round the ceiling), the light its windows let in from what they look out on (`windowLight`: the bright port face on
 * one side, black space on the other), and the Sun itself where it shines through a window onto the floor, a couch or
 * the core. Everything in the ship frame (the mesh's own: +x to the nose); units as in skyShaders.ts.
 */
import { Vector3, Vector4 } from 'three/webgpu';
import { abs, atan, dot, float, fract, max, min, mx_noise_float, normalLocal, normalize, positionLocal, select, smoothstep, sqrt, uniform, vertexColor } from 'three/tsl';
import type { Node } from 'three/webgpu';
import { DISPLAY_CAP, outside } from './skyShaders';

/** Set each frame of the cabin shot by render/lounge.ts. */
export const loungeLight = {
  /** Toward the Sun in the ship frame, and its light there (its unhidden share times its irradiance). */
  sun: uniform(new Vector4(0, 0, 1, 0)),
  /** The windows' light: the weighted direction (`toward`) and the sum (`all`), relative to full sunlight. */
  windows: uniform(new Vector4(0, 0, 0, 0)),
  /** The lamps' light on the floor. */
  lamps: uniform(0),
  /** The room's radius and its core's (m), the windows' sill and head along the ship (x, m). */
  room: uniform(new Vector4(1, 0, 0, 1)),
  /** The windows: how many round the room, the first one's angle, half one's width (rad). */
  glass: uniform(new Vector3(1, 0, 0.1)),
};

/** The share of the Sun's light reaching a point on its way in through a window (0 behind the wall or the core). */
function sunThrough(p: Node<'vec3'>, s: Node<'vec3'>): Node<'float'> {
  const R = loungeLight.room.x, core = loungeLight.room.y, g = loungeLight.glass;
  const a = max(dot(s.yz, s.yz), 1e-6), b = dot(p.yz, s.yz), c = dot(p.yz, p.yz);
  const t = b.negate().add(sqrt(max(b.mul(b).sub(a.mul(c.sub(R.mul(R)))), 0))).div(a);
  const x = p.x.add(t.mul(s.x)), at = atan(p.z.add(t.mul(s.z)), p.y.add(t.mul(s.y)));
  const step = float(2 * Math.PI).div(g.x), off = abs(fract(at.sub(g.y).div(step).add(0.5)).sub(0.5)).mul(step);
  // Soft by a couple of centimetres at the frame and the sill: the Sun's disc and the glass's edge.
  const across = smoothstep(g.z, g.z.sub(float(0.02).div(R)), off);
  const up = smoothstep(loungeLight.room.z, loungeLight.room.z.add(0.02), x).mul(smoothstep(loungeLight.room.w, loungeLight.room.w.sub(0.02), x));
  // The core stands in the way when the ray passes nearer the axis than its radius, on its way out past it.
  const nearest = c.sub(b.mul(b).div(a)), hidden = max(smoothstep(core.mul(core).mul(0.98), core.mul(core), nearest), select(b.greaterThanEqual(0), float(1), float(0)));
  const open = select(a.greaterThan(1e-4), float(1), float(0));
  return across.mul(up).mul(open).mul(select(core.greaterThan(0), hidden, float(1)));
}

/** A surface of the lounge: vertex albedo (a faint weave over it) in its lamps', windows' and the Sun's light. */
export function loungeColor(): Node<'vec3'> {
  const p = positionLocal, n = normalize(normalLocal), sun = loungeLight.sun, w = loungeLight.windows;
  const lamps = loungeLight.lamps.mul(n.x.mul(0.3).add(0.7));
  const windows = max(w.w.add(dot(n, w.xyz)), 0).mul(0.5);
  const sunlit = sun.w.mul(max(dot(n, sun.xyz), 0)).mul(sunThrough(p, sun.xyz));
  const weave = mx_noise_float(p.mul(60)).mul(0.04).add(1);
  return min(vertexColor().rgb.mul(weave).mul(lamps.add(windows).add(sunlit)).mul(outside.exposure), DISPLAY_CAP);
}


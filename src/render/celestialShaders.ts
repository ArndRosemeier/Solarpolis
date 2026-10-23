/** Low-resolution body appearance, true solar illumination and equatorial rings. All materials live in the registry. */
import { Vector3, Vector4, type Node, type Object3D } from 'three/webgpu';
import { abs, clamp, dot, float, fwidth, length, max, min, mix, mx_noise_float, normalLocal, normalize, positionLocal, pow, select, sin, smoothstep, uniform, vec3 } from 'three/tsl';
import { outside, skyMaps, sphereMap } from './skyShaders';

export interface CelestialLook { colour: Vector3; sun: Vector3; light: number; appearance: number; rings: Vector4; seed: number }
const fallback: CelestialLook = { colour: new Vector3(.3, .3, .3), sun: new Vector3(1, 0, 0), light: 1, appearance: 0, rings: new Vector4(), seed: 1 };
const field = <K extends keyof CelestialLook>(key: K) => ({ object }: { object?: Object3D | null }): CelestialLook[K] => (object?.userData.celestial as CelestialLook | undefined)?.[key] ?? fallback[key];
const colour = uniform(fallback.colour).onObjectUpdate(field('colour')), sun = uniform(fallback.sun).onObjectUpdate(field('sun'));
const irradiance = uniform(1).onObjectUpdate(field('light')), appearance = uniform(0).onObjectUpdate(field('appearance'));
const rings = uniform(fallback.rings).onObjectUpdate(field('rings')), seed = uniform(1).onObjectUpdate(field('seed'));

function ringOpacity(r: Node<'float'>): Node<'float'> {
  const within = r.greaterThan(rings.x).and(r.lessThan(rings.y));
  // Saturn's Cassini division (1.951–2.027 equatorial radii); other ring systems are dark and narrow.
  const cassini = select(rings.w.equal(1).and(r.greaterThan(1.951)).and(r.lessThan(2.027)), float(.025), float(1));
  const bands = sin(r.mul(190)).mul(.04).add(sin(r.mul(63)).mul(.04)).add(.92);
  const saturnDensity = select(r.lessThan(1.53), float(.28), select(r.lessThan(1.951), float(1), float(.8)));
  const stripe = (at: number, half: number): Node<'float'> => {
    const aa = max(fwidth(r), .00001);
    return float(1).sub(smoothstep(half, aa.add(half), abs(r.sub(at)))).mul(min(1, float(half * 2).div(aa)));
  };
  let uranus: Node<'float'> = float(0);
  for (const r0 of [1.637, 1.652, 1.666, 1.750, 1.786, 1.846, 1.863, 1.890, 1.957]) uranus = uranus.add(stripe(r0, .0003).mul(.3));
  uranus = uranus.add(stripe(1.999, .002).mul(.8));
  const neptune = stripe(2.147, .002).mul(.25).add(stripe(2.225, .002).mul(.1)).add(stripe(2.54, .001).mul(.3));
  const dense = select(rings.w.equal(1), bands.mul(saturnDensity).mul(cassini), rings.z.mul(bands));
  const opacity = select(rings.w.equal(2), uranus, select(rings.w.equal(3), neptune, dense));
  return select(within, opacity, float(0));
}

export function celestialColor(): Node<'vec3'> {
  const p = normalize(positionLocal), n = normalize(normalLocal), light = max(dot(n, sun), 0);
  const grain = mx_noise_float(p.mul(14).add(seed)).mul(.22).add(mx_noise_float(p.mul(4).add(seed)).mul(.3));
  const bands = sin(p.z.mul(45).add(mx_noise_float(p.mul(8)).mul(.5))).mul(.08).add(sin(p.z.mul(18)).mul(.1));
  let albedo = colour.mul(grain.add(.85));
  albedo = select(appearance.equal(1), colour.mul(grain.mul(.2).add(.95)), albedo);
  albedo = select(appearance.equal(3), colour.mul(bands.add(.85)).add(vec3(.12, .10, .075).mul(smoothstep(.15, .45, bands))), albedo);
  const belts = smoothstep(.1, .22, abs(p.z)).mul(float(1).sub(smoothstep(.3, .4, abs(p.z))));
  const jovian = mix(vec3(.74, .68, .55), colour.mul(.7), belts).mul(bands.mul(.7).add(.9));
  const spotDistance = length(p.xy.sub(vec3(.84, .41, 0).xy).div(.12)).add(abs(p.z.add(.36)).div(.06));
  const spot = float(1).sub(smoothstep(.75, 1, spotDistance));
  albedo = select(appearance.equal(6), mix(jovian, vec3(.47, .22, .12), spot.mul(.7)), albedo);
  albedo = select(appearance.equal(4), colour.mul(bands.mul(.15).add(.95)), albedo);
  const cap = smoothstep(.91, .97, abs(p.z));
  albedo = select(appearance.equal(2), mix(albedo, vec3(.7, .72, .7), cap), albedo);
  const cracks = pow(abs(sin(p.x.mul(39).add(sin(p.y.mul(21))))), 22).mul(.24);
  albedo = select(appearance.equal(5), colour.mul(float(1).sub(cracks)), albedo);
  const t = p.z.negate().div(select(abs(sun.z).lessThan(.0001), float(.0001), sun.z));
  const crossed = p.add(sun.mul(t));
  const ringShadow = select(t.greaterThan(0), float(1).sub(ringOpacity(length(crossed.xy)).mul(.88)), float(1));
  // Unilluminated airless terrain is dark; there is no ambient grey fill in space.
  let result = albedo.mul(light).mul(ringShadow).mul(irradiance);
  const clouds = smoothstep(.02, .4, mx_noise_float(p.mul(5).add(outside.clouds)).add(mx_noise_float(p.mul(27)).mul(.2)));
  const earth = mix(sphereMap(skyMaps.earthDay, p).rgb, vec3(.8, .83, .86), clouds.mul(.8)).mul(light)
    .add(sphereMap(skyMaps.earthNight, p).rgb.mul(outside.cityLights).mul(float(1).sub(smoothstep(-.1, .02, dot(n, sun)))));
  result = select(appearance.equal(7), earth.mul(irradiance), result);
  result = select(appearance.equal(8), sphereMap(skyMaps.moon, p).rgb.mul(.36).mul(light).mul(irradiance), result);
  return min(result.mul(outside.exposure), vec3(1e4));
}

export function celestialRing(): { colour: Node<'vec3'>; opacity: Node<'float'> } {
  const p = positionLocal.mul(rings.y), radius = length(p.xy);
  const along = dot(p, sun), miss = length(p.sub(sun.mul(along)));
  const shadow = select(along.lessThan(0).and(miss.lessThan(1)), float(.015), float(1));
  return { colour: colour.mul(abs(sun.z).mul(.65).add(.2)).mul(irradiance).mul(shadow).mul(outside.exposure), opacity: clamp(ringOpacity(radius), 0, 1) };
}

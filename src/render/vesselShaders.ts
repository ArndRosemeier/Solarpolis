/** Ship rooms use their own integrated illumination, never the habitat sunline. */
import { DataTexture, RGBAFormat, Vector3, type Node } from 'three/webgpu';
import { attribute, dot, exp, float, max, mix, mx_noise_float, normalLocal, normalWorld, normalize, positionLocal, positionWorld, pow, sin, smoothstep, texture, uniform, varying, vec2, vec3, vertexColor, uv } from 'three/tsl';
import { screenSurface } from './hamletSkies';
import { outside } from './skyShaders';
import { filtered } from './textures';

export const vesselLight = { up: uniform(new Vector3(0, 0, 1)), clock: uniform(0), radius: uniform(11.55) };
export const vesselSigns = texture(filtered(new DataTexture(new Uint8Array([20, 35, 30, 255]), 1, 1, RGBAFormat)));
export const cabinSign = (): Node<'vec3'> => vesselSigns.sample(uv()).rgb;
export function cabinSurface(): Node<'vec3'> {
  const n = normalize(varying(normalWorld));
  const light = dot(n, vesselLight.up).mul(.24).add(.55);
  const p = positionLocal;
  let shade: Node<'float'> = float(0);
  for (const y of [-1, 1]) for (const z of [-1, 1]) {
    const q = p.yz.sub(vec2(vesselLight.radius.mul(y * .49), vesselLight.radius.mul(z * .38))).div(vec2(2.2, 1.2));
    shade = shade.add(exp(dot(q, q).negate().mul(1.6)).mul(.35));
  }
  const floor = smoothstep(.7, .95, normalLocal.x);
  const weave = mx_noise_float(p.mul(65)).mul(.025).add(1);
  return vertexColor().rgb.mul(light).mul(float(1).sub(shade.mul(floor))).mul(weave);
}
export function cabinScreen(): Node<'vec3'> {
  const st = varying(attribute<'vec2'>('uv', 'vec2'));
  const u = st.x.mul(.26);
  const horizon = sin(u).mul(.24).add(sin(u.mul(2.7)).mul(.09)).add(1.12);
  const height = st.y;
  const sky = mix(vec3(.15, .32, .40), vec3(.72, .65, .47), smoothstep(3.5, 1.0, height));
  const clouds = smoothstep(.25, .65, mx_noise_float(vec3(u.mul(.6), height.mul(3), .7))).mul(smoothstep(1.7, 2.4, height)).mul(.16);
  const ridge = smoothstep(horizon, horizon.add(.018), height);
  const near = smoothstep(horizon.sub(.4), horizon.sub(.38), height);
  const mountain = mix(vec3(.10, .20, .14), vec3(.23, .33, .29), near);
  const landscape = mix(mountain, sky.add(clouds), ridge);
  // Slow, quiet image variation; the panel joints remain fixed to its physical metre UVs.
  const light = sin(vesselLight.clock.mul(.02)).mul(.015).add(1);
  return screenSurface(st, landscape.mul(light), vec3(.62), vec3(2.4, 1.2, .009));
}

/** Ceramic skin and controlled highlights: no procedural grime on a mature, well-kept ship. */
export function vesselHull(): Node<'vec3'> {
  const n = normalize(normalWorld), incidence = max(dot(n, outside.sunDir), 0);
  const half = normalize(outside.sunDir.sub(normalize(positionWorld)));
  const specular = pow(max(dot(n, half), 0), 80).mul(.16);
  return vertexColor().rgb.mul(incidence.mul(outside.sunlight).add(outside.earthshine).add(.005)).add(specular).mul(outside.exposure);
}

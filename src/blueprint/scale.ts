/**
 * One blueprint at another size: a habitat's parameters with its radius and length changed and everything that is a
 * size across (hub, sunline, relief, clouds, landmarks) or along (the ring lake's width) scaled with them, people at the
 * same density. What stays is what is human-sized (paths, bays, rooms, handrails) and what is already a share (lakes
 * and landforms in radii, day, climate). The Necklace's neighbours and every habitat of the system's ledger are the
 * sample habitat at their own size this way (docs/system.md: other forms are parked for now). Pure.
 */
import type { HabitatParams } from './params';

export function scaleBlueprint(base: HabitatParams, radius: number, length: number, seed: number): HabitatParams {
  const k = radius / base.radius, j = length / base.length, r = base.relief;
  return {
    ...base,
    radius,
    length,
    hubRadius: base.hubRadius * k,
    sunlineRadius: base.sunlineRadius * k,
    relief: {
      ...r,
      hills: r.hills * k,
      ringLake: r.ringLake && { width: r.ringLake.width * j, depth: r.ringLake.depth * k },
      terraceStep: r.terraceStep * k,
      massif: r.massif * k,
      rivers: r.rivers && { ...r.rivers, width: r.rivers.width * k, depth: r.rivers.depth * k },
    },
    clouds: base.clouds && { ...base.clouds, base: base.clouds.base * k, thickness: base.clouds.thickness * k, size: base.clouds.size * k },
    landmarks: base.landmarks && { ...base.landmarks, size: base.landmarks.size * k },
    population: Math.round((base.population * radius * length) / (base.radius * base.length)),
    seed,
  };
}

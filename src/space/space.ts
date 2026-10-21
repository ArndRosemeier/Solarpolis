/**
 * The space around the habitats: one clock, the Sun, Earth and Moon, the Necklace, and the frame tree that ties them
 * together. Windows, the title flight and near-space travel all read from this one model (docs/ARCHITECTURE.md:
 * "Where are the Sun, Earth and Moon?", "How do I get a position from one frame to another?").
 *
 * Frames (ids):
 * - `sun`: the root, heliocentric J2000 ecliptic.
 * - `earth`: Earth's centre, same axes (does not turn). `earth.fixed`: turns with Earth (x to Greenwich, z north).
 * - `moon`: the Moon's centre, ecliptic axes.
 * - `<habitat>.orbit`: a habitat's centre; its z axis on the pole of the ecliptic of date (Earth's orbit plane, which
 *   drifts slowly), so the Sun stays side-on to the habitat all year. `<habitat>.body`: the blueprint's own frame (`frame.ts`):
 *   origin on the axis at the wild endcap wall, +z toward the port wall, turning at the habitat's spin rate. Every
 *   interior position (`toWorld`) is a position in this frame. `<habitat>.spindle`: the same without the spin, the
 *   frame of the despun dock spindle and of the ships at its berths (`traffic.ts`).
 *
 * Pure: no three.js, no DOM, no wall clock.
 */
import { TAU } from '@futuremagic/core';
import { derive, type Habitat, type HabitatParams } from '../blueprint';
import { earthAt, earthAxesAt, eclipticAxesAt, moonFromEarthAt } from './ephemeris';
import { FrameTree } from './frames';
import { necklace, type NecklaceParams, type Placement } from './necklace';
import { apply, IDENTITY, mul, rotX, rotZ, type Mat3 } from './pose';
import { jdAt } from './time';
import type { TrafficParams } from './traffic';

export interface SpaceParams {
  /** Julian date at clock time 0. */
  epochJd: number;
  /** The player's habitat. */
  home: HabitatParams;
  necklace: NecklaceParams;
  traffic: TrafficParams;
  seed: number;
}

export interface PlacedHabitat extends Placement {
  habitat: Habitat;
  /** Frame ids. */
  orbitFrame: string;
  bodyFrame: string;
  spindleFrame: string;
  /** The habitat's spin angle at time t (radians in [0, 2π)). */
  spinAt(t: number): number;
}

export interface Space {
  readonly params: SpaceParams;
  readonly frames: FrameTree;
  readonly habitats: PlacedHabitat[];
  readonly home: PlacedHabitat;
  /** Julian date at clock time t. */
  jd(t: number): number;
}

/** Turn a ring placement into its two frames: its centre with ecliptic-of-date axes, and the turning blueprint frame. */
function placeHabitat(frames: FrameTree, p: Placement, epochJd: number): PlacedHabitat {
  const habitat = derive(p.params);
  const orbitFrame = `${p.id}.orbit`, bodyFrame = `${p.id}.body`, spindleFrame = `${p.id}.spindle`;
  const slot: [number, number, number] = [p.orbitRadius * Math.cos(p.longitude), p.orbitRadius * Math.sin(p.longitude), 0];
  frames.add({ id: orbitFrame, parent: 'earth', pose: (t) => {
    const jd = jdAt(epochJd, t);
    return { origin: apply(earthAxesAt(jd), slot), axes: eclipticAxesAt(jd) };
  } });
  // The fraction of a turn is taken before multiplying by 2π, so the angle stays exact over centuries of clock.
  const spinAt = (t: number): number => {
    const turns = t / habitat.period;
    return (((p.spinPhase / TAU + turns - Math.floor(turns)) % 1) + 1) % 1 * TAU;
  };
  const flip: Mat3 = p.portToward === 'north' ? IDENTITY : rotX(Math.PI);
  frames.add({
    id: bodyFrame,
    parent: orbitFrame,
    pose: (t) => {
      const axes = mul(flip, rotZ(spinAt(t)));
      return { origin: apply(axes, [0, 0, -habitat.length / 2]), axes };
    },
  });
  frames.add({ id: spindleFrame, parent: orbitFrame, pose: () => ({ origin: apply(flip, [0, 0, -habitat.length / 2]), axes: flip }) });
  return { ...p, habitat, orbitFrame, bodyFrame, spindleFrame, spinAt };
}

export function makeSpace(params: SpaceParams): Space {
  const jd = (t: number): number => jdAt(params.epochJd, t);
  const frames = new FrameTree('sun');
  frames.add({ id: 'earth', parent: 'sun', pose: (t) => ({ origin: earthAt(jd(t)), axes: IDENTITY }) });
  frames.add({ id: 'earth.fixed', parent: 'earth', pose: (t) => ({ origin: [0, 0, 0], axes: earthAxesAt(jd(t)) }) });
  frames.add({ id: 'moon', parent: 'earth', pose: (t) => ({ origin: moonFromEarthAt(jd(t)), axes: IDENTITY }) });
  const habitats = necklace(params.home, params.necklace, params.seed).map((p) => placeHabitat(frames, p, params.epochJd));
  return { params, frames, habitats, home: habitats[0], jd };
}

/** Flight planning on the shared worker pool. Astronomy is job-local, never held in a worker cache. */
import { SolarSystem, type EphemerisPack } from '../space/solarSystem';
import type { MoonRecord, SmallRecord } from '../space/solarData';
import { makeSpace, type SpaceParams } from '../space/space';
import { planVoyage, type VoyagePlan } from '../space/voyage';

export interface VoyageRequest { kind: 'voyage'; space: SpaceParams; target: string; start: number; base: string }
export async function buildVoyage(request: VoyageRequest): Promise<VoyagePlan> {
    const read = async <T>(name: string): Promise<T> => {
      const response = await fetch(`${request.base}space/${name}.json`);
      if (!response.ok) throw new Error(`Could not load ${name}`);
      return response.json() as Promise<T>;
    };
    const [ephemeris, moons, small] = await Promise.all([read<EphemerisPack>('ephemeris'), read<MoonRecord[]>('moons'), read<SmallRecord[]>('small-bodies')]);
    const system = new SolarSystem(ephemeris, moons, small), space = makeSpace(request.space, system);
    return planVoyage(space, system, request.target, request.start);
}

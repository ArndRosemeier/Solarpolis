/** Passenger expeditions: finite fusion propellant, moving-body rendezvous, two observation laps and home.
 * All planning is pure and can run in a disposable worker. Point masses and circular guided laps;
 * moon shapes/unknown masses and future satellite phases remain catalogue approximations. */
import { v3add, v3cross, v3dot, v3len, v3norm, v3scale, v3sub, type Vec3 } from '@futuremagic/core';
import { DAY } from './constants';
import { apply } from './pose';
import { polePlane } from './orbits';
import { PLANET_GM } from './solarData';
import type { SolarSystem } from './solarSystem';
import type { Space } from './space';
import { EXPLORER, type VesselRecipe } from './vessel';
import { STANDARD_G, torchTransfer, transferAt, type FlightState, type GravityField, type TorchTransfer } from './torchTransfer';

/** Advanced design assumptions, not a claim about demonstrated engines. Exhaust kinetic energy is
 * 40.5 TJ/kg, below the ~353 TJ/kg D–He3 reaction yield. Direct exhaust carries most of the energy.
 * Power density, fuel storage and waste-heat hardware are still speculative 3026 engineering. */
export const TOUR_SHIP: VesselRecipe = {
  ...EXPLORER, id: 'long-detour', name: 'This Will Only Take A Little While', className: 'Deep-system passenger explorer',
  radius: 22, deckHeight: 5.8,
  drive: { dryMass: 2400000, propellant: 9600000, thrust: 120000000, exhaustVelocity: 9000000 },
  greeting: 'You choose what interests you. I’ll take care of getting us there, and home.',
};
export const TOUR_RESERVE = .12;
// JPL satellite GM, km³/s² → SI. Others are explicitly estimated from radius and density.
const MOON_GM: Record<string, number> = { moon: 4902.800, phobos: .0007087, deimos: .0000962, io: 5959.91547, europa: 3202.71210, ganymede: 9887.83275, callisto: 7179.28340, titan: 8978.13710, enceladus: 7.21037, mimas: 2.50349, tethys: 41.21353, dione: 73.11607, rhea: 153.94175, iapetus: 120.51511, triton: 1427.598, charon: 105.88 };
export function voyageGM(system: SolarSystem, id: string): { gm: number; estimated: boolean } {
  const b = system.byId.get(id)!;
  const known = PLANET_GM[id] ?? (MOON_GM[b.name.toLowerCase()] === undefined ? undefined : MOON_GM[b.name.toLowerCase()] * 1e9);
  return { gm: known ?? 6.67430e-11 * 4 * Math.PI / 3 * b.radius ** 3 * (b.parent === 'mars' ? 1900 : 1400), estimated: known === undefined };
}
export interface ObservationOrbit {
  start: number; end: number; radius: number; period: number; u: Vec3; w: Vec3;
  gm: number; estimated: boolean; guided: boolean; deltaV: number;
}
export interface VoyageLeg { name: string; flight: TorchTransfer }
export interface VoyagePlan {
  target: string; start: number; end: number; outbound: VoyageLeg[]; inbound: VoyageLeg[];
  orbit: ObservationOrbit; deltaV: number; initialMass: number; finalFuel: number;
}
export interface VoyageState extends FlightState {
  phase: string; thrust: Vec3; forward: Vec3; up: Vec3; deltaV: number; fuel: number; lap: number;
}
export function voyageField(system: SolarSystem, epoch: number, target: string): GravityField {
  const ids = [...new Set(['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'moon', target, system.byId.get(target)!.parent])].filter(id => system.byId.has(id));
  return t => ids.map(id => { const b = system.byId.get(id)!; return { p: system.position(id, epoch + t / DAY), gm: voyageGM(system, id).gm, radius: b.radius, name: b.name }; });
}
export function bodyFlightState(system: SolarSystem, epoch: number, id: string, t: number): FlightState {
  const jd = epoch + t / DAY;
  return { p: system.position(id, jd), v: system.velocity(id, jd) };
}
function orbitState(system: SolarSystem, epoch: number, id: string, orbit: ObservationOrbit, t: number): FlightState {
  const center = bodyFlightState(system, epoch, id, t), rate = 2 * Math.PI / orbit.period, angle = (t - orbit.start) * rate;
  const radial = v3add(v3scale(orbit.u, Math.cos(angle)), v3scale(orbit.w, Math.sin(angle)));
  const tangent = v3add(v3scale(orbit.u, -Math.sin(angle)), v3scale(orbit.w, Math.cos(angle)));
  return { p: v3add(center.p, v3scale(radial, orbit.radius)), v: v3add(center.v, v3scale(tangent, orbit.radius * rate)) };
}
function orbitThrust(system: SolarSystem, epoch: number, id: string, orbit: ObservationOrbit, t: number, field: GravityField): Vec3 {
  const s = orbitState(system, epoch, id, orbit, t), c = bodyFlightState(system, epoch, id, t);
  const cv0 = bodyFlightState(system, epoch, id, t - 30).v, cv1 = bodyFlightState(system, epoch, id, t + 30).v;
  const a = v3sub(v3scale(v3sub(cv1, cv0), 1 / 60), v3scale(v3sub(s.p, c.p), (2 * Math.PI / orbit.period) ** 2));
  for (const b of field(t)) { const d = v3sub(b.p, s.p); const g = v3scale(d, b.gm / v3len(d) ** 3); for (let k = 0; k < 3; k++) a[k] -= g[k]; }
  return a;
}

/** Central-body gateway keeps high-speed transfer burns clear of the planet and its main rings.
 * The short local legs are solved too; no jump from heliocentric cruise into a moon's orbit. */
export function planVoyage(space: Space, system: SolarSystem, target: string, start: number): VoyagePlan {
  const body = system.byId.get(target);
  if (!body || body.kind === 'star') throw new Error('Choose a planet, dwarf planet, moon or asteroid.');
  const epoch = space.params.epochJd, field = voyageField(system, epoch, target), drive = TOUR_SHIP.drive;
  if (space.jd(start) < system.ephemeris.start + 1 || space.jd(start) > system.ephemeris.stop - 365) throw new Error('Choose a departure within 3020–3079; the offline sky ends in 3080.');
  const initialMass = drive.dryMass + drive.propellant, budget = drive.exhaustVelocity * Math.log(initialMass / (drive.dryMass + drive.propellant * TOUR_RESERVE));
  const home = (t: number): FlightState => {
    const offset: Vec3 = [space.home.habitat.exterior.radius * 2 + 5000, 0, 0];
    const homeOffset = (s: number): Vec3 => space.frames.position(offset, space.home.orbitFrame, 'earth', s);
    const earth = bodyFlightState(system, epoch, 'earth', t);
    return { p: v3add(earth.p, homeOffset(t)), v: v3add(earth.v, v3scale(v3sub(homeOffset(t + 30), homeOffset(t - 30)), 1 / 60)) };
  };
  const gateway = (id: string) => (t: number): FlightState => {
    const b = system.byId.get(id)!, center = bodyFlightState(system, epoch, id, t);
    const radius = id === 'earth' ? 160e6 : Math.max(b.radius * 5, (b.rings?.outer ?? 0) * 2);
    return { p: v3add(center.p, apply(polePlane(...b.pole), [0, 0, radius])), v: center.v };
  };
  const gm = voyageGM(system, target), radius = Math.max(body.radius * 3, body.radius + 5000, (body.rings?.outer ?? 0) * 1.25);
  const orbitalPeriod = 2 * Math.PI * Math.sqrt(radius ** 3 / gm.gm);
  const moon = system.moons.get(target), hill = moon ? moon.a * 1000 * (1 - moon.e) * Math.cbrt(gm.gm / (3 * PLANET_GM[body.parent])) : Infinity;
  const period = Math.min(orbitalPeriod, DAY * 2);
  const u = apply(polePlane(...body.pole), [0, 0, 1]), w = apply(polePlane(...body.pole), [1, 0, 0]);
  const orbit: ObservationOrbit = { start: 0, end: 0, radius, period, u, w, gm: gm.gm, estimated: gm.estimated, guided: radius > hill * .3 || period !== orbitalPeriod, deltaV: 0 };
  let state = home(start), clock = start;
  const outbound: VoyageLeg[] = [], inbound: VoyageLeg[] = [];
  const leg = (list: VoyageLeg[], name: string, end: (t: number) => FlightState, dv: number): void => {
    let flight: TorchTransfer;
    try { flight = torchTransfer(state, clock, end, field, dv); }
    catch (e) { throw new Error(`${name}: ${e instanceof Error ? e.message : String(e)}`); }
    list.push({ name, flight }); clock = flight.end; state = transferAt(flight, clock);
  };
  leg(outbound, 'Leaving the Necklace', gateway('earth'), budget * .06);
  const primary = body.kind === 'moon' ? body.parent : body.id;
  if (primary !== 'earth') leg(outbound, `Passage to ${system.byId.get(primary)!.name}`, gateway(primary), budget * .37);
  // Arrival phase is fixed in the target frame; solve its velocity as well as its location.
  const entry = (t: number): FlightState => orbitState(system, epoch, target, { ...orbit, start: t }, t);
  leg(outbound, `Approaching ${body.name}`, entry, budget * .06);
  orbit.start = clock; orbit.end = clock + 2 * period;
  for (let i = 0; i < 256; i++) {
    const thrust = v3len(orbitThrust(system, epoch, target, orbit, clock + (i + .5) * period / 128, field));
    if (thrust > STANDARD_G) throw new Error('This close observation circuit exceeds the ship’s thrust envelope.');
    orbit.deltaV += thrust * period / 128;
    if (thrust > .001 * STANDARD_G) orbit.guided = true;
  }
  clock = orbit.end; state = orbitState(system, epoch, target, orbit, clock);
  leg(inbound, `Leaving ${body.name}`, gateway(primary), budget * .06);
  if (primary !== 'earth') leg(inbound, 'Homeward passage', gateway('earth'), budget * .37);
  leg(inbound, 'Returning to the cylinder', home, budget * .06);
  const deltaV = [...outbound, ...inbound].reduce((sum, l) => sum + l.flight.deltaV, orbit.deltaV);
  const finalFuel = initialMass * Math.exp(-deltaV / drive.exhaustVelocity) - drive.dryMass;
  if (finalFuel < drive.propellant * TOUR_RESERVE || space.jd(clock) >= system.ephemeris.stop - 1) throw new Error('The full return journey exceeds the fuel reserve or the available ephemeris.');
  return { target, start, end: clock, outbound, inbound, orbit, deltaV, initialMass, finalFuel };
}

export function voyageAt(plan: VoyagePlan, system: SolarSystem, epoch: number, time: number): VoyageState {
  const t = Math.max(plan.start, Math.min(plan.end, time)), drive = TOUR_SHIP.drive;
  let state: FlightState, phase: string, thrust: Vec3 = [0, 0, 0], forward: Vec3 = [1, 0, 0], deltaV = 0, lap = 0;
  if (t >= plan.orbit.start && t < plan.orbit.end) {
    state = orbitState(system, epoch, plan.target, plan.orbit, t);
    thrust = orbitThrust(system, epoch, plan.target, plan.orbit, t, voyageField(system, epoch, plan.target));
    forward = v3len(thrust) > .001 ? v3norm(thrust) : v3norm(v3sub(state.v, bodyFlightState(system, epoch, plan.target, t).v));
    lap = (t - plan.orbit.start) / plan.orbit.period;
    phase = `${plan.orbit.guided ? 'Guided observation' : 'Orbit'} · lap ${Math.min(2, Math.floor(lap) + 1)} of 2`;
    deltaV = plan.outbound.reduce((s, l) => s + l.flight.deltaV, 0) + plan.orbit.deltaV * lap / 2;
  } else {
    const legs = t < plan.orbit.start ? plan.outbound : plan.inbound;
    if (legs === plan.inbound) deltaV = plan.outbound.reduce((s, l) => s + l.flight.deltaV, plan.orbit.deltaV);
    const leg = legs.find(l => t < l.flight.end) ?? legs[legs.length - 1], f = leg.flight;
    for (const l of legs) { if (l === leg) break; deltaV += l.flight.deltaV; }
    const at = transferAt(f, t), dt = t - f.start; state = at; deltaV += at.dv;
    const a = v3norm(f.impulse1), b = v3norm(f.impulse2);
    if (dt < f.burn1) { thrust = v3scale(a, STANDARD_G); forward = a; phase = `${leg.name} · 1 g departure burn`; }
    else if (dt < f.burn1 + f.coast) {
      const turn = Math.min(1, (dt - f.burn1) / 120), angle = Math.acos(Math.max(-1, Math.min(1, v3dot(a, b))));
      const tangent = v3sub(b, v3scale(a, v3dot(a, b)));
      const side = v3len(tangent) > 1e-6 ? v3norm(tangent) : v3norm(v3cross(a, Math.abs(a[2]) < .9 ? [0, 0, 1] : [0, 1, 0]));
      forward = turn === 1 ? b : v3norm(v3add(v3scale(a, Math.cos(turn * angle)), v3scale(side, Math.sin(turn * angle))));
      phase = `${leg.name} · ${turn < 1 ? 'turnover · freefall' : 'coasting · freefall'}`;
    } else { thrust = v3scale(b, STANDARD_G); forward = b; phase = `${leg.name} · 1 g braking burn`; }
    if (t >= plan.end) { thrust = [0, 0, 0]; phase = 'Welcome home · cylinder arrival stand-off'; }
  }
  const side = v3norm(v3cross(forward, Math.abs(forward[2]) < .95 ? [0, 0, 1] : [0, 1, 0])), up = v3norm(v3cross(side, forward));
  return { ...state, phase, thrust, forward, up, deltaV, lap, fuel: Math.max(0, plan.initialMass * Math.exp(-deltaV / drive.exhaustVelocity) - drive.dryMass) };
}

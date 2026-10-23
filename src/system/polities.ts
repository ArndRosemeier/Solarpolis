/**
 * The world bible's polities (Part VIII, docs/world-bible.md), as records the ledger places in the system. Their ids
 * are the ones the conversation engine's canon uses (solarpolis-dialogue/canon/solarpolis), so a resident who talks
 * about Velloran Reach means this Velloran Reach.
 *
 * Where the bible says where a polity is (Aurelipolis at Mercury, Velloran Reach at Mimas, Phobos, the Moon, Earth),
 * the record follows it (`placed: 'bible'`). Where it does not, the place is our choice (`placed: 'ours'`) and can be
 * moved without touching anything else: Thraxipolis at the Sun–Earth L4 point, Tessivorn and the Krillix under its
 * protection at Earth–Moon L5, Threnody over Mars, Mossgrown's wandering for now an eccentric ellipse, Grixmaw on a
 * Kuiper object at the lawless edge. The bible's own sizes (Aurelipolis 30 km long, Mossgrown 40 × 5 km) are kept;
 * other sizes and populations are ours. Economies stay null where the bible does not say which model a polity uses.
 */
import { AU } from '../space/constants';
import type { NameStyle } from './names';
import type { Economy, Form, Orbit, Tier } from './params';

export interface CanonHabitat {
  id: string;
  /** Null: a name from the polity's style, made by the ledger. */
  name: string | null;
  form: Form;
  orbit: Orbit;
  /** Spin radius and the floor's extent across the spin (a cylinder's length, a torus's floor width), m; a surface settlement's radius is its body's. */
  radius: number;
  length: number;
  /** Null: from the floor area, like every built habitat. */
  population: number | null;
  placed: 'bible' | 'ours';
}

export interface CanonPolity {
  id: string;
  name: string;
  tier: Tier;
  style: NameStyle;
  economy: Economy | null;
  /** The bible in a line. */
  note: string;
  /** The Mind that rules it, where one does (its name is then the habitat's). */
  mind: string | null;
  habitats: CanonHabitat[];
}

const KM = 1000;
/** Mimas's mean distance from Saturn (JPL satellite elements). */
const MIMAS = 185539 * KM;
/** Phobos's mean distance from Mars. */
const PHOBOS = 9376 * KM;
const D = Math.PI / 180;

/** The Velloran cluster: habitats near each other on Mimas's orbit, the capital first. */
const velloran = (k: number): CanonHabitat => ({
  id: k === 0 ? 'velloran' : `velloran-${k + 1}`, name: k === 0 ? 'Velloran Reach' : null, form: k % 3 === 2 ? 'torus' : 'cylinder',
  orbit: { kind: 'circle', body: 'saturn', radius: MIMAS + (k - 2) * 900 * KM, inclination: 1.6 * D, node: 0.6, phase: 2.1 + k * 0.004 },
  radius: [3200, 2400, 1800, 2600, 1500][k], length: [24000, 16000, 3000, 18000, 9000][k], population: null, placed: k === 0 ? 'bible' : 'ours',
});

export const CANON: readonly CanonPolity[] = [
  { id: 'earth', name: 'Earth', tier: 'significant', style: 'plain', economy: null, mind: null,
    note: 'A cultural titan with almost no hard power: a few hundred million people, no arrays, a pilgrimage and not a hub.',
    habitats: [{ id: 'earth', name: 'Earth', form: 'surface', orbit: { kind: 'surface', body: 'earth' }, radius: 6.371e6, length: 0, population: 300e6, placed: 'bible' }] },
  { id: 'selenipolis', name: 'Selenipolis', tier: 'major', style: 'grave', economy: null, mind: null,
    note: 'The Moon: the oldest offworld settlement, a major player through the largest arrays in the inner system.',
    habitats: [
      { id: 'selenipolis', name: 'Selenipolis Near Side', form: 'surface', orbit: { kind: 'surface', body: 'moon' }, radius: 1.7374e6, length: 0, population: 24e6, placed: 'bible' },
      { id: 'selenipolis-far', name: 'Selenipolis Far Side', form: 'surface', orbit: { kind: 'surface', body: 'moon' }, radius: 1.7374e6, length: 0, population: 9e6, placed: 'bible' },
    ] },
  { id: 'aurelipolis', name: 'Aurelipolis', tier: 'significant', style: 'grave', economy: null, mind: null,
    note: 'Prosperous, elegant and fascist; a 30 km cylinder orbiting Mercury, building twenty arks.',
    habitats: [{ id: 'aurelipolis', name: 'Aurelipolis', form: 'cylinder', orbit: { kind: 'circle', body: 'mercury', radius: 4 * 2439.7 * KM, inclination: 0, node: 0, phase: 0.8 },
      radius: 3500, length: 30000, population: null, placed: 'bible' }] },
  { id: 'thraxipolis', name: 'Thraxipolis', tier: 'major', style: 'grave', economy: null, mind: null,
    note: 'A large, no-nonsense bureaucratic cylinder in the inner system: layered permits, transparent courts.',
    // 60° ahead of Earth on Earth's own orbit (the Sun–Earth L4 point), from Earth's J2000 mean elements.
    habitats: [{ id: 'thraxipolis', name: 'Thraxipolis', form: 'cylinder', orbit: { kind: 'sun', a: 1.00000018 * AU, e: 0.0167, inclination: 0, node: 0, peri: 102.937 * D, mean: (100.464 + 60 - 102.937) * D },
      radius: 5000, length: 32000, population: null, placed: 'ours' }] },
  { id: 'tessivorn', name: 'Tessivorn', tier: 'major', style: 'plain', economy: null, mind: null,
    note: 'A vast spin-torus city ruled, and inhabited, by the Halvorn, a fused half-human, half-AI mind.',
    habitats: [{ id: 'tessivorn', name: 'Tessivorn', form: 'torus', orbit: { kind: 'lagrange', point: 5, along: 0 }, radius: 9000, length: 3000, population: null, placed: 'ours' }] },
  { id: 'krillix', name: 'Krillix', tier: 'minor', style: 'plain', economy: null, mind: null,
    note: 'A young water-volume habitat governed by uplifted dolphins, under the Halvorn’s protection.',
    habitats: [{ id: 'krillix', name: 'Krillix', form: 'water', orbit: { kind: 'lagrange', point: 5, along: 0.004 }, radius: 2500, length: 8000, population: null, placed: 'ours' }] },
  { id: 'threnody', name: 'The Long Afternoon of Threnody', tier: 'significant', style: 'mind', economy: null, mind: 'The Long Afternoon of Threnody',
    note: 'An AI-ruled bubble-habitat with a gentle, eccentric Mind; a free port for endangered minds.',
    habitats: [{ id: 'threnody', name: 'The Long Afternoon of Threnody', form: 'bubble', orbit: { kind: 'circle', body: 'mars', radius: 8 * 3396.19 * KM, inclination: 0.4, node: 1.1, phase: 4.0 },
      radius: 4000, length: 0, population: null, placed: 'ours' }] },
  { id: 'phobos', name: 'Phobos', tier: 'significant', style: 'plain', economy: null, mind: null,
    note: 'A small, decaying moon of Mars with a major array: a chokepoint with a strongly preferred push direction.',
    habitats: [{ id: 'phobos', name: 'Phobos', form: 'surface', orbit: { kind: 'circle', body: 'mars', radius: PHOBOS, inclination: 26 * D, node: 0, phase: 0 }, radius: 11000, length: 0, population: 400000, placed: 'bible' }] },
  { id: 'mossgrown', name: 'The Slow Verdict of Mossgrown Things', tier: 'significant', style: 'mind', economy: null, mind: 'The Slow Verdict of Mossgrown Things',
    note: 'An enormous roaming cylinder under sail and torch, ruled by a violence-averse AI with sophisticated nanites.',
    habitats: [{ id: 'mossgrown', name: 'The Slow Verdict of Mossgrown Things', form: 'cylinder', orbit: { kind: 'sun', a: 1.7 * AU, e: 0.28, inclination: 3 * D, node: 1.9, peri: 0.7, mean: 2.6 },
      radius: 2500, length: 40000, population: null, placed: 'ours' }] },
  { id: 'velloran', name: 'Velloran Reach', tier: 'major', style: 'plain', economy: null, mind: null,
    note: 'A habitat cluster at Mimas: a robust democracy that strip-mines Mimas and guards Enceladus.',
    habitats: [0, 1, 2, 3, 4].map(velloran) },
  { id: 'grixmaw', name: 'Grixmaw', tier: 'minor', style: 'punk', economy: null, mind: null,
    note: 'A punk, no-future swarm of patched modules and salvaged hulls on the lawless edge of the outer system.',
    habitats: [{ id: 'grixmaw', name: 'Grixmaw', form: 'swarm', orbit: { kind: 'asteroid', belt: 'kuiper', index: 2 }, radius: 600, length: 2500, population: null, placed: 'ours' }] },
];

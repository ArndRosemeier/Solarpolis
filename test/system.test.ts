import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { v3len, v3sub, type Vec3 } from '@futuremagic/core';
import { MATRIX, REFERENCE } from '../src/blueprint';
import { DAY, REFERENCE_SPACE, julianDay, makeSpace } from '../src/space';
import { ephemerisAt, type EphemerisPack } from '../src/space/solarSystem';
import { MEAN_PLANETS, meanPlanetAt } from '../src/space/meanPlanets';
import {
  C, CANON, FORMS, REFERENCE_SYSTEM, arrivalOf, centreOf, departureOf, habitatName, heardAt, lightTime, makeLedger, mindName, newsHeard, newsIn,
  NAME_STYLES, type HabitatRecord,
} from '../src/system';
import { learnedAt, newsTalk } from '../src/talk/news';

const ledger = makeLedger(REFERENCE_SPACE, REFERENCE_SYSTEM);
/** Every habitat in the order of `each`, made once for the tests that go through them all. */
let all: HabitatRecord[] | null = null;
const everyHabitat = (): HabitatRecord[] => {
  if (!all) { all = []; ledger.each((h) => all!.push(h)); }
  return all;
};
const YEAR = 365.25 * DAY;

test('mean planets: the data-free orbits follow the DE441 pack over 3020–3080 to within 1 % of their light time from the Sun', () => {
  const pack = JSON.parse(readFileSync(new URL('../public/space/ephemeris.json', import.meta.url), 'utf8')) as EphemerisPack;
  for (const id of MEAN_PLANETS) {
    for (let jd = julianDay(3020, 1, 2); jd < julianDay(3080, 1, 1); jd += 211.7) {
      const exact = ephemerisAt(pack, id === 'earth' ? 'emb' : id, jd), mean = meanPlanetAt(id, jd);
      const off = v3len(v3sub(exact, mean));
      assert.ok(off < 0.01 * v3len(exact), `${id} ${jd}: ${(off / C).toFixed(1)} light-s off`);
      if (['mercury', 'venus', 'earth', 'mars'].includes(id)) assert.ok(off / C < 1, `${id}: ${(off / C).toFixed(2)} light-s`);
    }
  }
});

test('light: an arrival solves t − sent = |to(t) − from| / c for a moving receiver, and a departure is its inverse', () => {
  const from: Vec3 = [1e11, 0, 0];
  // A receiver 1 AU away, moving at orbital speed.
  const to = (t: number): Vec3 => [0, 1.496e11 + 30000 * t, 0];
  const t = arrivalOf(from, 100, to);
  assert.ok(Math.abs(t - 100 - lightTime(from, to(t))) < 1e-6);
  assert.ok(Math.abs(departureOf(() => from, to(t), t) - 100) < 1e-6);
  const still = arrivalOf(from, 0, () => [1e11 + C * 60, 0, 0]);
  assert.ok(Math.abs(still - 60) < 1e-9);
});

test('ledger: the same parameters give the same system, its Necklace the same ids and places as makeSpace', () => {
  const again = makeLedger(REFERENCE_SPACE, REFERENCE_SYSTEM);
  assert.deepEqual(again.habitats, ledger.habitats);
  for (const id of ['belt-17', 'mars-3', 'kuiper-1500', 'l5-2000']) assert.deepEqual(again.habitat(id), ledger.habitat(id), id);
  const space = makeSpace(REFERENCE_SPACE);
  for (const h of space.habitats) {
    const r = ledger.habitat(h.id)!;
    assert.equal(r.region, 'necklace');
    for (const t of [0, 3.7e6, 4e8]) {
      const there = space.frames.position([0, 0, 0], h.orbitFrame, 'sun', t);
      assert.ok(v3len(v3sub(there, ledger.where(h.id, t))) < 1, `${h.id} at ${t}`);
    }
  }
  assert.equal(ledger.habitat('home')!.name, REFERENCE.mind);
});

test('ledger: every habitat has a unique id, a name, a form, people and a place; kept names never repeat', () => {
  const ids = new Set<string>(), rocks = new Set<string>(), kept = new Set(ledger.habitats.map((h) => h.name));
  assert.equal(kept.size, ledger.habitats.length);
  let n = 0, people = 0;
  everyHabitat().forEach((h) => {
    assert.ok(!ids.has(h.id), h.id);
    ids.add(h.id);
    assert.ok(h.name.length > 0 && h.mind.length > 0, h.id);
    assert.ok(FORMS.includes(h.form), h.form);
    assert.ok(h.population > 0 && Number.isFinite(h.population), `${h.id}: ${h.population}`);
    if (h.region !== 'canon' && h.region !== 'necklace') assert.ok(!kept.has(h.name), `${h.id} takes ${h.name}`);
    if (h.orbit.kind === 'asteroid') {
      const rock = `${h.orbit.belt}-${h.orbit.index}`;
      assert.ok(!rocks.has(rock), `${h.id}: ${rock} twice`);
      rocks.add(rock);
    }
    if (n++ % 97 === 0) for (const t of [0, 20 * YEAR]) assert.ok(ledger.where(h.id, t).every(Number.isFinite), h.id);
    people += h.population;
  });
  assert.equal(n, ledger.count);
  // Most people live in built habitats (world bible, Part I): many times Earth's few hundred million.
  assert.ok(people > 4 * ledger.habitat('earth')!.population, `${people}`);
  assert.equal(ledger.habitat('belt-0'), undefined);
  assert.equal(ledger.habitat('belt-20001'), undefined);
});

test('ledger: nth walks the habitats in the order of each, every one within its region’s reach and placed as by id', () => {
  const ids = everyHabitat().map((h) => h.id);
  const t = 3.3e7;
  for (let k = 0; k < ledger.count; k += 251) {
    const h = ledger.nth(k);
    assert.equal(h.id, ids[k]);
    const at = ledger.position(h, t);
    assert.deepEqual(at, ledger.where(h.id, t));
    const region = ledger.regions.find((r) => r.id === h.region);
    if (region) {
      const reach = ledger.reach(region, t), d = v3len(v3sub(at, reach.centre));
      assert.ok(d >= reach.inner - 1 && d <= reach.outer + 1, `${h.id}: ${d} outside ${reach.inner}–${reach.outer}`);
    }
    assert.equal(ledger.rock(h) !== null, h.orbit.kind === 'asteroid');
  }
  assert.equal(ledger.nth(ledger.count - 1).id, ids[ids.length - 1]);
  assert.throws(() => ledger.nth(ledger.count));
  assert.equal(centreOf(ledger.habitat('velloran')!.orbit), 'saturn');
  assert.equal(centreOf(ledger.habitat('l5-7')!.orbit), 'earth');
});

test('ledger: the world bible’s polities are where the bible puts them', () => {
  for (const c of CANON) {
    const p = ledger.polity(c.id)!;
    assert.equal(p.tier, c.tier, c.id);
    assert.deepEqual(p.habitats, c.habitats.map((h) => h.id));
  }
  const t = 2e7, from = (id: string, body: string): number => v3len(v3sub(ledger.where(id, t), ledger.where(body, t)));
  assert.ok(from('aurelipolis', 'mercury') < 2e7, 'Aurelipolis orbits Mercury');
  assert.ok(Math.abs(from('velloran', 'saturn') - 185539e3) < 4e6, 'Velloran Reach is on Mimas’s orbit');
  assert.ok(from('phobos', 'mars') < 1e7);
  assert.equal(from('selenipolis', 'moon'), 0);
  assert.ok(v3len(ledger.where('grixmaw', t)) > 40 * 1.496e11, 'Grixmaw is at the lawless edge');
  // Light-lag geography (Part III): minutes within the inner system, hours to Saturn and beyond.
  const lag = (id: string): number => ledger.arrival(id, t, 'home') - t;
  assert.ok(lag('aurelipolis') > 3 * 60 && lag('aurelipolis') < 15 * 60);
  assert.ok(lag('velloran') > 65 * 60 && lag('velloran') < 90 * 60);
  assert.ok(lag('grixmaw') > 5 * 3600);
  assert.ok(lag('l4-1') < 3);
});

for (const { name, params } of MATRIX) {
  test(`ledger (${name}): habitats are peopled at the home habitat's density, whatever its size`, () => {
    const l = makeLedger({ ...REFERENCE_SPACE, home: params }, REFERENCE_SYSTEM);
    const density = params.population / (2 * Math.PI * params.radius * params.length);
    for (const id of ['thraxipolis', 'mars-1', 'jupiter-9']) {
      const h = l.habitat(id)!, share = REFERENCE_SYSTEM.crowding[h.form as 'cylinder'];
      const floor = h.form === 'bubble' ? 2 * Math.PI * h.radius * h.radius : 2 * Math.PI * h.radius * h.length;
      assert.ok(Math.abs(h.population - density * share * floor) <= 1, `${name} ${id}`);
    }
    assert.equal(l.habitat('home')!.population, params.population);
  });
}

test('names: every style names, the same from the same seed', () => {
  for (const style of NAME_STYLES) {
    const names = new Set<string>();
    for (let s = 0; s < 400; s++) {
      const n = habitatName(style, s);
      assert.equal(n, habitatName(style, s));
      assert.ok(n.length > 1 && n === n.trim(), `${style}: "${n}"`);
      names.add(n);
    }
    assert.ok(names.size > 100, `${style}: only ${names.size}`);
    if (style === 'grave') for (const n of names) assert.match(n, /polis/);
  }
  assert.equal(mindName(7), mindName(7));
});

/** All the news over a year, in two halves, is the year's news. */
const year = newsIn(ledger, 0, YEAR);

test('news: the same span gives the same news, and any cut of it adds up to the whole', () => {
  assert.deepEqual(newsIn(ledger, 0, YEAR), year);
  const cut = 123.4 * DAY;
  assert.deepEqual([...newsIn(ledger, 0, cut), ...newsIn(ledger, cut, YEAR)], year);
  assert.equal(new Set(year.map((n) => n.id)).size, year.length);
  for (let k = 1; k < year.length; k++) assert.ok(year[k].t >= year[k - 1].t);
  const kinds = new Set(year.map((n) => n.kind));
  for (const k of ['flare', 'ark', 'assembly', 'election']) assert.ok(kinds.has(k as never), k);
  const arks = newsIn(ledger, -YEAR, 30 * YEAR).filter((n) => n.kind === 'ark');
  assert.equal(arks.length, REFERENCE_SYSTEM.news.arks.count);
});

test('news: each place hears of it when its light arrives, the far ones later, never sooner than light', () => {
  for (const n of year.filter((x) => x.kind !== 'flare').slice(0, 6)) {
    const home = heardAt(ledger, n, 'home'), far = heardAt(ledger, n, 'grixmaw');
    assert.ok(home - n.t >= lightTime(ledger.where(n.from, n.t), ledger.where('home', home)) - 1e-6);
    assert.ok(far - n.t > 5 * 3600, `${n.id} reached Grixmaw after ${(far - n.t) / 3600} h`);
    // Heard means heard: listed at home exactly from the moment its light arrives.
    assert.ok(!newsHeard(ledger, 'home', home - 1, DAY).some((h) => h.news.id === n.id));
    assert.ok(newsHeard(ledger, 'home', home + 1, DAY).some((h) => h.news.id === n.id));
  }
});

test('news talk: residents know a piece of news only once it has reached them, and talk of what they know', () => {
  const ark = year.find((n) => n.kind === 'ark')!, heard = heardAt(ledger, ark, 'home');
  const members = [3, 4, 5].map((r) => ({ id: `r${r}`, resident: r }));
  const before = newsTalk(ledger, 'home', heard - 1, members, 9);
  assert.ok(!before || !before.facts.some((f) => f.id === ark.id));
  const late = Math.max(...members.map((m) => learnedAt(ledger, { news: ark, heard }, m.resident)));
  assert.ok(late >= heard && late <= heard + REFERENCE_SYSTEM.news.spread);
  const told = newsTalk(ledger, 'home', late + 1, members, 9, 8)!;
  const fact = told.facts.find((f) => f.id === ark.id)!;
  assert.deepEqual(fact.knownBy, members.map((m) => m.id));
  assert.ok(told.topics.length >= 1);
  for (const f of told.facts) for (const v of Object.values(f.atom.args)) if (typeof v === 'string') assert.ok(v in told.names, `${v} has no name`);
});

/**
 * The habitat's residents as Actors draws them (render/people.ts): each one's look from their seed (`figureLook`), and
 * what their stand-in needs to match it (`dressOf`): their exact standing height, their width and the colours of what
 * they wear. Everything comes from the same look the figure is built from, so the two levels hand over without a
 * change in size or colour (CLAUDE.md, rule 16).
 *
 * The height is the figure's own, worked out without building it: Actors' body is the base mesh plus a weighted sum of
 * morph targets, and its height the span from its lowest to its highest vertex (`ThreeActor.height`). Only the
 * vertices at the soles and the crown can be either, so the height is that sum over a few hundred of them: about half
 * a millisecond a person (most of it Actors' own target weights), against a whole shape's tens of milliseconds. Of
 * each target only its rise at those vertices is kept (a kilobyte); the target itself is let go once read, so
 * measuring a crowd of thousands does not hold the pack's 40 MB of targets (only the figures' worker holds theirs).
 */
import { outfitGarments, randomConfig, seededRandom, type CharacterCatalog, type CharacterConfig } from '@actors/generator';
import { Human, sanitizeRace } from '@actors/human';
import { decodeTarget, type Fetcher, type MorphTarget } from '@actors/core';
import type { Resident } from '../../sim';
import { DYES, SLOT, hexColor, packColor, skinTone } from '../../gen/standIn';
import { packFetch } from './pack';

/** Outfits (Actors' presets) made of separate plain garments, each in one colour of its own. */
const OUTFITS = ['casual', 'sporty', 'layers', 'long-skirt', 'polo', 'cargo', 'summer', 'sport', 'kimono', 'shift-dress', 'halter-dress'] as const;
/** Tops whose sleeves reach the wrist; bottoms that leave the shins bare. */
const LONG_SLEEVES = new Set(['longsleeve', 'fisherman-sweater', 'kimono']);
const BARE_SHINS = new Set(['shorts', 'denim-shorts', 'shift-dress']);
/** Grown bodies span the middle of Actors' height slider (its ends make 1.3 m and 2.3 m adults); shells any. */
const GROWN_HEIGHT = 0.6;
/** A shell stands on its soles and its head plates reach a little over the body (m). */
const SHELL_EXTRA = 0.03;
/**
 * Body vertices to look at for the height: the lowest (soles) and the highest (crown) of the base mesh. Over thousands
 * of residents the lowest vertex of a body was always among the base's lowest 180 and the highest among its highest
 * 25 (test/slow/residents.slow.test.ts checks the height against Actors' own); these leave room on both.
 */
const LOWEST = 260, HIGHEST = 80;
/** Target files fetched at once while measuring (the rest wait their turn). */
const FETCHES = 16;

/** What a stand-in needs of a person: standing height (m), width (× the mean), and colours by slot (packed). */
export interface Dress {
  height: number;
  width: number;
  colors: number[];
}

export class Residents {
  /** The measuring body: a share of the pack's (its runtime and targets), never drawn. */
  private readonly ruler: Human;
  private readonly candidates: Uint32Array;
  /** Each target's rise at the candidates (m per unit weight), made the first time it is needed. */
  private readonly rise = new Map<string, Float32Array>();
  /** Targets asked for, and those not yet fetched. */
  private readonly asked = new Set<string>();
  private readonly queue: string[] = [];
  private fetching = 0;
  private readonly files: Map<string, string>;
  private readonly folder: string;
  private readonly dresses = new Map<number, Dress>();
  private readonly garments: Map<string, string[]>;

  /** `human` is the pack's loaded human (its runtime is shared, nothing is loaded twice); `fetcher` reads its files. */
  constructor(readonly catalog: CharacterCatalog, readonly base: CharacterConfig, readonly human: Human, private readonly fetcher: Fetcher = packFetch) {
    this.ruler = Human.share(human);
    const rt = human.runtime;
    this.files = new Map(rt.manifest.targets.map((t) => [t.name, t.file]));
    this.folder = rt.manifestUrl.slice(0, rt.manifestUrl.lastIndexOf('/') + 1);
    const body = rt.meshes.find((m) => m.def.role === 'body' && !(m as { stencil?: unknown }).stencil);
    const y = rt.basePositions;
    const verts = [...new Set<number>(body ? Array.from((body as unknown as { map: ArrayLike<number> }).map) : [])].sort((a, b) => y[a * 3 + 1] - y[b * 3 + 1]);
    this.candidates = Uint32Array.from([...verts.slice(0, LOWEST), ...verts.slice(-HIGHEST)]);
    this.garments = new Map(catalog.garments.map((g) => [g.id, g.occupies]));
  }

  /** A resident's look: a grown body dressed plainly in their own colours, or a shell. The same resident, the same look. */
  figureLook(r: Resident): CharacterConfig {
    const random = seededRandom(r.look), shell = r.body === 'shell';
    const look = randomConfig(this.catalog, this.base, { random, outfit: false, robot: shell });
    if (shell) return { ...look, robotLook: { ...look.robotLook, glowStrength: Math.min(look.robotLook.glowStrength, 0.25) }, anatomy: false, detail: 'high', animation: null };
    const body = { ...look.body, height: 0.5 + (look.body.height - 0.5) * GROWN_HEIGHT };
    const female = body.gender < 0.5;
    const presets = this.catalog.outfits.filter((p) => (OUTFITS as readonly string[]).includes(p.id) && (!p.gender || (p.gender === 'female') === female));
    const preset = presets.length ? presets[Math.floor(random() * presets.length)] : this.catalog.outfits[0];
    const outfit = outfitGarments(preset, body);
    const garmentColors: Record<string, string> = {};
    for (const g of outfit) garmentColors[g] = DYES[Math.floor(random() * DYES.length)];
    const hairColor = look.hairColor ?? this.catalog.hairColors[Math.floor(random() * this.catalog.hairColors.length)]?.id ?? '#3b2417';
    return { ...look, body, outfit, garmentColors, hairColor, anatomy: false, detail: 'high', animation: null };
  }

  /**
   * What a resident's stand-in wears and how tall it stands, or null while the body's targets are still loading
   * (asked again, it is there). Kept for every resident asked about (a few dozen bytes each).
   */
  dressOf(r: Resident): Dress | null {
    const known = this.dresses.get(r.id);
    if (known) return known;
    const look = this.figureLook(r), height = this.heightOf(look);
    if (height === null) return null;
    const dress = { height: height + (look.robot ? SHELL_EXTRA : 0), width: widthOf(look), colors: this.colorsOf(look) };
    this.dresses.set(r.id, dress);
    return dress;
  }

  /** A resident's dress if it is measured already (by id), without measuring it: the far specks' colours and size. */
  measured(id: number): Dress | undefined {
    return this.dresses.get(id);
  }

  /** Bytes the residents' stand-in data holds (memory watchdog). */
  heldBytes(): number {
    let n = this.dresses.size * 120;
    for (const a of this.rise.values()) n += a.byteLength;
    return n;
  }

  /** Forget the stand-ins' data (memory pressure): it is made again when asked. */
  forget(): void {
    this.dresses.clear();
  }

  /** The figure's standing height (m), or null while its targets load. */
  heightOf(look: CharacterConfig): number | null {
    const h = this.ruler, rt = h.runtime;
    h.params = { ...look.body };
    h.race = sanitizeRace({ race: look.race, race2: look.race2, mix: look.raceMix, size: look.raceSize });
    h.modifierValues = { ...look.details };
    const weights = h.targetWeights();
    let missing = false;
    for (const [name, w] of weights) if (w && !this.rise.has(name)) { missing = true; this.ask(name); }
    if (missing) return null;
    const c = this.candidates, y = new Float64Array(c.length);
    for (let k = 0; k < c.length; k++) y[k] = rt.basePositions[c[k] * 3 + 1];
    for (const [name, w] of weights) {
      if (!w) continue;
      const d = this.rise.get(name)!;
      for (let k = 0; k < c.length; k++) y[k] += w * d[k];
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of y) { if (v < lo) lo = v; if (v > hi) hi = v; }
    // The race's overall scale (1 for humans).
    return (hi - lo) * (h.shapeOptions().scale ?? 1);
  }

  /** Fetch a target (a few at a time), keep its rise at the candidates and let it go. */
  private ask(name: string): void {
    if (this.asked.has(name)) return;
    this.asked.add(name);
    this.queue.push(name);
    this.pump();
  }

  private pump(): void {
    while (this.fetching < FETCHES && this.queue.length) {
      const name = this.queue.shift()!, file = this.files.get(name);
      if (!file) continue;
      this.fetching++;
      void this.fetcher(this.folder + file).then((buf) => { this.rise.set(name, this.riseOf(decodeTarget(buf))); }, () => { this.asked.delete(name); })
        .finally(() => { this.fetching--; this.pump(); });
    }
  }

  private riseOf(t: MorphTarget): Float32Array {
    const c = this.candidates;
    const d = new Float32Array(c.length);
    for (let k = 0; k < c.length; k++) {
      let j = c[k];
      const at = t.indices;
      if (at) {
        let a = 0, b = t.count - 1;
        j = -1;
        while (a <= b) { const m = (a + b) >> 1, v = at[m]; if (v === c[k]) { j = m; break; } if (v < c[k]) a = m + 1; else b = m - 1; }
      } else if (j >= t.count) j = -1;
      if (j >= 0) d[k] = t.deltas[j * 3 + 1] * t.scale;
    }
    return d;
  }

  /** The stand-in's colours by slot (sRGB, packed): the look's skin, hair and garments, or a shell's plates. */
  private colorsOf(look: CharacterConfig): number[] {
    const out = new Array<number>(Object.keys(SLOT).length);
    const set = (slot: keyof typeof SLOT, c: readonly [number, number, number]): void => { out[SLOT[slot]] = packColor(c); };
    if (look.robot) {
      const r = look.robotLook, paint = hexColor(r.paint), trim = hexColor(r.trim);
      for (const s of ['skin', 'hair', 'top', 'sleeve', 'shin'] as const) set(s, paint);
      set('bottom', trim);
      set('shoes', trim);
      return out;
    }
    const skin = look.skinColor ? hexColor(look.skinColor) : look.skin === 'photo' ? (this.human.skinTextureTone(look.body) ?? skinTone(look.skinTone)) : skinTone(look.skinTone);
    const worn = (layer: string): string | undefined => [...look.outfit].reverse().find((g) => this.garments.get(g)?.includes(layer));
    const color = (g: string | undefined, or: readonly [number, number, number]): readonly [number, number, number] => (g && look.garmentColors[g] ? hexColor(look.garmentColors[g]) : or);
    const top = worn('top'), bottom = worn('bottom'), legs = worn('legwear');
    set('skin', skin);
    set('hair', look.hair ? hexColor(look.hairColor ?? '#3b2417') : skin);
    set('top', color(top, skin));
    set('sleeve', top && LONG_SLEEVES.has(top) ? color(top, skin) : skin);
    set('bottom', color(bottom, skin));
    set('shin', bottom && !BARE_SHINS.has(bottom) ? color(bottom, skin) : color(legs, skin));
    set('shoes', color(worn('shoes'), skin));
    return out;
  }
}


/** How broad a body is against the mean: weight, muscle and build. */
function widthOf(look: CharacterConfig): number {
  const b = look.body;
  return 1 + 0.3 * (b.weight - 0.5) + 0.15 * (b.muscle - 0.5) + 0.08 * (b.gender - 0.5);
}

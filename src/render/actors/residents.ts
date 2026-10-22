/**
 * The habitat's residents as Actors draws them (render/people.ts): each one's look from their seed (`figureLook`), and
 * what their stand-in needs to match it (`dressOf`): their exact standing height, their width and the colours of what
 * they wear. Everything comes from the same look the figure is built from, so the two levels hand over without a
 * change in size or colour (CLAUDE.md, rule 16).
 *
 * The height is the figure's own, worked out without building it: Actors' body is the base mesh plus a weighted sum of
 * morph targets, and its height the span from its lowest to its highest vertex (`ThreeActor.height`). Only the
 * vertices at the soles and the crown can be either, so the height is that sum over a few hundred of them: about a
 * tenth of a millisecond a person, against a whole shape's tens of milliseconds.
 */
import { outfitGarments, randomConfig, seededRandom, type CharacterCatalog, type CharacterConfig } from '@actors/generator';
import { Human, sanitizeRace } from '@actors/human';
import type { MorphTarget } from '@actors/core';
import type { Resident } from '../../sim';
import { SLOT, hexColor, packColor } from '../../gen/standIn';

/** Outfits (Actors' presets) made of separate plain garments, each in one colour of its own. */
const OUTFITS = ['casual', 'sporty', 'layers', 'long-skirt', 'polo', 'cargo', 'summer', 'sport', 'kimono', 'shift-dress', 'halter-dress'] as const;
/** Garment colours (sRGB): light, quiet, natural dyes, and a few strong ones. */
const DYES = ['#e6e1d6', '#d2bd98', '#8b8e93', '#5b6470', '#3566a8', '#2f6b45', '#a8b8c0', '#c9a27e', '#f1efe9', '#5f6838', '#8a4b2a', '#b9504a', '#d8b04a', '#1f7a7a', '#3b3f46'];
/** Tops whose sleeves reach the wrist; bottoms that leave the shins bare. */
const LONG_SLEEVES = new Set(['longsleeve', 'fisherman-sweater', 'kimono']);
const BARE_SHINS = new Set(['shorts', 'denim-shorts', 'shift-dress']);
/** Grown bodies span the middle of Actors' height slider (its ends make 1.3 m and 2.3 m adults); shells any. */
const GROWN_HEIGHT = 0.6;
/** A shell stands on its soles and its head plates reach a little over the body (m). */
const SHELL_EXTRA = 0.03;
/** Body vertices to look at for the height: the lowest (soles) and the highest (crown) of the base mesh. */
const LOWEST = 400, HIGHEST = 300;

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
  private readonly waiting = new Set<string>();
  private readonly dresses = new Map<number, Dress>();
  private readonly garments: Map<string, string[]>;

  /** `human` is the pack's loaded human (its runtime is shared, nothing is loaded twice). */
  constructor(readonly catalog: CharacterCatalog, readonly base: CharacterConfig, readonly human: Human) {
    this.ruler = Human.share(human);
    const rt = human.runtime, body = rt.meshes.find((m) => m.def.role === 'body' && !(m as { stencil?: unknown }).stencil);
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
    const weights = h.targetWeights(), missing: string[] = [];
    for (const name of weights.keys()) if (!rt.targets.has(name)) missing.push(name);
    if (missing.length) {
      const asked = missing.filter((m) => !this.waiting.has(m));
      if (asked.length) {
        asked.forEach((m) => this.waiting.add(m));
        void rt.ensureTargets(asked).finally(() => asked.forEach((m) => this.waiting.delete(m)));
      }
      return null;
    }
    const c = this.candidates, y = new Float64Array(c.length);
    for (let k = 0; k < c.length; k++) y[k] = rt.basePositions[c[k] * 3 + 1];
    for (const [name, w] of weights) {
      if (!w) continue;
      const d = this.riseOf(name, rt.targets.get(name)!);
      for (let k = 0; k < c.length; k++) y[k] += w * d[k];
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of y) { if (v < lo) lo = v; if (v > hi) hi = v; }
    // The race's overall scale (1 for humans).
    return (hi - lo) * (h.shapeOptions().scale ?? 1);
  }

  private riseOf(name: string, t: MorphTarget): Float32Array {
    let d = this.rise.get(name);
    if (d) return d;
    const c = this.candidates;
    d = new Float32Array(c.length);
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
    this.rise.set(name, d);
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
    const skin = look.skinColor ? hexColor(look.skinColor) : look.skin === 'photo' ? (this.human.skinTextureTone(look.body) ?? toneOf(look.skinTone)) : toneOf(look.skinTone);
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

/** A procedural skin's colour from its tone (0 light … 1 dark), sRGB. */
function toneOf(t: number): [number, number, number] {
  const light = [0.87, 0.72, 0.62], dark = [0.3, 0.2, 0.15];
  return [0, 1, 2].map((k) => light[k] + (dark[k] - light[k]) * t) as [number, number, number];
}

/** How broad a body is against the mean: weight, muscle and build. */
function widthOf(look: CharacterConfig): number {
  const b = look.body;
  return 1 + 0.3 * (b.weight - 0.5) + 0.15 * (b.muscle - 0.5) + 0.08 * (b.gender - 0.5);
}

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
import { Color, SRGBColorSpace } from 'three/webgpu';
import { outfitGarments, randomConfig, seededRandom, type CharacterCatalog, type CharacterConfig, type OutfitPreset } from '@actors/generator';
import { Human, sanitizeRace } from '@actors/human';
import { decodeTarget, type Fetcher, type MorphTarget } from '@actors/core';
import type { Resident } from '../../sim';
import { DYES, SLOT, hexColor, hexOf, packColor, skinTone } from '../../gen/standIn';
import { packFetch } from './pack';
import { SCREEN_BRIGHTNESS } from './screens';

/**
 * What residents wear (Actors' outfit presets), by share. Most wear the Commonwear of 3026 (Actors' Future wardrobe,
 * eight looks: the everyday wrap and transit trousers; garden commons; the aurora mantle and halo; open courtyard;
 * drift afternoon; the living canvas; comet trails; lightstream), the rest an older cut (an old favourite is no odder
 * in 3026 than a kimono is today), each garment in one plain colour of its own.
 */
const COMMONWEAR: readonly (readonly [string, number])[] = [
  ['future-daily', 0.2], ['future-garden', 0.1], ['future-orbit', 0.08], ['future-courtyard', 0.07],
  ['future-drift', 0.07], ['future-festival', 0.06], ['future-comet', 0.05], ['future-lightstream', 0.04],
];
const CLASSIC = ['casual', 'sporty', 'layers', 'long-skirt', 'polo', 'cargo', 'summer', 'sport', 'kimono', 'shift-dress', 'halter-dress'] as const;
/** Commonwear's tops and pants mix: a Commonwear outfit swaps its own for another of them by `SWAP`. */
const TOPS = ['future-wrap', 'future-vest', 'future-screen'];
const PANTS = ['future-trousers', 'future-flares', 'future-cocoon', 'future-culottes', 'future-screen-leggings', 'future-shorts'];
const SWAP = { top: 0.25, pants: 0.3 };
/**
 * Commonwear's accessories have layers of their own, so they go with anything: each one an outfit's preset has is
 * kept by `keep`, and one it lacks is added by `add`, unless what is worn already takes its layer (a mantle or a
 * bolero, not both; wide pants cover the calves) or it wants other pants (gaiters go over fitted ones). The halo is
 * left off voluminous hair, which it would cut through (Actors has no collision for it).
 */
const ACCESSORIES: readonly { id: string; keep: number; add: number; over?: readonly string[] }[] = [
  { id: 'future-cuffs', keep: 0.8, add: 0.15 },
  { id: 'future-belt', keep: 0.75, add: 0.12 },
  { id: 'future-gaiters', keep: 0.7, add: 0.1, over: ['future-trousers', 'future-screen-leggings', 'future-shorts'] },
  { id: 'future-mantle', keep: 0.85, add: 0.05 },
  { id: 'future-bolero', keep: 0.85, add: 0.04 },
  { id: 'future-sash', keep: 0.8, add: 0.05 },
  { id: 'future-halo', keep: 0.7, add: 0.03 },
];
const ACCESSORY_IDS = ACCESSORIES.map((a) => a.id);
const VOLUMINOUS = new Set(['hair-afro01', 'hair-afro-puffs', 'hair-cloud', 'hair-jungle', 'hair-80s', 'hair-curly-wild', 'hair-curly-long', 'hair-updo-50s', 'hair-braid-bun-high', 'hair-wig-bow']);
/** How often a Commonwear piece keeps its preset's colour (else a dye, or a glow for a screen). */
const PRESET_COLOR = 0.45;
/** Colours a screen glows in (sRGB): the presets' own and a few more, all light (a dark dye would barely glow). */
const GLOWS = ['#70d5e7', '#d5b6fa', '#e8a3f3', '#9ff1dc', '#f6ca8c', '#a1eddd', '#ffd27a', '#8fd0ff', '#ff9fb0', '#b8f28a', '#f4f1ea'];
/**
 * Tops and layers whose sleeves reach the wrist (the bolero's too), or one of them (the wrap's are unequal); bottoms
 * that leave the shins bare, or half of them (the culottes end at mid-calf).
 */
const LONG_SLEEVES = new Set(['longsleeve', 'fisherman-sweater', 'kimono', 'future-screen', 'future-bolero']);
const HALF_SLEEVES = new Set(['future-wrap']);
const BARE_SHINS = new Set(['shorts', 'denim-shorts', 'shift-dress', 'future-shorts']);
const HALF_SHINS = new Set(['future-culottes']);
/** How much of a stand-in's top a mantle or bolero covers, and a sash; of its forearms the cuffs. */
const MANTLE_SHARE = 0.4, SASH_SHARE = 0.15, CUFF_SHARE = 0.4;
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

/**
 * A resident's ancestry, as Actors' three ethnic weights. A thousand years on, people's forebears come from everywhere,
 * and their skin spans the whole range from dark to light evenly. Actors' own pick leans light (two of its three photo
 * skins, which follow these weights, are light), so the weight of the dark one is drawn evenly here and the rest split
 * between the other two. Drawn after the rest of the look, which stays as it was.
 */
function mixOf(random: () => number): { african: number; asian: number; caucasian: number } {
  const dark = random(), split = random();
  return { african: dark, asian: (1 - dark) * split, caucasian: (1 - dark) * (1 - split) };
}

/**
 * Whether figures wear Actors' photo skins (else its procedural skin in the photos' mean colour). Their textures are
 * per-figure inputs of a shared material; the Stage rebinds them when they switch (@futuremagic/stage patches.ts
 * `rebindSwitchedTextures`), without which every skin came out nearly white.
 */
const PHOTO_SKIN = true;

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
  /** The pack's screen garments (`fabric:screen`), which glow. */
  private readonly screens: Set<string>;

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
    this.screens = new Set<string>();
    for (const m of rt.manifest.meshes) if (m.tags?.includes('fabric:screen')) this.screens.add(m.name);
  }

  /** A resident's look: a grown body dressed plainly in their own colours, or a shell. The same resident, the same look. */
  figureLook(r: Resident): CharacterConfig {
    return this.lookFrom(r.look, r.body === 'shell');
  }

  /** The look from a seed (a resident's `look`, or anyone's met outside the population: the arrival's passengers). */
  lookFrom(seed: number, shell = false): CharacterConfig {
    const random = seededRandom(seed);
    const look = randomConfig(this.catalog, this.base, { random, outfit: false, robot: shell });
    if (shell) return { ...look, robotLook: { ...look.robotLook, glowStrength: Math.min(look.robotLook.glowStrength, 0.25) }, anatomy: false, detail: 'high', animation: null };
    const body = { ...look.body, height: 0.5 + (look.body.height - 0.5) * GROWN_HEIGHT };
    const { outfit, garmentColors } = this.dress(random, body, look.hair);
    const hairColor = look.hairColor ?? this.catalog.hairColors[Math.floor(random() * this.catalog.hairColors.length)]?.id ?? '#3b2417';
    const grown = { ...body, ...mixOf(random) }, tone = this.human.skinTextureTone(grown);
    // The skin's colour is the photo skins' own mean, so it is the same in either kind of skin (PHOTO_SKIN).
    const skin = PHOTO_SKIN && look.skin === 'photo' ? 'photo' : 'procedural', skinColor = tone ? hexOf(tone) : look.skinColor;
    return { ...look, body: grown, skin, skinColor, outfit, garmentColors, hairColor, anatomy: false, detail: 'high', animation: null };
  }

  /** An outfit and its colours: Commonwear or an older cut by their shares, its accessories each by its own chance. */
  private dress(random: () => number, body: CharacterConfig['body'], hair: string | null): { outfit: string[]; garmentColors: Record<string, string> } {
    const female = body.gender < 0.5, fits = (p: OutfitPreset): boolean => !p.gender || (p.gender === 'female') === female;
    const byId = new Map(this.catalog.outfits.map((p) => [p.id, p]));
    let x = random(), preset: OutfitPreset | undefined;
    for (const [id, share] of COMMONWEAR) if (!preset && (x -= share) < 0) preset = byId.get(id);
    const classic = CLASSIC.map((id) => byId.get(id)).filter((p): p is OutfitPreset => !!p && fits(p));
    preset ??= classic.length ? classic[Math.floor(random() * classic.length)] : this.catalog.outfits[0];
    const oneOf = (list: readonly string[]): string => list[Math.floor(random() * list.length)];
    const outfit = outfitGarments(preset, body).filter((g) => !ACCESSORY_IDS.includes(g));
    if (preset.id.startsWith('future-')) for (const [kind, share] of [[TOPS, SWAP.top], [PANTS, SWAP.pants]] as const) {
      const k = outfit.findIndex((g) => kind.includes(g));
      if (k >= 0 && random() < share) outfit[k] = oneOf(kind.filter((g) => g !== outfit[k] && this.garments.has(g)));
    }
    const taken = new Set(outfit.flatMap((g) => this.garments.get(g) ?? []));
    for (const a of ACCESSORIES) {
      const has = preset.garments.includes(a.id), roll = random(), layers = this.garments.get(a.id);
      if (roll >= (has ? a.keep : a.add) || !layers || layers.some((l) => taken.has(l)) || (a.over && !a.over.some((g) => outfit.includes(g)))) continue;
      if (a.id === 'future-halo' && hair && VOLUMINOUS.has(hair)) continue;
      outfit.push(a.id);
      for (const l of layers) taken.add(l);
    }
    const garmentColors: Record<string, string> = {};
    for (const g of outfit) {
      const own = preset.colors?.[g], keep = random() < PRESET_COLOR;
      garmentColors[g] = own && keep ? own : this.screens.has(g) ? oneOf(GLOWS) : oneOf(DYES);
    }
    return { outfit, garmentColors };
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
    // A screen looks as bright as its dark base and its glow together (screens.ts); mixed in linear light.
    const color = (g: string | undefined, or: readonly [number, number, number]): readonly [number, number, number] => {
      if (!g || !look.garmentColors[g]) return or;
      const c = hexColor(look.garmentColors[g]);
      return this.screens.has(g) ? blendLinear(BLACK, c, SCREEN_BRIGHTNESS) : c;
    };
    const top = worn('top'), bottom = worn('bottom'), legs = worn('legwear'), mantle = worn('mantle'), sash = worn('sash'), cuffs = worn('wrists'), gaiters = worn('gaiters');
    const layered = mantle ? blendLinear(color(top, skin), color(mantle, skin), MANTLE_SHARE) : color(top, skin);
    const torso = sash ? blendLinear(layered, color(sash, skin), SASH_SHARE) : layered;
    const sleeved = mantle && LONG_SLEEVES.has(mantle) ? mantle : top;
    const arm = sleeved && LONG_SLEEVES.has(sleeved) ? color(sleeved, skin) : top && HALF_SLEEVES.has(top) ? blendLinear(skin, color(top, skin), 0.5) : skin;
    const below = bottom && BARE_SHINS.has(bottom) ? color(legs, skin) : bottom && HALF_SHINS.has(bottom) ? blendLinear(color(legs, skin), color(bottom, skin), 0.5) : color(bottom, skin);
    set('skin', skin);
    set('hair', look.hair ? hexColor(look.hairColor ?? '#3b2417') : skin);
    set('top', torso);
    set('sleeve', cuffs ? blendLinear(arm, color(cuffs, skin), CUFF_SHARE) : arm);
    set('bottom', color(bottom, skin));
    set('shin', gaiters ? color(gaiters, skin) : below);
    set('shoes', color(worn('shoes'), skin));
    return out;
  }
}


const ca = new Color(), cb = new Color();
type RGB = readonly [number, number, number];
const BLACK: RGB = [0, 0, 0];
/** Two sRGB colours mixed in linear light, `share` of the second (from black: the second scaled by `share`). */
function blendLinear(a: RGB, b: RGB, share: number): RGB {
  ca.setRGB(a[0], a[1], a[2], SRGBColorSpace).lerp(cb.setRGB(b[0], b[1], b[2], SRGBColorSpace), share);
  const o = { r: 0, g: 0, b: 0 };
  ca.getRGB(o, SRGBColorSpace);
  return [o.r, o.g, o.b];
}

/** How broad a body is against the mean: weight, muscle and build. */
function widthOf(look: CharacterConfig): number {
  const b = look.body;
  return 1 + 0.3 * (b.weight - 0.5) + 0.15 * (b.muscle - 0.5) + 0.08 * (b.gender - 0.5);
}

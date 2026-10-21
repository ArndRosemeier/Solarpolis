/**
 * Ported from Dunfinity src/render/actors/animator.ts (the plan asks Actors to take it over; then this goes).
 *
 * The game's animator for Actors figures: what a figure does (move state, a one-shot action over
 * it, a mood, a blow) played with the pack's clips on the figure's own mixer.
 *
 * Every clip is baked for the figure's body and split in two halves: the legs and hips (lower) and
 * the spine, arms and head (upper). Movement drives both halves; an action or a flinch takes the
 * upper half over the movement, so a figure can swing while it walks. Movement clips cross-fade
 * and keep their stride in step with the ground speed.
 */
import { AnimationClip, LoopOnce, LoopRepeat, type AnimationAction, type AnimationMixer, type KeyframeTrack } from 'three/webgpu';
import type { Clip } from '@actors/core';
import type { Character } from '@actors/generator';

/** What a figure does, as the game says it (the same words the old humans took). */
export type MoveState =
  | 'idle' | 'walk' | 'run' | 'sprint' | 'crouch' | 'swim' | 'fly' | 'fall' | 'jump' | 'climb' | 'glide'
  | 'sit' | 'sleep' | 'dead' | 'stunned' | 'knockdown';

export type Mood = 'neutral' | 'happy' | 'angry' | 'sad' | 'afraid' | 'surprised' | 'disgusted' | 'focused' | 'pain';

/** A one-shot action: `id` (e.g. "swing_1h", "throw"), started at `t0` on the game clock, `dur` seconds long. */
export interface ActionAnim {
  id: string;
  t0: number;
  dur: number;
}

export interface AnimState {
  move: MoveState;
  action?: ActionAnim;
  mood?: Mood;
}

/** One frame of what the figure does: its state, ground speed (m/s) and the game clock. */
export interface AnimInput {
  anim: AnimState;
  speed: number;
  time: number;
  /** Holds a weapon ready (a fighting stance when standing). */
  combat?: boolean;
}

interface MoveClip {
  /** Pack clip. */
  clip: string;
  /** Plays once and holds its last pose (death, knocked down). */
  once?: boolean;
  /** Matches its stride to the ground speed. */
  stride?: boolean;
}

/** The pack clip for each move state (a crouch that moves walks crouched). */
function moveClip(move: MoveState, speed: number, combat: boolean): MoveClip {
  switch (move) {
    case 'walk': return { clip: 'walk', stride: true };
    case 'run': return { clip: 'jog', stride: true };
    case 'sprint': return { clip: 'sprint', stride: true };
    case 'crouch': return speed > 0.2 ? { clip: 'crouch walk', stride: true } : { clip: 'crouch' };
    case 'swim': return speed > 0.3 ? { clip: 'swim' } : { clip: 'tread water' };
    case 'jump': case 'fall': case 'fly': case 'glide': return { clip: 'jump' };
    case 'climb': return { clip: 'climb up' };
    case 'sit': case 'sleep': return { clip: 'sit' };
    case 'dead': return { clip: 'death', once: true };
    case 'knockdown': return { clip: 'knocked back', once: true };
    case 'stunned': return { clip: 'zombie idle' };
    default: return { clip: combat ? 'sword idle' : 'idle' };
  }
}

/** The pack clip for each of the game's action ids (anything else: a jab). */
const ACTION_CLIPS: Record<string, string> = {
  swing_1h: 'sword slash A',
  slam: 'chop wood',
  mine: 'chop wood',
  chop: 'chop wood',
  stab: 'punch jab',
  swat: 'hook',
  block: 'sword block',
  cast_forward: 'spell cast',
  cheer: 'spell raise',
  talk: 'talk',
  throw: 'throw',
  pickup: 'pick up',
  harvest: 'harvest',
  roll: 'roll',
};

/** Actions that move the whole body (the legs too), not just the arms. */
const WHOLE_BODY = new Set(['roll', 'pick up', 'harvest']);

/** The face for each mood (Actors' expressions). */
const MOOD_FACE: Record<Mood, string> = {
  neutral: 'neutral', happy: 'smile', angry: 'angry', sad: 'sad', afraid: 'fear', surprised: 'surprise', disgusted: 'disgust', focused: 'neutral', pain: 'fear',
};

/** The clips every figure may need, loaded before it is first drawn. */
export const FIGURE_CLIPS = [...new Set([
  'idle', 'sword idle', 'walk', 'jog', 'sprint', 'crouch', 'crouch walk', 'swim', 'tread water', 'jump', 'climb up', 'sit', 'death',
  'knocked back', 'zombie idle', 'hit to chest', ...Object.values(ACTION_CLIPS),
])];

/** Bones of the lower half (the rest is the upper half). */
const LOWER = /^(Root|pelvis|thigh_|calf_|foot_|ball_)/;

/** Cross-fade time between movement clips, seconds. */
const FADE = 0.25;

interface Halves {
  lower: AnimationAction;
  upper: AnimationAction;
  /** Ground speed the clip's stride covers (m/s; 0 for clips that stand). */
  speed: number;
}

interface Playing extends Halves {
  name: string;
  weight: number;
}

export class FigureAnimator {
  private readonly mixer: AnimationMixer;
  private readonly baked = new Map<string, Halves>();
  /** Movement clips fading in or out; the last is the current one. */
  private moves: Playing[] = [];
  private action: { halves: Halves; whole: boolean; weight: number } | null = null;
  private flinch: { halves: Halves; t: number; strength: number } | null = null;
  private mood: Mood = 'neutral';
  private hit = 0;

  constructor(private readonly character: Character) {
    this.mixer = character.actor.mixer;
    // A new body shape (the editor) moves the joints: bake the clips again.
    character.onShape(() => this.rebake());
  }

  /** Loads the clips (each file once for all figures). */
  async load(): Promise<void> {
    await Promise.all(FIGURE_CLIPS.map((c) => this.character.loadClip(c).then((clip) => this.loaded.set(c, clip), () => {})));
  }

  /** A blow from direction (dirX, dirZ), strength 0..1: the upper body jerks back. */
  onHit(_dirX: number, _dirZ: number, strength: number): void {
    this.hit = Math.max(this.hit, Math.min(1, strength));
  }

  update(input: AnimInput, dt: number): void {
    const { anim, speed, time } = input;
    if (this.hit > 0) {
      const halves = this.halves('hit to chest');
      if (halves) {
        this.flinch?.halves.upper.stop();
        this.flinch = { halves, t: 0, strength: this.hit };
        halves.upper.reset().play();
      }
      this.hit = 0;
    }
    this.updateMove(moveClip(anim.move, speed, !!input.combat), speed, dt);
    const actionWeight = this.updateAction(anim.action, time, dt);
    const flinchWeight = this.updateFlinch(dt);
    const upperFree = Math.max(0, 1 - actionWeight - flinchWeight);
    const lowerFree = this.action?.whole ? Math.max(0, 1 - actionWeight) : 1;
    for (const m of this.moves) {
      m.lower.setEffectiveWeight(m.weight * lowerFree);
      m.upper.setEffectiveWeight(m.weight * upperFree);
    }
    this.setMood(anim.mood ?? 'neutral');
  }

  /** Stops every clip (the figure is put away). */
  stop(): void {
    this.mixer.stopAllAction();
    this.moves = [];
    this.action = null;
    this.flinch = null;
  }

  private updateMove(want: MoveClip, speed: number, dt: number): void {
    const current = this.moves[this.moves.length - 1];
    if (current?.name !== want.clip) {
      const halves = this.halves(want.clip);
      if (halves) {
        const old = this.moves.find((m) => m.name === want.clip);
        if (old) this.moves = this.moves.filter((m) => m !== old);
        const next: Playing = old ?? { ...halves, name: want.clip, weight: current ? 0 : 1 };
        for (const a of [next.lower, next.upper]) {
          a.setLoop(want.once ? LoopOnce : LoopRepeat, Infinity);
          a.clampWhenFinished = !!want.once;
          if (!old) {
            a.reset().play();
            // Walking into a run keeps the feet in step.
            if (current && want.stride && current.speed > 0) a.time = (current.lower.time / current.lower.getClip().duration) * a.getClip().duration;
          }
        }
        this.moves.push(next);
      }
    }
    const top = this.moves[this.moves.length - 1];
    if (!top) return;
    const step = dt / FADE;
    for (const m of this.moves) m.weight = m === top ? Math.min(1, m.weight + step) : Math.max(0, m.weight - step);
    for (const m of this.moves.filter((x) => x !== top && x.weight <= 0)) {
      m.lower.stop();
      m.upper.stop();
    }
    this.moves = this.moves.filter((m) => m === top || m.weight > 0);
    const scale = want.stride && top.speed > 0 ? Math.min(1.6, Math.max(0.6, speed / top.speed)) : 1;
    top.lower.timeScale = top.upper.timeScale = scale;
  }

  /** Poses the action at its place on the game clock; returns how much of the upper body it takes. */
  private updateAction(action: ActionAnim | undefined, time: number, dt: number): number {
    const name = action ? (ACTION_CLIPS[action.id] ?? 'punch jab') : null;
    const progress = action ? (time - action.t0) / Math.max(0.05, action.dur) : 1;
    const halves = name && progress >= 0 && progress < 1 ? this.halves(name) : undefined;
    if (this.action && this.action.halves !== halves) {
      this.action.weight = Math.max(0, this.action.weight - dt / 0.15);
      if (this.action.weight <= 0) {
        this.action.halves.upper.stop();
        this.action.halves.lower.stop();
        this.action = null;
      }
    }
    if (halves && name && (!this.action || this.action.halves === halves)) {
      if (!this.action) {
        this.action = { halves, whole: WHOLE_BODY.has(name), weight: 0 };
        for (const a of [halves.upper, halves.lower]) {
          a.setLoop(LoopOnce, 1);
          a.clampWhenFinished = true;
          a.reset().play();
          a.paused = true;
        }
        if (!this.action.whole) halves.lower.stop();
      }
      // The game clock places the pose, so the action lasts exactly as long as the game says.
      const d = halves.upper.getClip().duration;
      halves.upper.time = halves.lower.time = Math.min(d - 1e-3, progress * d);
      const edge = Math.min(progress, 1 - progress) * action!.dur;
      this.action.weight = Math.min(1, edge / 0.12 + 0.05);
    }
    if (!this.action) return 0;
    this.action.halves.upper.setEffectiveWeight(this.action.weight);
    if (this.action.whole) this.action.halves.lower.setEffectiveWeight(this.action.weight);
    return this.action.weight;
  }

  private updateFlinch(dt: number): number {
    const f = this.flinch;
    if (!f) return 0;
    f.t += dt;
    const d = Math.min(0.6, f.halves.upper.getClip().duration);
    if (f.t >= d) {
      f.halves.upper.stop();
      this.flinch = null;
      return 0;
    }
    const w = Math.sin((f.t / d) * Math.PI) * (0.4 + 0.6 * f.strength);
    f.halves.upper.setEffectiveWeight(w);
    return w;
  }

  private setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    void this.character.set({ expression: MOOD_FACE[mood] ?? 'neutral' });
  }

  /** The clip baked for this body and split in halves (null until its file is loaded). */
  private halves(name: string): Halves | undefined {
    const known = this.baked.get(name);
    if (known) return known;
    const clip = this.loaded.get(name);
    if (!clip) {
      this.fetch(name);
      return undefined;
    }
    const actor = this.character.actor;
    const three = actor.toThreeClip(clip);
    const half = (keep: (t: KeyframeTrack) => boolean, suffix: string) => new AnimationClip(`${name}/${suffix}`, three.duration, three.tracks.filter(keep));
    const isLower = (t: KeyframeTrack) => LOWER.test(t.name.split('.')[0]);
    const halves: Halves = {
      lower: this.mixer.clipAction(half(isLower, 'lower')),
      upper: this.mixer.clipAction(half((t) => !isLower(t), 'upper')),
      speed: strideSpeed(this.character, clip),
    };
    this.baked.set(name, halves);
    return halves;
  }

  private readonly loaded = new Map<string, Clip>();
  private readonly fetching = new Set<string>();

  private fetch(name: string): void {
    if (this.fetching.has(name)) return;
    this.fetching.add(name);
    this.character.loadClip(name).then((c) => this.loaded.set(name, c), () => {});
  }

  /** Drops the baked clips; the next frame bakes what it plays for the new body. */
  private rebake(): void {
    this.stop();
    for (const h of this.baked.values()) {
      this.mixer.uncacheClip(h.lower.getClip());
      this.mixer.uncacheClip(h.upper.getClip());
    }
    this.baked.clear();
  }
}

/** How fast a clip's stride carries the body over the ground (m/s), from its root motion. */
function strideSpeed(character: Character, clip: Clip): number {
  const actor = character.actor;
  const was = actor.inPlace;
  actor.inPlace = false;
  try {
    const moving = actor.toThreeClip(clip);
    const root = moving.tracks.find((t) => t.name.endsWith('.position'));
    if (!root || moving.duration <= 0) return 0;
    const v = root.values, n = v.length;
    const dist = Math.hypot(v[n - 3] - v[0], v[n - 1] - v[2]);
    return dist / moving.duration;
  } finally {
    actor.inPlace = was;
  }
}

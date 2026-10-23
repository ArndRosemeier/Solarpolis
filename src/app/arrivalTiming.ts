/**
 * How the arrival hides the game's warm-up (Arnd, 2026-10-23: the arrival is a cinematic, and the interior warms up
 * behind it, so the game has to start fast). The arrival is the loading screen. This module measures whether it does
 * that job: how long until the title flies, when the interior and the player's body were ready after Start, whether
 * the curtain at the end of the flight had to wait for them, and whether the flight stuttered while they were built
 * (its slowest frames, and the shaders built while it flew, from both views' shader monitors).
 *
 * One line in the debug menu (and so in every render report). The clock is injected so it is tested headless
 * (test/arrivalTiming.test.ts); main.ts passes `performance.now`, whose zero is when the page opened.
 */
import type { ShaderEvent } from '@futuremagic/stage';

/** The moments marked, in the order they come. */
export type ArrivalMark =
  /** The title's attract loop is flying. */
  | 'title'
  /** Start was pressed: the flight begins. */
  | 'start'
  /** The Inside view is built (its warm-up and first tiles). */
  | 'inside'
  /** The player's body is loaded and its shaders warmed. */
  | 'body'
  /** The ship has berthed and the crossing ended: the curtain starts to close. */
  | 'flown'
  /** The curtain is closed. */
  | 'closed'
  /** The arrival terrace (or the Hub) is ready behind it. */
  | 'ready'
  /** The curtain is open again: the player is inside. */
  | 'open';

/** A frame longer than this (ms) is a stutter: it missed two refreshes at 60 Hz. */
export const STUTTER_MS = 1000 / 30 + 1;

/** Shader builds that block the main thread (the monitor's own list: the async ones yield). */
const BLOCKING: ReadonlySet<ShaderEvent['kind']> = new Set(['node-sync', 'gpu-module', 'gpu-pipeline-sync', 'gl-link']);
/** Builds that start a new shader. */
const STARTS: ReadonlySet<ShaderEvent['kind']> = new Set(['node-sync', 'node-async']);

/** Where shader builds are recorded: a Stage's monitor. */
export interface ShaderLog { readonly events: readonly ShaderEvent[] }

export interface FlightFrames {
  /** Frames drawn while flying. */
  count: number;
  /** Their total time (ms). */
  ms: number;
  /** The slowest (ms). */
  slowest: number;
  /** How many were stutters (over `STUTTER_MS`). */
  stutters: number;
}

export interface FlightShaders {
  /** Shaders started while flying. */
  built: number;
  /** The longest any build blocked the main thread (ms). */
  worst: number;
  /** All the time builds blocked it (ms). */
  blocked: number;
}

/** A script that ran in a long frame (a Long Animation Frame entry's script, as the browser names it). */
export interface LongScript {
  /** What called it: an event, a callback, a resolved promise. */
  invoker: string;
  sourceURL: string;
  sourceFunctionName: string;
  /** Where in the source the function starts (characters; maps to the code through the build's source map). */
  sourceCharPosition: number;
  duration: number;
}

/** A frame that took long, and the scripts that made it long (Chrome's Long Animation Frames). */
export interface LongFrame {
  startTime: number;
  duration: number;
  scripts: readonly LongScript[];
}

/** The longest frames kept from the flight, and the scripts kept per frame. */
const KEPT_FRAMES = 12;
const KEPT_SCRIPTS = 3;
/** The loading notes kept after Start. */
const KEPT_NOTES = 40;

export class ArrivalTiming {
  /** What the views said they load, when (`note`). */
  private readonly notes: { what: string; t: number }[] = [];
  /** The flight's longest frames, longest first. */
  readonly longFrames: LongFrame[] = [];
  private readonly marks = new Map<ArrivalMark, number>();
  private readonly frames: FlightFrames = { count: 0, ms: 0, slowest: 0, stutters: 0 };
  private readonly logs: { name: string; log: () => ShaderLog | null }[] = [];

  constructor(private readonly now: () => number) {}

  /** Mark a moment (the first time only: a second Start after going back to the title keeps the first figures). */
  mark(what: ArrivalMark): void {
    if (what === 'start' && this.marks.has('start')) return;
    if (!this.marks.has(what)) this.marks.set(what, this.now());
  }

  /** When a moment was marked (ms on the clock), or null. */
  at(what: ArrivalMark): number | null {
    return this.marks.get(what) ?? null;
  }

  /** Whether the flight is under way: after Start, before the curtain closed. */
  get flying(): boolean {
    return this.marks.has('start') && !this.marks.has('closed');
  }

  /** One frame took `ms`: counted while the flight is under way. */
  countFrame(ms: number): void {
    if (!this.flying) return;
    const f = this.frames;
    f.count++;
    f.ms += ms;
    f.slowest = Math.max(f.slowest, ms);
    if (ms > STUTTER_MS) f.stutters++;
  }

  /** A view says what it loads (render/loadLog.ts): kept from Start on (the first `KEPT_NOTES`). */
  note(what: string): void {
    if (!this.marks.has('start') || this.notes.length >= KEPT_NOTES) return;
    this.notes.push({ what, t: this.now() });
  }

  /** The debug menu's line on what loaded when after Start (s). */
  loadingLine(): string {
    const start = this.marks.get('start');
    if (start === undefined || !this.notes.length) return '';
    return `arrival's loading: ${this.notes.map((n) => `${((n.t - start) / 1000).toFixed(1)} ${n.what}`).join(' · ')}`;
  }

  /** A long frame the browser reported: kept while the flight is under way, the longest few. */
  longFrame(frame: LongFrame): void {
    const from = this.marks.get('start'), to = this.marks.get('closed') ?? Infinity;
    if (from === undefined || frame.startTime < from || frame.startTime > to) return;
    const scripts = [...frame.scripts].sort((a, b) => b.duration - a.duration).slice(0, KEPT_SCRIPTS);
    this.longFrames.push({ startTime: frame.startTime, duration: frame.duration, scripts });
    this.longFrames.sort((a, b) => b.duration - a.duration);
    this.longFrames.length = Math.min(this.longFrames.length, KEPT_FRAMES);
  }

  /** The debug menu's line on the flight's longest frames: when after Start, how long, and the scripts that ran in them. */
  stutterLine(): string {
    const start = this.marks.get('start');
    if (start === undefined || !this.longFrames.length) return '';
    const file = (url: string): string => url.slice(url.lastIndexOf('/') + 1) || '?';
    return `arrival's long frames: ${this.longFrames.map((f) => `${((f.startTime - start) / 1000).toFixed(1)} s ${f.duration.toFixed(0)} ms [${f.scripts.map((x) => `${x.invoker} ${x.sourceFunctionName || '?'} ${file(x.sourceURL)}@${x.sourceCharPosition} ${x.duration.toFixed(0)} ms`).join('; ')}]`).join(' · ')}`;
  }

  /** Watch a view's shader builds (`log` returns null until the view exists). */
  watchShaders(name: string, log: () => ShaderLog | null): void {
    this.logs.push({ name, log });
  }

  get flightFrames(): Readonly<FlightFrames> {
    return this.frames;
  }

  /** The shaders built while the flight was under way, in every watched view. */
  flightShaders(): FlightShaders {
    const out: FlightShaders = { built: 0, worst: 0, blocked: 0 }, from = this.marks.get('start');
    if (from === undefined) return out;
    const to = this.marks.get('closed') ?? Infinity;
    for (const { log } of this.logs) for (const e of log()?.events ?? []) {
      if (e.t < from || e.t > to) continue;
      if (STARTS.has(e.kind)) out.built++;
      if (BLOCKING.has(e.kind)) { out.worst = Math.max(out.worst, e.ms); out.blocked += e.ms; }
    }
    return out;
  }

  /** How long the closed curtain waited for the land behind it (ms), once it is known. */
  get curtainWait(): number | null {
    const closed = this.marks.get('closed'), ready = this.marks.get('ready');
    return closed === undefined || ready === undefined ? null : Math.max(0, ready - closed);
  }

  /** The debug menu's line. */
  arrivalLine(): string {
    const s = (ms: number): string => `${(ms / 1000).toFixed(1)} s`, m = this.marks;
    const title = m.get('title'), start = m.get('start');
    const parts = [`arrival: title ${title === undefined ? 'not yet' : `${s(title)} after opening`}`];
    if (start === undefined) return `${parts[0]} · not started`;
    const since = (what: ArrivalMark): string => { const t = m.get(what); return t === undefined ? 'not yet' : s(Math.max(0, t - start)); };
    parts.push(`after Start: interior ${since('inside')}, body ${since('body')}, flight ${since('flown')}`);
    const flown = m.get('flown'), inside = m.get('inside');
    if (flown !== undefined && inside !== undefined) parts.push(inside <= flown ? `interior ready ${s(flown - inside)} before the curtain` : `interior ${s(inside - flown)} late`);
    const wait = this.curtainWait;
    if (wait !== null) parts.push(`curtain waited ${s(wait)}`);
    const f = this.frames, sh = this.flightShaders();
    if (f.count) parts.push(`flight ${(1000 * f.count / Math.max(1, f.ms)).toFixed(0)} fps, slowest frame ${f.slowest.toFixed(0)} ms, ${f.stutters} stutters`);
    parts.push(`${sh.built} shaders built in flight (worst ${sh.worst.toFixed(0)} ms, ${sh.blocked.toFixed(0)} ms blocked)`);
    return parts.join(' · ');
  }
}

/**
 * The frame tree: every position in the game names the frame it lives in, and this is the one way between frames.
 * Each frame has a parent and a pose in it that depends on the clock; the root is the heliocentric J2000 ecliptic
 * frame. All in 64-bit numbers.
 *
 * Transforms go through the nearest common ancestor, never through the root unless they must, so two points inside
 * one habitat convert without passing through numbers the size of an astronomical unit.
 */
import type { Vec3 } from '@futuremagic/core';
import { apply, compose, invert, ORIGIN, type Pose } from './pose';

export interface Frame {
  id: string;
  /** The parent frame's id; null only for the root. */
  parent: string | null;
  /** This frame's pose in its parent at clock time t (s). */
  pose(t: number): Pose;
}

export class FrameTree {
  private frames = new Map<string, Frame>();

  constructor(readonly root: string) {
    this.frames.set(root, { id: root, parent: null, pose: () => ORIGIN });
  }

  add(frame: Frame): void {
    if (this.frames.has(frame.id)) throw new Error(`frames: '${frame.id}' already exists`);
    if (frame.parent === null || !this.frames.has(frame.parent)) throw new Error(`frames: parent '${frame.parent}' of '${frame.id}' is unknown`);
    this.frames.set(frame.id, frame);
  }

  has(id: string): boolean {
    return this.frames.has(id);
  }

  /** The chain from a frame up to the root, the frame first. */
  private chain(id: string): string[] {
    const out: string[] = [];
    for (let f = this.get(id); ; f = this.get(f.parent as string)) {
      out.push(f.id);
      if (f.parent === null) return out;
    }
  }

  private get(id: string): Frame {
    const f = this.frames.get(id);
    if (!f) throw new Error(`frames: unknown frame '${id}'`);
    return f;
  }

  /** The pose of frame `from` written in frame `to` at time t. */
  relative(from: string, to: string, t: number): Pose {
    const up = this.chain(from), down = this.chain(to);
    const shared = new Set(down);
    const common = up.find((id) => shared.has(id)) as string;
    let fromInCommon = ORIGIN;
    for (const id of up) {
      if (id === common) break;
      fromInCommon = compose(this.get(id).pose(t), fromInCommon);
    }
    let toInCommon = ORIGIN;
    for (const id of down) {
      if (id === common) break;
      toInCommon = compose(this.get(id).pose(t), toInCommon);
    }
    return compose(invert(toInCommon), fromInCommon);
  }

  /** A position given in frame `from`, written in frame `to`. */
  position(p: Vec3, from: string, to: string, t: number): Vec3 {
    const r = this.relative(from, to, t);
    const q = apply(r.axes, p);
    return [q[0] + r.origin[0], q[1] + r.origin[1], q[2] + r.origin[2]];
  }

  /** A direction (or velocity-free vector) given in frame `from`, written in frame `to`. */
  direction(v: Vec3, from: string, to: string, t: number): Vec3 {
    return apply(this.relative(from, to, t).axes, v);
  }
}

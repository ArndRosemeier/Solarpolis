/**
 * Everyone up on the land beyond the people drawn near (render/people.ts), as specks: the whole habitat's people
 * worked out in a worker every few seconds (sim/specks.ts), drawn as one layer (the SPECK kind) in which each person is
 * the patch of screen their body covers, as faint as it is small. So a person never vanishes with distance (a crowd on
 * the far side stays as the tint it makes), and walkers keep walking between lists (`speckClock`).
 *
 * A new list is drawn from the frame it is ready: it is put on the GPU first (its CPU copy let go), then swapped in for
 * the old one in one frame. Whoever the near levels draw (a figure, a stand-in, or their own speck with its exact place
 * and colours) is not drawn here: `follow` is given their keys each frame and turns their specks off (CLAUDE.md, rule
 * 16: the near level shows them before this one lets go).
 */
import { Group, InstancedBufferAttribute, type Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import type { Habitat } from '../blueprint';
import { SPECK_SHOWN, SPECK_STRIDE, speckBands } from '../gen/standIn';
import type { Specks } from '../sim/specks';
import type { WorkerPool } from '../workers/pool';
import { SPECK, SPECK_LAYOUT, peopleInstances } from './materials';
import { speckClock } from './crowdShaders';
import { drawnAnywhere, dropUploaded, freeMesh, quadInstances } from './geometry';
import type { Residents } from './actors/residents';

/** A new list is asked for this often (s, real time), or once the clock is this far from the drawn one's (s). */
const SPECKS_EVERY = 3;
const SPECKS_AHEAD = 5;
/** Walkers are carried on from their list's time at most this long (s): after a jump in the clock they wait for the next list. */
const CARRY = 10;

/** A list on the GPU: its mesh, who is in it (by key, ascending) and which of them are drawn. */
interface Drawn {
  mesh: Mesh;
  t: number;
  key: Float64Array;
  shown: InstancedBufferAttribute;
  /** The frame each speck was last found drawn by a nearer level, and those turned off now. */
  stamp: Uint32Array;
  off: number[];
  gpuBytes: number;
}

export class SpeckView {
  readonly group = new Group();
  private drawn: Drawn | null = null;
  private ready: Drawn | null = null;
  private asking = false;
  private askedAt = -Infinity;
  private clock = 0;
  private frameNo = 0;
  private lists = 0;
  private slowest = 0;
  private disposed = false;

  constructor(private readonly habitat: Habitat, private readonly stage: Stage, private readonly pool: WorkerPool) {
    this.group.name = 'specks';
  }

  /**
   * Bring the specks up to clock time t (s). `near`: the keys (`personKey`) of everyone a nearer level draws this frame;
   * `residents`: the measured looks (their colours and size replace the guess), once loaded. `dt`: the frame's (s).
   */
  follow(t: number, dt: number, near: Iterable<number>, residents: Residents | null): void {
    this.clock += dt;
    this.frameNo++;
    if (!this.asking && (this.clock - this.askedAt > SPECKS_EVERY || (this.drawn && Math.abs(t - this.drawn.t) > SPECKS_AHEAD))) this.askList(t, residents);
    if (this.ready) {
      // The new list is on the GPU: it takes over in this frame.
      if (this.drawn) freeMesh(this.drawn.mesh);
      this.drawn = this.ready;
      this.ready = null;
      this.group.add(this.drawn.mesh);
    }
    const d = this.drawn;
    if (!d) return;
    speckClock.value = Math.max(0, Math.min(CARRY, t - d.t));
    this.hide(d, near);
  }

  private askList(t: number, residents: Residents | null): void {
    this.asking = true;
    this.askedAt = this.clock;
    const t0 = performance.now();
    void this.pool.job({ kind: 'specks', params: this.habitat.params, t }).then(async (answer) => {
      if (this.disposed || !('kind' in answer) || answer.kind !== 'specks') return;
      this.slowest = Math.max(this.slowest, performance.now() - t0);
      const ready = await this.upload(answer.specks, residents);
      if (this.disposed) { freeMesh(ready.mesh); return; }
      if (this.ready) freeMesh(this.ready.mesh);
      this.ready = ready;
      this.lists++;
    }).finally(() => { this.asking = false; });
  }

  /** A list onto the GPU: those whose look is measured take its colours and size; the CPU's copy is let go. */
  private async upload(s: Specks, residents: Residents | null): Promise<Drawn> {
    const data = s.data;
    if (residents) {
      for (let i = 0; i < s.count; i++) {
        const dress = residents.measured(s.resident[i]);
        if (!dress) continue;
        const o = i * SPECK_STRIDE, bands = speckBands(dress.colors);
        data[o + 3] = dress.height;
        data[o + 8] = bands[0]; data[o + 9] = bands[1]; data[o + 10] = bands[2];
        data[o + 14] = dress.width;
      }
    }
    const g = quadInstances();
    peopleInstances(g, data, SPECK_LAYOUT);
    const shown = new InstancedBufferAttribute(new Float32Array(s.count).fill(1), 1);
    g.setAttribute(SPECK_SHOWN, shown);
    g.instanceCount = s.count;
    const mesh = drawnAnywhere(g, SPECK.material, 'specks');
    await this.stage.prepare(mesh);
    dropUploaded(mesh, this.stage.renderer, [SPECK_SHOWN]);
    return { mesh, t: s.t, key: s.key, shown, stamp: new Uint32Array(s.count), off: [], gpuBytes: data.byteLength + shown.array.byteLength };
  }

  /** Turn off the specks of everyone drawn nearer this frame, and back on those no longer drawn there. */
  private hide(d: Drawn, near: Iterable<number>): void {
    const shown = d.shown.array as Float32Array, frame = this.frameNo;
    let changed = false;
    for (const key of near) {
      const i = findKey(d.key, key);
      if (i < 0) continue;
      d.stamp[i] = frame;
      if (shown[i] !== 0) { shown[i] = 0; d.off.push(i); changed = true; }
    }
    const off: number[] = [];
    for (const i of d.off) {
      if (d.stamp[i] === frame) off.push(i);
      else { shown[i] = 1; changed = true; }
    }
    d.off = off;
    if (changed) d.shown.needsUpdate = true;
  }

  /** Bytes held: the drawn and waiting lists' keys and flags on the CPU, their instances on the GPU (memory watchdog). */
  bytes(): number {
    let n = 0;
    for (const d of [this.drawn, this.ready]) if (d) n += d.key.byteLength + d.stamp.byteLength + d.gpuBytes + d.off.length * 8;
    return n;
  }

  /** The debug menu's line. */
  info(): string {
    const d = this.drawn;
    if (!d) return 'specks: none yet';
    return `specks: ${d.key.length} up on the land, ${d.off.length} drawn nearer · list ${speckClock.value.toFixed(1)} s old, ${this.lists} lists, slowest ${this.slowest.toFixed(0)} ms`;
  }

  dispose(): void {
    this.disposed = true;
    for (const d of [this.drawn, this.ready]) if (d) freeMesh(d.mesh);
    this.drawn = this.ready = null;
    this.group.removeFromParent();
  }
}

/** Where a key is in an ascending list, or -1. */
function findKey(keys: Float64Array, key: number): number {
  let a = 0, b = keys.length - 1;
  while (a <= b) {
    const m = (a + b) >> 1, v = keys[m];
    if (v === key) return m;
    if (v < key) a = m + 1; else b = m - 1;
  }
  return -1;
}

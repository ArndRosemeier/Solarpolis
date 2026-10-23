/**
 * The sound player (design "Solarpolis: how it sounds"). It plays what `sim/sounds.ts` says is heard, with Web Audio:
 *
 *  - beds: each a long take (public/sound/bed/*) played as overlapping segments that crossfade, in two chains offset by
 *    half a take and panned apart, so a mono file sounds wide and its loop never shows; its gain glides to the weight
 *    the soundscape gives it, a few times a second;
 *  - calls: single birds placed on the land by seed and clock (`callsIn`), each from its point in the world through an
 *    HRTF panner, so they come from a tree and fade with distance;
 *  - steps: one per stride (`strideAt`: slower and longer near the axis), on the ground under the feet
 *    (`stepSurfaceAt`), one of four takes at a seeded pitch;
 *  - music: streamed through a media element (never decoded whole), faded in and out.
 *
 * Memory (CLAUDE.md rule 12): decoded audio is 32-bit float, so takes are stored at `index.rate` (32 kHz mono) and the
 * context runs at that rate; only beds the soundscape wants are decoded, the least recently used go first past
 * `BUDGET`, and every byte is reported as `sound` to the watchdog, which can take the quiet ones back.
 *
 * Browsers start sound only after the person's first click or key, so nothing plays before that (the title waits).
 */
import { hash3i, hashToFloat } from '@futuremagic/core';
import { BEDS, callsIn, soundscapeAt, stepSurfaceAt, strideAt, type Bed, type Call, type Hearing, type Soundscape } from '../sim/sounds';
import type { MemoryWatchdog } from '../app/memory';
import { readSetting, writeSetting } from '../persist/settings';

const BASE = `${import.meta.env?.BASE_URL ?? '/'}sound/`;
const MB = 1024 * 1024;
/** The most decoded audio kept (bytes); past it the least recently heard takes are dropped. */
const BUDGET = 24 * MB;
/** How often the soundscape is worked out (s), and how fast a bed's gain follows it (time constant, s). */
const LISTEN_EVERY = 0.25, GLIDE = 1.2;
/** A bed's segments overlap by this much (s), and are laid this far ahead of the clock (s). */
const XFADE = 1.5, LAY_AHEAD = 2;
/** A bed quiet this long (s) stops playing; its take is kept until memory needs it. */
const QUIET_STOP = 20;
/** Calls are laid this far ahead (s of the habitat's clock); a jump in the clock larger than this starts afresh. */
const CALLS_AHEAD = 1, CLOCK_JUMP = 10;
/** The most single calls playing at once. */
const MOST_CALLS = 8;
/** How loud each bed is at weight 1, so they sit together (the files are all levelled to the same loudness). */
const MIX: Record<Bed, number> = {
  'wind-soft': 0.5, 'wind-open': 0.6, 'wind-high': 0.6, 'leaves-broad': 0.6, 'leaves-conifer': 0.55, grass: 0.4,
  'river-riffle': 0.7, 'river-slow': 0.6, lake: 0.6, falls: 0.9, 'birds-wood': 0.5, 'birds-meadow': 0.45, 'birds-water': 0.45,
  bees: 0.35, crickets: 0.4,
};
const STEP_GAIN = 0.45, CALL_GAIN = 0.8, MUSIC_GAIN = 0.7;
/** How the music fades in and out (s). */
const MUSIC_IN = 2, MUSIC_OUT = 8;

interface Index {
  rate: number;
  sounds: Record<string, { kind: string; files: string[]; seconds: number[] }>;
}

interface Take {
  buffer: AudioBuffer;
  bytes: number;
  /** When it was last wanted (context time). */
  used: number;
}

/** One chain of a bed's crossfading segments. */
interface Chain {
  pan: StereoPannerNode;
  /** When its next segment starts (context time). */
  next: number;
  playing: AudioBufferSourceNode[];
  first: boolean;
}

interface BedVoice {
  gain: GainNode;
  chains: Chain[];
  file: string;
  /** When it last had a weight above silence (context time). */
  heard: number;
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** The land's beds and calls go through the air (a low-pass that follows the air's density). */
  private land!: GainNode;
  private air!: BiquadFilterNode;
  private steps!: GainNode;
  private musicGain!: GainNode;
  private index: Index | null = null;
  private readonly takes = new Map<string, Take>();
  private readonly loading = new Map<string, Promise<Take | null>>();
  private readonly beds = new Map<Bed, BedVoice>();
  private scape: Soundscape | null = null;
  private listened = -Infinity;
  private callsUntil = -Infinity;
  private callsPlaying = 0;
  private walked = 0;
  private wasOnFoot = false;
  private stepCount = 0;
  private lastSurface = '';
  private lastTick = 0;
  private wantMusic: string | null = null;
  private media: HTMLAudioElement | null = null;
  private mediaSource: MediaElementAudioSourceNode | null = null;
  private muted: boolean;
  /** Called when muting changes (the header's button). */
  onMuted: ((muted: boolean) => void) | null = null;

  constructor(memory: MemoryWatchdog, private readonly hear: () => Hearing | null) {
    this.muted = readMuted();
    memory.track('sound', () => this.decodedBytes());
    memory.onPressure('soft', () => this.shed(false));
    memory.onPressure('hard', () => this.shed(true));
    void fetch(`${BASE}index.json`).then((r) => (r.ok ? r.json() : null)).then((i: Index | null) => { this.index = i; }).catch(() => { this.index = null; });
    const unlock = (): void => {
      removeEventListener('pointerdown', unlock, true);
      removeEventListener('keydown', unlock, true);
      this.openContext();
    };
    addEventListener('pointerdown', unlock, true);
    addEventListener('keydown', unlock, true);
  }

  get isMuted(): boolean { return this.muted; }

  /** Turn all sound off or on (kept for the next visit, in this browser). */
  setMuted(on: boolean): void {
    this.muted = on;
    writeMuted(on);
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0 : 1, this.ctx.currentTime, 0.1);
    this.onMuted?.(on);
  }

  /** Play a piece of music (an id in the index, e.g. `music/title`), or fade out what plays (null). */
  music(id: string | null): void {
    this.wantMusic = id;
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.musicGain.gain, now = ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (!id) {
      g.linearRampToValueAtTime(0, now + MUSIC_OUT);
      const media = this.media;
      setTimeout(() => { if (this.wantMusic === null && media === this.media) media?.pause(); }, MUSIC_OUT * 1000 + 100);
      return;
    }
    const file = this.index?.sounds[id]?.files[0];
    if (!file) return;
    if (!this.media) {
      this.media = new Audio();
      this.media.crossOrigin = 'anonymous';
      this.mediaSource = ctx.createMediaElementSource(this.media);
      this.mediaSource.connect(this.musicGain);
    }
    const src = BASE + file;
    if (!this.media.src.endsWith(src)) { this.media.src = src; this.media.currentTime = 0; }
    void this.media.play().catch(() => undefined);
    g.linearRampToValueAtTime(MUSIC_GAIN, now + MUSIC_IN);
  }

  /** Bytes of decoded audio held (memory watchdog). */
  decodedBytes(): number {
    let n = 0;
    for (const t of this.takes.values()) n += t.bytes;
    return n;
  }

  /** A line for the debug menu. */
  hearingLine(): string {
    if (!this.ctx) return `sound: waiting for a click${this.muted ? ' (muted)' : ''}`;
    const loud = this.scape ? BEDS.map((b) => [b, this.scape!.beds[b]] as const).filter(([, w]) => w > 0.02).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
    const beds = loud.map(([b, w]) => `${b} ${w.toFixed(2)}`).join(', ') || 'none';
    const air = this.scape ? `, air ×${this.scape.air.toFixed(2)}, light ${this.scape.light.toFixed(2)}, birds ${this.scape.birds.toFixed(2)}` : '';
    return `sound${this.muted ? ' (muted)' : ''}: ${(this.decodedBytes() / MB).toFixed(1)} MB decoded, ${this.beds.size} beds, ${this.callsPlaying} calls · ${beds}${air} · steps on ${this.lastSurface || '-'} (${this.stepCount})`;
  }

  private openContext(): void {
    if (this.ctx) return;
    let ctx: AudioContext;
    try { ctx = new AudioContext({ sampleRate: this.index?.rate ?? 32000 }); } catch { ctx = new AudioContext(); }
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = ctx.sampleRate / 2;
    this.air.connect(this.master);
    this.land = ctx.createGain();
    this.land.connect(this.air);
    this.steps = ctx.createGain();
    this.steps.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = 0;
    this.musicGain.connect(this.master);
    void ctx.resume();
    if (this.wantMusic) this.music(this.wantMusic);
    const nextFrame = (): void => { this.onFrame(); requestAnimationFrame(nextFrame); };
    requestAnimationFrame(nextFrame);
  }

  private onFrame(): void {
    const ctx = this.ctx!, now = ctx.currentTime, dt = Math.min(0.25, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    const h = this.index ? this.hear() : null;
    if (!h) {
      if (this.scape) { this.scape = null; for (const v of this.beds.values()) v.gain.gain.setTargetAtTime(0, now, GLIDE); }
      this.walked = 0;
      this.layBeds(now);
      return;
    }
    const l = ctx.listener;
    if (l.positionX) {
      l.positionX.value = h.eye[0]; l.positionY.value = h.eye[1]; l.positionZ.value = h.eye[2];
      l.forwardX.value = h.look[0]; l.forwardY.value = h.look[1]; l.forwardZ.value = h.look[2];
      l.upX.value = h.up[0]; l.upY.value = h.up[1]; l.upZ.value = h.up[2];
    } else {
      l.setPosition(...h.eye);
      l.setOrientation(...h.look, ...h.up);
    }
    if (now - this.listened >= LISTEN_EVERY) {
      this.listened = now;
      this.hearLand(h, now);
    }
    this.layBeds(now);
    this.pace(h, dt);
  }

  /** Work out the soundscape, set every bed's gain toward it, lay the calls that start soon. */
  private hearLand(h: Hearing, now: number): void {
    const scape = soundscapeAt(h.ecology, h.time, h.listener);
    this.scape = scape;
    // The air thins toward the axis: less of the high end carries (a gentle tilt; the bed for thin wind does the rest).
    this.air.frequency.setTargetAtTime(Math.min(this.ctx!.sampleRate / 2, 2000 + 14000 * scape.air ** 4), now, GLIDE);
    for (const b of BEDS) {
      const want = scape.beds[b] * MIX[b];
      let v = this.beds.get(b);
      if (want > 0.003) {
        if (!v) v = this.startBed(b, now) ?? undefined;
        if (v) { v.heard = now; v.gain.gain.setTargetAtTime(want, now, GLIDE); }
      } else if (v) v.gain.gain.setTargetAtTime(0, now, GLIDE);
    }
    if (h.time < this.callsUntil - CLOCK_JUMP || h.time > this.callsUntil + CLOCK_JUMP) this.callsUntil = h.time;
    const until = h.time + CALLS_AHEAD;
    if (until > this.callsUntil) {
      for (const c of callsIn(h.ecology, this.callsUntil, until, h.listener)) this.call(c, now + Math.max(0, c.t - h.time));
      this.callsUntil = until;
    }
  }

  /** A bed's voice: its gain and two chains panned apart, once its take is decoded. */
  private startBed(b: Bed, now: number): BedVoice | null {
    const file = this.index?.sounds[`bed/${b}`]?.files[0];
    if (!file) return null;
    const take = this.takes.get(file);
    if (!take) { void this.decodeTake(file); return null; }
    const ctx = this.ctx!, gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.land);
    const chains = [-0.45, 0.45].map((p) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = p;
      pan.connect(gain);
      return { pan, next: now + 0.05, playing: [], first: true } as Chain;
    });
    const v: BedVoice = { gain, chains, file, heard: now };
    this.beds.set(b, v);
    return v;
  }

  /** Keep every bed's chains laid ahead of the clock, and stop the beds quiet for long. */
  private layBeds(now: number): void {
    for (const [b, v] of this.beds) {
      const take = this.takes.get(v.file);
      if (!take || now - v.heard > QUIET_STOP) { this.stopBed(b, v); continue; }
      take.used = now;
      const dur = take.buffer.duration;
      v.chains.forEach((c, k) => {
        while (c.next < now + LAY_AHEAD) {
          // The second chain starts half a take in, so the two never cross their seams together.
          const offset = c.first && k === 1 ? dur / 2 : 0, length = dur - offset;
          c.first = false;
          const src = this.ctx!.createBufferSource(), g = this.ctx!.createGain();
          src.buffer = take.buffer;
          src.playbackRate.value = k === 1 ? 0.97 : 1;
          const span = length / src.playbackRate.value, fade = Math.min(XFADE, span / 3);
          g.gain.setValueAtTime(0, c.next);
          g.gain.linearRampToValueAtTime(1, c.next + fade);
          g.gain.setValueAtTime(1, c.next + span - fade);
          g.gain.linearRampToValueAtTime(0, c.next + span);
          src.connect(g).connect(c.pan);
          src.start(c.next, offset);
          src.stop(c.next + span + 0.05);
          c.playing.push(src);
          src.onended = () => { c.playing = c.playing.filter((x) => x !== src); g.disconnect(); };
          c.next += span - fade;
        }
      });
    }
  }

  private stopBed(b: Bed, v: BedVoice): void {
    for (const c of v.chains) for (const s of c.playing) { try { s.stop(); } catch { /* already stopped */ } }
    v.gain.disconnect();
    this.beds.delete(b);
  }

  /** A single call at its place in the world, starting at context time `when`. */
  private call(c: Call, when: number): void {
    const files = this.index?.sounds[`call/${c.kind}`]?.files;
    if (!files?.length || this.callsPlaying >= MOST_CALLS) return;
    const file = files[0], take = this.takes.get(file);
    if (!take) { void this.decodeTake(file); return; }
    const ctx = this.ctx!;
    take.used = ctx.currentTime;
    const src = ctx.createBufferSource(), panner = new PannerNode(ctx, {
      panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 8, rolloffFactor: 1, maxDistance: 400,
      positionX: c.at[0], positionY: c.at[1], positionZ: c.at[2],
    }), g = ctx.createGain();
    src.buffer = take.buffer;
    src.playbackRate.value = 0.94 + 0.12 * hashToFloat(hash3i(Math.round(c.t * 1000), 7, 1, 0));
    g.gain.value = CALL_GAIN * (this.scape?.air ?? 1);
    src.connect(g).connect(panner).connect(this.land);
    this.callsPlaying++;
    src.onended = () => { this.callsPlaying--; panner.disconnect(); };
    src.start(when);
  }

  /** Footsteps: one each stride walked on the ground; a firmer one on landing. */
  private pace(h: Hearing, dt: number): void {
    const f = h.feet;
    if (!f) { this.wasOnFoot = false; return; }
    const landed = !this.wasOnFoot;
    this.wasOnFoot = true;
    const stride = strideAt(f.speed, h.gravity);
    if (landed) { this.walked = 0; this.footstep(h, 1.3); return; }
    if (f.speed < 0.2) { this.walked = Math.min(this.walked, stride * 0.6); return; }
    this.walked += f.speed * dt;
    if (this.walked >= stride) { this.walked -= stride; this.footstep(h, Math.min(1.3, 0.8 + f.speed / 8)); }
  }

  private footstep(h: Hearing, loud: number): void {
    const f = h.feet!, surface = stepSurfaceAt(h.ecology, f.theta, f.s, f.h, h.listener.below);
    const files = this.index?.sounds[`step/${surface}`]?.files;
    this.lastSurface = surface;
    if (!files?.length) return;
    const n = this.stepCount++, draw = (k: number): number => hashToFloat(hash3i(n, k, 0x57e9, 0));
    const file = files[Math.floor(draw(0) * files.length) % files.length], take = this.takes.get(file);
    // Every surface's takes are fetched once it is first stepped on; this step waits for them.
    for (const other of files) if (!this.takes.has(other)) void this.decodeTake(other);
    if (!take) return;
    const ctx = this.ctx!, src = ctx.createBufferSource(), g = ctx.createGain();
    take.used = ctx.currentTime;
    src.buffer = take.buffer;
    src.playbackRate.value = 0.92 + 0.16 * draw(1);
    g.gain.value = STEP_GAIN * loud * (0.85 + 0.3 * draw(2)) * (this.scape?.air ?? 1);
    src.connect(g).connect(this.steps);
    src.onended = () => g.disconnect();
    src.start();
  }

  /** Fetch and decode a take (once), dropping the least recently used ones past the budget. */
  private decodeTake(file: string): Promise<Take | null> {
    let p = this.loading.get(file);
    if (p) return p;
    const ctx = this.ctx!;
    p = fetch(BASE + file)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${file}: ${r.status}`))))
      .then((b) => ctx.decodeAudioData(b))
      .then((buffer) => {
        const take = { buffer, bytes: buffer.length * buffer.numberOfChannels * 4, used: ctx.currentTime };
        this.takes.set(file, take);
        this.fit();
        return take;
      })
      .catch(() => null)
      .finally(() => { this.loading.delete(file); });
    this.loading.set(file, p);
    return p;
  }

  /** Past the budget, drop the takes heard longest ago that no bed is playing. */
  private fit(): void {
    if (this.decodedBytes() <= BUDGET) return;
    const playing = new Set([...this.beds.values()].map((v) => v.file));
    const old = [...this.takes].filter(([f]) => !playing.has(f)).sort((a, b) => a[1].used - b[1].used);
    for (const [f] of old) {
      if (this.decodedBytes() <= BUDGET) break;
      this.takes.delete(f);
    }
  }

  /** Give memory back: the takes of beds not playing (soft), and the quiet beds themselves (hard). */
  private shed(hard: boolean): void {
    const now = this.ctx?.currentTime ?? 0;
    if (hard) for (const [b, v] of this.beds) if (v.gain.gain.value < 0.01) this.stopBed(b, v);
    const playing = new Set([...this.beds.values()].map((v) => v.file));
    for (const [f, t] of this.takes) if (!playing.has(f) && (hard || now - t.used > 10)) this.takes.delete(f);
  }
}

/** Whether sound was turned off on an earlier visit (in this browser). */
const readMuted = (): boolean => readSetting('sound.muted', '0') === '1';
const writeMuted = (on: boolean): void => writeSetting('sound.muted', on ? '1' : '0');

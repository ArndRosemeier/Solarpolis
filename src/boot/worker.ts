/// <reference types="@webgpu/types" />
/**
 * The opening's renderer (design "First Light"), in its own worker on its own WebGPU device, drawing into the page's
 * canvas through an OffscreenCanvas. The main thread meanwhile parses the game, builds the Outside view and warms the
 * interior; none of that can hold a frame here. One shader module, three pipelines built before the first frame
 * (shaders.ts); the sky's numbers each frame from OpeningSky (scene.ts), the pure models the game reads.
 *
 * Messages in: `start` (the canvas, the page's query and base URL, the drawing size), `size`, `end`. Out: `lit` when the
 * first frame is on screen (ms since the epoch of `performance.timeOrigin`), `bytes`, `problem`, and `ended` with the
 * frame figures once it has let go of everything.
 */
import { habitatFromUrl } from '../app/params';
import { decodeStars } from '../space';
import { OpeningSky, PLANET_POINTS, packPoints, packStars, type OpeningState } from './scene';
import { CITY_LIGHTS, OPENING_WGSL, UNIFORM_VEC4S } from './shaders';

/** A frame longer than this (ms) missed two refreshes at 60 Hz (the arrival's measure, app/arrivalTiming.ts). */
const STUTTER_MS = 1000 / 30 + 1;
/** Earth's maps fade in over this long once they are in (s): the planet comes up out of its silhouette. */
const MAP_FADE = 1.2;
/** How far into a frame (ms) the ring's looks may be made, between frames, before the glints fade in together. */
const RING_MS = 6;

export type ToWorker =
  | { type: 'start'; canvas: OffscreenCanvas; search: string; base: string; width: number; height: number }
  | { type: 'size'; width: number; height: number }
  | { type: 'end' };
export type FromWorker =
  | { type: 'lit'; at: number }
  | { type: 'bytes'; bytes: number }
  | { type: 'problem'; text: string }
  | { type: 'ended'; frames: number; slowest: number; stutters: number };

const tell = (m: FromWorker): void => (self as unknown as Worker).postMessage(m);

interface Drawing {
  device: GPUDevice;
  context: GPUCanvasContext;
  canvas: OffscreenCanvas;
  sky: OpeningSky;
  pipes: { sky: GPURenderPipeline; star: GPURenderPipeline; output: GPURenderPipeline };
  uniforms: GPUBuffer;
  points: GPUBuffer;
  starCount: number;
  pointCount: number;
  sampler: GPUSampler;
  maps: { day: GPUTexture; night: GPUTexture; moon: GPUTexture };
  hdr: GPUTexture | null;
  groups: { sky: GPUBindGroup; star: GPUBindGroup; output: GPUBindGroup | null };
  mapsAt: number | null;
  /** When every habitat's glint was ready (ms), or null. */
  ringAt: number | null;
  bytes: number;
}

let drawing: Drawing | null = null;
let ended = false;
let first = 0, last = 0, frames = 0, slowest = 0, stutters = 0;
let size = { width: 1, height: 1 };

self.onmessage = (e: MessageEvent<ToWorker>): void => {
  const m = e.data;
  if (m.type === 'start') void startDrawing(m).catch((err) => fail(err));
  else if (m.type === 'size') { size = { width: Math.max(1, m.width), height: Math.max(1, m.height) }; resize(); }
  else if (m.type === 'end') releaseAll();
};

function fail(err: unknown): void {
  tell({ type: 'problem', text: err instanceof Error ? err.message : String(err) });
  releaseAll();
}

async function startDrawing(m: Extract<ToWorker, { type: 'start' }>): Promise<void> {
  size = { width: Math.max(1, m.width), height: Math.max(1, m.height) };
  const gpu = (self.navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) throw new Error('no WebGPU in workers');
  // Everything the first frame needs, asked for at once.
  const starsFile = fetch(`${m.base}sky/stars.bin`).then((r) => r.arrayBuffer());
  const adapter = await gpu.requestAdapter();
  if (!adapter || ended) throw new Error('no WebGPU adapter');
  const device = await adapter.requestDevice();
  if (ended) { device.destroy(); return; }
  device.lost.then((info) => { if (!ended) fail(`the opening's device was lost (${info.message})`); });
  device.onuncapturederror = (ev) => tell({ type: 'problem', text: `WebGPU: ${ev.error.message}` });
  const context = m.canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!context) throw new Error('no WebGPU canvas');
  const format = gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  const module = device.createShaderModule({ code: OPENING_WGSL, label: 'first light' });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((x) => x.type === 'error');
  if (errors.length) throw new Error(`the opening's shader: ${errors.map((x) => `${x.lineNum}:${x.linePos} ${x.message}`).join('; ')}`);
  const screen = { module, entryPoint: 'screenVertex' };
  const add: GPUBlendComponent = { operation: 'add', srcFactor: 'one', dstFactor: 'one' };
  const building = Promise.all([
    device.createRenderPipelineAsync({ label: 'opening sky', layout: 'auto', vertex: screen, fragment: { module, entryPoint: 'skyFragment', targets: [{ format: 'rgba16float' }] } }),
    device.createRenderPipelineAsync({
      label: 'opening stars', layout: 'auto',
      vertex: { module, entryPoint: 'starVertex', buffers: [{ arrayStride: 32, stepMode: 'instance', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x4' }, { shaderLocation: 1, offset: 16, format: 'float32x4' }] }] },
      fragment: { module, entryPoint: 'starFragment', targets: [{ format: 'rgba16float', blend: { color: add, alpha: add } }] },
    }),
    device.createRenderPipelineAsync({ label: 'opening output', layout: 'auto', vertex: screen, fragment: { module, entryPoint: 'outputFragment', targets: [{ format }] } }),
  ]);
  // The sky's models while the GPU builds the pipelines.
  const opening = new OpeningSky(habitatFromUrl(new URLSearchParams(m.search)));
  const [sky, star, output] = await building;
  const field = decodeStars(await starsFile);
  if (ended) { device.destroy(); return; }
  const pointCount = opening.space.habitats.length + PLANET_POINTS;
  const data = new Float32Array((field.count + pointCount) * 8);
  packStars(field.dir, field.flux, field.color, opening.starAxes(0), data);
  const points = device.createBuffer({ label: 'opening stars', size: data.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(points, 0, data);
  const uniforms = device.createBuffer({ label: 'opening uniforms', size: UNIFORM_VEC4S * 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 8 });
  const placeholderMap = (): GPUTexture => {
    const t = device.createTexture({ size: [1, 1], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: t }, new Uint8Array([20, 20, 30, 255]), { bytesPerRow: 4 }, [1, 1]);
    return t;
  };
  const d: Drawing = {
    device, context, canvas: m.canvas, sky: opening, pipes: { sky, star, output }, uniforms, points, starCount: field.count, pointCount, sampler,
    maps: { day: placeholderMap(), night: placeholderMap(), moon: placeholderMap() }, hdr: null, groups: { sky: null!, star: null!, output: null }, mapsAt: null, ringAt: null, bytes: data.byteLength,
  };
  d.groups.star = device.createBindGroup({ layout: star.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] });
  skyGroup(d);
  drawing = d;
  resize();
  next();
  // Earth's maps (the smaller day map: Earth is about 10° across here) and the Moon's; they fade in once all are in.
  void Promise.all(['earth-day-2k.jpg', 'earth-night.jpg', 'moon.jpg'].map((file) => loadMap(device, `${m.base}sky/${file}`))).then(([day, night, moon]) => {
    if (!drawing || ended) { for (const x of [day, night, moon]) x.texture.destroy(); return; }
    for (const t of Object.values(drawing.maps)) t.destroy();
    drawing.maps = { day: day.texture, night: night.texture, moon: moon.texture };
    drawing.bytes += day.bytes + night.bytes + moon.bytes;
    skyGroup(drawing);
    drawing.mapsAt = performance.now();
    tell({ type: 'bytes', bytes: drawing.bytes });
  }).catch((err) => tell({ type: 'problem', text: `the opening's maps: ${err instanceof Error ? err.message : String(err)}` }));
}

/** An sRGB map with its whole mip chain, halved with the browser's high-quality resize, as the Outside view makes them. */
async function loadMap(device: GPUDevice, url: string): Promise<{ texture: GPUTexture; bytes: number }> {
  const blob = await (await fetch(url)).blob();
  const top = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  const levels = Math.floor(Math.log2(Math.max(top.width, top.height))) + 1;
  const texture = device.createTexture({
    size: [top.width, top.height], format: 'rgba8unorm-srgb', mipLevelCount: levels,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  for (let k = 0, w = top.width, h = top.height; k < levels; k++, w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
    const image = k === 0 ? top : await createImageBitmap(top, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    device.queue.copyExternalImageToTexture({ source: image }, { texture, mipLevel: k }, [w, h]);
    if (k > 0) image.close();
  }
  const bytes = top.width * top.height * 4 * 4 / 3;
  top.close();
  return { texture, bytes };
}

function skyGroup(d: Drawing): void {
  d.groups.sky = d.device.createBindGroup({
    layout: d.pipes.sky.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: d.uniforms } },
      { binding: 1, resource: d.sampler },
      { binding: 2, resource: d.maps.day.createView() },
      { binding: 3, resource: d.maps.night.createView() },
      { binding: 4, resource: d.maps.moon.createView() },
    ],
  });
}

/** The canvas and the linear frame behind it follow the page's size (drawing-buffer pixels). */
function resize(): void {
  const d = drawing;
  if (!d) return;
  const { width, height } = size;
  if (d.hdr && d.hdr.width === width && d.hdr.height === height) return;
  d.canvas.width = width;
  d.canvas.height = height;
  if (d.hdr) { d.bytes -= d.hdr.width * d.hdr.height * 8; d.hdr.destroy(); }
  d.hdr = d.device.createTexture({ label: 'opening frame', size: [width, height], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
  d.bytes += width * height * 8;
  d.groups.output = d.device.createBindGroup({ layout: d.pipes.output.getBindGroupLayout(0), entries: [{ binding: 5, resource: d.hdr.createView() }] });
  tell({ type: 'bytes', bytes: d.bytes });
}

const frameLater = (cb: (t: number) => void): void => {
  const raf = (self as unknown as { requestAnimationFrame?: (cb: (t: number) => void) => number }).requestAnimationFrame;
  if (raf) raf(cb);
  else setTimeout(() => cb(performance.now()), 1000 / 60);
};

function next(): void {
  if (!ended) frameLater(() => drawOpening());
}

function drawOpening(): void {
  const d = drawing;
  if (!d || ended || !d.hdr || !d.groups.output) return;
  const now = performance.now();
  if (!first) first = now;
  else {
    const ms = now - last;
    frames++;
    slowest = Math.max(slowest, ms);
    if (ms > STUTTER_MS) stutters++;
  }
  const dt = last ? (now - last) / 1000 : Infinity;
  last = now;
  const s = d.sky.stateAt((now - first) / 1000, d.hdr.width, d.hdr.height, dt);
  writeUniforms(d, s, fadeIn(d.mapsAt, now));
  const pts = new Float32Array(d.pointCount * 8);
  // The glints come first in the points; they fade in once the whole ring has its looks.
  const glints = fadeIn(d.ringAt, now);
  packPoints(s.points.map((p, i) => (i < s.points.length - PLANET_POINTS ? { ...p, flux: [p.flux[0] * glints, p.flux[1] * glints, p.flux[2] * glints] } : p)), pts);
  d.device.queue.writeBuffer(d.points, d.starCount * 32, pts);

  const enc = d.device.createCommandEncoder({ label: 'opening' });
  const target = d.hdr.createView();
  const sky = enc.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
  sky.setPipeline(d.pipes.sky);
  sky.setBindGroup(0, d.groups.sky);
  sky.draw(3);
  sky.setPipeline(d.pipes.star);
  sky.setBindGroup(0, d.groups.star);
  sky.setVertexBuffer(0, d.points);
  sky.draw(6, d.starCount + d.pointCount);
  sky.end();
  const out = enc.beginRenderPass({ colorAttachments: [{ view: d.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
  out.setPipeline(d.pipes.output);
  out.setBindGroup(0, d.groups.output);
  out.draw(3);
  out.end();
  d.device.queue.submit([enc.finish()]);
  if (frames === 0) void d.device.queue.onSubmittedWorkDone().then(() => tell({ type: 'lit', at: performance.timeOrigin + performance.now() }));
  if (d.ringAt === null && d.sky.prepareRing(() => performance.now() - now > RING_MS)) d.ringAt = performance.now();
  next();
}

/** 0 → 1 over MAP_FADE seconds from `since` (ms; null: not yet), eased. */
function fadeIn(since: number | null, now: number): number {
  const f = since === null ? 0 : Math.min(1, Math.max(0, (now - since) / 1000 / MAP_FADE));
  return f * f * (3 - 2 * f);
}

function writeUniforms(d: Drawing, s: OpeningState, mapsIn: number): void {
  const v = new Float32Array(UNIFORM_VEC4S * 4);
  const putVec = (i: number, x: ArrayLike<number>, w: number): void => { v.set([x[0], x[1], x[2], w], i * 4); };
  const rows = (i: number, m: ArrayLike<number>): void => { for (let r = 0; r < 3; r++) putVec(i + r, [m[r * 3], m[r * 3 + 1], m[r * 3 + 2]], 0); };
  putVec(0, s.right, s.tanHalf * s.aspect);
  putVec(1, s.up, s.tanHalf);
  putVec(2, s.forward, s.exposure);
  putVec(3, s.sunDir, s.sunRadius);
  putVec(4, s.earth.dir, s.earth.sin);
  putVec(5, s.moon.dir, s.moon.sin);
  rows(6, s.earth.toBody);
  rows(9, s.moon.toBody);
  putVec(12, s.earth.sun, s.earth.light);
  putVec(13, s.moon.sun, s.moon.light);
  putVec(14, s.clouds, CITY_LIGHTS);
  v.set([s.starExposure, s.pixelSolidAngle, s.sunlight, s.irradiance], 15 * 4);
  v.set([d.hdr!.width, d.hdr!.height, s.earthNearer ? 1 : 0, mapsIn], 16 * 4);
  d.device.queue.writeBuffer(d.uniforms, 0, v);
}

/** Let go of everything: the device and its memory go with it. */
function releaseAll(): void {
  if (ended) return;
  ended = true;
  const d = drawing;
  drawing = null;
  if (d) {
    d.points.destroy(); d.uniforms.destroy(); d.hdr?.destroy();
    for (const t of Object.values(d.maps)) t.destroy();
    d.device.destroy();
  }
  tell({ type: 'ended', frames, slowest, stutters });
}

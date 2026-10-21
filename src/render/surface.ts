/**
 * What every 3D view on the page shares: the frame loop that runs while the view is shown, the canvas following its
 * box on screen, and looking around with the right mouse button held (one finger on touch screens), with the pointer
 * left visible and free for clicking things in the world (Arnd, 2026-10-21).
 */
import type { PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';

/**
 * A view's frame loop and the keys held down while it is shown: `set(true)` starts calling `frame(dt)` every
 * animation frame, `set(false)` stops it and lets go of every key. `onKey` sees each key press while it runs.
 */
export class FrameLoop {
  running = false;
  readonly keys = new Set<string>();

  constructor(private readonly frame: (dt: number) => void, onKey: (e: KeyboardEvent) => void = () => {}) {
    window.addEventListener('keydown', (e) => {
      if (!this.running) return;
      onKey(e);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  set(on: boolean): void {
    const was = this.running;
    this.running = on;
    if (!on) this.keys.clear();
    else if (!was) runFrames(() => this.running, this.frame);
  }
}

/** Call `frame(dt)` every animation frame while `on()` holds; dt in seconds, at most 0.1. */
export function runFrames(on: () => boolean, frame: (dt: number) => void): void {
  let last = performance.now();
  const tick = (t: number): void => {
    if (!on()) return;
    frame(Math.min(0.1, (t - last) / 1000));
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Keep the drawing buffer and the camera's aspect matched to the canvas's size on screen. */
export function fitCanvas(canvas: HTMLCanvasElement, renderer: WebGPURenderer, camera: PerspectiveCamera): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (w && h && (canvas.width !== Math.round(w * renderer.getPixelRatio()) || camera.aspect !== w / h)) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}

/** Right-button (or one-finger) drags on the canvas: `drag(dx, dy)` in pixels of pointer movement. */
export function dragToLook(canvas: HTMLCanvasElement, drag: (dx: number, dy: number) => void): void {
  let looking: number | null = null;
  const looks = (e: PointerEvent): boolean => (e.pointerType === 'touch' ? e.isPrimary : e.button === 2);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (!looks(e) || looking !== null) return;
    looking = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    canvas.classList.add('looking');
  });
  const release = (e: PointerEvent): void => {
    if (e.pointerId !== looking) return;
    looking = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    canvas.classList.remove('looking');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === looking) drag(e.movementX, e.movementY);
  });
}

/** Draw one frame of a Stage: its per-frame work (the compile cap), then the scene through its camera. */
export function draw(stage: Stage): void {
  stage.frame();
  stage.renderer.render(stage.scene, stage.camera);
}

/** What the movement keys held down ask for: W A S D or the arrows, E or Space up, Q or C down, Shift faster. */
export function moveKeys(k: ReadonlySet<string>): { forward: number; right: number; up: number; fast: boolean } {
  return {
    forward: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0),
    right: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0),
    up: (k.has('KeyE') || k.has('Space') ? 1 : 0) - (k.has('KeyQ') || k.has('KeyC') ? 1 : 0),
    fast: k.has('ShiftLeft') || k.has('ShiftRight'),
  };
}

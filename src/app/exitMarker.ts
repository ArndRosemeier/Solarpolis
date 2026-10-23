/** A compass marker toward the nearest real lift below. Direction only, not a route through walls. */
import type { Vec3 } from '../blueprint';
import type { ExitCourt } from '../gen/exitCourt';
import { el } from './dom';

export class ExitMarker {
  readonly box = el('div', 'exit-marker');
  private readonly arrow = el('span', 'exit-marker-arrow', '↑');
  private readonly label = el('span', '');
  constructor() {
    this.box.hidden = true;
    this.arrow.setAttribute('aria-hidden', 'true');
    this.box.append(this.arrow, this.label);
  }
  showExit(exit: ExitCourt | null, eye: Vec3, forward: Vec3, up: Vec3): void {
    this.box.hidden = !exit;
    if (!exit) return;
    const d = exit.doors.at.map((v, k) => v - eye[k]);
    const right = [forward[1] * up[2] - forward[2] * up[1], forward[2] * up[0] - forward[0] * up[2], forward[0] * up[1] - forward[1] * up[0]];
    const scale = Math.hypot(...right) || 1;
    const horizontal = [up[1] * right[2] - up[2] * right[1], up[2] * right[0] - up[0] * right[2], up[0] * right[1] - up[1] * right[0]];
    const side = d.reduce((n, v, k) => n + v * right[k] / scale, 0), ahead = d.reduce((n, v, k) => n + v * horizontal[k] / scale, 0);
    this.arrow.style.transform = `rotate(${Math.atan2(side, ahead)}rad)`;
    this.label.textContent = exit.distance < 4 ? 'Lift to surface · click the doors' : `Exit court ${exit.court + 1} · ${Math.round(exit.distance)} m to lift`;
  }
}

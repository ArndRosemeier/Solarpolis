/**
 * Ways: the link's wayfinding. Below the land it marks the nearest lift up (the real doors, `nearestExitCourt`), as a
 * card with the distance and a mark on the doors, or an arrow at the screen's edge while they are out of sight. More
 * ways come here (a destination chosen, a friend to meet), each one shown the same way.
 */
import type { ExitCourt } from '../../gen/exitCourt';
import type { LinkService, LinkStatus } from '../../link';

export class Ways implements LinkService {
  readonly id = 'ways';
  readonly title = 'Ways';
  private exit: ExitCourt | null = null;

  /** The nearest lift up from below, or null up on the land (InteriorView.onExit). */
  showExit(exit: ExitCourt | null): void { this.exit = exit; }

  offers(): readonly [] { return []; }

  status(): LinkStatus | null {
    const e = this.exit;
    if (!e) return null;
    const near = e.distance < 4, metres = `${Math.round(e.distance)} m`;
    return {
      from: 'Ways',
      title: `Lift up · exit court ${e.court + 1}`,
      detail: near ? 'Click the doors to ride up to the land.' : `${metres} to the doors`,
      at: e.doors.at,
      mark: near ? 'Lift up · click the doors' : `Lift up · ${metres}`,
    };
  }
}

/** Domestic space: fixed services and circulation, with retractable fittings in clear wall-side zones.
 * Bay coordinates, human dimensions. Rendering and residents share this plan. */
import type { Vec3 } from '../blueprint';
import { HOME_RHYTHM, type House, type Rect } from './homes';
import { upright, type BuildDetail } from './building';
import { FINISH } from './pavilion';
import type { RGB, Shape } from './shapes';

const DISPLAY: RGB[] = [[0.35, 0.57, 0.62], [0.62, 0.49, 0.36], [0.4, 0.57, 0.48]];
export const HOME_MODES = ['gather', 'focus', 'rest', 'clear'] as const;
export type HomeMode = typeof HOME_MODES[number];
export interface HomePlan { room: Rect; doorX: number; doorY: number; doorWidth: number; stair: Rect; service: Rect; resident: [number, number] }
export interface Fitting { centre: Vec3; size: Vec3; colour: RGB }
/**
 * Pieces of furniture drawn at most at once (render/homes.ts: every home whose rooms the drawn tiles build): `homeFittings`
 * gives five a storey, and the most any habitat of the MATRIX furnishes round an eye is well under it (test/home-furniture.test.ts).
 */
export const FURNITURE_CAPACITY = 4096;

/** How a house's rooms are built: as drawn at a detail (none far off), or `solid`, their structure for the physics. */
export type RoomDetail = BuildDetail | 'solid';

/** What a household's wall displays show (an empty house's are dark): the room seen through its open door. */
export const homeDisplay = (house: House): RGB => (house.lived ? DISPLAY[house.seed % DISPLAY.length] : [0.025, 0.03, 0.03]);

export function homePlan(house: House, hr: number): HomePlan {
  const b = house.body, t = hr * 0.28, room = { x0: b.x0 + t, x1: b.x1 - t, y0: b.y0 + t, y1: b.y1 - t };
  const n = Math.max(1, Math.floor((b.x1 - b.x0) / (HOME_RHYTHM * hr)));
  const doorX = b.x0 + (b.x1 - b.x0) * (Math.floor(n / 2) + 0.5) / n;
  const stair = { x0: room.x1 - hr * 1.05, x1: room.x1, y0: room.y0 + hr * 0.8, y1: room.y1 - hr * 0.8 };
  const service = { x0: room.x0, x1: room.x0 + hr * 1.35, y0: room.y1 - hr * 0.55, y1: room.y1 };
  return { room, doorX, doorY: house.door > 0 ? b.y1 : b.y0, doorWidth: Math.min(1.2 * hr, 0.8 * (b.x1 - b.x0) / n), stair, service,
    resident: [room.x0 + hr * 2.6, (room.y0 + room.y1) / 2] };
}

/** A household's chosen activity, stable across reloads and shared by furniture and inhabitants. */
export function homeUseAt(house: House, clock: number, period: number, floor = 0): HomeMode {
  if (!house.lived) return 'clear';
  return HOME_MODES[((Math.floor(clock / Math.max(period, 1)) + house.seed + floor) % 4 + 4) % 4];
}

/** All modes have the same pieces, so a change interpolates continuously. Zero-height pieces stow in the floor. */
export function homeFittings(house: House, hr: number, floor: number, mode: HomeMode): Fitting[] {
  const { room: r } = homePlan(house, hr), z = house.base + floor * house.storey;
  const x = r.x0 + hr * 1.25, y = (r.y0 + r.y1) / 2;
  const across = Math.min(1, (r.x1 - r.x0 - hr * 1.35) / (hr * 4.2));
  const active = house.lived && mode !== 'clear', rest = active && mode === 'rest', gather = active && mode === 'gather', focus = active && mode === 'focus';
  const out: Fitting[] = [];
  const part = (cx: number, cy: number, width: number, depth: number, bottom: number, height: number, colour: RGB): void => {
    out.push({ centre: [r.x0 + (cx - r.x0) * across, cy, z + (bottom + height / 2) * hr], size: [width * hr * across, depth * hr, Math.max(0.002, height * hr)], colour });
  };
  // The same broad support changes from low rest surface to upholstered social bench; it stows for focus.
  part(x, y, rest ? 1.7 : 1.35, rest ? 2.3 : 1.8, 0, rest ? 0.38 : gather ? 0.43 : 0, [0.12, 0.28, 0.27]);
  part(rest ? x : x - hr * 0.55, rest ? y + hr * 0.8 : y, rest ? 1.35 : 0.18, rest ? 0.5 : 1.8, rest ? 0.38 : gather ? 0.43 : 0, rest ? 0.09 : gather ? 0.4 : 0, [0.3, 0.4, 0.35]);
  // A wall console extends into a work surface, then becomes a smaller shared tea table.
  part(x + hr * 1.9, y - hr * 1.3, focus ? 1.6 : 1.1, focus ? 0.85 : 0.7, 0, focus ? 0.7 : gather ? 0.44 : 0, [0.16, 0.2, 0.22]);
  part(x + hr * 1.9, y - hr * 1.3, focus ? 1.85 : 1.25, focus ? 1 : 0.85, focus ? 0.7 : gather ? 0.44 : 0, focus || gather ? 0.07 : 0, [0.65, 0.69, 0.66]);
  part(x + hr * 1.9, y + hr * 1.1, 0.8, 0.8, 0, gather || focus ? 0.43 : 0, [0.25, 0.22, 0.16]);
  return out;
}

/**
 * Lined rooms, luminous skirting, compact service wall and a continuous stair through all storeys. Mid: the stair a
 * ramp of its run (its risers are under a pixel from where mid tiles are drawn). Solid: the floors, walls, service
 * wall and stair ramps the feet meet, without screens, lamps or console.
 */
export function homeInteriorShape(sh: Shape, house: House, hr: number, detail: Exclude<RoomDetail, 'far'>): void {
  const { room: r, doorX, doorWidth, stair: st, service } = homePlan(house, hr), b = house.body;
  const stone: RGB = [0.3, 0.34, 0.35], pale: RGB = [0.55, 0.59, 0.57], accent: RGB = [0.08, 0.17, 0.18];
  const slab = hr * 0.12;
  for (let k = 0; k < house.storeys; k++) {
    const z = house.base + k * house.storey, top = z + house.storey - slab;
    sh.finish = FINISH.panel;
    // A continuous resilient floor finish over the structural slab.
    if (k === 0) upright(sh, r.x0, r.x1, r.y0, r.y1, z, z + 0.008 * hr, [0.24, 0.29, 0.29]);
    // Floors leave a stairwell on the right; ground floor is already the plinth's top.
    if (k > 0) {
      upright(sh, r.x0, st.x0, r.y0, r.y1, z - slab, z, stone, true);
      for (const [a, c] of [[r.y0, st.y0], [st.y1, r.y1]]) upright(sh, st.x0, r.x1, a, c, z - slab, z, stone, true);
    }
    if (k === house.storeys - 1) upright(sh, r.x0, r.x1, r.y0, r.y1, top, top + slab, pale, true);
    // Almost every interior wall is a physical display, with a solid backing and a recessed dark border.
    const wall = (x0: number, y0: number, x1: number, y1: number, normal: Vec3, door: boolean): void => {
      const len = Math.hypot(x1 - x0, y1 - y0), dx = (x1 - x0) / len, dy = (y1 - y0) / len;
      const ranges = door ? [[0, doorX - doorWidth / 2 - x0, z, top], [doorX + doorWidth / 2 - x0, len, z, top], [doorX - doorWidth / 2 - x0, doorX + doorWidth / 2 - x0, z + 2.5 * hr, top]] : [[0, len, z, top]];
      for (const [a, c, low, high] of ranges) {
        if (c <= a || high <= low) continue;
        sh.finish = FINISH.panel;
        sh.faceToward([x0 + dx * a, y0 + dy * a, low], [x0 + dx * c, y0 + dy * c, low], [x0 + dx * c, y0 + dy * c, high], [x0 + dx * a, y0 + dy * a, high], normal, accent);
        if (detail === 'solid') continue;
        const edge = hr * 0.07, u0 = a + edge, u1 = c - edge;
        if (u1 <= u0) continue;
        sh.finish = FINISH.domestic;
        sh.faceToward([x0 + dx * u0 + normal[0] * 0.005, y0 + dy * u0 + normal[1] * 0.005, low + edge], [x0 + dx * u1 + normal[0] * 0.005, y0 + dy * u1 + normal[1] * 0.005, low + edge], [x0 + dx * u1 + normal[0] * 0.005, y0 + dy * u1 + normal[1] * 0.005, high - edge], [x0 + dx * u0 + normal[0] * 0.005, y0 + dy * u0 + normal[1] * 0.005, high - edge], normal, homeDisplay(house));
      }
    };
    wall(r.x0, r.y0, r.x1, r.y0, [0, 1, 0], k === 0 && house.door < 0);
    wall(r.x0, r.y1, r.x1, r.y1, [0, -1, 0], k === 0 && house.door > 0);
    wall(r.x0, r.y0, r.x0, r.y1, [1, 0, 0], false);
    wall(r.x1, r.y0, r.x1, r.y1, [-1, 0, 0], false);
    sh.finish = FINISH.panel;
    upright(sh, service.x0, service.x1, service.y0, service.y1, z, z + hr * 0.83, pale);
    if (k < house.storeys - 1) {
      // Shallow domestic risers up close; further off and for the feet, the ramp of the same run.
      const steps = Math.ceil(house.storey / (0.08 * hr)), depth = (st.y1 - st.y0) / steps;
      if (detail !== 'near') {
        sh.faceToward([st.x0, st.y0, z], [st.x1, st.y0, z], [st.x1, st.y1, z + house.storey], [st.x0, st.y1, z + house.storey], [0, 0, 1], stone);
        for (const x of [st.x0, st.x1]) sh.faceToward([x, st.y0, z], [x, st.y1, z], [x, st.y1, z + house.storey], [x, st.y0, z], [x === st.x0 ? -1 : 1, 0, 0], stone);
      } else for (let n = 0; n < steps; n++) upright(sh, st.x0, st.x1, st.y0 + n * depth, st.y0 + (n + 1) * depth, z, z + (n + 1) * house.storey / steps, stone);
      // Guard the open side; the stair entry and upper landing remain clear.
      upright(sh, st.x0 - hr * 0.07, st.x0, st.y0 + depth, st.y1 - depth, z + house.storey, z + house.storey + hr, accent);
    }
    if (detail !== 'solid') {
      sh.finish = FINISH.lamp;
      upright(sh, r.x0 + hr * 0.03, r.x0 + hr * 0.07, r.y0, r.y1, top - hr * 0.06, top, pale);
      sh.finish = FINISH.panel;
      // A flush entry console, with no historical handles or cupboards.
      upright(sh, doorX + doorWidth * 0.65, doorX + doorWidth * 0.9, house.door > 0 ? r.y1 - hr * 0.04 : b.y0, house.door > 0 ? b.y1 : r.y0 + hr * 0.04, z + hr, z + hr * 1.35, accent);
    }
  }
}

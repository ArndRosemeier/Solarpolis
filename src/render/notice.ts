/**
 * The newcomers' notice at the port door (gen/welcomeSign.ts): its glass with the letters, the NOTICE kind. The letters
 * are drawn once per habitat on a canvas into a two-channel mask (red the heading's, green the lines' and the rule round
 * the edge) at the panel's own shape, so they keep their proportions on any habitat; the case round the glass is the
 * Lift Stair's. The mask goes to the GPU with mips (far off the panel dims to an even glow) and its pixels are let go on
 * the CPU once uploaded (`dropUploadedTexture`).
 */
import { DataTexture, Group, RGFormat, UnsignedByteType, type Mesh } from 'three/webgpu';
import type { Stage } from '@futuremagic/stage';
import { toView, type Habitat, type Vec3 } from '../blueprint';
import { HEADING_JOIN, welcomeSignOf, type NoticeLine, type WelcomeSign } from '../gen/welcomeSign';
import { axesOf, dropUploadedTexture, freeMesh, meshGeometry, posedMesh, setPose, uploadStatic } from './geometry';
import { NOTICE, noticeLetters } from './materials';
import { filtered } from './textures';

/** The mask's height in texels; its width follows the panel's shape (a multiple of 64, at most `MOST_WIDE`). */
const TEXELS_HIGH = 512;
const MOST_WIDE = 4096;
/** Margins round the text and the rule's inset and width, as shares of the panel's height. */
const MARGIN = 0.07;
const RULE = { inset: 0.025, width: 0.006 };
/** A line's letters are this share of its font size (cap height); lines wrap rather than shrink below `LEAST` of it. */
const CAP = 0.72;
const LEAST = 0.8;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
/** How far the glass stands in front of its case (m), clear of it in the depth buffer. */
const PROUD = 0.01;

interface Row {
  text: string;
  px: number;
  heading: boolean;
  gap: number;
}

/** The lines as rows in the mask (font sizes in texels), wrapped and scaled so they fill the panel without overflowing it. */
function rowsOf(ctx: CanvasRenderingContext2D, lines: readonly NoticeLine[], wide: number, high: number): Row[] {
  const room = wide - 2 * MARGIN * high, rows: Row[] = [];
  const widthAt = (text: string, px: number, heading: boolean): number => {
    ctx.font = `${heading ? 700 : 500} ${px}px ${FONT}`;
    return ctx.measureText(text).width;
  };
  for (const [i, l] of lines.entries()) {
    const px = (l.size * high) / CAP, gap = i === 0 ? 0 : px * (l.heading || lines[i - 1].heading ? 0.55 : 0.32);
    const fit = room / widthAt(l.text, px, l.heading);
    if (fit >= LEAST) { rows.push({ text: l.text, px: px * Math.min(1, fit), heading: l.heading, gap }); continue; }
    // Too long for the panel at a readable size: over as few rows as fit, close together (the heading breaks only
    // between its parts).
    const join = l.heading ? HEADING_JOIN : ' ', wrapped: string[] = [];
    let row = '';
    for (const word of l.text.split(join)) {
      const next = row ? `${row}${join}${word}` : word;
      if (row && widthAt(next, px, l.heading) > room) { wrapped.push(row); row = word; } else row = next;
    }
    wrapped.push(row);
    wrapped.forEach((text, k) => rows.push({ text, px, heading: l.heading, gap: k === 0 ? gap : px * 0.12 }));
  }
  const tall = rows.reduce((n, r) => n + r.gap + r.px, 0), most = high * (1 - 2 * MARGIN);
  const scale = Math.min(1, most / tall);
  for (const r of rows) {
    r.px *= scale;
    r.gap *= scale;
    // Still too wide after the rows shrank together: shrink this one alone.
    r.px *= Math.min(1, room / widthAt(r.text, r.px, r.heading));
  }
  return rows;
}

/** The mask of a notice: red the heading, green the lines and the rule; its width in texels. */
export function drawNotice(sign: WelcomeSign): { data: Uint8Array; width: number; height: number } {
  const high = TEXELS_HIGH, wide = Math.min(MOST_WIDE, Math.max(64, Math.round((high * sign.width) / sign.height / 64) * 64));
  const canvas = document.createElement('canvas');
  canvas.width = wide;
  canvas.height = high;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, wide, high);
  // The panel's texels are not square where its width was rounded: draw in units of the height.
  ctx.save();
  ctx.scale(wide / ((high * sign.width) / sign.height), 1);
  const across = (high * sign.width) / sign.height;
  ctx.strokeStyle = '#0f0';
  ctx.lineWidth = RULE.width * high;
  const inset = RULE.inset * high;
  ctx.strokeRect(inset, inset, across - 2 * inset, high - 2 * inset);
  const rows = rowsOf(ctx, sign.lines, across, high);
  const tall = rows.reduce((n, r) => n + r.gap + r.px, 0);
  let y = (high - tall) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const r of rows) {
    y += r.gap;
    ctx.font = `${r.heading ? 700 : 500} ${r.px}px ${FONT}`;
    ctx.fillStyle = r.heading ? '#f00' : '#0f0';
    ctx.fillText(r.text, across / 2, y);
    y += r.px;
  }
  ctx.restore();
  // Rows top down in the canvas, the texture's v up from the bottom.
  const rgba = ctx.getImageData(0, 0, wide, high).data, data = new Uint8Array(wide * high * 2);
  for (let j = 0; j < high; j++) for (let i = 0; i < wide; i++) {
    const from = ((high - 1 - j) * wide + i) * 4, to = (j * wide + i) * 2;
    data[to] = rgba[from];
    data[to + 1] = rgba[from + 1];
  }
  return { data, width: wide, height: high };
}

/** The notice's glass: a quad in its own frame (x along the lines, y up), uv over the mask. */
function glass(sign: WelcomeSign): Mesh {
  const x = sign.width / 2, y = sign.height / 2;
  const g = meshGeometry(new Uint32Array([0, 1, 2, 0, 2, 3]), {
    position: [new Float32Array([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0]), 3],
    uv: [new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2],
  });
  return posedMesh(g, NOTICE.material, 'notice to newcomers');
}

export class NoticeView {
  readonly group = new Group();
  private readonly sign: WelcomeSign | null;
  private mesh: Mesh | null = null;
  private letters: DataTexture | null = null;
  private held = 0;

  constructor(h: Habitat, private readonly stage: Stage) {
    this.group.name = 'notice';
    this.sign = welcomeSignOf(h);
  }

  /** Draw the letters and put the glass on the GPU (before the reveal, so it never appears late). */
  async load(): Promise<void> {
    const s = this.sign;
    if (!s || this.mesh) return;
    const m = drawNotice(s);
    const t = filtered(new DataTexture(m.data, m.width, m.height, RGFormat, UnsignedByteType), { mips: true, anisotropy: 8 });
    noticeLetters.value = t;
    this.letters = t;
    const mesh = glass(s);
    mesh.frustumCulled = false;
    await uploadStatic(this.stage, mesh);
    this.held = m.data.byteLength;
    mesh.visible = true;
    this.group.add(mesh);
    this.mesh = mesh;
  }

  /** Bytes it holds: the mask's pixels until the GPU has them, and the mask on the GPU (with its mips). */
  bytes(): number {
    return this.held + (this.letters ? Math.round((this.letters.image.width * this.letters.image.height * 2 * 4) / 3) : 0);
  }

  /** Pose the glass for the frame (relative to the eye), and let go of the mask's pixels once they are uploaded. */
  poseAt(eye: Vec3): void {
    const s = this.sign;
    if (!this.mesh || !s) return;
    setPose(this.mesh, axesOf({ ex: s.ex, ey: s.ey, ez: s.ez }), toView(eye, [s.at[0] + s.ez[0] * PROUD, s.at[1] + s.ez[1] * PROUD, s.at[2] + s.ez[2] * PROUD]));
    if (this.letters && this.held && dropUploadedTexture(this.letters, this.stage.renderer)) this.held = 0;
  }

  dispose(): void {
    if (this.mesh) freeMesh(this.mesh);
    this.mesh = null;
    if (this.letters) {
      if (noticeLetters.value === this.letters) noticeLetters.value = filtered(new DataTexture(new Uint8Array([0, 0]), 1, 1, RGFormat, UnsignedByteType));
      this.letters.dispose();
    }
    this.letters = null;
    this.held = 0;
  }
}

/**
 * The gravity meter in the Inside view (Arnd, 2026-10-22: make the spin's gravity visible and educational, since a
 * player who meets it unexplained takes it for a bug). It shows the gravity the player feels now (`feltGravity`, from
 * `InteriorView.onGravity`), a bar against what standing still here would give, which way spinward lies (the dial's
 * arrow), and why it differs; its "?" opens a short explanation with this habitat's own numbers.
 */
import type { Habitat } from '../blueprint';
import type { GravityReading } from '../world/motion';
import { el, km, openDialog, svg } from './dom';

/** Earth's gravity (m/s²): the meter reads in g. */
const G = 9.81;
/** The bar's full scale (g). */
const BAR_TOP = 2;
/** Slower than this around the axis (m/s) counts as standing still. */
const STILL = 0.3;

/** Height changes below this share of the floor's gravity are not worth a word. */
const LEVEL = 0.005;

/** A signed percentage: "+45%", "−36%". */
const signed = (x: number): string => `${x > 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`;

/**
 * The meter's words for a reading: the value ("0.64 g"), what changes it ("against the spin −36% · higher up −3%"),
 * one line on why, and the change from the floor's gravity standing still. Pure.
 */
export function describeGravity(r: GravityReading): { value: string; state: string; reason: string; change: number } {
  const spin = r.rest > 0 ? r.felt / r.rest - 1 : 0, height = r.floor > 0 ? r.rest / r.floor - 1 : 0;
  const doing = r.moving === 'lift' ? 'In a lift' : r.moving === 'fly' ? 'Flying' : r.moving === 'swim' ? 'Swimming' : r.moving === 'air' ? 'In the air' : '';
  const parts: string[] = [];
  const moving = Math.abs(r.spinward) >= STILL && Math.round(Math.abs(spin) * 100) > 0;
  if (moving) parts.push(`${r.spinward > 0 ? 'with' : 'against'} the spin ${signed(spin)}`);
  if (height < -LEVEL) parts.push(`higher up ${signed(height)}`);
  else if (height > LEVEL) parts.push(`lower down ${signed(height)}`);
  const state = parts.length ? parts.join(' · ') : r.moving === 'foot' ? 'standing still or along the axis' : 'as on the floor';
  const headed = doing ? `${doing}${parts.length ? ': ' : ', '}${state}` : state[0].toUpperCase() + state.slice(1);
  const reason = moving && Math.abs(spin) >= Math.abs(height)
    ? r.spinward > 0
      ? 'You go around the axis faster than the floor does, so it has to push you harder.'
      : 'You go around the axis slower than the floor does, so it pushes you less.'
    : height < -LEVEL
      ? 'Nearer the axis you go around on a smaller circle, slower, so the spin presses you less.'
      : 'The spinning floor carries you around the axis; its push toward the axis is your weight.';
  return { value: `${(r.felt / G).toFixed(2)} g`, state: headed, reason, change: r.floor > 0 ? r.felt / r.floor - 1 : 0 };
}

export class GravityMeter {
  readonly box = el('div', 'gm');
  private readonly arrow = svg('g', { class: 'gm-arrow' });
  private readonly value = el('div', 'gm-value');
  private readonly now = el('span', 'gm-now');
  private readonly restMark = el('span', 'gm-rest');
  private readonly state = el('div', 'gm-state');
  private readonly reason = el('div', 'gm-reason');
  private shown = '';

  /** `explain` gives the habitat and the player's walking and running speeds for the "?" panel. */
  constructor(private readonly explain: () => { habitat: Habitat; walk: number; run: number } | null) {
    this.box.setAttribute('role', 'status');
    this.box.setAttribute('aria-label', 'Gravity you feel');
    const dial = svg('svg', { class: 'gm-dial', viewBox: '-22 -22 44 44', 'aria-hidden': 'true' });
    dial.append(svg('circle', { r: '19', class: 'gm-ring' }), svg('circle', { r: '1.6', class: 'gm-you' }));
    this.arrow.append(svg('path', { d: 'M0 -17 L5 -9 L1.6 -9 L1.6 -3 L-1.6 -3 L-1.6 -9 L-5 -9 Z' }));
    dial.append(this.arrow);
    const left = el('div', 'gm-left');
    left.append(dial, el('span', 'gm-spin', 'spin'));
    const bar = el('div', 'gm-bar');
    bar.append(this.restMark, this.now);
    const text = el('div', 'gm-text');
    const help = el('button', 'gm-help', '?');
    help.type = 'button';
    help.title = 'Why does my weight change?';
    help.setAttribute('aria-label', 'Why does my weight change?');
    help.addEventListener('click', () => this.openExplanation());
    const head = el('div', 'gm-head');
    head.append(this.value, help);
    text.append(head, bar, this.state, this.reason);
    this.box.append(left, text);
  }

  /** Show a reading (each frame): the arrow turns at once, the words change only when they read differently. */
  showReading(r: GravityReading): void {
    this.arrow.setAttribute('transform', `rotate(${(r.arrow * 180) / Math.PI})`);
    const d = describeGravity(r);
    const key = `${d.value}|${d.state}|${d.reason}`;
    this.now.style.left = `${(Math.min(BAR_TOP, r.felt / G) / BAR_TOP) * 100}%`;
    this.restMark.style.left = `${(Math.min(BAR_TOP, r.rest / G) / BAR_TOP) * 100}%`;
    if (key === this.shown) return;
    this.shown = key;
    this.value.textContent = d.value;
    this.state.textContent = d.state;
    this.reason.textContent = d.reason;
    this.box.dataset.change = d.change > 0.005 ? 'heavier' : d.change < -0.005 ? 'lighter' : 'same';
  }

  /** The "?" panel: spin gravity in a few lines, with this habitat's numbers. */
  private openExplanation(): void {
    const e = this.explain();
    const close = el('button', 'wn-close', 'Close');
    close.type = 'button';
    const panel = openDialog('gm', 'Why your weight changes', close);
    if (!panel || !e) return;
    const { habitat: h, walk, run } = e;
    const V = h.spin * h.radius, R = h.radius;
    const g = (v: number): string => `${((V + v) ** 2 / R / G).toFixed(2)} g`;
    const head = el('div', 'wn-head');
    head.append(el('h2', '', 'Why your weight changes'), close);
    const para = (text: string): HTMLParagraphElement => el('p', '', text);
    const table = el('table', 'gm-table');
    const addRow = (cells: string[], tag: 'th' | 'td' = 'td'): void => {
      const tr = el('tr', '');
      for (const c of cells) tr.append(el(tag, '', c));
      table.append(tr);
    };
    addRow(['', 'with the spin', 'against it'], 'th');
    addRow([`walking (${walk.toFixed(0)} m/s)`, g(walk), g(-walk)]);
    addRow([`running (${run.toFixed(0)} m/s)`, g(run), g(-run)]);
    panel.append(head,
      para(`Nothing here pulls you down. The habitat is a drum ${km(2 * R)} across that turns once every ${h.period.toFixed(0)} s, and its floor carries you around the axis at ${V.toFixed(0)} m/s (${(V * 3.6).toFixed(0)} km/h). To keep you on that circle the floor has to push you toward the axis all the time. That push is your weight.`),
      para('Run with the spin and you go around faster, so the floor must push harder: you are heavier. Run against it and you go around slower: you are lighter. Your weight grows with the square of your speed around the axis, so even a fraction of the floor\'s speed shows:'),
      table,
      para('Along the axis nothing changes: you are not going around any faster. Up the endcap slopes you are nearer the axis, so you go around slower and weigh less; near the top, almost nothing.'),
      para('A jump hangs in the air as long as the gravity you felt when you left the ground says, so a jump while running against the spin lasts longer. A dropped ball lands a little behind (against the spin): up where it was let go it moved around more slowly than the floor below.'),
      para('The arrow on the meter points spinward, the way the floor itself moves. The mark on the bar is your gravity standing still where you are.'));
  }
}

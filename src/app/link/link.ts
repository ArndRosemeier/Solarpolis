/**
 * The player's neural link and its overlay (Arnd, 2026-10-23: canon, as common as phones today; everything integrates
 * into it). The one place the game speaks to the player over the world: systems serve it (`serve`, a `LinkService`
 * from src/link) and say lines through it (`say`); it draws their offers in its panel (N, or its sigil in the
 * corner), their live work as cards with a mark in the world, and the lines as quiet whispers that fade. Quiet by
 * default: nothing shows until something is going on or the player opens it. Page text, so it stays sharp and costs
 * the GPU nothing; only its own panel, cards and sigil take the mouse, the world stays clickable everywhere else.
 */
import type { Vec3 } from '@futuremagic/core';
import { LINK_KEY, findChoices, type LinkChoice, type LinkLine, type LinkOffer, type LinkService, type LinkStatus, type Sighting } from '../../link';
import { button, el } from '../dom';
import './link.css';

/** Seconds a whispered line stays, and how many show at once. */
const LINE_SECONDS = 7;
const MOST_LINES = 3;
/** While open, the offers are asked again this often (s). */
const REFRESH = 1;

/** Where a world point (the habitat's frame) shows this frame: on screen, or pinned to its edge toward it. */
export type Project = (p: Vec3) => Sighting;

interface Whisper { box: HTMLElement; age: number }
interface Card { box: HTMLElement; from: HTMLElement; title: HTMLElement; detail: HTMLElement; bar: HTMLElement; cancel: HTMLButtonElement; mark: HTMLElement; status: LinkStatus | null }

export class Link {
  readonly root = el('div', 'link');
  private readonly sigil = button('link-sigil', '', () => this.toggle());
  private readonly panel = el('section', 'link-panel');
  private readonly body = el('div', 'link-body');
  private readonly whispers = el('div', 'link-lines');
  private readonly cards = el('div', 'link-cards');
  private readonly marks = el('div', 'link-marks');
  private readonly services: LinkService[] = [];
  private readonly lines: Whisper[] = [];
  private readonly shown = new Map<string, Card>();
  /** The offer whose list is open, or null for the link's front. */
  private picking: { service: string; offer: string } | null = null;
  private typed = '';
  private selected = 0;
  private refresh = 0;
  /** What the panel shows now, so a refresh that changes nothing leaves it alone (a click in progress stays). */
  private drawn = '';

  constructor() {
    this.sigil.setAttribute('aria-label', `Open your link (${LINK_KEY.label})`);
    this.sigil.title = `Your link · ${LINK_KEY.label}`;
    this.sigil.append(el('span', 'link-sigil-ring'), el('span', 'link-sigil-key', LINK_KEY.label));
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Your link');
    this.panel.hidden = true;
    this.panel.append(this.body);
    this.whispers.setAttribute('aria-live', 'polite');
    this.root.append(this.marks, this.sigil, this.whispers, this.panel, this.cards);
    window.addEventListener('keydown', (e) => this.keyPressed(e));
  }

  /** Whether the link is open. */
  get opened(): boolean { return !this.panel.hidden; }

  /** Add a system's part of the link; returns the function that takes it away again. */
  serve(service: LinkService): () => void {
    this.services.push(service);
    if (this.opened) this.fillPanel();
    return () => {
      const i = this.services.indexOf(service);
      if (i >= 0) this.services.splice(i, 1);
      if (this.picking?.service === service.id) this.picking = null;
      if (this.opened) this.fillPanel();
    };
  }

  /** Whisper a line to the player ('On my way. Forty seconds.'). */
  say(line: LinkLine): void {
    const box = el('p', 'link-line');
    box.append(el('span', 'link-from', line.from), el('span', 'link-text', line.text));
    this.whispers.append(box);
    this.lines.push({ box, age: 0 });
    while (this.lines.length > MOST_LINES) this.lines.shift()!.box.remove();
  }

  open(): void {
    if (this.opened) return;
    this.panel.hidden = false;
    this.root.classList.add('open');
    this.picking = null;
    this.fillPanel();
  }

  close(): void {
    if (!this.opened) return;
    this.panel.hidden = true;
    this.root.classList.remove('open');
    this.picking = null;
    if (this.panel.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
  }

  toggle(): void { if (this.opened) this.close(); else this.open(); }

  /**
   * Each frame the view is shown: the services' live work as cards and marks (`project` puts a world point on screen),
   * the whispers aging, the open panel kept up to date.
   */
  frame(dt: number, project: Project): void {
    for (const w of this.lines) w.age += dt;
    while (this.lines.length && this.lines[0].age > LINE_SECONDS) this.lines.shift()!.box.remove();
    for (const w of this.lines) w.box.classList.toggle('fading', w.age > LINE_SECONDS - 1.5);
    const live = new Set<string>();
    for (const s of this.services) {
      const status = s.status?.() ?? null;
      if (!status) continue;
      live.add(s.id);
      this.showCard(s.id, status, project);
    }
    for (const [id, card] of this.shown) {
      if (live.has(id)) continue;
      card.box.remove(); card.mark.remove();
      this.shown.delete(id);
    }
    if (this.opened && (this.refresh += dt) >= REFRESH) {
      this.refresh = 0;
      this.fillPanel(true);
    }
  }

  private showCard(id: string, status: LinkStatus, project: Project): void {
    let c = this.shown.get(id);
    if (!c) {
      c = {
        box: el('div', 'link-card'), from: el('span', 'link-from'), title: el('strong', 'link-card-title'), detail: el('span', 'link-card-detail'),
        bar: el('span', 'link-card-bar'), cancel: button('link-card-cancel', 'Cancel', () => this.shown.get(id)?.status?.cancel?.()),
        mark: el('div', 'link-mark'), status: null,
      };
      const track = el('span', 'link-card-track');
      track.append(c.bar);
      c.box.append(c.from, c.title, c.detail, track, c.cancel);
      c.mark.append(el('span', 'link-mark-ring'), el('span', 'link-mark-text'));
      this.cards.append(c.box);
      this.marks.append(c.mark);
      this.shown.set(id, c);
    }
    c.status = status;
    if (c.from.textContent !== status.from) c.from.textContent = status.from;
    if (c.title.textContent !== status.title) c.title.textContent = status.title;
    const detail = status.detail ?? '';
    if (c.detail.textContent !== detail) c.detail.textContent = detail;
    c.detail.hidden = !detail;
    c.bar.parentElement!.hidden = status.progress === undefined;
    if (status.progress !== undefined) c.bar.style.width = `${(Math.min(1, Math.max(0, status.progress)) * 100).toFixed(1)}%`;
    c.cancel.hidden = !status.cancel;
    const seen = status.at ? project(status.at) : null;
    c.mark.hidden = !seen;
    if (seen) {
      const text = c.mark.lastElementChild as HTMLElement, words = status.mark ?? status.title;
      if (text.textContent !== words) text.textContent = words;
      c.mark.classList.toggle('edge', !seen.on);
      // Off screen: the words on the inner side of the arrow, so they stay on the screen.
      c.mark.classList.toggle('flip', !seen.on && Math.cos(seen.angle) > 0.3);
      (c.mark.firstElementChild as HTMLElement).style.transform = seen.on ? '' : `rotate(${seen.angle.toFixed(3)}rad)`;
      c.mark.style.transform = `translate(${seen.at[0].toFixed(1)}px, ${seen.at[1].toFixed(1)}px)`;
    }
  }

  /** The service and offer whose list is open. */
  private openOffer(): { service: LinkService; offer: LinkOffer } | null {
    if (!this.picking) return null;
    const service = this.services.find((s) => s.id === this.picking!.service);
    const offer = service?.offers().find((o) => o.id === this.picking!.offer);
    return service && offer?.choices ? { service, offer } : null;
  }

  /** Fill the panel: the front (every service's offers) or an offer's list. `keep`: a refresh, keep the search. */
  private fillPanel(keep = false): void {
    const picked = this.openOffer();
    if (this.picking && !picked) this.picking = null;
    if (picked) { this.drawChoices(picked.service, picked.offer, keep); return; }
    const all = this.services.map((s) => ({ s, offers: s.offers() }));
    const drawn = 'front|' + all.map(({ s, offers }) => s.id + ':' + offers.map((o) => `${o.id},${o.title},${o.detail ?? ''},${!!o.choices}`).join(';')).join('|');
    if (keep && drawn === this.drawn) return;
    this.drawn = drawn;
    this.body.replaceChildren();
    const head = el('header', 'link-head');
    head.append(el('span', 'link-eyebrow', 'Your link'), button('link-close', '×', () => this.close()));
    this.body.append(head);
    let any = false;
    for (const { s, offers } of all) {
      if (!offers.length) continue;
      any = true;
      const section = el('section', 'link-service');
      section.append(el('h3', 'link-service-title', s.title));
      for (const o of offers) {
        const b = button('link-offer', '', () => this.takeOffer(s, o));
        b.append(el('span', 'link-offer-title', o.title));
        if (o.detail) b.append(el('span', 'link-offer-detail', o.detail));
        if (o.choices) b.append(el('span', 'link-offer-more', '›'));
        section.append(b);
      }
      this.body.append(section);
    }
    if (!any) this.body.append(el('p', 'link-empty', 'Nothing here needs you. The habitat is quiet.'));
  }

  private takeOffer(s: LinkService, o: LinkOffer): void {
    if (o.choices) {
      this.picking = { service: s.id, offer: o.id };
      this.typed = '';
      this.selected = 0;
      this.fillPanel();
      return;
    }
    this.close();
    o.take();
  }

  private drawChoices(s: LinkService, o: LinkOffer, keep: boolean): void {
    const found = findChoices(o.choices ?? [], this.typed);
    this.selected = Math.min(this.selected, Math.max(0, found.length - 1));
    const drawn = `${s.id}/${o.id}|${this.typed}|${this.selected}|` + found.map((c) => `${c.id},${c.title},${c.detail ?? ''}`).join(';');
    if (keep && drawn === this.drawn) return;
    this.drawn = drawn;
    let search = this.body.querySelector<HTMLInputElement>('.link-search');
    let list = this.body.querySelector<HTMLElement>('.link-choices');
    if (!keep || !search || !list) {
      this.body.replaceChildren();
      const head = el('header', 'link-head');
      const back = button('link-back', '‹', () => { this.picking = null; this.fillPanel(); });
      back.setAttribute('aria-label', 'Back');
      head.append(back, el('span', 'link-eyebrow', `${s.title} · ${o.title}`), button('link-close', '×', () => this.close()));
      search = Object.assign(el('input', 'link-search'), { type: 'search', placeholder: 'Where to?', ariaLabel: `Find in ${o.title}` });
      search.value = this.typed;
      search.addEventListener('input', () => { this.typed = search!.value; this.selected = 0; this.fillPanel(true); });
      list = el('div', 'link-choices');
      list.setAttribute('role', 'listbox');
      this.body.append(head, search, list);
      const input = search;
      queueMicrotask(() => input.focus());
    }
    list.replaceChildren();
    let group: string | undefined;
    found.forEach((c: LinkChoice, i) => {
      if (c.group !== group) { group = c.group; if (group) list!.append(el('h4', 'link-group', group)); }
      const b = button('link-choice', '', () => { this.close(); o.take(c.id); });
      b.setAttribute('role', 'option');
      b.setAttribute('aria-selected', String(i === this.selected));
      b.classList.toggle('on', i === this.selected);
      b.append(el('span', 'link-offer-title', c.title));
      if (c.detail) b.append(el('span', 'link-offer-detail', c.detail));
      b.addEventListener('mousemove', () => { if (this.selected !== i) { this.selected = i; this.fillPanel(true); } });
      list!.append(b);
    });
    if (!found.length) list.append(el('p', 'link-empty', 'Nothing by that name.'));
  }

  private keyPressed(e: KeyboardEvent): void {
    if (!this.root.isConnected || !this.root.getClientRects().length) return;
    // N typed into the link's search (or any field) is a letter, not the link's key.
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target instanceof HTMLElement && e.target.isContentEditable);
    if (e.code === LINK_KEY.code && !typing && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      this.toggle();
      return;
    }
    if (!this.opened) return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (this.picking) { this.picking = null; this.fillPanel(); } else this.close();
      return;
    }
    if (!this.picking) return;
    const options = this.body.querySelectorAll<HTMLButtonElement>('.link-choice');
    if (e.code === 'ArrowDown' || e.code === 'ArrowUp') {
      e.preventDefault();
      if (!options.length) return;
      this.selected = (this.selected + (e.code === 'ArrowDown' ? 1 : options.length - 1)) % options.length;
      this.fillPanel(true);
      this.body.querySelector('.link-choice.on')?.scrollIntoView({ block: 'nearest' });
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      options[this.selected]?.click();
    }
  }
}

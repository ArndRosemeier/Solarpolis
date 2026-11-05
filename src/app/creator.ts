/**
 * The player's own look (Arnd, 2026-11-05: "Actors has a newer, easier and more flexible character generator now"):
 * Actors' creator (`CharacterEditor`) in the player's link, over a mirror the link holds up (the view's camera turned
 * round to the body, InteriorView `openMirror`). It offers what pack.ts `PLAYER_OFFER` lets the player make: a human
 * or a robot, in every outfit Actors has, medieval and fantastic too (residents keep to `THEMES_3026`). The look is
 * kept for the next visit (src/persist/look.ts); Start over gives back the person the world's seed made.
 */
import { CharacterEditor, type Character, type CharacterConfig, type CharacterPatch, type EditorSection } from '@actors/generator';
import type { LinkOffer, LinkService } from '../link';
import { writeLook } from '../persist/look';
import { el, onEscape } from './dom';
import './creator.css';

/** What the creator needs of the view: the mirror, and the seed's person. */
export interface Mirror {
  canMirror(): boolean;
  openMirror(closed: () => void): Character | null;
  closeMirror(): void;
  firstLook(): Promise<CharacterPatch>;
}

/** The creator's sections: what one is (a person or a robot), the robot, body, face and hair, clothes; no clips. */
const SECTIONS: EditorSection[] = ['race', 'robot', 'body', 'face', 'outfit'];
/** A change is kept once the sliders have rested this long (ms). */
const KEEP_AFTER = 500;

/** A look to keep: the config without its clip (the game plays its own). */
function keepable(config: CharacterConfig): object {
  const { animation: _clip, ...look } = config;
  return look;
}

export class LookCreator implements LinkService {
  readonly id = 'look';
  readonly title = 'You';
  readonly root = el('section', 'creator');
  private editor: CharacterEditor | null = null;
  private character: Character | null = null;
  private stops: (() => void)[] = [];
  private keepTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly view: Mirror, private readonly said: (text: string) => void) {
    this.root.hidden = true;
    this.root.setAttribute('aria-label', 'Your look');
  }

  offers(): readonly LinkOffer[] {
    if (this.editor || !this.view.canMirror()) return [];
    return [{ id: 'look', title: 'Change how you look', detail: 'Body, face, hair and clothes, in a mirror your link holds up.', take: () => this.open() }];
  }

  /** Open the creator over the mirror (nothing where the mirror cannot open now: not on foot). */
  open(): void {
    if (this.editor) return;
    const character = this.view.openMirror(() => this.closed());
    if (!character) return;
    this.character = character;
    this.root.hidden = false;
    this.editor = new CharacterEditor(character, this.root, {
      title: 'You',
      sections: SECTIONS,
      buttons: ['randomize'],
      hide: ['anatomy'],
      actions: [
        { label: 'Start over', onClick: () => void this.startOver() },
        { label: 'Done', onClick: () => this.view.closeMirror() },
      ],
    });
    this.stops.push(
      character.onChange((config) => {
        clearTimeout(this.keepTimer);
        this.keepTimer = setTimeout(() => writeLook(keepable(config)), KEEP_AFTER);
      }),
      onEscape(() => this.view.closeMirror()),
    );
    this.said('Holding up a mirror. Drag with the right button to walk round yourself; the wheel comes closer.');
  }

  /** Back to the person the world's seed made (and no look kept). */
  private async startOver(): Promise<void> {
    const c = this.character;
    if (!c) return;
    const { animation: _clip, ...look } = await this.view.firstLook();
    await c.set(look);
    clearTimeout(this.keepTimer);
    writeLook(null);
  }

  /** The mirror closed (Done, Escape, or no longer on foot): the look kept as it is now, the panel gone. */
  private closed(): void {
    clearTimeout(this.keepTimer);
    for (const stop of this.stops) stop();
    this.stops = [];
    this.editor?.dispose();
    this.editor = null;
    this.character = null;
    this.root.replaceChildren();
    this.root.hidden = true;
  }
}

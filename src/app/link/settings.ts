/**
 * The link's own settings, as one of its services: names on hover on or off (Arnd, 2026-10-23: "with a toggle"). On by
 * default; the choice is kept for the next visit (src/persist). The view asks nothing while it is off.
 */
import type { LinkOffer, LinkService } from '../../link';
import { readSetting, writeSetting } from '../../persist/settings';

const SETTING = 'link.names';

export class LinkSettings implements LinkService {
  readonly id = 'link';
  readonly title = 'Your link';
  private on = readSetting(SETTING, 'on') !== 'off';

  /** `changed` hears the setting as it is now and whenever the player turns it. */
  constructor(private readonly changed: (namesOn: boolean) => void, private readonly said: (text: string) => void) {
    changed(this.on);
  }

  offers(): readonly LinkOffer[] {
    return [{
      id: 'names',
      title: `Names on hover: ${this.on ? 'on' : 'off'}`,
      detail: this.on ? 'Rest your pointer on someone or something to see its name.' : 'Turn on to have what your pointer rests on named.',
      take: () => {
        this.on = !this.on;
        writeSetting(SETTING, this.on ? 'on' : 'off');
        this.changed(this.on);
        this.said(this.on ? 'Names on hover are on. Rest your pointer on something.' : 'Names on hover are off.');
      },
    }];
  }
}

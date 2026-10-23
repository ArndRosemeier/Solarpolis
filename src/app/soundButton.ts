/** The header's sound switch: turns all sound off or on (kept in this browser), beside What's new. */
import type { Sound } from '../audio/sound';
import { button, showToggle } from './dom';

const TEXT = ['Sound on', 'Sound off'] as const;
const TITLE = ['Sound is on: click to turn it off', 'Sound is off: click to turn it on'] as const;

export function soundButton(sound: Sound): HTMLButtonElement {
  const b = button('sound-button', '', () => sound.setMuted(!sound.isMuted));
  const show = (muted: boolean): void => showToggle(b, !muted, TEXT, TITLE);
  sound.onMuted = show;
  show(sound.isMuted);
  return b;
}

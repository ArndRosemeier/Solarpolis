/**
 * The page's first script (index.html): the styles, the opening (design "First Light", firstLight.ts) and then the
 * game. The opening starts before the game's code has even arrived, so its first frame is up in well under a second;
 * a page opened straight into a view (`?view=inside`) has no opening (index.html marks it `no-opening`).
 */
import '../app/style.css';
import { firstLight } from './firstLight';

if (!document.documentElement.classList.contains('no-opening')) firstLight.begin();
void import('../main');

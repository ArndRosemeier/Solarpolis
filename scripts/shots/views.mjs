/**
 * The named views `npm run shots` can capture (scripts/shots/README.md). Add yours here, in your branch: the render PC
 * reads this file from the ref it renders, so a new view works in the same request that adds it.
 *
 * A view is `{ query, about, steps, settle }`:
 *  - `query`: the page's URL query (`view=inside`, `view=outside&preset=large`, '' for the title).
 *  - `steps`: what to do once the view is ready, in order. Each step is one of
 *      { debug: 'label' }             click the debug menu item whose label starts with this (Shift+Ctrl+F12 menu)
 *      { key: 'KeyF' }                press a key (`KeyboardEvent.code`); `{ key, hold: 1500 }` holds it that long (ms)
 *      { look: [dx, dy] }             hold the right mouse button and drag by dx, dy pixels (looks around)
 *      { wheel: dy }                  turn the mouse wheel (positive: away from the screen)
 *      { wait: 2000 }                 let the page run this long (ms)
 *      { shot: 'name' }               take a picture now (`<view>-<name>.png`); the view's own picture comes at the end
 *      { run: async (page) => {} }    anything else, with Playwright's page
 *  - `heap(label)` as a `run` step: a heap snapshot of the page, who holds what (heap.mjs), as a warning in report.json.
 *  - `settle`: ms to let tiles, plants and shaders stream in before the steps (default 4000).
 *  - `default: true`: part of the set captured when no `--views` are given.
 */
/**
 * Standing still, read the debug menu's terrain line every 250 ms for 6 s and log it as console warnings (they land in
 * report.json): tiles that keep coming on screen or being built again are LOD flicker.
 */
async function logTiles(page) {
  await page.keyboard.press('Control+Shift+F12');
  const lines = [];
  for (let i = 0; i < 24; i++) {
    const text = await page.locator('.dbg-panel .dbg-info').innerText({ timeout: 3000 }).catch(() => '');
    lines.push(text.split('\n').find((l) => l.startsWith('terrain')) ?? '(no terrain line)');
    await page.waitForTimeout(250);
  }
  await page.locator('.dbg-panel .dbg-close').click().catch(() => {});
  await page.evaluate((ls) => { for (const l of ls) console.warn(`tiles: ${l}`); }, lines);
}
/** A heap snapshot step (heap.mjs, loaded fresh: the render PC's watcher runs for hours and would keep an old copy). */
const heap = (label) => ({ run: async (page) => { await (await import(`./heap.mjs?t=${Date.now()}`)).heapStep(page, label); } });
/** Turn on the debug menu's memory details, so the report's debug info lists every owner. */
const memoryDetails = { debug: 'Show memory details' };

export const views = {
  title: { query: '', about: 'the title card over the attract flight', default: true },
  arrival: {
    query: '', about: 'Start: the passenger\'s ship down its corridor (-corridor), nearing the berth (-berth), then just latched',
    steps: [{ run: async (page) => page.click('.title-start') }, { wait: 5000 }, { shot: 'corridor' }, { wait: 14000 }, { shot: 'berth' }, { wait: 3500 }],
  },
  lab: { query: 'view=lab', about: 'the Blueprint Lab', settle: 1000, default: true },
  inside: { query: 'view=inside', about: 'standing on the floor, first look', default: true },
  'inside-up': { query: 'view=inside', about: 'from the floor, looking up across the cylinder', steps: [{ look: [0, -250] }] },
  'inside-wild-endcap': { query: 'view=inside', about: 'halfway up the wild endcap', steps: [{ debug: 'Halfway up the wild endcap' }, { wait: 4000 }] },
  'inside-port-endcap': { query: 'view=inside', about: 'at the foot of the port endcap', steps: [{ debug: 'The foot of the port endcap' }, { wait: 4000 }] },
  'inside-fly': { query: 'view=inside', about: 'flying up for 4 s from the floor', steps: [{ key: 'KeyF' }, { key: 'KeyE', hold: 4000 }, { wait: 3000 }] },
  'ground-down': { query: 'view=inside', about: 'standing on the floor, looking down at the feet', steps: [{ look: [0, 320] }, { wait: 1500 }] },
  'ground-wood': { query: 'view=inside', about: 'inside the nearest wood: ahead (-ahead), then down at the floor', settle: 6000, steps: [{ debug: 'Into the nearest wood' }, { wait: 6000 }, { shot: 'ahead' }, { look: [0, 300] }, { wait: 1500 }] },
  'ground-meadow': { query: 'view=inside', about: 'in the nearest meadow: ahead (-ahead), then down at the grass', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { shot: 'ahead' }, { look: [0, 200] }, { wait: 1500 }] },
  'ground-log': { query: 'view=inside', about: 'a few metres before the nearest fallen trunk, looking at it', settle: 6000, steps: [{ debug: 'To the nearest fallen trunk' }, { wait: 6000 }, { look: [0, 90] }, { wait: 1000 }] },
  'ground-boulder': { query: 'view=inside', about: 'halfway up the wild endcap, before the nearest boulder: ahead (-ahead), then from closer', settle: 6000, steps: [{ debug: 'Halfway up the wild endcap' }, { wait: 5000 }, { debug: 'To the nearest boulder' }, { wait: 7000 }, { look: [0, 60] }, { shot: 'ahead' }, { key: 'KeyW', hold: 1200 }, { wait: 1500 }] },
  'ground-river': { query: 'view=inside', about: 'on the bank of the nearest river, looking upstream at it: ahead (-ahead), then down at the water', settle: 6000, steps: [{ debug: 'To the nearest river' }, { wait: 7000 }, { shot: 'ahead' }, { look: [0, 120] }, { wait: 1500 }] },
  'ground-falls': { query: 'view=inside', about: 'halfway up the wild endcap, 200 m below the nearest falls, looking up at them', settle: 6000, steps: [{ debug: 'Halfway up the wild endcap' }, { wait: 5000 }, { debug: 'Below the nearest falls' }, { wait: 7000 }, { look: [0, -90] }, { wait: 2000 }] },
  'river-above': { query: 'view=inside', about: 'flown up over the nearest river on the floor, looking down along it', settle: 6000, steps: [{ debug: 'To the nearest river' }, { wait: 6000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 3500 }, { look: [0, 200] }, { wait: 3000 }] },
  'ground-endcap': { query: 'view=inside', about: 'at the foot of the wild endcap, looking a little down', steps: [{ debug: 'The foot of the wild endcap' }, { wait: 6000 }, { look: [0, 120] }, { wait: 1000 }] },
  'inside-wild-tip': { query: 'view=inside', about: 'near the wild endcap\'s tip, where the sunline meets it; logs the terrain line every 250 ms for 6 s (LOD flicker)', settle: 6000, steps: [{ debug: 'Near the wild endcap\'s tip' }, { wait: 8000 }, { run: logTiles }, { look: [0, -200] }, { wait: 1500 }] },
  'inside-port-hub': { query: 'view=inside', about: 'near the port endcap\'s hub, where the sunline meets it; logs the terrain line every 250 ms for 6 s (LOD flicker)', settle: 6000, steps: [{ debug: 'Near the port endcap\'s hub' }, { wait: 8000 }, { run: logTiles }, { look: [0, -200] }, { wait: 1500 }] },
  outside: { query: 'view=outside', about: 'the home habitat from outside', default: true },
  'outside-earth': { query: 'view=outside', about: 'looking at Earth (key 2)', steps: [{ key: 'Digit2' }, { wait: 3000 }] },
  'outside-moon': { query: 'view=outside', about: 'looking at the Moon (key 3)', steps: [{ key: 'Digit3' }, { wait: 3000 }] },
  'outside-neighbour': { query: 'view=outside', about: 'the nearest neighbour in the Necklace (key 4)', steps: [{ key: 'Digit4' }, { wait: 3000 }] },
  'outside-night-eyes': { query: 'view=outside', about: 'the stars with the Night eyes augmentation', steps: [{ debug: 'Night eyes augmentation' }, { wait: 2000 }] },
  'outside-close': { query: 'view=outside', about: 'wheel in close to the hull', steps: [{ wheel: -2400 }, { wait: 3000 }] },
  'memory-title': { query: '', about: 'the title flight for 40 s, then a heap snapshot: who holds the JS heap', steps: [memoryDetails, { wait: 40000 }, heap('title')] },
  'memory-inside': {
    query: 'view=inside', about: 'up the wild endcap and flying toward the sunline, looking around, then a heap snapshot', settle: 6000,
    steps: [memoryDetails, { debug: 'The foot of the wild endcap' }, { wait: 5000 }, { debug: 'Halfway up the wild endcap' }, { wait: 5000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 6000 },
      { look: [700, 0] }, { wait: 3000 }, { look: [700, 0] }, { wait: 3000 }, { look: [700, 0] }, { wait: 3000 }, { look: [0, 250] }, { wait: 6000 }, { shot: 'before-heap' }, heap('inside')],
  },
};

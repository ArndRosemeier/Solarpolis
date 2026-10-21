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
    query: '', about: 'Start: down the corridor (-corridor), nearing the berth (-berth), in the bore (-bore), past the bearing (-sleeve), then floating at the Hub',
    steps: [{ run: async (page) => page.click('.title-start') }, { wait: 5000 }, { shot: 'corridor' }, { wait: 14000 }, { shot: 'berth' }, { wait: 9000 }, { shot: 'bore' }, { wait: 8000 }, { shot: 'sleeve' }, { wait: 14000 }],
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
  'bushes-meadow': { query: 'view=inside', about: 'in the nearest meadow, looking out across it at the bushes near and far', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 7000 }, { look: [0, -20] }, { wait: 1500 }] },
  'bushes-above': { query: 'view=inside', about: 'flown up over the nearest meadow, looking out and down at the bushes', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 3000 }, { look: [0, 90] }, { wait: 3000 }] },
  'ground-endcap': { query: 'view=inside', about: 'at the foot of the wild endcap, looking a little down', steps: [{ debug: 'The foot of the wild endcap' }, { wait: 6000 }, { look: [0, 120] }, { wait: 1000 }] },
  'clouds-up': { query: 'view=inside', about: 'in the nearest meadow, looking straight up at the clouds overhead', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { look: [0, -390] }, { wait: 1500 }] },
  'clouds-side': { query: 'view=inside', about: 'in the nearest meadow, turned spinward and looking up at the clouds across the cylinder', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { look: [390, -150] }, { wait: 1500 }] },
  'clouds-overcast': { query: 'view=inside', about: 'in the nearest meadow, the clouds set to overcast (85%), looking up across the cylinder', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { debug: 'Clouds: schedule' }, { debug: 'Clouds: schedule' }, { debug: 'Clouds: schedule' }, { look: [0, -200] }, { wait: 1500 }] },
  'clouds-under': { query: 'view=inside', about: 'flown up under the clouds: ahead (-ahead), then looking up', settle: 6000, steps: [{ debug: 'Fly up under the clouds' }, { wait: 3000 }, { shot: 'ahead' }, { look: [0, -250] }, { wait: 1500 }] },
  'clouds-drift': { query: 'view=inside', about: 'in the nearest meadow looking up across the cylinder, at real time: now (-now) and half a minute later', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { look: [200, -260] }, { wait: 1500 }, { shot: 'now' }, { wait: 30000 }] },
  'clouds-in': { query: 'view=inside', about: 'flown up into the middle of the cloud layer, looking ahead', settle: 6000, steps: [{ debug: 'Fly up into the clouds' }, { wait: 3000 }] },
  // The assembly pavilion on the ring lake (gen/pavilion.ts): from its bridge, on its floor, from nearby and from afar.
  'pavilion-bridge': { query: 'view=inside', about: 'at the shore end of the pavilion\'s bridge, looking along it at the pavilion: ahead (-ahead), then up at the roof', settle: 6000, steps: [{ debug: 'To the pavilion: the shore end' }, { wait: 9000 }, { shot: 'ahead' }, { look: [0, -80] }, { wait: 1500 }] },
  'pavilion-floor': { query: 'view=inside', about: 'on the pavilion\'s speaking floor by the pool: ahead at the seats (-ahead), then up at the oculus', settle: 6000, steps: [{ debug: 'Onto the pavilion\'s speaking floor' }, { wait: 9000 }, { shot: 'ahead' }, { look: [0, -260] }, { wait: 1500 }] },
  'pavilion-by': { query: 'view=inside', about: 'floating beside the pavilion, a little above its roof, looking at it', settle: 6000, steps: [{ debug: 'Fly: by the pavilion' }, { wait: 9000 }] },
  'pavilion-far': { query: 'view=inside', about: 'floating far from the pavilion and high over the lake, looking at it', settle: 6000, steps: [{ debug: 'Fly: the pavilion from afar' }, { wait: 9000 }] },
  // The founders' grove (gen/planted.ts): inside its ring, over it, and from afar.
  'grove-in': { query: 'view=inside', about: 'standing inside the founders\' grove, looking across its clearing at the ring of trees', settle: 6000, steps: [{ debug: 'To the founders\' grove' }, { wait: 9000 }] },
  'grove-over': { query: 'view=inside', about: 'floating above the founders\' grove, looking down at the ring', settle: 6000, steps: [{ debug: 'Fly: over the founders\' grove' }, { wait: 9000 }] },
  'grove-far': { query: 'view=inside', about: 'floating far from the founders\' grove, looking at it', settle: 6000, steps: [{ debug: 'Fly: the founders\' grove from afar' }, { wait: 12000 }] },
  'inside-wild-tip': { query: 'view=inside', about: 'near the wild endcap\'s tip, where the sunline meets it; logs the terrain line every 250 ms for 6 s (LOD flicker)', settle: 6000, steps: [{ debug: 'Near the wild endcap\'s tip' }, { wait: 8000 }, { run: logTiles }, { look: [0, -200] }, { wait: 1500 }] },
  'inside-port-hub': { query: 'view=inside', about: 'near the port endcap\'s hub, where the sunline meets it; logs the terrain line every 250 ms for 6 s (LOD flicker)', settle: 6000, steps: [{ debug: 'Near the port endcap\'s hub' }, { wait: 8000 }, { run: logTiles }, { look: [0, -200] }, { wait: 1500 }] },
  // The far view (docs/far-view.md): high over the land, every distance band from a few hundred metres to across the tube.
  'far-low': { query: 'view=inside', about: 'flying low over the floor, looking along it', steps: [{ debug: 'Fly: low over the floor' }, { wait: 9000 }] },
  'far-across': { query: 'view=inside', about: 'a quarter of the way to the axis, looking across the curve', steps: [{ debug: 'Fly: a quarter of the way up' }, { wait: 9000 }] },
  'far-side': { query: 'view=inside', about: 'halfway to the axis, looking at the far side', steps: [{ debug: 'Fly: halfway up' }, { wait: 9000 }] },
  'far-down': { query: 'view=inside', about: 'high up, looking down at the floor', steps: [{ debug: 'Fly: high up, looking down' }, { wait: 9000 }] },
  'far-tube': { query: 'view=inside', about: 'near the axis at the wild end, looking along the tube', steps: [{ debug: 'Fly: near the axis' }, { wait: 9000 }] },
  'far-tube-clear': { query: 'view=inside', about: 'as far-tube, with no clouds (to tell the air from the clouds)', steps: [...Array(4).fill({ debug: 'Clouds: schedule' }), { debug: 'Fly: near the axis' }, { wait: 9000 }] },
  'far-endcap': { query: 'view=inside', about: 'over the floor near the wild end, looking up its endcap', steps: [{ debug: 'Fly: over the floor, looking up' }, { wait: 9000 }] },
  'snow-line': { query: 'view=inside', about: 'a few metres over the Mountain\'s snow line, looking up into the snow', settle: 6000, steps: [{ debug: 'Fly: at the Mountain\'s snow line, looking up into the snow' }, { wait: 9000 }] },
  'snow-over': { query: 'view=inside', about: 'high over the Mountain\'s snowfield, looking up toward the axis', settle: 6000, steps: [{ debug: 'Fly: over the Mountain\'s snowfield' }, { wait: 9000 }] },
  'far-gate': { query: 'view=inside', about: 'over the floor near the port end, looking up the Gate', steps: [{ debug: 'Fly: over the floor, looking up the port endcap' }, { wait: 9000 }] },
  'far-meadow-up': { query: 'view=inside', about: 'standing in a meadow, looking up at the far side', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 5000 }, { look: [0, -260] }, { wait: 3000 }] },
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

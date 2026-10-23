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
/**
 * Read the debug menu's plant LOD line once and log it as a console warning (report.json): its holes must be 0, and
 * so must the frames with holes so far.
 */
async function logPlantLod(page) {
  await page.keyboard.press('Control+Shift+F12');
  const text = await page.locator('.dbg-panel .dbg-info').innerText({ timeout: 3000 }).catch(() => '');
  await page.locator('.dbg-panel .dbg-close').click().catch(() => {});
  const lines = text.split('\n').filter((l) => l.startsWith('plant LOD') || l.startsWith('plants'));
  await page.evaluate((ls) => { for (const l of ls) console.warn(l); }, lines.length ? lines : ['(no plant LOD line)']);
}
/**
 * Read the debug menu's people line and shader line once and log them as console warnings (report.json): handover
 * holes must stay 0; the shader line says how many shaders the figures built after the warm-up, and the worst.
 */
/** Click (the left button) the middle of the view, where the eye looks. */
async function clickMiddle(page) {
  const box = await page.locator('canvas.view-canvas').first().boundingBox();
  if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function logPeople(page) {
  await page.keyboard.press('Control+Shift+F12');
  const text = await page.locator('.dbg-panel .dbg-info').innerText({ timeout: 3000 }).catch(() => '');
  await page.locator('.dbg-panel .dbg-close').click().catch(() => {});
  const lines = text.split('\n').filter((l) => l.startsWith('people') || l.startsWith('understorey') || l.startsWith('home furniture') || l.startsWith('θ') || l.startsWith('specks') || l.startsWith('drones') || l.startsWith('talk') || l.startsWith('animals') || l.startsWith('squirrels') || l.startsWith('deer') || l.startsWith('birds') || l.startsWith('shaders') || l.startsWith('memory') || l.includes('MB') || l.includes('fps'));
  await page.evaluate((ls) => { for (const l of ls) console.warn(l); }, lines.length ? lines : ['(no people line)']);
  // Builds after the warm-up that started sooner than twice the last one's time after it (the cap, docs/SHADERS.md):
  // which, and how (a node-sync one was drawn uncompiled).
  await page.evaluate(() => {
    const run = (window.shaders?.events ?? []).filter((e) => e.phase === 'run' && (e.kind === 'node-sync' || e.kind === 'node-async')).sort((a, b) => a.t - b.t);
    for (let i = 1; i < run.length; i++) {
      const a = run[i - 1], b = run[i], gap = b.t - a.t - a.ms;
      if (gap < 2 * a.ms - 1) console.warn(`close builds: ${gap.toFixed(0)} ms after ${a.kind} "${a.what}" (${a.ms.toFixed(0)} ms), ${b.kind} "${b.what}"`);
    }
    for (const e of run) if (e.kind === 'node-sync') console.warn(`drawn uncompiled: "${e.what}" (${e.ms.toFixed(0)} ms)`);
  });
}
/** Walk ahead (W) for `steps` stretches of `ms`, a picture after each (`-w1`, `-w2`, ...), then log the plant LOD line. */
const walk = (steps, ms) => [...Array.from({ length: steps }, (_, i) => [{ key: 'KeyW', hold: ms }, { shot: `w${i + 1}` }]).flat(), { run: logPlantLod }];
/** Press keys and keep them down across the next steps (running while a picture is taken), and let them go. */
const hold = (...keys) => async (page) => { for (const k of keys) await page.keyboard.down(k); };
const release = (...keys) => async (page) => { for (const k of keys) await page.keyboard.up(k); };
/** A heap snapshot step (heap.mjs, loaded fresh: the render PC's watcher runs for hours and would keep an old copy). */
const heap = (label) => ({ run: async (page) => { await (await import(`./heap.mjs?t=${Date.now()}`)).heapStep(page, label); } });
/** Turn on the debug menu's memory details, so the report's debug info lists every owner. */
const memoryDetails = { debug: 'Show memory details' };

/** Fly to a bird, let the land there load, then fly to it again (it has moved on) and take the picture at once. */
const toBird = (item, shot) => [{ debug: item }, { wait: 3000 }, { debug: item }, { wait: 300 }, { shot }];

export const views = {
  'ship-tour': { query: 'view=tour', about: 'Passenger destination tree, physical camera, closeups, decks and a complete accelerated lunar return', settle: 5000, steps: [
    { shot: 'destinations' },
    { run: async (page) => { await page.locator('.voyage-launch').click(); await page.locator('.voyage-hud').waitFor({ state: 'visible', timeout: 60000 }); } },
    { wait: 1500 }, { shot: 'departure' },
    { run: async (page) => { await page.getByLabel('Voyage clock', { exact: true }).selectOption('0'); await page.getByLabel('Observe a world', { exact: true }).selectOption('earth'); await page.getByLabel('Observation mode', { exact: true }).selectOption('model'); } },
    { wait: 1500 }, { shot: 'earth-closeup' },
    { run: async (page) => { await page.getByLabel('Observe a world', { exact: true }).selectOption('saturn'); } },
    { wait: 1500 }, { shot: 'saturn-closeup' },
    { run: async (page) => {
      for (const side of ['forward', 'aft', 'port', 'starboard', 'above', 'below']) { await page.getByLabel('Look toward', { exact: true }).selectOption(side); await page.waitForTimeout(120); }
      await page.getByLabel('Look toward', { exact: true }).selectOption('body');
      await page.locator('.voyage-details > summary').click();
    } }, { shot: 'route' },
    { run: async (page) => { await page.locator('.voyage-details > summary').click(); await page.getByRole('button', { name: 'Outside', exact: true }).click(); await page.getByRole('button', { name: 'Ship Tour', exact: true }).click(); await page.locator('.voyage-hud').waitFor({ state: 'visible' }); } },
    { run: async (page) => { await page.locator('.voyage-visit').click(); await page.locator('.vessel-panel').waitFor({ state: 'visible', timeout: 30000 }); } },
    { wait: 2000 }, { shot: 'passenger-deck' },
    { run: async (page) => { await page.getByRole('button', { name: 'Return to voyage computer' }).click(); await page.getByLabel('Observe a world', { exact: true }).selectOption('moon'); await page.getByLabel('Look toward', { exact: true }).selectOption('destination'); await page.getByLabel('Observation mode', { exact: true }).selectOption('window'); await page.getByLabel('Voyage clock', { exact: true }).selectOption('3600'); } },
    { wait: 7000 }, { shot: 'under-way' },
    { run: async (page) => { await page.getByLabel('Voyage clock', { exact: true }).selectOption('604800'); await page.waitForFunction(() => document.querySelector('.voyage-hud h2')?.textContent?.includes('Welcome home'), { timeout: 30000 }); } },
    { wait: 1000 }, { shot: 'home' },
    { run: logPeople }, heap('ship-tour'),
  ] },
  title: { query: '', about: 'the title card over the attract flight', default: true },
  arrival: {
    query: '', about: 'Docking, the turning bore, the sheltered threshold, the cylinder reveal and an on-foot arrival terrace',
    steps: [{ run: async (page) => page.click('.title-start') }, { wait: 5000 }, { shot: 'corridor' }, { wait: 14000 }, { shot: 'berth' }, { wait: 9000 }, { shot: 'bore' }, { wait: 8000 }, { shot: 'sleeve' }, { run: async (page) => page.waitForSelector('.arrival-card.welcoming', { timeout: 60000 }) }, { shot: 'welcome' }, { wait: 6500 }, { shot: 'reveal' }, { run: async (page) => page.waitForSelector('.arrival-card.arrived', { timeout: 30000 }) }, { wait: 3000 }, { shot: 'terrace' }, { run: logPeople }],
  },
  'arrival-terrace': { query: 'view=inside', about: 'the port overlook and its usable connection to the Lift Stair', settle: 6000, steps: [memoryDetails, { debug: 'Arrival: reveal the port terrace' }, { wait: 5000 }, { shot: 'threshold' }, { wait: 7000 }, { shot: 'reveal' }, { wait: 7000 }, { shot: 'landed' }, { look: [300, 50] }, { wait: 1500 }, { shot: 'route' }, { run: logPeople }, heap('arrival-terrace')] },
  lab: { query: 'view=lab', about: 'the Blueprint Lab', settle: 1000, default: true },
  'lab-under': { query: 'view=lab', about: 'the Blueprint Lab scrolled to "Under the floor": the Understorey plan, the whole floor and one hamlet close up', settle: 3000, steps: [{ run: async (page) => page.evaluate(() => { [...document.querySelectorAll('h2')].find((e) => e.textContent === 'Under the floor')?.scrollIntoView(); }) }, { wait: 1500 }] },
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
  'walk-meadow': { query: 'view=inside', about: 'walking (5 m/s) across the nearest meadow, a picture every 0.8 s (-w1 … -w10): no bush, tuft or stone may blink out; logs the plant LOD line', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 8000 }, { look: [0, -15] }, { wait: 1000 }, { shot: 'w0' }, ...walk(10, 800)] },
  'walk-wood': { query: 'view=inside', about: 'walking (5 m/s) into the nearest wood, a picture every 0.8 s (-w1 … -w10); logs the plant LOD line', settle: 6000, steps: [{ debug: 'Before the nearest wood' }, { wait: 8000 }, { look: [0, -15] }, { wait: 1000 }, { shot: 'w0' }, ...walk(10, 800)] },
  'run-meadow': { query: 'view=inside', about: 'travelling 10× (50 m/s) across the nearest meadow, a picture every 0.5 s (-w1 … -w8): coarser levels stand in where cells are still planted; logs the plant LOD line', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 8000 }, { debug: 'Travel 10× faster' }, { look: [0, -15] }, { wait: 1000 }, { shot: 'w0' }, ...walk(8, 500)] },
  'bushes-levels': { query: 'view=inside', about: 'in the nearest meadow: every level (-all), then only the full (-full), only the lite (-lite), only the far level (-far), to compare their size and colour', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 8000 }, { look: [0, -15] }, { wait: 1500 }, { shot: 'all' }, { debug: 'Plants: every level' }, { wait: 2500 }, { shot: 'full' }, { debug: 'Plants: every level' }, { wait: 2500 }, { shot: 'lite' }, { debug: 'Plants: every level' }, { wait: 2500 }, { shot: 'far' }, { debug: 'Plants: every level' }, { wait: 500 }] },
  'bushes-meadow': { query: 'view=inside', about: 'in the nearest meadow, looking out across it at the bushes near and far', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 7000 }, { look: [0, -20] }, { wait: 1500 }] },
  'bushes-above': { query: 'view=inside', about: 'flown up over the nearest meadow, looking out and down at the bushes', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 3000 }, { look: [0, 90] }, { wait: 3000 }] },
  'ground-endcap': { query: 'view=inside', about: 'at the foot of the wild endcap, looking a little down', steps: [{ debug: 'The foot of the wild endcap' }, { wait: 6000 }, { look: [0, 120] }, { wait: 1000 }] },
  'clouds-up': { query: 'view=inside', about: 'in the nearest meadow, looking straight up at the clouds overhead', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { look: [0, -390] }, { wait: 1500 }] },
  'gravity-run': { query: 'view=inside', about: 'the gravity meter (app/gravityMeter.ts): standing (-still), running against the spin (-against), with it (-with), then its explanation panel', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 6000 }, { look: [-393, 0] }, { wait: 1000 }, { shot: 'still' }, { run: hold('ShiftLeft', 'KeyW') }, { wait: 1500 }, { shot: 'against' }, { run: release('ShiftLeft', 'KeyW') }, { look: [786, 0] }, { run: hold('ShiftLeft', 'KeyW') }, { wait: 1500 }, { shot: 'with' }, { run: release('ShiftLeft', 'KeyW') }, { wait: 500 }, { run: async (page) => { await page.locator('.gm-help').click(); await page.waitForTimeout(500); } }] },
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
  // The Lift Stair up the Gate (gen/liftStair.ts): from its foot, on a landing, from over the floor, beside it, close up, near the hub.
  'stair-foot': { query: 'view=inside', about: 'on the Lift Stair\'s forecourt at the foot of the Gate, looking up the stair', settle: 6000, steps: [{ debug: 'To the Lift Stair: its forecourt' }, { wait: 9000 }, { shot: 'ahead' }, { look: [0, -200] }, { wait: 1500 }] },
  'stair-landing': { query: 'view=inside', about: 'on a landing of the Lift Stair halfway up the Gate, looking up (-ahead), then out over the habitat', settle: 6000, steps: [{ debug: 'Onto the Lift Stair: a landing' }, { wait: 9000 }, { shot: 'ahead' }, { look: [900, 120] }, { wait: 1500 }] },
  'stair-floor': { query: 'view=inside', about: 'floating over the floor about a kilometre from the Gate, looking at the Lift Stair zigzagging up it', settle: 6000, steps: [{ debug: 'Fly: the Lift Stair from over the floor' }, { wait: 12000 }] },
  'stair-beside': { query: 'view=inside', about: 'floating some tens of metres off the Lift Stair halfway up, looking at its legs and platforms', settle: 6000, steps: [{ debug: 'Fly: beside the Lift Stair' }, { wait: 12000 }] },
  'stair-close': { query: 'view=inside', about: 'floating a few metres off a leg of the Lift Stair: steps, nosings, parapets, copings, handrails', settle: 6000, steps: [{ debug: 'Fly: the Lift Stair close up' }, { wait: 12000 }] },
  'stair-hub': { query: 'view=inside', about: 'floating off the Lift Stair near the hub, where the steps are ledges', settle: 6000, steps: [{ debug: 'Fly: the Lift Stair near the hub' }, { wait: 12000 }] },
  'hut-terrace': { query: 'view=inside', about: 'on the summit hut\'s terrace high on the Mountain, looking out down the cylinder, then back at the hall', settle: 6000, steps: [{ debug: 'To the summit hut: on its terrace' }, { wait: 9000 }, { shot: 'ahead' }, { look: [1800, 60] }, { wait: 1500 }] },
  'hut-beside': { query: 'view=inside', about: 'floating beside the summit hut on its cliff: roof, hall, terrace, prow, buttress', settle: 6000, steps: [{ debug: 'Fly: by the summit hut' }, { wait: 12000 }] },
  'hut-under': { query: 'view=inside', about: 'floating under the summit hut: corbels and struts raking back into the rock', settle: 6000, steps: [{ debug: 'Fly: under the summit hut' }, { wait: 12000 }] },
  'hut-far': { query: 'view=inside', about: 'the summit hut from a few hundred metres out, small on the Mountain\'s face', settle: 6000, steps: [{ debug: 'Fly: the summit hut from afar' }, { wait: 12000 }] },
  'under-dim': { query: 'view=inside', about: 'below the land, in the Understorey\'s pillar forest under the start: ahead (-ahead), up into the fan vaults (-vaults), then after walking on a few seconds; logs the understorey line', settle: 6000, steps: [{ debug: 'Below: the pillar forest under here' }, { wait: 10000 }, { shot: 'ahead' }, { look: [0, -260] }, { wait: 1500 }, { shot: 'vaults' }, { look: [0, 260] }, { key: 'KeyW', hold: 3000 }, { wait: 3000 }, { run: logPeople }] },
  'under-hamlet': { query: 'view=inside', about: 'below the land under the nearest entrance court, at its wellhead under the light well: up into the oculus (-up), then round the four ways along the bays (-0, -1, -2, -3; a quarter turn is 393 px), one of them toward the court\'s lift cage', settle: 6000, steps: [{ debug: 'Below: under the nearest entrance court' }, { wait: 10000 }, { look: [0, -300] }, { wait: 1500 }, { shot: 'up' }, { look: [0, 300] }, { wait: 800 }, { shot: '0' }, { look: [393, 0] }, { wait: 1200 }, { shot: '1' }, { look: [393, 0] }, { wait: 1200 }, { shot: '2' }, { look: [393, 0] }, { wait: 1200 }, { shot: '3' }, { run: logPeople }] },
  // The hamlets' skies (gen/skies.ts, render/hamletSkies.ts): one bay under each kind in turn, looking up.
  'under-skies': { query: 'view=inside', about: 'below the land, in a bay under each kind of hamlet sky in turn, looking up at it (-open, -aurora, -moon, -mars, -canopy, -deep, -glass); logs the position line (it names the sky)', settle: 6000, steps: [{ debug: 'Below: under the next kind of hamlet sky' }, { wait: 9000 }, { look: [0, -330] }, { wait: 1200 }, { shot: 'open' }, { look: [0, 330] }, { debug: 'Below: under the next kind of hamlet sky' }, { wait: 9000 }, { look: [0, -330] }, { wait: 1200 }, { shot: 'aurora' }, { look: [0, 330] }, { debug: 'Below: under the next kind of hamlet sky' }, { wait: 9000 }, { look: [0, -330] }, { wait: 1200 }, { shot: 'moon' }, { look: [0, 330] }, { debug: 'Below: under the next kind of hamlet sky' }, { wait: 9000 }, { look: [0, -330] }, { wait: 1200 }, { shot: 'mars' }, { look: [0, 330] }, { debug: 'Below: under the next kind of hamlet sky' }, { wait: 9000 }, { look: [0, -330] }, { wait: 1200 }, { shot: 'canopy' }, { look: [0, 330] }, { debug: 'Below: under the next kind of hamlet sky' }, { wait: 9000 }, { look: [0, -330] }, { wait: 1200 }, { shot: 'deep' }, { look: [0, 330] }, { debug: 'Below: under the next kind of hamlet sky' }, { wait: 9000 }, { look: [0, -330] }, { wait: 1200 }, { shot: 'glass' }, { look: [0, 330] }, { run: logPeople }] },
  'link': { query: 'view=inside', about: 'the neural link: below in the pillar forest, the lift-up card and the mark on the doors or the edge arrow (-ways), turned away so the arrow points back (-behind), then the link open with Tab (-open)', settle: 6000, steps: [{ debug: 'Below: the pillar forest under here' }, { wait: 10000 }, { shot: 'ways' }, { look: [786, 0] }, { wait: 1500 }, { shot: 'behind' }, { key: 'Tab' }, { wait: 800 }, { shot: 'open' }] },
  'under-life': { query: 'view=inside', about: 'neighbours walking to shared halls, nearby faces, the exit compass, and memory below', settle: 6000, steps: [memoryDetails, { debug: 'Below: beside neighbours at a shared hall' }, { wait: 15000 }, { shot: 'neighbours' }, { run: logPeople }, { wait: 5000 }, { shot: 'later' }, { debug: "Below: in a street among a hamlet's homes" }, { wait: 12000 }, { shot: 'street' }, { run: logPeople }, heap('below-life')] },
  'adaptive-home-walk': { query: 'view=inside', about: 'Walk through the actual house doorway, climb the internal stair, and see residents at home', settle: 6000, steps: [
    { debug: 'Below: at an adaptive home doorway' }, { wait: 10000 }, { shot: 'door' }, { key: 'KeyW', hold: 2200 }, { wait: 2000 }, { shot: 'inside' },
    { run: async (page) => { if (!await page.locator('.home-controls').isVisible()) throw new Error('Doorway did not lead into a usable room'); } },
    { debug: 'Below: at an adaptive home stair' }, { wait: 3000 }, { shot: 'stair' }, { key: 'KeyW', hold: 14000 }, { wait: 2000 }, { shot: 'upstairs' },
    { run: async (page) => { const line = await page.locator('.home-status').textContent(); if (!line.includes('Level 2')) throw new Error('Stair did not reach the upper floor: ' + line); } },
    { key: 'KeyA', hold: 1000 }, { look: [786, 100] }, { wait: 1500 }, { shot: 'upper-room' },
    { debug: 'Below: beside residents at home' }, { wait: 12000 }, { shot: 'residents' }, { run: logPeople }
  ] },
  'adaptive-home': { query: 'view=inside', about: 'A usable domestic room, wall displays and all four adaptive furniture arrangements', settle: 6000, steps: [
    { debug: 'Below: inside an adaptive home' }, { wait: 12000 }, { shot: 'entered' },
    { run: async (page) => { await page.getByRole('button', { name: 'Gather', exact: true }).click(); } }, { wait: 3500 }, { shot: 'gather' },
    { run: async (page) => { await page.getByRole('button', { name: 'Focus', exact: true }).click(); } }, { wait: 3500 }, { shot: 'focus' },
    { run: async (page) => { await page.getByRole('button', { name: 'Rest', exact: true }).click(); } }, { wait: 3500 }, { shot: 'rest' },
    { run: async (page) => { await page.getByRole('button', { name: 'Clear floor', exact: true }).click(); } }, { wait: 3500 }, { shot: 'clear' },
    { key: 'KeyW', hold: 1500 }, { look: [250, 50] }, { wait: 1500 }, { shot: 'walk' }, { run: logPeople }, heap('adaptive-home')
  ] },
  'under-homes': { query: 'view=inside', about: 'below the land in a hamlet\'s street, on the walk between two bays of homes: down the street along the axis (-street), a quarter turn to face the houses on one side (-houses), up over them into the vaults (-over), then after walking a few steps up the street (-on); logs the position line (it names the houses) and the memory lines', settle: 6000, steps: [{ debug: "Below: in a street among a hamlet's homes" }, { wait: 10000 }, { shot: 'street' }, { look: [393, 0] }, { wait: 1200 }, { shot: 'houses' }, { look: [0, -200] }, { wait: 1200 }, { shot: 'over' }, { look: [-393, 200] }, { key: 'KeyW', hold: 1500 }, { wait: 2500 }, { shot: 'on' }, { run: logPeople }] },
  'home-street-walk': { query: 'view=inside', about: 'running along a hamlet\'s street below the land: furniture comes and goes only with its home\'s rooms (mid and near tiles), far houses show their screens in the doorway; a picture and the home furniture and memory lines after each stretch', settle: 6000, steps: [memoryDetails, { debug: "Below: in a street among a hamlet's homes" }, { wait: 10000 }, { shot: 'start' }, { run: logPeople }, { run: hold('ShiftLeft') }, { key: 'KeyW', hold: 2500 }, { wait: 300 }, { shot: 'w1' }, { key: 'KeyW', hold: 2500 }, { wait: 300 }, { shot: 'w2' }, { key: 'KeyW', hold: 2500 }, { wait: 300 }, { shot: 'w3' }, { run: release('ShiftLeft') }, { look: [393, 0] }, { wait: 1200 }, { shot: 'houses' }, { run: logPeople }, heap('home-street-walk')] },
  'under-halls': { query: 'view=inside', about: 'below the land at a hamlet\'s halls round its wellhead, one of each kind in turn, each from the walk on its wellhead side looking at its front: the kitchen hall (-kitchen), the bath (-bath), a makers\' shop (-shop), the stage (-stage), the minds\' room (-minds), the commons (-commons); logs the position line (it names the hall) and the memory lines', settle: 6000, steps: [{ debug: "Below: at the next kind of hall (kitchen, bath, shop, stage, minds' room, commons)" }, { wait: 9000 }, { shot: 'kitchen' }, { debug: "Below: at the next kind of hall (kitchen, bath, shop, stage, minds' room, commons)" }, { wait: 9000 }, { shot: 'bath' }, { debug: "Below: at the next kind of hall (kitchen, bath, shop, stage, minds' room, commons)" }, { wait: 9000 }, { shot: 'shop' }, { debug: "Below: at the next kind of hall (kitchen, bath, shop, stage, minds' room, commons)" }, { wait: 9000 }, { shot: 'stage' }, { debug: "Below: at the next kind of hall (kitchen, bath, shop, stage, minds' room, commons)" }, { wait: 9000 }, { shot: 'minds' }, { debug: "Below: at the next kind of hall (kitchen, bath, shop, stage, minds' room, commons)" }, { wait: 9000 }, { shot: 'commons' }, { run: logPeople }] },
  'under-glass': { query: 'view=inside', about: 'below the land under a glass deck: the real land above on its ceilings, looking up (-up) and up and along (-along), then two hours later (-later); logs the position, memory and shader lines', settle: 6000, steps: [{ debug: 'Below: under a glass deck (the real sky above)' }, { wait: 10000 }, { look: [0, -330] }, { wait: 1500 }, { shot: 'up' }, { look: [0, 200] }, { wait: 800 }, { shot: 'along' }, { debug: 'Two hours later' }, { wait: 17000 }, { look: [0, -200] }, { wait: 800 }, { shot: 'later' }, { run: logPeople }] },
  'under-screen-panels': { query: 'view=inside', about: 'the live-view ceiling screen above the hall roofs: its physical panel grid looking up, after moving sideways, and at a grazing angle', settle: 6000, steps: [{ debug: 'Below: under a glass deck (the real sky above)' }, { wait: 10000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 1500 }, { look: [0, -330] }, { wait: 3000 }, { shot: 'up' }, { key: 'KeyD', hold: 500 }, { wait: 1000 }, { shot: 'moved' }, { look: [0, 230] }, { wait: 1000 }, { shot: 'along' }, { run: logPeople }] },
  // The lifts (gen/lifts.ts, render/lift.ts): click a court's portal, ride down, step out, turn to the cabin, ride up.
  'lift-ride': { query: 'view=inside', about: 'a lift ride: at a court\'s portal doors (-doors), clicked: in the cabin (-in), going down the shaft (-shaft), stepped out below (-below), turned round to the cabin in its cage (-cabin), clicked again: going up (-up), back in the court (-court); logs the position and understorey lines', settle: 6000, steps: [{ debug: 'To a lift: at its doors in an entrance court (click them to ride down)' }, { wait: 9000 }, { shot: 'doors' }, { run: clickMiddle }, { wait: 1200 }, { shot: 'in' }, { wait: 3500 }, { shot: 'shaft' }, { run: logPeople }, { wait: 9000 }, { shot: 'below' }, { look: [786, 0] }, { wait: 1500 }, { shot: 'cabin' }, { run: clickMiddle }, { wait: 3000 }, { shot: 'up' }, { wait: 9000 }, { shot: 'court' }, { run: logPeople }] },
  'court-floor': { query: 'view=inside', about: 'standing on an entrance court\'s paved floor, facing the portal with its bronze lift doors, then turning to the stairs', settle: 6000, steps: [{ debug: 'To an entrance court: on its floor' }, { wait: 9000 }, { shot: 'portal' }, { look: [1800, 0] }, { wait: 1500 }] },
  'court-rim': { query: 'view=inside', about: 'on an entrance court\'s rim walk, looking down into it: wall, stairs, portal, benches', settle: 6000, steps: [{ debug: 'To an entrance court: on its rim walk' }, { wait: 9000 }, { look: [0, 140] }, { wait: 1500 }] },
  'court-over': { query: 'view=inside', about: 'floating over an entrance court, the whole hollow in view', settle: 6000, steps: [{ debug: 'Fly: over an entrance court' }, { wait: 12000 }] },
  'court-far': { query: 'view=inside', about: 'entrance courts from a few hundred metres up, set into the land', settle: 6000, steps: [{ debug: 'Fly: entrance courts from afar' }, { wait: 12000 }] },
  'court-letgo': { query: 'view=inside', about: 'in a court where the land was let go: no railings, weathered stone', settle: 6000, steps: [{ debug: 'To a court where the land was let go' }, { wait: 9000 }] },
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
  'path-sunwalk': { query: 'view=inside', about: 'standing on the Sunwalk, looking along it, then down at it', settle: 6000, steps: [{ debug: 'Onto the Sunwalk' }, { wait: 8000 }, { look: [0, -10] }, { wait: 1500 }, { shot: 'along' }, { look: [0, 40] }, { wait: 1500 }] },
  'path-way': { query: 'view=inside', about: 'standing on the nearest way between entrances, looking along it', settle: 6000, steps: [{ debug: 'Onto the nearest way' }, { wait: 8000 }, { look: [0, 15] }, { wait: 1500 }] },
  'path-sunwalk-high': { query: 'view=inside', about: 'over the Sunwalk, flown up 60 m, looking along it', settle: 6000, steps: [{ debug: 'Onto the Sunwalk' }, { wait: 5000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 2500 }, { wait: 5000 }, { look: [0, 60] }, { wait: 2000 }] },
  'place-vineyard': { query: 'view=inside', about: 'between two rows of vines on the Vine face, looking along them, then out over the terraces', settle: 6000, steps: [{ debug: 'Into the nearest vineyard' }, { wait: 9000 }, { look: [0, 5] }, { wait: 2000 }, { shot: 'rows' }, { look: [900, 10] }, { wait: 2000 }] },
  'place-orchard': { query: 'view=inside', about: 'in the nearest orchard, looking down its rows', settle: 6000, steps: [{ debug: 'Into the nearest orchard' }, { wait: 9000 }, { look: [0, 10] }, { wait: 2000 }] },
  'place-vine-face': { query: 'view=inside', about: 'floating over the floor before the Vine face, looking at its lower terraces: parcels of vines, orchards and meadow', settle: 6000, steps: [{ debug: 'Fly: the Vine face from over the floor' }, { wait: 12000 }] },
  'crossing-arch': { query: 'view=inside', about: 'beside the nearest stone arch bridge over a river: arches, cutwaters, parapets', settle: 6000, steps: [{ debug: 'Fly: by the nearest stone arch bridge' }, { wait: 12000 }] },
  'crossing-timber': { query: 'view=inside', about: 'beside the nearest timber bridge: planks, stringers, bents, rails', settle: 6000, steps: [{ debug: 'Fly: by the nearest timber bridge' }, { wait: 12000 }] },
  'crossing-stepping': { query: 'view=inside', about: 'beside the nearest stepping stones across a river', settle: 6000, steps: [{ debug: 'Fly: by the nearest stepping stones' }, { wait: 12000 }] },
  'crossing-log': { query: 'view=inside', about: 'beside the nearest log laid across a river, with its rope handline', settle: 6000, steps: [{ debug: 'Fly: by the nearest log across a river' }, { wait: 12000 }] },
  'crossing-on': { query: 'view=inside', about: 'standing on the nearest river crossing, looking across', settle: 6000, steps: [{ debug: 'Onto the nearest river crossing' }, { wait: 9000 }, { shot: 'across' }, { look: [900, 60] }, { wait: 1500 }] },
  'hall-nave': { query: 'view=inside', about: 'standing in a grown hall\'s nave by the long table, looking down it to the hearth under the vault of grafted limbs', settle: 6000, steps: [{ debug: 'To a grown hall: in its nave' }, { wait: 12000 }, { shot: 'along' }, { look: [0, -320] }, { wait: 1500 }] },
  'hall-dais': { query: 'view=inside', about: 'on a grown hall\'s dais, looking down the nave', settle: 6000, steps: [{ debug: 'To a grown hall: on its dais' }, { wait: 12000 }] },
  'hall-beside': { query: 'view=inside', about: 'floating beside a grown hall: the two rows of trained lindens, the lattice screen, the roof of crowns', settle: 6000, steps: [{ debug: 'Fly: beside a grown hall' }, { wait: 12000 }] },
  'hall-far': { query: 'view=inside', about: 'a grown hall from a few hundred metres off', settle: 6000, steps: [{ debug: 'Fly: a grown hall from afar' }, { wait: 12000 }] },
  // The landforms (gen/plan.ts `grounds`, gen/terrain.ts): a Ring's terraced front, the Rings and the tallest Height from afar, its top.
  'ring-front': { query: 'view=inside', about: 'floating before the nearest Ring\'s terraced front over a ridge, looking up at it', settle: 6000, steps: [{ debug: 'Fly: before the nearest Ring' }, { wait: 14000 }] },
  'ring-far': { query: 'view=inside', about: 'the nearest Ring from far off toward the port: a ridge across the floor and up round the curve', settle: 6000, steps: [{ debug: 'Fly: the nearest Ring from far off' }, { wait: 14000 }] },
  'height-far': { query: 'view=inside', about: 'the tallest Height from a few kilometres off: sheer rock flanks, its plateau', settle: 6000, steps: [{ debug: 'Fly: the tallest Height from far off' }, { wait: 14000 }] },
  'height-top': { query: 'view=inside', about: 'standing on the tallest Height\'s top, looking out along the cylinder, then down its flank', settle: 6000, steps: [{ debug: 'To the top of the tallest Height' }, { wait: 12000 }, { shot: 'out' }, { look: [900, 260] }, { wait: 1500 }] },
  // The rooms step down to the lake (gen/plan.ts `roomAt`): a river's fall where it breaks through a Ring, from below and from its lip.
  'ring-fall-volume': { query: 'view=inside', about: 'the Ring fall across its face and nearer its edge, clear of riverbank foliage', settle: 6000, steps: [{ debug: 'Fly: across the nearest Ring fall' }, { wait: 14000 }, { shot: 'across' }, { key: 'KeyW', hold: 1700 }, { wait: 4000 }, { shot: 'near' }, { key: 'KeyD', hold: 1300 }, { wait: 3000 }, { shot: 'edge' }, { run: logPeople }] },
  'ring-fall': { query: 'view=inside', about: 'the nearest river fall where a river breaks through a Ring: from the room below, looking up at it, then from beside its lip, looking down into the lower room', settle: 6000, steps: [{ debug: 'Below the nearest Ring fall' }, { wait: 12000 }, { shot: 'below' }, { debug: 'Above the nearest Ring fall' }, { wait: 12000 }, { shot: 'lip' }] },
  // The lakes on the floor (gen/plan.ts `meres`): the great lake and the smaller ones from off their ends, then from a shore.
  lakes: { query: 'view=inside', about: 'the lakes on the floor: the great lake in the reserve with the great river through it, then each smaller one, from off the end of its long axis; then standing on the great lake\'s shore', settle: 6000, steps: [
    ...['great', 'lake-1', 'lake-2', 'lake-3'].flatMap((name) => [{ debug: 'Fly: the next lake' }, { wait: 12000 }, { shot: name }]),
    { debug: 'To the next lake\'s shore' }, { wait: 12000 }, { shot: 'shore' },
  ] },
  // The boats (gen/boat.ts, render/boats.ts): four hours into the day, riding beside each design in turn (under sail if
  // one is out), twice a few seconds apart; then beside the nearest boat under sail from further off, and the great lake.
  boats: { query: 'view=inside', about: 'the boats, four hours into the day: riding beside the nearest skiff, foiling trimaran and glass-roofed catamaran in turn (each under sail if one is out; -2 four seconds on), then off the beam of the nearest boat under sail (-sailing), then the great lake from off its end (-lake); a heap snapshot at the end; logs the boats line', settle: 6000, steps: [
    memoryDetails, { debug: 'Two hours later' }, { debug: 'Two hours later' }, { wait: 4000 },
    ...['skiff', 'foiler', 'cruiser'].flatMap((name) => [{ debug: 'Ride beside a boat: skiff → foiler → cruiser → off' }, { wait: 12000 }, { shot: name }, { wait: 4000 }, { shot: `${name}-2` }]),
    { debug: 'Ride beside a boat: skiff → foiler → cruiser → off' }, { debug: 'Fly: beside the nearest boat under sail' }, { wait: 10000 }, { shot: 'sailing' },
    { debug: 'Fly: the next lake' }, { wait: 12000 }, { shot: 'lake' }, heap('boats'),
  ] },
  // The harbours (gen/harbours.ts, gen/harbourBuild.ts): from off the nearest one over the water, then standing on its
  // pontoon looking out past the boats in their berths; then four hours on, when some are out and others come back in.
  harbours: { query: 'view=inside', about: 'the nearest harbour from off it over the water (pier, pontoon, fingers, piles, boats in their berths), then standing on its pontoon (-on, -on-2 turned along it); four hours into the day again (-later); a heap snapshot', settle: 6000, steps: [
    memoryDetails, { debug: 'Fly: over the nearest harbour' }, { wait: 12000 }, { shot: 'over' },
    { debug: 'Onto the nearest harbour' }, { wait: 9000 }, { shot: 'on' }, { look: [700, 0] }, { wait: 1500 }, { shot: 'on-2' },
    { debug: 'Two hours later' }, { debug: 'Two hours later' }, { debug: 'Fly: over the nearest harbour' }, { wait: 12000 }, { shot: 'later' }, heap('harbours'),
  ] },
  // The crews (sim/crews.ts): residents walking to their boat or home from it, then aboard a skiff and a cruiser under sail.
  crews: { query: 'view=inside', about: 'the boats\' crews, three and four hours into the day: beside the nearest crew walking between their court and their boat (-walking, -walking-2 two hours on), then riding beside a skiff and a cruiser with their crews aboard (-skiff, -cruiser); a heap snapshot; logs the boats and crew lines', settle: 6000, steps: [
    memoryDetails, { debug: 'Two hours later' }, { wait: 3000 },
    { debug: 'Fly: beside the nearest crew on their way to their boat' }, { wait: 9000 }, { shot: 'walking' },
    { debug: 'Two hours later' }, { debug: 'Fly: beside the nearest crew on their way to their boat' }, { wait: 9000 }, { shot: 'walking-2' },
    { debug: 'Ride beside a boat: skiff → foiler → cruiser → off' }, { wait: 12000 }, { shot: 'skiff' },
    { debug: 'Ride beside a boat: skiff → foiler → cruiser → off' }, { wait: 12000 }, { shot: 'foiler' },
    { debug: 'Ride beside a boat: skiff → foiler → cruiser → off' }, { wait: 12000 }, { shot: 'cruiser' }, heap('crews'),
  ] },
  // The districts' works (gen/works.ts): each press of the Go entry moves to the next kind, nearest the eye.
  works: { query: 'view=inside', about: 'the districts\' works, one kind after another, each from two of its radii off: pyramid, cone, sunken court, mesa, fold, dome, down, scarp, vale, bowl, stepwell, half-pipe, amphitheatre, ramp, drumlin, tor', settle: 6000, steps: [
    ...['pyramid', 'cone', 'sunken', 'mesa', 'fold', 'dome', 'down', 'scarp', 'vale', 'bowl', 'stepwell', 'halfpipe', 'amphitheatre', 'ramp', 'drumlin', 'tor'].flatMap((kind) => [{ debug: 'Fly: the next district work' }, { wait: 9000 }, { shot: kind }]),
  ] },
  // The signature works (gen/works.ts `SIGNATURE_KINDS`): each from 1.6 of its radii off, then from the floor across the axis.
  signature: { query: 'view=inside', about: 'the signature works in turn: the Spiral, the Wave Field, the Tilt (before its cliff), each up close and then from the far side of the cylinder', settle: 6000, steps: [
    ...['spiral', 'wave-field', 'tilt'].flatMap((kind) => [{ debug: 'Fly: the next signature work' }, { wait: 10000 }, { shot: kind }, { debug: 'Fly: the signature work from the far side' }, { wait: 10000 }, { shot: `${kind}-far` }]),
  ] },
  'far-meadow-up': { query: 'view=inside', about: 'standing in a meadow, looking up at the far side', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 5000 }, { look: [0, -260] }, { wait: 3000 }] },
  outside: { query: 'view=outside', about: 'the home habitat from outside', default: true },
  'exploration-ship': { query: 'view=outside', about: 'Recipe-built exploration ship: exterior, all six decks, adaptable rooms and a powered departure', settle: 5000, steps: [
    { run: async page => { await page.getByRole('button', { name: 'Visit exploration ship', exact: true }).click(); await page.locator('.vessel-panel').waitFor({ state: 'visible' }); } },
    { wait: 2000 }, { shot: 'hull' },
    { run: async page => { await page.getByRole('button', { name: 'Enter airlock', exact: true }).click(); } },
    { wait: 1000 }, { shot: 'welcome' },
    ...['1', '2', '3', '4', '5'].flatMap(deck => [
      { run: async page => { await page.getByLabel('Ship deck', { exact: true }).selectOption(deck); await page.getByRole('button', { name: 'Take central lift', exact: true }).click(); } },
      { wait: 3000 }, { shot: `deck-${deck}` },
    ]),
    { run: async page => { await page.getByRole('button', { name: 'Make room', exact: true }).click(); } }, { wait: 3000 }, { shot: 'open-floor' },
    { run: async page => { await page.getByRole('button', { name: 'Restore furnishings', exact: true }).click(); await page.getByRole('button', { name: 'Try a 20-second departure burn', exact: true }).click(); } },
    { wait: 3000 }, { shot: 'thrust' },
    { key: 'KeyE', hold: 700 }, { key: 'KeyB', hold: 700 }, { shot: 'passenger' },
    { run: async page => { await page.getByRole('button', { name: 'Observe exterior', exact: true }).click(); } }, { wait: 1000 }, { shot: 'powered-hull' },
    { run: async page => { await page.locator('.vessel-panel').getByRole('button', { name: 'Return to habitat', exact: true }).click(); } },
    { wait: 2000 }, heap('exploration-ship'),
  ] },
  'solar-system': { query: 'view=outside', about: 'Real-scale planetary observer: inner worlds, rings, major moons and the outer system', settle: 6000, steps: [
    { run: async page => { await page.locator('.solar-controls > summary').click(); } },
    ...['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'moon-401', 'jupiter', 'saturn', 'moon-606', 'uranus', 'neptune', 'moon-801', 'pluto', 'moon-901', 'haumea', 'makemake', 'eris'].flatMap(id => [
      { run: async page => { await page.getByLabel('Celestial body', { exact: true }).selectOption(id); await page.getByRole('button', { name: 'Observe', exact: true }).click(); } },
      { wait: 4500 }, { shot: id },
    ]),
    { run: async page => { await page.getByLabel('Outside clock speed').selectOption('86400'); } }, { wait: 2000 },
    { run: async page => { await page.getByLabel('Outside clock speed').selectOption('0'); await page.getByRole('button', { name: 'Return to habitat', exact: true }).click(); } },
    { wait: 4000 }, { shot: 'home' }, heap('solar-system')
  ] },
  // The system's habitats (render/habitatLights.ts): the panel, then the thousands about Mars and Saturn, Velloran Reach, and home.
  'system-habitats': { query: 'view=outside', about: 'the system\'s habitats as points of light with overlay names: the Habitats panel, Mars and Saturn with their thousands, Velloran Reach, home', settle: 6000, steps: [
    { run: async page => { await page.locator('.solar-controls > summary').click(); await page.locator('.solar-habitats summary').click(); } },
    { wait: 3000 }, { shot: 'panel' },
    ...['mars', 'saturn'].flatMap(id => [
      { run: async page => { await page.getByLabel('Celestial body', { exact: true }).selectOption(id); await page.getByRole('button', { name: 'Observe', exact: true }).click(); } },
      { wait: 6000 }, { shot: id },
    ]),
    { run: async page => { await page.getByLabel('Polity', { exact: true }).selectOption('velloran'); await page.getByRole('button', { name: 'Observe its world', exact: true }).click(); } },
    { wait: 4000 }, { look: [300, 0] }, { wait: 2000 }, { shot: 'velloran' },
    { run: async page => { await page.locator('.solar-controls').getByRole('button', { name: 'Return to habitat', exact: true }).click(); } },
    { wait: 5000 }, { shot: 'home' }, heap('system-habitats'),
  ] },
  // Visiting another habitat (docs/system.md, a proof of concept): the trip card for Velloran Reach, then there at once.
  'visit': { query: 'view=outside', about: 'the Habitats panel with the trip to Velloran Reach (-trip), Visit: its arrival terrace (-arrival) and stepped out (-there), back outside (-outside: the trip card says you are visiting), Return home (-home); a heap snapshot at the end', settle: 6000, steps: [
    memoryDetails,
    { run: async page => { await page.locator('.solar-controls > summary').click(); await page.locator('.solar-habitats summary').click(); await page.getByLabel('Polity', { exact: true }).selectOption('velloran'); } },
    { wait: 2000 }, { shot: 'trip' },
    { run: async page => { await page.locator('.solar-habitats').getByRole('button', { name: 'Visit', exact: true }).click(); } },
    { wait: 30000 }, { shot: 'arrival' },
    { run: async page => { const b = page.getByRole('button', { name: 'Step onto the terrace', exact: true }); if (await b.isVisible()) await b.click(); } },
    { wait: 6000 }, { shot: 'there' }, { run: logPeople },
    { run: async page => { await page.getByRole('button', { name: 'Outside', exact: true }).click(); } },
    { wait: 5000 }, { shot: 'outside' },
    { run: async page => { await page.locator('.solar-habitats').getByRole('button', { name: 'Return home', exact: true }).click(); } },
    { wait: 30000 }, { shot: 'home' }, heap('visit'),
  ] },
  'outside-earth': { query: 'view=outside', about: 'looking at Earth (key 2)', steps: [{ key: 'Digit2' }, { wait: 3000 }] },
  'outside-moon': { query: 'view=outside', about: 'looking at the Moon (key 3)', steps: [{ key: 'Digit3' }, { wait: 3000 }] },
  'outside-neighbour': { query: 'view=outside', about: 'the nearest neighbour in the Necklace (key 4)', steps: [{ key: 'Digit4' }, { wait: 3000 }] },
  'outside-night-eyes': { query: 'view=outside', about: 'the stars with the Night eyes augmentation', steps: [{ debug: 'Night eyes augmentation' }, { wait: 2000 }] },
  'outside-close': { query: 'view=outside', about: 'wheel in close to the hull', steps: [{ wheel: -2400 }, { wait: 3000 }] },
  'people-crowd': { query: 'view=inside', about: 'before the busiest spot within 2 km in the morning: as they appear (-early), once the nearest have their figures (-near), a step closer (-closer); logs the people and shader lines', settle: 6000, steps: [{ debug: 'Before the nearest crowd' }, { wait: 3000 }, { shot: 'early' }, { wait: 12000 }, { shot: 'near' }, { run: logPeople }, { key: 'KeyW', hold: 1500 }, { wait: 4000 }, { shot: 'closer' }, { run: logPeople }] },
  'people-court': { query: 'view=inside', about: 'two hours into the morning, in the busiest court within 3 km, 12 m from its light well: parties meeting, rings talking, people on the well seat, coming and going (-court, -court2 20 s on); then beside the nearest talking ring of three or more (-ring, -ring2 10 s on: the turn to speak moves round); logs the people and shader lines', settle: 6000, steps: [{ debug: 'Two hours later' }, { wait: 4000 }, { debug: 'In the busiest court nearby' }, { wait: 15000 }, { shot: 'court' }, { run: logPeople }, { wait: 20000 }, { shot: 'court2' }, { debug: 'Beside the nearest talking ring' }, { wait: 15000 }, { shot: 'ring' }, { wait: 10000 }, { shot: 'ring2' }, { run: logPeople }] },
  'people-drones': { query: 'view=inside', about: 'two hours into the morning, 4 m from the nearest person in a drone body staying with others (-near, -near2 8 s on: hovering at their eyes, nodding on their turn to talk), then walked back for 6 s (-mid); logs the people, drones and shader lines', settle: 6000, steps: [{ debug: 'Two hours later' }, { wait: 4000 }, { debug: 'Beside the nearest person in a drone body' }, { wait: 15000 }, { shot: 'near' }, { wait: 8000 }, { shot: 'near2' }, { run: logPeople }, { key: 'KeyS', hold: 6000 }, { wait: 2000 }, { shot: 'mid' }, { run: logPeople }] },
  'people-beats': { query: 'view=inside', about: 'two hours into the morning, 6 m from the nearest party sitting or lying on the grass (-near), 20 s on (-near2), then five minutes later three times (-later1..3: beats change: sitting down, eating, lying back, getting up, strolling off); logs the people lines', settle: 6000, steps: [{ debug: 'Two hours later' }, { wait: 4000 }, { debug: 'Beside the nearest party on the grass' }, { wait: 15000 }, { shot: 'near' }, { wait: 20000 }, { shot: 'near2' }, { run: logPeople }, ...[1, 2, 3].flatMap((k) => [{ debug: 'Five minutes later' }, { wait: 6000 }, { shot: `later${k}` }]), { run: logPeople }] },
  'activity-props': { query: 'view=inside', about: 'one ball per catch pair, hand-held workshop tools and timber', settle: 6000, steps: [{ debug: 'Two hours later' }, { wait: 4000 }, { debug: 'Beside the nearest game of catch' }, { wait: 15000 }, { shot: 'ball' }, { wait: 900 }, { shot: 'ball-flight' }, { debug: 'Beside the nearest one at standing work' }, { wait: 15000 }, { shot: 'tool' }, { wait: 1200 }, { shot: 'tool-stroke' }, { run: logPeople }] },
  'people-places': { query: 'view=inside', about: 'two hours into the morning, 6 m from the nearest party at each beat the places offer, twice 2 s apart: a game of catch (-catch, -catch2), dancers (-dance), a pair talking with their hands (-hands), someone stretching (-stretch), someone sawing or splitting wood (-work); a heap snapshot at the end; logs the people and shader lines', settle: 6000, steps: [memoryDetails, { debug: 'Two hours later' }, { wait: 4000 }, ...[['Beside the nearest game of catch', 'catch'], ['Beside the nearest dancers', 'dance'], ['Beside the nearest pair talking with their hands', 'hands'], ['Beside the nearest one stretching', 'stretch'], ['Beside the nearest one at standing work', 'work']].flatMap(([label, id]) => [{ debug: label }, { wait: 15000 }, { shot: id }, { wait: 2000 }, { shot: `${id}2` }]), { run: logPeople }, heap('places')] },
  'people-talk': { query: 'view=inside', about: 'the speech bubbles: two hours into the morning, 6 m from the nearest party talking (-near), then every 4 s three more (-near2..4: the conversation goes on, one speaker at a time), then flown 25 m back up and over it (-dots: a small bubble farther out); a heap snapshot at the end; logs the people, talk and shader lines', settle: 6000, steps: [memoryDetails, { debug: 'Two hours later' }, { wait: 4000 }, { debug: 'Beside the nearest party talking' }, { wait: 15000 }, { shot: 'near' }, ...[2, 3, 4].flatMap((k) => [{ wait: 4000 }, { shot: `near${k}` }]), { run: logPeople }, { key: 'KeyF' }, { key: 'KeyS', hold: 2500 }, { key: 'KeyE', hold: 1200 }, { wait: 2000 }, { shot: 'dots' }, { run: logPeople }, heap('talk')] },
  'stockings': { query: 'view=inside', about: 'sheer stockings retain the skin underneath', settle: 6000, steps: [{ debug: 'Below: beside a resident wearing stockings' }, { wait: 18000 }, { shot: 'legs' }, { run: logPeople }] },
  'people-above': { query: 'view=inside', about: 'flown up over the busiest spot within 2 km, looking down at the crowd and out across the land', settle: 6000, steps: [{ debug: 'Before the nearest crowd' }, { wait: 6000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 2500 }, { look: [0, 160] }, { wait: 3000 }, { shot: 'down' }, { look: [0, -120] }, { wait: 2000 }, { run: logPeople }] },
  'people-far': { query: 'view=inside', about: 'everyone far off as specks, in the morning: low over the floor looking along it (-along), halfway up at the far side (-far-side), a quarter up across the curve (-curve); -marked: the same with every speck magenta and at least 4 px; logs the people, specks and shader lines', settle: 6000, steps: [{ debug: 'Fly: low over the floor, looking along it' }, { wait: 9000 }, { shot: 'along' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'along-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { run: logPeople }, { debug: 'Fly: halfway up, looking at the far side' }, { wait: 6000 }, { shot: 'far-side' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'far-side-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { debug: 'Fly: a quarter of the way up, looking across the curve' }, { wait: 6000 }, { shot: 'curve' }, { run: logPeople }] },
  'people-handover': { query: 'view=inside', about: 'flown up from the busiest spot within 2 km until the crowd is a few hundred metres off: stand-ins hand over to specks there (-up, then -higher); logs the people and specks lines', settle: 6000, steps: [{ debug: 'Before the nearest crowd' }, { wait: 6000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 5000 }, { look: [0, 140] }, { wait: 3000 }, { shot: 'up' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'up-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { run: logPeople }, { key: 'KeyE', hold: 5000 }, { wait: 3000 }, { shot: 'higher' }, { run: logPeople }] },
  'people-stair': { query: 'view=inside', about: 'in the afternoon (6 hours on, the busiest time there), beside the Lift Stair (-stair) and from over the floor (-far): about two thousand people within 1.5 km come in nearest first; logs the people, frame and shader lines', settle: 6000, steps: [...Array.from({ length: 3 }, () => ({ debug: 'Two hours later' })), { debug: 'Fly: beside the Lift Stair' }, { wait: 10000 }, { shot: 'stair' }, { run: logPeople }, { debug: 'Fly: the Lift Stair from over the floor' }, { wait: 8000 }, { shot: 'far' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'far-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { run: logPeople }] },
  'drones': { query: 'view=inside', about: 'the drones: beside the nearest one at work (-near), from 60 m (-coarse), low over the floor looking along it (-along, -along-marked: every speck magenta, people and drones), and a minute on from 60 m (-later); logs the people, specks, drones and shader lines', settle: 6000, steps: [{ wait: 8000 }, { debug: 'Fly: beside the nearest drone at work' }, { wait: 4000 }, { shot: 'near' }, { run: logPeople }, { debug: 'Fly: the nearest drone at work from 60 m' }, { wait: 3000 }, { shot: 'coarse' }, { debug: 'Fly: low over the floor, looking along it' }, { wait: 6000 }, { shot: 'along' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'along-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { run: logPeople }, { debug: 'Fly: the nearest drone at work from 60 m' }, { wait: 60000 }, { shot: 'later' }, { run: logPeople }] },
  'squirrels': { query: 'view=inside', about: 'into the nearest wood: beside the nearest squirrel down on the ground (-near, -near2 a few seconds on), from 15 m (-mid), then two hours later the same again (-later-near, -later-mid); a heap snapshot at the end; logs the animals, people and shader lines', settle: 6000, steps: [memoryDetails, { debug: 'Into the nearest wood' }, { wait: 10000 }, { debug: 'Fly: beside the nearest squirrel' }, { wait: 4000 }, { shot: 'near' }, { wait: 3000 }, { shot: 'near2' }, { run: logPeople }, { debug: 'Fly: the nearest squirrel from 15 m' }, { wait: 3000 }, { shot: 'mid' }, { debug: 'Two hours later' }, { wait: 6000 }, { debug: 'Fly: beside the nearest squirrel' }, { wait: 4000 }, { shot: 'later-near' }, { debug: 'Fly: the nearest squirrel from 15 m' }, { wait: 3000 }, { shot: 'later-mid' }, { run: logPeople }, heap('squirrels')] },
  'birds': { query: 'view=inside', about: 'the birds (each flown to twice, the land loading between, the picture taken at once): into the nearest wood at the dawn chorus, beside the nearest bird sitting, singing or feeding (-near, -near2 a second on), from 4 m (-four), from 20 m (-mid), into the nearest meadow beside a lark (-lark, -lark2 a few seconds on) and the meadow from 20 m (-meadow), then at nightfall beside the nearest owl (-owl); a heap snapshot at the end; logs the birds, animals and shader lines', settle: 6000, steps: [memoryDetails, { debug: 'Into the nearest wood' }, { debug: 'To the dawn chorus (the light coming up here)' }, { wait: 12000 }, ...toBird('Fly: beside the nearest bird', 'near'), { wait: 1000 }, { shot: 'near2' }, { run: logPeople }, ...toBird('Fly: the nearest bird from 4 m', 'four'), ...toBird('Fly: the nearest bird from 20 m', 'mid'), { debug: 'Into the nearest meadow' }, { wait: 12000 }, ...toBird('Fly: beside the nearest lark', 'lark'), { wait: 4000 }, { shot: 'lark2' }, ...toBird('Fly: the nearest bird from 20 m', 'meadow'), { run: logPeople }, { debug: 'Into the nearest wood' }, { debug: 'To nightfall here (owls out)' }, { wait: 75000 }, ...toBird('Fly: beside the nearest owl', 'owl'), { run: logPeople }, heap('birds')] },
  'flocks': { query: 'view=inside', about: 'the flocks: onto the nearest bridge and beside one of its swallows (-swallow, -swallow2 a second on); to the Lift Stair at the swifts\' dusk race (-stair) and beside a swift (-swift); then the next lake at the starlings\' dusk (-lake), before its murmuration from 120 m (-murmur, -murmur2 a few seconds on) and inside it (-inside); a heap snapshot at the end; logs the birds, memory and shader lines', settle: 6000, steps: [memoryDetails, { debug: 'Onto the nearest river crossing' }, { wait: 12000 }, ...toBird('Fly: beside the nearest swallow', 'swallow'), { wait: 1000 }, { shot: 'swallow2' }, { run: logPeople }, { debug: 'To the Lift Stair: its forecourt at the foot of the Gate' }, { debug: "To the swifts' dusk race at the Stair" }, { wait: 14000 }, { shot: 'stair' }, ...toBird('Fly: beside the nearest swift', 'swift'), { run: logPeople }, { debug: 'Fly: the next lake' }, { debug: "To the starlings' murmuration here (dusk)" }, { wait: 16000 }, { shot: 'lake' }, ...toBird('Fly: before the nearest murmuration from 120 m', 'murmur'), { wait: 4000 }, { shot: 'murmur2' }, ...toBird('Fly: into the nearest murmuration', 'inside'), { run: logPeople }, heap('flocks')] },
  'deer': { query: 'view=inside', about: 'before the nearest herd of deer (-herd, from 60 m), beside the nearest deer (-near, -near2 a few seconds on), from 60 m (-mid), then two hours later the same again (-later-near, -later-mid); a heap snapshot at the end; logs the animals, people and shader lines', settle: 6000, steps: [memoryDetails, { debug: 'Before the nearest herd' }, { wait: 15000 }, { shot: 'herd' }, { debug: 'Fly: beside the nearest deer' }, { wait: 5000 }, { shot: 'near' }, { wait: 3000 }, { shot: 'near2' }, { run: logPeople }, { debug: 'Fly: the nearest deer from 60 m' }, { wait: 3000 }, { shot: 'mid' }, { debug: 'Two hours later' }, { wait: 8000 }, { debug: 'Fly: beside the nearest deer' }, { wait: 5000 }, { shot: 'later-near' }, { debug: 'Fly: the nearest deer from 60 m' }, { wait: 3000 }, { shot: 'later-mid' }, { run: logPeople }, heap('deer')] },
  'memory-people': { query: 'view=inside', about: 'before the busiest spot within 2 km for 30 s with figures loaded, then a heap snapshot: who holds the JS heap', settle: 6000, steps: [memoryDetails, { debug: 'Before the nearest crowd' }, { wait: 30000 }, { run: logPeople }, { shot: 'before-heap' }, heap('people')] },
  'memory-title': { query: '', about: 'the title flight for 40 s, then a heap snapshot: who holds the JS heap', steps: [memoryDetails, { wait: 40000 }, heap('title')] },
  'memory-inside': {
    query: 'view=inside', about: 'up the wild endcap and flying toward the sunline, looking around, then a heap snapshot', settle: 6000,
    steps: [memoryDetails, { debug: 'The foot of the wild endcap' }, { wait: 5000 }, { debug: 'Halfway up the wild endcap' }, { wait: 5000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 6000 },
      { look: [700, 0] }, { wait: 3000 }, { look: [700, 0] }, { wait: 3000 }, { look: [700, 0] }, { wait: 3000 }, { look: [0, 250] }, { wait: 6000 }, { shot: 'before-heap' }, heap('inside')],
  },
  'memory-gate': {
    query: 'view=inside', about: 'flown up over the foot of the Gate, looking at it (Arnd: 4,214 tiles, 2.8 GB there); logs the terrain line, then a heap snapshot', settle: 6000,
    steps: [memoryDetails, { debug: 'The foot of the port endcap' }, { wait: 5000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 2500 }, { look: [0, -40] }, { wait: 8000 },
      { run: logTiles }, { shot: 'before-heap' }, heap('gate')],
  },
};

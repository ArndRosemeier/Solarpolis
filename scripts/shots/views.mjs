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
  const lines = text.split('\n').filter((l) => l.startsWith('people') || l.startsWith('understorey') || l.startsWith('θ') || l.startsWith('specks') || l.startsWith('drones') || l.startsWith('animals') || l.startsWith('squirrels') || l.startsWith('deer') || l.startsWith('shaders') || l.startsWith('memory') || l.includes('MB') || l.includes('fps'));
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

export const views = {
  title: { query: '', about: 'the title card over the attract flight', default: true },
  arrival: {
    query: '', about: 'Start: down the corridor (-corridor), nearing the berth (-berth), in the bore (-bore), past the bearing (-sleeve), then floating at the Hub',
    steps: [{ run: async (page) => page.click('.title-start') }, { wait: 5000 }, { shot: 'corridor' }, { wait: 14000 }, { shot: 'berth' }, { wait: 9000 }, { shot: 'bore' }, { wait: 8000 }, { shot: 'sleeve' }, { wait: 14000 }],
  },
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
  'under-homes': { query: 'view=inside', about: 'below the land in a hamlet\'s street, on the walk between two bays of homes: down the street along the axis (-street), a quarter turn to face the houses on one side (-houses), up over them into the vaults (-over), then after walking a few steps up the street (-on); logs the position line (it names the houses) and the memory lines', settle: 6000, steps: [{ debug: "Below: in a street among a hamlet's homes" }, { wait: 10000 }, { shot: 'street' }, { look: [393, 0] }, { wait: 1200 }, { shot: 'houses' }, { look: [0, -200] }, { wait: 1200 }, { shot: 'over' }, { look: [-393, 200] }, { key: 'KeyW', hold: 1500 }, { wait: 2500 }, { shot: 'on' }, { run: logPeople }] },
  'under-glass': { query: 'view=inside', about: 'below the land under a glass deck: the real land above on its ceilings, looking up (-up) and up and along (-along), then two hours later (-later); logs the position, memory and shader lines', settle: 6000, steps: [{ debug: 'Below: under a glass deck (the real sky above)' }, { wait: 10000 }, { look: [0, -330] }, { wait: 1500 }, { shot: 'up' }, { look: [0, 200] }, { wait: 800 }, { shot: 'along' }, { debug: 'Two hours later' }, { wait: 17000 }, { look: [0, -200] }, { wait: 800 }, { shot: 'later' }, { run: logPeople }] },
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
  'far-meadow-up': { query: 'view=inside', about: 'standing in a meadow, looking up at the far side', settle: 6000, steps: [{ debug: 'Into the nearest meadow' }, { wait: 5000 }, { look: [0, -260] }, { wait: 3000 }] },
  outside: { query: 'view=outside', about: 'the home habitat from outside', default: true },
  'outside-earth': { query: 'view=outside', about: 'looking at Earth (key 2)', steps: [{ key: 'Digit2' }, { wait: 3000 }] },
  'outside-moon': { query: 'view=outside', about: 'looking at the Moon (key 3)', steps: [{ key: 'Digit3' }, { wait: 3000 }] },
  'outside-neighbour': { query: 'view=outside', about: 'the nearest neighbour in the Necklace (key 4)', steps: [{ key: 'Digit4' }, { wait: 3000 }] },
  'outside-night-eyes': { query: 'view=outside', about: 'the stars with the Night eyes augmentation', steps: [{ debug: 'Night eyes augmentation' }, { wait: 2000 }] },
  'outside-close': { query: 'view=outside', about: 'wheel in close to the hull', steps: [{ wheel: -2400 }, { wait: 3000 }] },
  'people-crowd': { query: 'view=inside', about: 'before the busiest spot within 2 km in the morning: as they appear (-early), once the nearest have their figures (-near), a step closer (-closer); logs the people and shader lines', settle: 6000, steps: [{ debug: 'Before the nearest crowd' }, { wait: 3000 }, { shot: 'early' }, { wait: 12000 }, { shot: 'near' }, { run: logPeople }, { key: 'KeyW', hold: 1500 }, { wait: 4000 }, { shot: 'closer' }, { run: logPeople }] },
  'people-court': { query: 'view=inside', about: 'two hours into the morning, in the busiest court within 3 km, 12 m from its light well: parties meeting, rings talking, people on the well seat, coming and going (-court, -court2 20 s on); then beside the nearest talking ring of three or more (-ring, -ring2 10 s on: the turn to speak moves round); logs the people and shader lines', settle: 6000, steps: [{ debug: 'Two hours later' }, { wait: 4000 }, { debug: 'In the busiest court nearby' }, { wait: 15000 }, { shot: 'court' }, { run: logPeople }, { wait: 20000 }, { shot: 'court2' }, { debug: 'Beside the nearest talking ring' }, { wait: 15000 }, { shot: 'ring' }, { wait: 10000 }, { shot: 'ring2' }, { run: logPeople }] },
  'people-drones': { query: 'view=inside', about: 'two hours into the morning, 4 m from the nearest person in a drone body staying with others (-near, -near2 8 s on: hovering at their eyes, nodding on their turn to talk), then walked back for 6 s (-mid); logs the people, drones and shader lines', settle: 6000, steps: [{ debug: 'Two hours later' }, { wait: 4000 }, { debug: 'Beside the nearest person in a drone body' }, { wait: 15000 }, { shot: 'near' }, { wait: 8000 }, { shot: 'near2' }, { run: logPeople }, { key: 'KeyS', hold: 6000 }, { wait: 2000 }, { shot: 'mid' }, { run: logPeople }] },
  'people-beats': { query: 'view=inside', about: 'two hours into the morning, 6 m from the nearest party sitting or lying on the grass (-near), 20 s on (-near2), then five minutes later three times (-later1..3: beats change: sitting down, eating, lying back, getting up, strolling off); logs the people lines', settle: 6000, steps: [{ debug: 'Two hours later' }, { wait: 4000 }, { debug: 'Beside the nearest party on the grass' }, { wait: 15000 }, { shot: 'near' }, { wait: 20000 }, { shot: 'near2' }, { run: logPeople }, ...[1, 2, 3].flatMap((k) => [{ debug: 'Five minutes later' }, { wait: 6000 }, { shot: `later${k}` }]), { run: logPeople }] },
  'people-above': { query: 'view=inside', about: 'flown up over the busiest spot within 2 km, looking down at the crowd and out across the land', settle: 6000, steps: [{ debug: 'Before the nearest crowd' }, { wait: 6000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 2500 }, { look: [0, 160] }, { wait: 3000 }, { shot: 'down' }, { look: [0, -120] }, { wait: 2000 }, { run: logPeople }] },
  'people-far': { query: 'view=inside', about: 'everyone far off as specks, in the morning: low over the floor looking along it (-along), halfway up at the far side (-far-side), a quarter up across the curve (-curve); -marked: the same with every speck magenta and at least 4 px; logs the people, specks and shader lines', settle: 6000, steps: [{ debug: 'Fly: low over the floor, looking along it' }, { wait: 9000 }, { shot: 'along' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'along-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { run: logPeople }, { debug: 'Fly: halfway up, looking at the far side' }, { wait: 6000 }, { shot: 'far-side' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'far-side-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { debug: 'Fly: a quarter of the way up, looking across the curve' }, { wait: 6000 }, { shot: 'curve' }, { run: logPeople }] },
  'people-handover': { query: 'view=inside', about: 'flown up from the busiest spot within 2 km until the crowd is a few hundred metres off: stand-ins hand over to specks there (-up, then -higher); logs the people and specks lines', settle: 6000, steps: [{ debug: 'Before the nearest crowd' }, { wait: 6000 }, { key: 'KeyF' }, { key: 'KeyE', hold: 5000 }, { look: [0, 140] }, { wait: 3000 }, { shot: 'up' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'up-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { run: logPeople }, { key: 'KeyE', hold: 5000 }, { wait: 3000 }, { shot: 'higher' }, { run: logPeople }] },
  'people-stair': { query: 'view=inside', about: 'in the afternoon (6 hours on, the busiest time there), beside the Lift Stair (-stair) and from over the floor (-far): about two thousand people within 1.5 km come in nearest first; logs the people, frame and shader lines', settle: 6000, steps: [...Array.from({ length: 3 }, () => ({ debug: 'Two hours later' })), { debug: 'Fly: beside the Lift Stair' }, { wait: 10000 }, { shot: 'stair' }, { run: logPeople }, { debug: 'Fly: the Lift Stair from over the floor' }, { wait: 8000 }, { shot: 'far' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'far-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { run: logPeople }] },
  'drones': { query: 'view=inside', about: 'the drones: beside the nearest one at work (-near), from 60 m (-coarse), low over the floor looking along it (-along, -along-marked: every speck magenta, people and drones), and a minute on from 60 m (-later); logs the people, specks, drones and shader lines', settle: 6000, steps: [{ wait: 8000 }, { debug: 'Fly: beside the nearest drone at work' }, { wait: 4000 }, { shot: 'near' }, { run: logPeople }, { debug: 'Fly: the nearest drone at work from 60 m' }, { wait: 3000 }, { shot: 'coarse' }, { debug: 'Fly: low over the floor, looking along it' }, { wait: 6000 }, { shot: 'along' }, { debug: 'People far off' }, { wait: 500 }, { shot: 'along-marked' }, { debug: 'People far off' }, { debug: 'People far off' }, { run: logPeople }, { debug: 'Fly: the nearest drone at work from 60 m' }, { wait: 60000 }, { shot: 'later' }, { run: logPeople }] },
  'squirrels': { query: 'view=inside', about: 'into the nearest wood: beside the nearest squirrel down on the ground (-near, -near2 a few seconds on), from 15 m (-mid), then two hours later the same again (-later-near, -later-mid); a heap snapshot at the end; logs the animals, people and shader lines', settle: 6000, steps: [memoryDetails, { debug: 'Into the nearest wood' }, { wait: 10000 }, { debug: 'Fly: beside the nearest squirrel' }, { wait: 4000 }, { shot: 'near' }, { wait: 3000 }, { shot: 'near2' }, { run: logPeople }, { debug: 'Fly: the nearest squirrel from 15 m' }, { wait: 3000 }, { shot: 'mid' }, { debug: 'Two hours later' }, { wait: 6000 }, { debug: 'Fly: beside the nearest squirrel' }, { wait: 4000 }, { shot: 'later-near' }, { debug: 'Fly: the nearest squirrel from 15 m' }, { wait: 3000 }, { shot: 'later-mid' }, { run: logPeople }, heap('squirrels')] },
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

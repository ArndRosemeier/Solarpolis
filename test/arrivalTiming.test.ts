/** The arrival's timing line (src/app/arrivalTiming.ts): marks, the flight's frames and shaders, the curtain's wait. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ShaderEvent } from '@futuremagic/stage';
import { ArrivalTiming, STUTTER_MS } from '../src/app/arrivalTiming';

test('arrival timing: the title, the flight, what was built while it flew, and whether the curtain waited', () => {
  let now = 0;
  const t = new ArrivalTiming(() => now), events: ShaderEvent[] = [];
  t.watchShaders('inside', () => ({ events }));
  t.watchShaders('outside', () => null);
  assert.match(t.arrivalLine(), /title not yet · not started/);
  now = 4000; t.mark('title');
  // Frames on the title are not the flight's.
  t.countFrame(200);
  events.push({ t: 3000, kind: 'node-sync', ms: 80, what: 'warm-up', phase: 'warmup' });
  now = 10000; t.mark('start');
  assert.ok(t.flying);
  for (let k = 0; k < 100; k++) t.countFrame(16);
  t.countFrame(50);
  events.push({ t: 12000, kind: 'node-sync', ms: 20, what: 'a', phase: 'run' }, { t: 13000, kind: 'node-async', ms: 5, what: 'b', phase: 'run' }, { t: 13100, kind: 'gpu-pipeline-sync', ms: 30, what: 'b', phase: 'run' });
  now = 28000; t.mark('inside');
  now = 31000; t.mark('body');
  now = 53000; t.mark('flown');
  now = 53500; t.mark('closed');
  assert.ok(!t.flying);
  t.countFrame(500);
  events.push({ t: 54000, kind: 'node-sync', ms: 90, what: 'after', phase: 'run' });
  now = 54500; t.mark('ready');
  now = 55000; t.mark('open');
  // A second Start (back to the title and again) keeps the first flight's figures.
  now = 90000; t.mark('start');
  assert.equal(t.at('start'), 10000);
  const f = t.flightFrames;
  assert.equal(f.count, 101);
  assert.equal(f.slowest, 50);
  assert.equal(f.stutters, 1);
  assert.ok(50 > STUTTER_MS && 16 < STUTTER_MS);
  assert.deepEqual(t.flightShaders(), { built: 2, worst: 30, blocked: 50 });
  assert.equal(t.curtainWait, 1000);
  const line = t.arrivalLine();
  for (const part of ['title 4.0 s after opening', 'interior 18.0 s', 'body 21.0 s', 'flight 43.0 s', 'interior ready 25.0 s before the curtain', 'curtain waited 1.0 s', 'slowest frame 50 ms, 1 stutters', '2 shaders built in flight (worst 30 ms, 50 ms blocked)']) {
    assert.ok(line.includes(part), `${part} in: ${line}`);
  }
});

test('arrival timing: an interior that came after the ship says how late it was', () => {
  let now = 0;
  const t = new ArrivalTiming(() => now);
  t.mark('start');
  now = 40000; t.mark('flown');
  now = 52000; t.mark('inside');
  assert.ok(t.arrivalLine().includes('interior 12.0 s late'));
});

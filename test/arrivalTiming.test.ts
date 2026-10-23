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

test('arrival timing: the flight\'s longest frames and what ran in them, nothing from before Start or after the curtain', () => {
  let now = 0;
  const t = new ArrivalTiming(() => now), script = (name: string, duration: number) => ({ invoker: 'FrameRequestCallback', sourceURL: 'http://x/assets/index-abc.js', sourceFunctionName: name, sourceCharPosition: 1234, duration });
  t.longFrame({ startTime: 500, duration: 900, scripts: [script('early', 800)] });
  now = 1000; t.mark('start');
  for (let k = 0; k < 20; k++) t.longFrame({ startTime: 2000 + k * 100, duration: 60 + k, scripts: [script('a', 10), script('b', 50), script('c', 5), script('d', 20)] });
  now = 30000; t.mark('closed');
  t.longFrame({ startTime: 31000, duration: 900, scripts: [] });
  assert.equal(t.longFrames.length, 12);
  assert.equal(t.longFrames[0].duration, 79);
  assert.deepEqual(t.longFrames[0].scripts.map((s) => s.sourceFunctionName), ['b', 'd', 'a']);
  assert.ok(t.stutterLine().startsWith('arrival\'s long frames: 2.9 s 79 ms [FrameRequestCallback b index-abc.js@1234 50 ms;'), t.stutterLine());
});

test('arrival timing: what loaded when after Start', () => {
  let now = 0;
  const t = new ArrivalTiming(() => now);
  t.note('before');
  now = 1000; t.mark('start');
  now = 3500; t.note('human pack …');
  now = 9000; t.note('human pack ✓');
  assert.equal(t.loadingLine(), 'arrival\'s loading: 2.5 human pack … · 8.0 human pack ✓');
});

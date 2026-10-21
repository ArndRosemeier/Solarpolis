import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryWatchdog, deviceBudget, type PressureLevel } from '../src/app/memory';

const MB = 1024 * 1024;

function rig(heap: { v: number | null }) {
  let t = 0;
  const levels: PressureLevel[] = [];
  const dog = new MemoryWatchdog({
    budget: { soft: 100 * MB, hard: 200 * MB, device: 'test' },
    readHeap: () => heap.v,
    now: () => (t += 1000),
    onLevel: (l) => levels.push(l),
  });
  return { dog, levels };
}

test('memory: tracked owners add to the heap, and the soft budget sheds once until it re-arms', () => {
  const heap = { v: 50 * MB as number | null };
  const { dog, levels } = rig(heap);
  let cache = 40 * MB, soft = 0, hard = 0;
  dog.track('chunks', () => cache);
  dog.onPressure('soft', () => { soft++; cache = 0; });
  dog.onPressure('hard', () => hard++);
  assert.equal(dog.sample().total, 90 * MB);
  cache = 60 * MB;
  assert.equal(dog.sample().level, 'soft');
  assert.equal(soft, 1);
  assert.equal(dog.sample().level, 'ok'); // the shed worked
  cache = 60 * MB;
  dog.sample();
  assert.equal(soft, 2, 're-armed after falling under 90%');
  assert.equal(hard, 0);
  assert.deepEqual(levels, ['soft', 'ok', 'soft']);
});

test('memory: the hard budget sheds both levels, and a browser without a heap reading still counts its owners', () => {
  const { dog } = rig({ v: null });
  let soft = 0, hard = 0;
  dog.track('gpu', () => 250 * MB);
  dog.onPressure('soft', () => soft++);
  dog.onPressure('hard', () => hard++);
  const s = dog.sample();
  assert.equal(s.heap, null);
  assert.equal(s.level, 'hard');
  assert.deepEqual([soft, hard], [1, 1]);
  dog.sample();
  assert.deepEqual([soft, hard], [1, 1], 'no repeat while still over');
});

test('memory: growth per minute and the debug line', () => {
  const heap = { v: 10 * MB as number | null };
  const { dog } = rig(heap);
  dog.sample();
  heap.v = 20 * MB;
  dog.sample(); // one second later
  assert.equal(Math.round(dog.growth() / MB), 600);
  assert.match(dog.line(), /memory 20 MB of 100 MB\/200 MB \(test\), heap 20 MB/);
});

test('memory: tablets get a smaller budget than desktops', () => {
  const tablet = deviceBudget({ mobile: true, deviceMemoryGB: 8 });
  const desk = deviceBudget({ mobile: false, deviceMemoryGB: null });
  assert.ok(tablet.hard <= 1024 * MB && tablet.hard < desk.soft);
});

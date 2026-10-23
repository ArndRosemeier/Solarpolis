/** Heavy loading waits for a cut while a cinematic plays (src/render/loadGate.ts). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoadGate } from '../src/render/loadGate';

test('load gate: open, steps go at once; held, they wait for the next cut, all together; let go, all go', async () => {
  const g = new LoadGate(), went: string[] = [], queued = (): number => g.waitingSteps;
  await g.wait();
  g.hold(true);
  void g.wait().then(() => went.push('a'));
  void g.wait().then(() => went.push('b'));
  await Promise.resolve();
  assert.equal(went.length, 0);
  assert.equal(queued(), 2);
  g.cut();
  await Promise.resolve();
  assert.deepEqual(went, ['a', 'b']);
  void g.wait().then(() => went.push('c'));
  g.hold(false);
  await Promise.resolve();
  assert.deepEqual(went, ['a', 'b', 'c']);
  assert.ok(!g.held && queued() === 0);
});

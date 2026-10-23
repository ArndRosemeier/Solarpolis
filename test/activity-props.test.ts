import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tossAt, TOSS } from '../src/sim/props';
import { ActivityProps, type PropPerson } from '../src/render/activityProps';
import type { Stage } from '@futuremagic/stage';
import type { InstancedMesh } from 'three/webgpu';

test('catch ball: shared throw clock alternates possession and joins the hands continuously', () => {
  for (let turn = 0; turn < 6; turn++) {
    const start = turn * TOSS.turn;
    assert.equal(tossAt(start).thrower, turn % 2);
    assert.ok(tossAt(start + TOSS.release).flight < 1e-10);
    assert.ok(Math.abs(tossAt(start + TOSS.release + TOSS.flight / 2).flight - 0.5) < 1e-10);
    assert.equal(tossAt(start + TOSS.release + TOSS.flight + 1e-9).flight, 1);
    const before = tossAt(start + TOSS.turn - 1e-8), next = tossAt(start + TOSS.turn);
    assert.equal(1 - before.thrower, next.thrower, 'the catcher holds the ball for the next throw');
  }
});

test('activity props: a full pool keeps its old mesh until a larger one has warmed', async () => {
  const stage = { prepare: async () => undefined, renderer: { info: {} } } as unknown as Stage;
  const props = new ActivityProps(stage, 1);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const old = props.group.children.find((m) => m.name === 'activity axe') as InstancedMesh;
  const people = Array.from({ length: 129 }, (_, i) => ({
    person: { act: 'work', moving: false, posture: 0, court: 0, outing: i },
    feet: [i, 0, 0], up: [0, 1, 0], front: [0, 0, 1], height: 1.7, figure: null, anim: { move: 'idle' },
  })) as PropPerson[];
  props.update(people, [0, 0, 0]);
  assert.equal(old.count, 128);
  assert.ok(props.group.children.includes(old));
  await Promise.resolve();
  props.update(people, [0, 0, 0]);
  const grown = props.group.children.find((m) => m.name === 'activity axe') as InstancedMesh;
  assert.notEqual(grown, old, 'new bindings must reference the larger buffer');
  assert.equal(grown.count, 129);
  assert.ok(Math.abs(grown.instanceMatrix.array[128 * 16 + 12] - 128.2) < 1e-4);
  props.dispose();
});

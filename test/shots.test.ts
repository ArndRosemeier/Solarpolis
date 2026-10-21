/**
 * The real-GPU screenshot tool (scripts/shots): its arguments and the views catalogue. The capture itself needs a GPU
 * and runs on the render PC, never in CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Catalogue = Record<string, { query: string; steps?: Record<string, unknown>[]; default?: boolean }>;
interface Shots {
  parseArgs(argv: string[]): { ref: string | null; views: string[] | null; size: [number, number]; publish: boolean; id: string | null };
  pickViews(catalogue: Catalogue, names: string[] | null): string[];
  checkViews(catalogue: Catalogue): string[];
}
// Plain .mjs scripts, loaded by path so the typecheck does not need declarations for them.
const SHOTS = '../scripts/shots/shots.mjs', VIEWS = '../scripts/shots/views.mjs';
const shots = (await import(SHOTS)) as Shots;
const { views } = (await import(VIEWS)) as { views: Catalogue };

test('shots: every view in the catalogue is well formed, and the default set has the four tabs', () => {
  assert.deepEqual(shots.checkViews(views), []);
  assert.deepEqual(shots.pickViews(views, null), ['title', 'lab', 'inside', 'outside']);
  assert.equal(shots.pickViews(views, ['all']).length, Object.keys(views).length);
});

test('shots: a malformed view or an unknown name is refused', () => {
  assert.equal(shots.checkViews({ x: { query: 'view=inside', steps: [{ key: 'KeyF', wait: 1 }] } }).length, 1);
  assert.equal(shots.checkViews({ x: { query: 'view=inside', steps: [{ look: [1] }] } }).length, 1);
  assert.throws(() => shots.pickViews(views, ['nowhere']), /unknown view/);
});

test('shots: arguments', () => {
  const o = shots.parseArgs(['--ref', 'claude/x', '--views', 'inside, outside', '--size', '1280x720', '--publish', '--id', 'a.b-1']);
  assert.equal(o.ref, 'claude/x');
  assert.deepEqual(o.views, ['inside', 'outside']);
  assert.deepEqual(o.size, [1280, 720]);
  assert.equal(o.publish, true);
  assert.throws(() => shots.parseArgs(['--id', '../x']), /--id/);
  assert.throws(() => shots.parseArgs(['--nope']), /unknown argument/);
});

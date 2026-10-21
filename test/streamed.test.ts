/** The one stream cache (render/streamed.ts): every entry it makes is either kept or freed, and it keeps to its bytes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamCache, type Streamed } from '../src/render/streamed';
import type { WorkerPool } from '../src/workers/pool';
import type { GenAnswer, GenRequest } from '../src/workers/gen.worker';

interface E extends Streamed { id: string }

/** A pool whose jobs the test settles by hand, and a cache over it counting what it makes and frees. */
function rig(opts: { limit?: number; maxBytes?: number } = {}) {
  const jobs: { request: GenRequest; settle: () => void }[] = [];
  const pool = {
    job: (request: GenRequest) => new Promise<GenAnswer>((resolve) => jobs.push({ request, settle: () => resolve({} as GenAnswer) })),
    drop: () => {},
  } as unknown as WorkerPool;
  const live = new Set<E>();
  let made = 0;
  const cache = new StreamCache<E>(pool, {
    id: (r) => (r as unknown as { id: string }).id,
    limit: opts.limit ?? 100, maxBytes: opts.maxBytes ?? 1e9, inFlight: 8,
    make: async (_a, id) => { made++; const e = { id, bytes: 10, lastDrawn: 0 }; live.add(e); return e; },
    free: (e) => { assert.ok(live.delete(e), 'freed once'); },
  });
  const req = (id: string) => ({ id, request: { id } as unknown as GenRequest });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { cache, jobs, live, req, tick, made: () => made };
}

test('stream cache: a job finished after it was no longer wanted is not made', async () => {
  const { cache, jobs, live, req, tick, made } = rig();
  cache.frame();
  cache.want([req('a')]);
  cache.frame();
  cache.want([]); // the eye moved on
  jobs[0].settle();
  await tick();
  assert.equal(made(), 0);
  assert.equal(live.size, 0);
});

test('stream cache: asked again while an older job ran, it keeps one entry and frees the other', async () => {
  const { cache, jobs, live, req, tick } = rig();
  cache.frame(); cache.want([req('a')]);
  cache.frame(); cache.want([]);
  cache.frame(); cache.want([req('a')]); // back again: a second job for the same tile
  assert.equal(jobs.length, 2);
  jobs[1].settle(); jobs[0].settle();
  await tick();
  assert.equal(cache.built.size, 1);
  assert.equal(live.size, 1);
  assert.equal(cache.bytes, 10);
});

test('stream cache: entries not drawn go once it holds more than its bytes', async () => {
  const { cache, jobs, live, req, tick } = rig({ maxBytes: 35 });
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  cache.frame();
  cache.want(ids.map(req));
  for (const j of jobs) j.settle();
  await tick();
  assert.equal(cache.built.size, 6);
  cache.frame();
  cache.mark(cache.get('f')!);
  cache.want([req('f')]);
  assert.ok(cache.bytes <= 35, `${cache.bytes} bytes kept`);
  assert.ok(cache.get('f'), 'the drawn one stays');
  assert.equal(live.size, cache.built.size);
});

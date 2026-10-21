import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChangelog } from '../src/app/changelog';

test("what's new: versions newest first with their titles and bullets", () => {
  const r = parseChangelog('# Changelog\n\n## v0.002 — The **town**\n\n- A `thing`\n  wrapped on.\n- Two\n\n## v0.001 — Start\n\n- One\n');
  assert.deepEqual(r, [
    { version: 'v0.002', title: 'The town', notes: ['A thing wrapped on.', 'Two'] },
    { version: 'v0.001', title: 'Start', notes: ['One'] },
  ]);
});

test("what's new: the real CHANGELOG.md reads, every version with notes", () => {
  const r = parseChangelog(readFileSync('CHANGELOG.md', 'utf8'));
  // Empty until the first merge is folded in as v0.001.
  for (const x of r) {
    assert.match(x.version, /^v\d+\.\d{3}$/);
    assert.ok(x.notes.length > 0, x.version);
  }
});

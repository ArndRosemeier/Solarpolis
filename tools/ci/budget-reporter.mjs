/**
 * A node:test reporter that keeps the fast suite fast (docs/CI.md): it prints one line per failure
 * (with its error) and a summary, and then checks tools/ci/budget.json: the whole run under `totalMs`, or it fails
 * (exit code 1). A top-level test over `perTestMs` or a file over `perFileMs` is a warning only (a GitHub annotation
 * and a line in the PR's summary): runners differ about 1.6× in speed, so a single test's wall clock near its limit
 * would fail at random (Arnd, 2026-10-22: warn per test and file, fail on the total). Either way a slow test is
 * made faster or moved to test/slow/ before it can pile up.
 *
 * With CI_TIMES_OUT=<file> it also writes the timings as JSON (`{ totalMs, tests, files: { file: ms }, slow: [line] }`),
 * which CI compares with main's (tools/ci/suite-diff.mjs) so each PR shows what its tests cost and what is over.
 *
 * Node built-ins only. Used by `npm test` (`--test-reporter=./tools/ci/budget-reporter.mjs`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUDGET = JSON.parse(fs.readFileSync(path.join(HERE, 'budget.json'), 'utf8'));
// A machine much slower than CI (a busy laptop) can scale the limits: CI_BUDGET_SCALE=2.
const SCALE = Number(process.env.CI_BUDGET_SCALE || 1);

/** Budget breaches for collected timings (pure, tested): `warn` for a test or file over its limit, `fail` for the suite. */
export function breaches(tests, files, totalMs, budget = BUDGET, scale = SCALE) {
  const warn = [], fail = [];
  for (const t of tests) if (t.ms > budget.perTestMs * scale) warn.push(`test over ${budget.perTestMs * scale} ms: ${t.ms.toFixed(0)} ms  ${t.name}  (${t.file})`);
  for (const [file, ms] of files) if (ms > budget.perFileMs * scale) warn.push(`file over ${budget.perFileMs * scale} ms: ${ms.toFixed(0)} ms  ${file}`);
  if (totalMs > budget.totalMs * scale) fail.push(`suite over ${budget.totalMs * scale} ms: ${totalMs.toFixed(0)} ms`);
  return { warn, fail };
}

export default async function* budgetReporter(source) {
  const tests = [];
  const files = new Map();
  let pass = 0, fail = 0;
  for await (const event of source) {
    if (event.type === 'test:diagnostic' && event.data.nesting === 0) continue;
    if (event.type !== 'test:pass' && event.type !== 'test:fail') continue;
    const d = event.data;
    if (d.details?.type === 'suite') continue;
    const file = d.file ? path.relative(process.cwd(), d.file) : '?';
    if (event.type === 'test:fail') {
      fail++;
      const err = d.details?.error;
      yield `FAIL ${file} > ${d.name}\n${String(err?.cause?.stack ?? err?.cause ?? err?.message ?? err).split('\n').map((l) => '    ' + l).join('\n')}\n`;
    } else pass++;
    if (d.nesting === 0) {
      const ms = d.details?.duration_ms ?? 0;
      tests.push({ name: d.name, file, ms });
      files.set(file, (files.get(file) ?? 0) + ms);
    }
  }
  // Since the process started, not since this reporter did: with the test files in one process the reporter can
  // start reading events only after they ran, so its own start time says nothing about the run (CI showed 0.1 s).
  // The tests' own time is a floor, so the cap can never be measured away.
  const totalMs = Math.max(performance.now(), tests.reduce((a, t) => a + t.ms, 0));
  const { warn, fail: over } = breaches(tests, files, totalMs);
  if (process.env.CI_TIMES_OUT) {
    fs.writeFileSync(process.env.CI_TIMES_OUT, JSON.stringify({ totalMs: Math.round(totalMs), tests: tests.length, files: Object.fromEntries([...files].map(([f, ms]) => [f, Math.round(ms)])), slow: warn }, null, 1));
  }
  const slowest = [...tests].sort((a, b) => b.ms - a.ms).slice(0, 5);
  yield `${pass} passed, ${fail} failed, ${files.size} files.\n`;
  yield `CI budget (tools/ci/budget.json): ${(totalMs / 1000).toFixed(1)} s of ${(BUDGET.totalMs * SCALE / 1000).toFixed(0)} s. Slowest: ${slowest.map((t) => `${t.name} ${t.ms.toFixed(0)} ms`).join(', ') || 'none'}\n`;
  if (warn.length) {
    yield `CI budget warning (does not fail the run). Make it faster or move it to test/slow/ (docs/CI.md):\n${warn.map((l) => '  ' + l).join('\n')}\n`;
    if (process.env.GITHUB_ACTIONS) for (const l of warn) yield `::warning title=Slow test (docs/CI.md)::${l}\n`;
  }
  if (over.length) {
    yield `CI BUDGET BREACHED. Make tests faster or move them to test/slow/ (docs/CI.md):\n${over.map((l) => '  ' + l).join('\n')}\n`;
    process.exitCode = 1;
  }
}

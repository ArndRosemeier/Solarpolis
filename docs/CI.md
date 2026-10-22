# CI: a hard 2-minute cap

Arnd (2026-10-21): "A CI limitation to 2 minutes. Don't want to get all dev time being eaten by this since this will get quadratic (more commits that each take longer than the last)."

## How it is kept

- **One job, `timeout-minutes: 2`** (`.github/workflows/ci.yml`): change note check, `npm ci`, typecheck, `npm test`, `vite build`. A newer push to a PR cancels the older run.
- **Budgets per test, per file and for the whole suite** (`tools/ci/budget.json`). The budget reporter (`tools/ci/budget-reporter.mjs`) fails the run when the suite's total is crossed. A test or file over its own limit is a warning: a GitHub annotation and a line under "Over budget" in the PR's step summary, so a slow test is caught on the PR that adds it, long before the cap is reached. Only the total fails, because a single test's wall clock swings with the runner's speed (about 1.6×) and failed main at random near its limit (Arnd, 2026-10-22: "Warn per test, fail on total").
- **Cost report**: each PR's step summary compares its test timings with main's last green run (`tools/ci/suite-diff.mjs`).
- **Slow tests live in `test/slow/`** and run with `npm run test:slow`, locally or on demand, never in the PR check.
- **No wall-clock timings in the PR check.** GitHub's runners differ about 1.6× in speed from run to run, so a millisecond limit there fails at random. Timings (such as a ground tile's 40 ms) live in the slow suite, measured warm (Arnd, 2026-10-21).

## When a budget is crossed

A warning counts as much as a failure for the PR that causes it: fix it in that PR. Make the test faster (smaller habitat from the `MATRIX`, fewer samples, test the function instead of the whole pipeline), or move it to `test/slow/`. Raise a budget only with a reason in `budget.json`, and never the 2-minute cap without Arnd.

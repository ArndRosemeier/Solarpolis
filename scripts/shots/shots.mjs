#!/usr/bin/env node
/**
 * Real-GPU screenshots and a WGSL check of Solarpolis (scripts/shots/README.md). Runs on a machine with a GPU (Arnd's
 * PC); the cloud containers only have SwiftShader. Never part of CI.
 *
 *   npm run shots -- [--ref <branch|sha>] [--views a,b|all] [--size 1600x900] [--publish] [--id <name>] [--wgsl all]
 *   npm run shots -- --list
 *
 * Without --ref it builds this checkout as it is. With --ref it fetches the ref into its own clone (.render/src), so
 * this checkout is never touched. It builds with Vite (no typecheck), serves the build, opens each view in a fresh
 * headless Chrome page on the real GPU, and records every WGSL module the app compiles with its compilation messages,
 * uncaptured WebGPU errors, a lost device, console errors and the shader monitor's report. Output: .render/out/<id>/
 * (report.json, <view>.png, wgsl/). --publish pushes it to the `renders` branch (one commit, the latest results only).
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = resolve(import.meta.dirname);
const REPO = resolve(HERE, '../..');
const WORK = join(REPO, '.render');
/** How many result sets the `renders` branch keeps. */
const KEEP = 20;
const BRANCH = 'renders';

// ---- arguments -------------------------------------------------------------------------------------
export function parseArgs(argv) {
  const o = { ref: null, views: null, size: [1600, 900], publish: false, id: null, wgsl: 'errors', list: false, headed: false, keep: false, watch: false, interval: 30 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--ref') o.ref = next();
    else if (a === '--views') o.views = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--size') { const m = /^(\d+)x(\d+)$/.exec(next()); if (!m) throw new Error('--size is WIDTHxHEIGHT'); o.size = [+m[1], +m[2]]; }
    else if (a === '--publish') o.publish = true;
    else if (a === '--id') o.id = next();
    else if (a === '--wgsl') { o.wgsl = next(); if (!['all', 'errors'].includes(o.wgsl)) throw new Error('--wgsl is all or errors'); }
    else if (a === '--list') o.list = true;
    else if (a === '--headed') o.headed = true;
    else if (a === '--keep-server') o.keep = true;
    else if (a === '--watch') o.watch = true;
    else if (a === '--interval') { o.interval = Number(next()); if (!(o.interval >= 5)) throw new Error('--interval is at least 5 s'); }
    else throw new Error(`unknown argument ${a}`);
  }
  if (o.id && !/^[\w.-]+$/.test(o.id)) throw new Error('--id may hold letters, digits, . _ - only');
  return o;
}

/** The step kinds a view may use (views.mjs). */
export const STEP_KINDS = ['debug', 'key', 'look', 'wheel', 'wait', 'shot', 'run'];

/** What is wrong with a views catalogue, one line each (empty: fine). */
export function checkViews(catalogue) {
  const out = [];
  for (const [name, v] of Object.entries(catalogue)) {
    if (!/^[\w-]+$/.test(name)) out.push(`${name}: a view name holds letters, digits, _ and - only`);
    if (typeof v.query !== 'string') out.push(`${name}: query must be a string ('' for the title)`);
    for (const s of v.steps ?? []) {
      const kinds = STEP_KINDS.filter((k) => k in s);
      if (kinds.length !== 1) out.push(`${name}: each step has exactly one of ${STEP_KINDS.join(', ')}: ${JSON.stringify(s)}`);
      if ('look' in s && !(Array.isArray(s.look) && s.look.length === 2)) out.push(`${name}: look is [dx, dy]`);
      if ('hold' in s && !('key' in s)) out.push(`${name}: hold goes with key`);
    }
  }
  return out;
}

/** The views to capture: the named ones, `all`, or the default set. */
export function pickViews(catalogue, names) {
  if (!names) return Object.keys(catalogue).filter((k) => catalogue[k].default);
  if (names.length === 1 && names[0] === 'all') return Object.keys(catalogue);
  const unknown = names.filter((n) => !catalogue[n]);
  if (unknown.length) throw new Error(`unknown view(s): ${unknown.join(', ')}. Known: ${Object.keys(catalogue).join(', ')}`);
  return names;
}

// ---- the source to build ------------------------------------------------------------------------------
const run = (cmd, args, cwd, env) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...process.env, ...env }, maxBuffer: 64 << 20 }).trim();
/** npm is a .cmd on Windows, which only runs through a shell. */
const npm = (line, cwd) => execFileSync(`npm ${line}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', shell: true, maxBuffer: 64 << 20 });
const git = (args, cwd = REPO, env) => run('git', args, cwd, env);
const log = (s) => console.log(`[shots] ${s}`);

/** On Windows the Actors pack script must use Windows' own tar: Git's GNU tar reads `C:\…` as a remote host. */
function packEnv() {
  if (process.platform !== 'win32') return {};
  const sys = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32');
  return { PATH: `${sys};${process.env.PATH}`, Path: `${sys};${process.env.Path ?? process.env.PATH}` };
}

/** Check out `ref` in .render/src (its own clone, reused), install and build it. Returns the source directory and its commit. */
function prepare(ref) {
  let dir = REPO;
  if (ref) {
    dir = join(WORK, 'src');
    const origin = git(['remote', 'get-url', 'origin']);
    if (!existsSync(join(dir, '.git'))) { log(`cloning ${origin} into ${dir}`); mkdirSync(WORK, { recursive: true }); git(['clone', '--quiet', origin, dir], WORK); }
    log(`fetching ${ref}`);
    git(['fetch', '--quiet', '--force', 'origin', `+refs/heads/*:refs/remotes/origin/*`], dir);
    let sha;
    try { sha = git(['rev-parse', '--verify', `origin/${ref}^{commit}`], dir); } catch {
      try { git(['fetch', '--quiet', 'origin', ref], dir); sha = git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], dir); } catch {
        sha = git(['rev-parse', '--verify', `${ref}^{commit}`], dir);
      }
    }
    git(['checkout', '--quiet', '--force', '--detach', sha], dir);
    git(['clean', '-fdq', '-e', 'node_modules', '-e', '.actors-pack'], dir);
    git(['submodule', 'update', '--init', '--recursive', '--quiet'], dir);
    // Dependencies: again only when the lock file changed.
    const lock = createHash('sha1').update(readFileSync(join(dir, 'package-lock.json'))).digest('hex');
    const stamp = join(dir, 'node_modules', '.shots-lock');
    if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== lock) {
      log('npm ci (the lock file changed)');
      npm('ci --no-audit --no-fund', dir);
      writeFileSync(stamp, lock);
    }
    // The Actors pack: copied from this checkout when it has the same version (a download is 400 MB).
    const version = JSON.parse(readFileSync(join(dir, 'node_modules/@actors/generator/package.json'), 'utf8')).version;
    const mine = join(REPO, '.actors-pack', version), theirs = join(dir, '.actors-pack', version);
    if (!existsSync(join(theirs, 'human/manifest.json')) && existsSync(join(mine, 'human/manifest.json'))) { log(`copying the Actors pack ${version}`); cpSync(mine, theirs, { recursive: true }); }
  }
  log('building');
  run('node', ['tools/actors/pack.mjs'], dir, packEnv());
  try { run(process.execPath, [join(dir, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'], dir); } catch (e) { throw new Error(`the build failed:\n${e.stderr || e.stdout || e.message}`); }
  const sha = git(['rev-parse', 'HEAD'], dir);
  const dirty = !ref && git(['status', '--porcelain', '--untracked-files=no'], dir) !== '';
  return { dir, sha, dirty, subject: git(['log', '-1', '--format=%s'], dir) };
}

// ---- serving -----------------------------------------------------------------------------------------
function freePort() {
  return new Promise((ok, fail) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); s.on('error', fail); });
}

async function serve(dir) {
  const port = await freePort();
  const vite = join(dir, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [vite, 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return { url, stop: () => child.kill() }; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('vite preview did not start');
}

// ---- the browser ---------------------------------------------------------------------------------------
/** Runs in the page before the app: records every WGSL module, its compilation messages, and WebGPU errors. */
function probe() {
  const rec = { adapter: null, modules: [], errors: [], pipelines: [], lost: null };
  globalThis.__shots = rec;
  if (!globalThis.GPUDevice) return;
  const D = GPUDevice.prototype, A = GPUAdapter.prototype;
  const csm = D.createShaderModule;
  D.createShaderModule = function (desc) {
    const m = csm.call(this, desc);
    const entry = { label: desc?.label ?? '', code: String(desc?.code ?? ''), messages: null };
    rec.modules.push(entry);
    m.getCompilationInfo().then(
      (info) => { entry.messages = Array.from(info.messages, (x) => ({ type: x.type, line: x.lineNum, col: x.linePos, message: x.message })); },
      (e) => { entry.messages = [{ type: 'error', line: 0, col: 0, message: `getCompilationInfo failed: ${e}` }]; });
    return m;
  };
  const cpa = D.createRenderPipelineAsync;
  D.createRenderPipelineAsync = function (desc) {
    const p = cpa.call(this, desc);
    p.catch((e) => rec.pipelines.push({ label: desc?.label ?? '', message: String(e?.message ?? e) }));
    return p;
  };
  const rd = A.requestDevice;
  A.requestDevice = async function (desc) {
    const dev = await rd.call(this, desc);
    const i = this.info ?? {};
    rec.adapter = { vendor: i.vendor, architecture: i.architecture, device: i.device, description: i.description, fallback: !!(i.isFallbackAdapter ?? this.isFallbackAdapter) };
    dev.addEventListener('uncapturederror', (e) => { if (rec.errors.length < 200) rec.errors.push(String(e.error?.message ?? e.error)); });
    dev.lost.then((l) => { rec.lost = { reason: l.reason, message: l.message }; });
    return dev;
  };
}

async function launch(headed) {
  const { chromium } = await import('playwright-core');
  const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'];
  try { return await chromium.launch({ channel: 'chrome', headless: !headed, args }); } catch (e) {
    log(`no installed Chrome (${String(e.message).split('\n')[0]}); trying Playwright's Chromium`);
    return chromium.launch({ headless: !headed, args });
  }
}

/** The view is up: its canvas is on the page and its note is empty, or it is the Lab. */
async function ready(page, timeout = 120_000) {
  await page.waitForFunction(() => {
    const box = [...document.querySelectorAll('.inside')].find((b) => !b.hidden);
    if (!box) return !!document.querySelector('.lab:not([hidden])');
    const note = box.querySelector('.inside-note')?.textContent ?? '';
    return !!box.querySelector('canvas') && note === '';
  }, null, { timeout, polling: 250 });
  const note = await page.evaluate(() => [...document.querySelectorAll('.inside')].find((b) => !b.hidden)?.querySelector('.inside-note')?.textContent ?? '');
  if (note) throw new Error(note);
}

async function debugClick(page, label) {
  await page.keyboard.press('Control+Shift+F12');
  const item = page.locator('.dbg-panel .dbg-item').filter({ has: page.locator('.dbg-label', { hasText: label }) }).first();
  await item.click({ timeout: 5000 });
  await page.locator('.dbg-panel .dbg-close').click();
}

async function debugInfo(page) {
  await page.keyboard.press('Control+Shift+F12');
  const text = await page.locator('.dbg-panel .dbg-info').innerText({ timeout: 3000 }).catch(() => '');
  await page.locator('.dbg-panel .dbg-close').click().catch(() => {});
  return text;
}

async function step(page, s, shoot) {
  const { width: w, height: h } = page.viewportSize();
  if (s.debug) await debugClick(page, s.debug);
  // Playwright takes KeyboardEvent codes (KeyF, Digit2, Space) as they are.
  else if (s.key && s.hold) { await page.keyboard.down(s.key); await page.waitForTimeout(s.hold); await page.keyboard.up(s.key); }
  else if (s.key) await page.keyboard.press(s.key);
  else if (s.look) {
    await page.mouse.move(w / 2, h / 2); await page.mouse.down({ button: 'right' });
    const n = 12; for (let i = 1; i <= n; i++) await page.mouse.move(w / 2 + s.look[0] * i / n, h / 2 + s.look[1] * i / n);
    await page.mouse.up({ button: 'right' });
  } else if (s.wheel) { await page.mouse.move(w / 2, h / 2); const n = Math.max(1, Math.round(Math.abs(s.wheel) / 120)); for (let i = 0; i < n; i++) { await page.mouse.wheel(0, s.wheel / n); await page.waitForTimeout(16); } }
  else if (s.wait) await page.waitForTimeout(s.wait);
  else if (s.shot) await shoot(s.shot);
  else if (s.run) await s.run(page);
  else throw new Error(`unknown step ${JSON.stringify(s)}`);
}

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 12);

async function capture(browser, url, name, view, out, opts) {
  const t0 = performance.now();
  const page = await browser.newPage({ viewport: { width: opts.size[0], height: opts.size[1] } });
  await page.addInitScript(probe);
  const consoleLines = [];
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && consoleLines.length < 200) consoleLines.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleLines.push(`pageerror: ${e.message}`));
  const shots = [];
  const shoot = async (suffix) => {
    const file = suffix ? `${name}-${suffix}.png` : `${name}.png`;
    const ts = performance.now();
    await page.screenshot({ path: join(out, file) });
    shots.push({ file, ms: Math.round(performance.now() - ts) });
  };
  const result = { view: name, about: view.about ?? '', query: view.query, ok: true, failure: null };
  try {
    await page.goto(url + (view.query ? `?${view.query}` : ''), { waitUntil: 'load' });
    await ready(page);
    result.readyMs = Math.round(performance.now() - t0);
    await page.waitForTimeout(view.settle ?? 4000);
    for (const s of view.steps ?? []) await step(page, s, shoot);
    await shoot('');
  } catch (e) {
    result.ok = false;
    result.failure = String(e?.message ?? e).split('\n').slice(0, 6).join('\n');
    await shoot('failed').catch(() => {});
  }
  result.debugInfo = await debugInfo(page).catch(() => '');
  result.shaderReport = await page.evaluate(() => globalThis.shaders?.report?.() ?? null).catch(() => null);
  // Compilation messages arrive a moment after the module is made.
  await page.waitForFunction(() => (globalThis.__shots?.modules ?? []).every((m) => m.messages), null, { timeout: 10_000 }).catch(() => {});
  const rec = await page.evaluate(() => globalThis.__shots).catch(() => null);
  await page.close();
  const modules = new Map();
  for (const m of rec?.modules ?? []) {
    const k = hash(m.code);
    if (!modules.has(k)) modules.set(k, { hash: k, label: m.label, lines: m.code.split('\n').length, messages: m.messages ?? [{ type: 'error', message: 'no compilation info' }], code: m.code });
  }
  const bad = [...modules.values()].filter((m) => m.messages.some((x) => x.type === 'error' || x.type === 'warning'));
  for (const m of opts.wgsl === 'all' ? modules.values() : bad) {
    mkdirSync(join(out, 'wgsl'), { recursive: true });
    const notes = m.messages.map((x) => `// ${x.type} ${x.line}:${x.col} ${x.message}`).join('\n');
    writeFileSync(join(out, 'wgsl', `${m.hash}.wgsl`), (notes ? notes + '\n' : '') + `// label: ${m.label}\n` + m.code);
  }
  Object.assign(result, {
    shots, totalMs: Math.round(performance.now() - t0), adapter: rec?.adapter ?? null,
    wgsl: { modules: rec?.modules.length ?? 0, unique: modules.size, withMessages: bad.map(({ code, ...m }) => m) },
    gpuErrors: rec?.errors ?? [], pipelineErrors: rec?.pipelines ?? [], deviceLost: rec?.lost ?? null, console: consoleLines,
  });
  // A 3D view without a real adapter is a failure; the Lab draws no 3D.
  if (!rec?.adapter && view.query.includes('view=') && !view.query.includes('view=lab')) { result.ok = false; result.failure ??= 'no WebGPU adapter'; }
  if (rec?.adapter?.fallback) { result.ok = false; result.failure ??= 'a software (fallback) WebGPU adapter'; }
  if (bad.some((m) => m.messages.some((x) => x.type === 'error')) || result.gpuErrors.length || result.pipelineErrors.length || result.deviceLost) result.ok = false;
  return result;
}

// ---- publishing --------------------------------------------------------------------------------------------
/** Put `out` at `<id>/` on the `renders` branch as one parentless commit (the latest KEEP sets), and push it. */
function publish(out, id, summary) {
  const index = join(WORK, 'publish.index');
  rmSync(index, { force: true });
  const env = { GIT_INDEX_FILE: index };
  let previous = [];
  try {
    git(['fetch', '--quiet', 'origin', `+refs/heads/${BRANCH}:refs/shots/${BRANCH}`]);
    git(['read-tree', `refs/shots/${BRANCH}`], REPO, env);
    previous = JSON.parse(git(['show', `refs/shots/${BRANCH}:index.json`]));
  } catch { /* the first set */ }
  previous = previous.filter((p) => p.id !== id);
  const keep = [summary, ...previous].slice(0, KEEP);
  for (const p of previous.slice(KEEP - 1)) git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', p.id], REPO, env);
  git(['rm', '-r', '--cached', '--quiet', '--ignore-unmatch', id], REPO, env);
  const add = (file, path) => { const blob = git(['hash-object', '-w', file]); git(['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], REPO, env); };
  for (const e of readdirSync(out, { recursive: true, withFileTypes: true })) {
    if (e.isFile()) { const file = join(e.parentPath, e.name); add(file, `${id}/${relative(out, file).replaceAll('\\', '/')}`); }
  }
  const indexFile = join(WORK, 'index.json');
  writeFileSync(indexFile, JSON.stringify(keep, null, 2) + '\n');
  add(indexFile, 'index.json');
  const tree = git(['write-tree'], REPO, env);
  const commit = git(['commit-tree', tree, '-m', `renders: ${id}`], REPO);
  git(['push', '--quiet', '--force', 'origin', `${commit}:refs/heads/${BRANCH}`]);
  rmSync(index, { force: true });
  return commit;
}

// ---- one render, and the watcher -------------------------------------------------------------------------
const firstLine = (s) => String(s).split('\n')[0];
const timestamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

/**
 * Render `opts.ref` (or this checkout) and write the report; publish it with --publish. A failed build, or a request
 * that is wrong from the start (`refused`), still writes and publishes its report, so whoever asked learns why.
 */
async function render(opts, request = null, refused = null) {
  const t0 = performance.now();
  const stamp = timestamp();
  let src = null, names = [], failure = refused, out = null, id = opts.id;
  const results = [];
  try {
    if (refused) throw new Error(refused);
    src = prepare(opts.ref);
    id ??= `${stamp}-${src.sha.slice(0, 8)}`;
    out = join(WORK, 'out', id);
    rmSync(out, { recursive: true, force: true });
    mkdirSync(out, { recursive: true });
    // The views come from the ref being rendered, so a branch can add its own.
    const theirs = join(src.dir, 'scripts', 'shots', 'views.mjs');
    const { views } = await import(pathToFileURL(existsSync(theirs) ? theirs : join(HERE, 'views.mjs')).href + `?t=${src.sha}`);
    const problems = checkViews(views);
    if (problems.length) throw new Error(['views.mjs:', ...problems].join('\n'));
    names = pickViews(views, opts.views);
    const server = await serve(src.dir);
    const browser = await launch(opts.headed);
    try {
      for (const n of names) {
        log(`${n}…`);
        const r = await capture(browser, server.url, n, views[n], out, opts);
        results.push(r);
        const policy = /(\d+) violations/.exec(r.shaderReport ?? '')?.[1];
        log(`${n}: ${r.ok ? 'ok' : 'PROBLEM'} in ${(r.totalMs / 1000).toFixed(1)} s, ${r.wgsl.unique} shaders${policy && policy !== '0' ? `, ${policy} shader-policy violations` : ''}${r.failure ? ` — ${firstLine(r.failure)}` : ''}`);
      }
    } finally {
      await browser.close();
      if (!opts.keep) server.stop();
    }
  } catch (e) {
    failure = String(e?.message ?? e).slice(0, 4000);
    log(`failed: ${firstLine(failure)}`);
  }
  id ??= `${stamp}-failed`;
  out ??= join(WORK, 'out', id);
  mkdirSync(out, { recursive: true });
  const report = {
    id, request, ref: opts.ref ?? '(working tree)', sha: src?.sha ?? null, dirty: src?.dirty ?? false, subject: src?.subject ?? null, size: opts.size,
    adapter: results.find((r) => r.adapter)?.adapter ?? null, totalMs: Math.round(performance.now() - t0),
    ok: !failure && results.every((r) => r.ok), failure, views: results,
  };
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  log(`${report.ok ? 'all ok' : 'PROBLEMS'}: ${results.length} views in ${(report.totalMs / 1000).toFixed(1)} s → ${out}`);
  if (opts.publish) {
    const summary = { id, request, ref: report.ref, sha: report.sha, ok: report.ok, failure: failure ? firstLine(failure) : null, views: names, files: results.flatMap((r) => r.shots.map((x) => x.file)) };
    const commit = publish(out, id, summary);
    log(`published to ${BRANCH} (${commit.slice(0, 8)}): git fetch origin ${BRANCH} && git show origin/${BRANCH}:${id}/report.json`);
  }
  return report;
}

/** A request is a branch `shots-req/<who>/<views>` pointing at the commit to render (README). */
export const REQUEST_PREFIX = 'shots-req/';

/** The asker and the views of a request branch (`default` for the default set), or why its name is malformed. */
export function parseRequest(name) {
  const parts = name.slice(name.startsWith(REQUEST_PREFIX) ? REQUEST_PREFIX.length : 0).split('/');
  if (parts.length !== 2 || !/^[\w.-]+$/.test(parts[0]) || !/^[\w,-]+$/.test(parts[1])) return { who: 'bad', views: null, error: `a request is ${REQUEST_PREFIX}<who>/<view,view,…>, not ${name}` };
  return { who: parts[0], views: parts[1] === 'default' ? null : parts[1].split(',').filter(Boolean), error: null };
}

/** One watcher per machine: two would render every request twice and overwrite each other's `renders` pushes. */
function takeWatchLock() {
  const lock = join(WORK, 'watch.lock');
  mkdirSync(WORK, { recursive: true });
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    let alive = false;
    try { process.kill(pid, 0); alive = pid !== process.pid; } catch { /* gone */ }
    if (alive) throw new Error(`another watcher runs here (pid ${pid}); stop it first, or delete ${lock} if it is stale`);
  }
  writeFileSync(lock, String(process.pid));
  const drop = () => { try { if (readFileSync(lock, 'utf8') === String(process.pid)) rmSync(lock); } catch { /* already gone */ } };
  process.on('exit', drop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { drop(); process.exit(130); });
}

/**
 * Look for request branches every `interval` s; render, publish and delete each, in name order. Each request is
 * rendered at the commit it pointed to when seen, and deleted only if it still points there: a request pushed again
 * under the same name while the old one renders stays and is rendered next.
 */
async function watch(opts) {
  takeWatchLock();
  log(`watching ${REQUEST_PREFIX}* on origin every ${opts.interval} s (Ctrl+C stops)`);
  for (;;) {
    let requests = [];
    try {
      requests = git(['ls-remote', '--heads', 'origin', `${REQUEST_PREFIX}*`]).split('\n').filter(Boolean)
        .map((l) => { const [sha, ref] = l.split('\t'); return { sha, name: ref.replace('refs/heads/', '') }; })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    } catch (e) { log(`ls-remote failed: ${firstLine(e.message)}`); }
    for (const { sha, name } of requests) {
      const req = parseRequest(name);
      log(`request ${name} at ${sha.slice(0, 8)}`);
      await render({ ...opts, ref: sha, views: req.views, publish: true, id: `${timestamp()}-${req.who}` }, name, req.error)
        .catch((e) => log(`request ${name} failed: ${firstLine(e?.message ?? e)}`));
      try { git(['push', '--quiet', `--force-with-lease=refs/heads/${name}:${sha}`, 'origin', `:refs/heads/${name}`]); } catch (e) { log(`kept ${name} (pushed again meanwhile, or the delete failed): ${firstLine(e.message)}`); }
    }
    await new Promise((r) => setTimeout(r, opts.interval * 1000));
  }
}

// ---- main ----------------------------------------------------------------------------------------------------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.list) {
    const { views } = await import(pathToFileURL(join(HERE, 'views.mjs')).href);
    for (const [k, v] of Object.entries(views)) console.log(`${v.default ? '*' : ' '} ${k.padEnd(22)} ${v.about ?? ''}`);
    return;
  }
  if (opts.watch) return watch(opts);
  const report = await render(opts);
  process.exitCode = report.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(`[shots] ${e?.message ?? e}`); process.exitCode = 2; });

/**
 * Who holds the JS heap: a heap snapshot of the page, taken over the DevTools protocol on the render PC, and read here
 * without loading it whole (a big page's snapshot is larger than one JS string may be). It reports:
 *
 *  - the totals (V8's own heap figures, and what the snapshot counts by node type),
 *  - the classes holding most (self size; typed arrays' data counts as `native:system / JSArrayBufferData`),
 *  - the dominator tree down to everything holding at least `minMB`: each node's retained size and the edge it is
 *    held by, so a big array shows the path of property names that keeps it (`tiles.cache.built...`). Names in the
 *    build are minified; property names are not.
 *
 * Use it from a view (views.mjs) as `{ run: (page) => heapStep(page, 'label') }`: the report goes to the page's console
 * as one warning, which lands in report.json. Or on a saved snapshot: `node scripts/shots/heap.mjs file.heapsnapshot`.
 */
import { createReadStream, createWriteStream, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const MB = 1024 * 1024;

/** Take a snapshot of the page (after a full GC), analyse it, and write the report to the page's console. */
export async function heapStep(page, label, opts = {}) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  const usage = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  const perf = await page.evaluate(() => (performance.memory ? { usedJSHeapSize: performance.memory.usedJSHeapSize, totalJSHeapSize: performance.memory.totalJSHeapSize } : null));
  const file = join(tmpdir(), `solarpolis-${process.pid}-${label.replace(/\W+/g, '-')}.heapsnapshot`);
  const out = createWriteStream(file);
  const onChunk = ({ chunk }) => out.write(chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  const t0 = performance.now();
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await new Promise((r) => out.end(r));
  const tookMs = Math.round(performance.now() - t0);
  let text;
  try {
    text = report(await analyse(file), { minMB: opts.minMB ?? 4, label, extra: { usage, perf, snapshotMs: tookMs } });
  } finally {
    if (!opts.keep) rmSync(file, { force: true });
  }
  await cdp.detach().catch(() => {});
  await page.evaluate((t) => console.warn(t), text);
  return text;
}

/** Read a .heapsnapshot file: nodes, edges and (shortened) strings, streamed. */
export async function analyse(file) {
  // The header: everything before "nodes":[ is the snapshot's meta (small).
  let header = '';
  for await (const chunk of createReadStream(file, { encoding: 'latin1', highWaterMark: 1 << 16 })) {
    header += chunk;
    if (header.includes('"nodes":[')) break;
  }
  const meta = JSON.parse(header.slice(0, header.indexOf('"nodes":[')).replace(/,\s*$/, '') + '}').snapshot;
  const nf = meta.meta.node_fields.length, ef = meta.meta.edge_fields.length;
  const N = meta.node_count, E = meta.edge_count;
  const nodes = new Float64Array(N * nf), edges = new Uint32Array(E * ef);
  const strings = [];
  const MAXSTR = 160;

  // One pass over the bytes: the "nodes" and "edges" number arrays, then the "strings" array.
  let section = 'head', arr = null, k = 0, num = 0, inNum = false;
  let window = ''; // the last bytes outside arrays, to spot the next section's name
  let inStr = false, esc = false, raw = [], rawLen = 0;
  for await (const buf of createReadStream(file, { highWaterMark: 1 << 24 })) {
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (section === 'nums') {
        if (c >= 48 && c <= 57) { num = num * 10 + (c - 48); inNum = true; continue; }
        if (inNum) { if (arr) arr[k++] = num; num = 0; inNum = false; }
        if (c === 93) { section = 'between'; window = ''; } // ]
        continue;
      }
      if (section === 'strs') {
        if (inStr) {
          if (esc) { esc = false; if (rawLen < MAXSTR) { raw.push(c); rawLen++; } continue; }
          if (c === 92) { esc = true; if (rawLen < MAXSTR) { raw.push(c); rawLen++; } continue; }
          if (c === 34) { inStr = false; strings.push(decode(raw)); raw = []; rawLen = 0; continue; }
          if (rawLen < MAXSTR) { raw.push(c); rawLen++; }
          continue;
        }
        if (c === 34) inStr = true;
        else if (c === 93) section = 'done';
        continue;
      }
      if (section === 'done') break;
      window = (window + String.fromCharCode(c)).slice(-16);
      if (window.endsWith('"nodes":[')) { section = 'nums'; arr = nodes; k = 0; }
      else if (window.endsWith('"edges":[')) { section = 'nums'; arr = edges; k = 0; }
      else if (window.endsWith('"strings":[')) section = 'strs';
      else if (/"\w+":\[$/.test(window)) { section = 'nums'; arr = null; } // locations, samples: skipped
    }
  }
  return { meta: meta.meta, nf, ef, N, E, nodes, edges, strings };
}

/** A string from its raw JSON bytes (cut at MAXSTR: a cut escape is dropped). */
function decode(bytes) {
  let s = Buffer.from(bytes).toString('utf8');
  for (let t = 0; t < 3; t++) {
    try { return JSON.parse(`"${s}"`); } catch { s = s.slice(0, -1); }
  }
  return s;
}

/** The report: totals, classes, and the dominator tree down to `minMB`. */
export function report(snap, { minMB = 4, label = '', extra = {} } = {}) {
  const { meta, nf, ef, N, nodes, edges, strings } = snap;
  const fT = meta.node_fields.indexOf('type'), fName = meta.node_fields.indexOf('name'), fSelf = meta.node_fields.indexOf('self_size'), fEc = meta.node_fields.indexOf('edge_count');
  const eT = meta.edge_fields.indexOf('type'), eName = meta.edge_fields.indexOf('name_or_index'), eTo = meta.edge_fields.indexOf('to_node');
  const nodeTypes = meta.node_types[fT], edgeTypes = meta.edge_types[eT];
  const WEAK = edgeTypes.indexOf('weak'), SHORTCUT = edgeTypes.indexOf('shortcut');
  const ELEMENT = edgeTypes.indexOf('element'), HIDDEN = edgeTypes.indexOf('hidden');
  const self = (n) => nodes[n * nf + fSelf];
  const typeOf = (n) => nodeTypes[nodes[n * nf + fT]];
  const nameOf = (n) => strings[nodes[n * nf + fName]] ?? '?';

  // Forward edges (CSR by node), skipping weak and shortcut ones.
  const first = new Uint32Array(N + 1);
  for (let n = 0, e = 0; n < N; n++) { first[n] = e; e += nodes[n * nf + fEc]; first[n + 1] = e; }
  const strong = (e) => { const t = edges[e * ef + eT]; return t !== WEAK && t !== SHORTCUT; };
  const to = (e) => edges[e * ef + eTo] / nf;

  // Depth-first from the root (node 0): post order.
  const post = new Int32Array(N).fill(-1), order = new Uint32Array(N);
  const stack = new Uint32Array(N), cursor = new Uint32Array(N);
  const seen = new Uint8Array(N);
  let top = 0, count = 0;
  stack[top++] = 0; seen[0] = 1; cursor[0] = first[0];
  while (top) {
    const n = stack[top - 1];
    let pushed = false;
    while (cursor[n] < first[n + 1]) {
      const e = cursor[n]++;
      if (!strong(e)) continue;
      const m = to(e);
      if (seen[m]) continue;
      seen[m] = 1; cursor[m] = first[m]; stack[top++] = m; pushed = true;
      break;
    }
    if (!pushed) { top--; post[n] = count; order[count++] = n; }
  }

  // Retainers (reverse strong edges among reachable nodes), as CSR.
  const rc = new Uint32Array(N + 1);
  for (let n = 0; n < N; n++) if (seen[n]) for (let e = first[n]; e < first[n + 1]; e++) if (strong(e)) rc[to(e) + 1]++;
  for (let n = 0; n < N; n++) rc[n + 1] += rc[n];
  const fill = rc.slice(0, N), rfrom = new Uint32Array(rc[N]), redge = new Uint32Array(rc[N]);
  for (let n = 0; n < N; n++) if (seen[n]) for (let e = first[n]; e < first[n + 1]; e++) if (strong(e)) { const m = to(e); rfrom[fill[m]] = n; redge[fill[m]++] = e; }

  // Immediate dominators (Cooper, Harvey, Kennedy), by post-order numbers.
  const idom = new Int32Array(N).fill(-1);
  idom[0] = 0;
  const intersect = (a, b) => {
    while (a !== b) {
      while (post[a] < post[b]) a = idom[a];
      while (post[b] < post[a]) b = idom[b];
    }
    return a;
  };
  for (let changed = true, rounds = 0; changed && rounds < 50; rounds++) {
    changed = false;
    for (let i = count - 2; i >= 0; i--) {
      const n = order[i];
      let d = -1;
      for (let r = rc[n]; r < rc[n + 1]; r++) {
        const p = rfrom[r];
        if (idom[p] === -1) continue;
        d = d === -1 ? p : intersect(p, d);
      }
      if (d !== -1 && idom[n] !== d) { idom[n] = d; changed = true; }
    }
  }

  // Retained sizes: children before their dominators (ascending post order).
  const retained = new Float64Array(N);
  let reachable = 0, unreachable = 0;
  for (let n = 0; n < N; n++) { if (seen[n]) { retained[n] = self(n); reachable += self(n); } else unreachable += self(n); }
  for (let i = 0; i < count - 1; i++) { const n = order[i]; if (idom[n] >= 0 && idom[n] !== n) retained[idom[n]] += retained[n]; }

  // Totals by node type, and the top classes by self size.
  const byType = new Map(), byClass = new Map();
  for (let n = 0; n < N; n++) {
    const t = typeOf(n), s = self(n);
    byType.set(t, (byType.get(t) ?? 0) + s);
    const key = `${t}:${t === 'object' || t === 'native' || t === 'closure' || t === 'hidden' || t === 'synthetic' || t === 'array' ? nameOf(n).slice(0, 60) : ''}`;
    const c = byClass.get(key) ?? { size: 0, count: 0 };
    c.size += s; c.count++;
    byClass.set(key, c);
  }

  // The dominator tree down to minMB.
  const min = minMB * MB, kids = new Map();
  for (let n = 1; n < N; n++) if (seen[n] && retained[n] >= min) {
    const d = idom[n];
    if (!kids.has(d)) kids.set(d, []);
    kids.get(d).push(n);
  }
  const edgeName = (e) => {
    const t = edges[e * ef + eT], v = edges[e * ef + eName];
    return t === ELEMENT || t === HIDDEN ? `[${v}]` : String(strings[v] ?? v).slice(0, 40);
  };
  const heldBy = (n) => {
    const d = idom[n];
    for (let r = rc[n]; r < rc[n + 1]; r++) if (rfrom[r] === d) return `.${edgeName(redge[r])}`;
    const r = rc[n];
    return r < rc[n + 1] ? `(via ${label1(rfrom[r])}).${edgeName(redge[r])}` : '';
  };
  const label1 = (n) => `${typeOf(n)} ${JSON.stringify(nameOf(n).slice(0, 50))}`;
  const lines = [];
  const walk = (n, depth) => {
    const list = (kids.get(n) ?? []).sort((a, b) => retained[b] - retained[a]);
    for (const m of list) {
      if (lines.length >= 220) return;
      lines.push(`${'  '.repeat(Math.min(depth, 30))}${(retained[m] / MB).toFixed(1)} MB  ${heldBy(m)}  ${label1(m)}${self(m) >= MB ? `  (self ${(self(m) / MB).toFixed(1)} MB)` : ''}`);
      walk(m, depth + 1);
    }
  };
  walk(0, 0);

  const fmt = (b) => `${(b / MB).toFixed(1)} MB`;
  return [
    `HEAP ${label}`,
    `nodes ${N}, reachable ${fmt(reachable)}, unreachable ${fmt(unreachable)}; ${JSON.stringify(extra)}`,
    `by node type: ${[...byType].sort((a, b) => b[1] - a[1]).map(([t, s]) => `${t} ${fmt(s)}`).join(', ')}`,
    'top classes (self size):',
    ...[...byClass].sort((a, b) => b[1].size - a[1].size).slice(0, 40).map(([k, c]) => `  ${fmt(c.size)}  ×${c.count}  ${k}`),
    `dominator tree (retained ≥ ${minMB} MB):`,
    ...lines,
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node scripts/shots/heap.mjs <file.heapsnapshot> [minMB]'); process.exit(2); }
  console.log(report(await analyse(file), { minMB: Number(process.argv[3] ?? 4), label: file }));
}

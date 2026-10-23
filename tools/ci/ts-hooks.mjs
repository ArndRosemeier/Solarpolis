/**
 * TypeScript for the fast suite (`npm test`), in the test's own thread: Node's synchronous module hooks
 * (`module.registerHooks`) resolve imports the way the bundler does (no extension, a folder's index) and strip the types
 * with esbuild. It replaces `--import tsx` there because tsx names every function it compiles (esbuild `keepNames`: a
 * `__name` call, an `Object.defineProperty`, for every closure made, millions over the suite: over a second of the
 * 30 s budget) and answers each import from a worker thread. The browser build (Vite) never names them either, so the
 * tests run the code as the game does. Compiled files are kept under node_modules/.cache, by content.
 *
 * Node built-ins and esbuild only. Used as `node --import ./tools/ci/ts-hooks.mjs`.
 */
import { registerHooks } from 'node:module';
import { transformSync } from 'esbuild';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, 'node_modules/.cache/ts-hooks');
const TS = /\.(ts|tsx|mts|cts)$/;
const TRY = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.json'];
// The project's tsconfig targets ES2022: class fields defined as the standard says (as Vite builds them).
const TSCONFIG = { compilerOptions: { target: 'ES2022', useDefineForClassFields: true, verbatimModuleSyntax: false } };

const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** A relative or absolute import without its extension, or of a folder, as the bundler finds it (null: as Node does). */
function bundlerPath(specifier, parentURL) {
  if (!parentURL?.startsWith('file:') || !/^(\.{1,2}\/|\/|\.{1,2}$)/.test(specifier)) return null;
  const base = fileURLToPath(new URL(specifier, parentURL));
  if (isFile(base)) return null;
  for (const ext of TRY) if (isFile(base + ext)) return base + ext;
  // `./x.js` written for `./x.ts`.
  if (/\.(m?js)$/.test(base)) for (const ext of ['.ts', '.mts']) { const p = base.replace(/\.m?js$/, ext); if (isFile(p)) return p; }
  for (const ext of TRY) if (isFile(path.join(base, 'index' + ext))) return path.join(base, 'index' + ext);
  return null;
}

function compile(file) {
  const source = fs.readFileSync(file, 'utf8');
  const key = createHash('sha1').update(file).update('\0').update(source).digest('hex');
  const kept = path.join(CACHE, key + '.mjs');
  try { return fs.readFileSync(kept, 'utf8'); } catch { /* not compiled yet */ }
  const { code } = transformSync(source, {
    loader: file.endsWith('x') ? 'tsx' : 'ts', format: 'esm', target: `node${process.versions.node}`,
    sourcemap: 'inline', sourcefile: file, tsconfigRaw: TSCONFIG,
  });
  try { fs.mkdirSync(CACHE, { recursive: true }); fs.writeFileSync(kept, code); } catch { /* a cache is only a cache */ }
  return code;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    const found = bundlerPath(specifier, context.parentURL);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('file:')) {
      const file = fileURLToPath(url);
      if (TS.test(file)) return { format: 'module', source: compile(file), shortCircuit: true };
      // JSON imported as the bundler does, without `with { type: 'json' }`.
      if (file.endsWith('.json') && context.importAttributes?.type !== 'json') {
        return { format: 'module', source: `export default ${fs.readFileSync(file, 'utf8')};`, shortCircuit: true };
      }
    }
    return nextLoad(url, context);
  },
});

// Failures point at the TypeScript lines.
process.setSourceMapsEnabled(true);

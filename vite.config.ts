import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * The Actors asset pack (tools/actors/pack.mjs fetches it into .actors-pack/<version>/), served and built under
 * /actors/ (src/render/actors/pack.ts). The CMU mocap library stays out. ACTORS_PACK=skip builds without copying it
 * (the CI check, which only needs the code to build). Ported from Dunfinity vite.config.ts.
 */
function actorsPack(): Plugin {
  const version = (): string => JSON.parse(fs.readFileSync(path.resolve('node_modules/@actors/generator/package.json'), 'utf8')).version;
  const dir = (): string => path.resolve('.actors-pack', version());
  // The packs the game uses: people and the animals that live in it (no dogs or cats yet, Arnd, 2026-10-22).
  const PACKS = ['human', 'squirrel', 'deer'];
  const wanted = (rel: string): boolean => {
    const r = rel.split(path.sep).join('/');
    return r === '' || r === '.version' || (PACKS.includes(r.split('/')[0]) && !r.startsWith('human/clips/cmu'));
  };
  let outDir = 'dist';
  return {
    name: 'actors-pack',
    configResolved(config) { outDir = path.resolve(config.root, config.build.outDir); },
    configureServer(server) {
      server.middlewares.use('/actors/', (req, res, next) => {
        const root = dir();
        const file = path.join(root, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!file.startsWith(root + path.sep) || !wanted(path.relative(root, file)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
        res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream');
        res.end(fs.readFileSync(file));
      });
    },
    closeBundle() {
      if (process.env.ACTORS_PACK === 'skip') return;
      const root = dir();
      if (!fs.existsSync(path.join(root, 'human/manifest.json'))) throw new Error(`No Actors pack in ${root}: run node tools/actors/pack.mjs`);
      fs.cpSync(root, path.join(outDir, 'actors'), { recursive: true, dereference: true, filter: (src) => wanted(path.relative(root, src)) });
    },
  };
}

// `npm run build:publish` builds for a subpath: GitHub Pages names it (SOLARPOLIS_BASE, e.g. /Solarpolis/).
export default defineConfig(({ mode }) => ({
  base: mode === 'publish' ? (process.env.SOLARPOLIS_BASE ?? '/solarpolis/') : '/',
  plugins: [actorsPack()],
  server: { port: 5210 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  // One copy of three for the whole app and the shared packages: a second copy would split TSL's state.
  resolve: { dedupe: ['three'] },
}));

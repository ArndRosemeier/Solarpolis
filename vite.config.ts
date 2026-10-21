import { defineConfig } from 'vite';

// `npm run build:publish` builds for a subpath: GitHub Pages names it (SOLARPOLIS_BASE, e.g. /Solarpolis/).
export default defineConfig(({ mode }) => ({
  base: mode === 'publish' ? (process.env.SOLARPOLIS_BASE ?? '/solarpolis/') : '/',
  server: { port: 5210 },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  // One copy of three for the whole app and the shared packages: a second copy would split TSL's state.
  resolve: { dedupe: ['three'] },
}));

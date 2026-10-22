#!/usr/bin/env node
// Ported from Dunfinity tools/actors/pack.mjs.
// Fetches the Actors asset pack (bodies, skins, wardrobe, hair, clips) that matches the installed
// @actors/generator into .actors-pack/<version>/human, and the animal packs beside it (squirrel, deer;
// the dog and cat packs are left out of the build, vite.config.ts), once per version. Vite serves it under
// /actors/ and copies it into the build (vite.config.ts). The CMU mocap library (~200 MB) is left
// out: the game plays the pack's own clips.
//
// `node tools/actors/pack.mjs` (also run by `npm run dev` and `npm run build`). ACTORS_PACK_FILE
// points at an already downloaded actors-packs-<version>.tar.gz instead of downloading it.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
export const version = JSON.parse(readFileSync(join(root, 'node_modules/@actors/generator/package.json'), 'utf8')).version;
export const packDir = join(root, '.actors-pack', version);

if (existsSync(join(packDir, 'human/manifest.json'))) {
  console.log(`actors pack ${version}: ready in ${packDir}`);
} else {
  let archive = process.env.ACTORS_PACK_FILE;
  if (!archive) {
    archive = join(tmpdir(), `actors-packs-${version}-${process.pid}.tar.gz`);
    const url = `https://github.com/ArndRosemeier/Actors/releases/download/v${version}/actors-packs-${version}.tar.gz`;
    console.log(`actors pack ${version}: downloading ${url}`);
    execFileSync('curl', ['-fsSL', '--retry', '4', '-o', archive, url], { stdio: 'inherit' });
  }
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  // The archive holds packs/human/, packs/squirrel/, ...; keep them, without the CMU library.
  execFileSync('tar', ['-xzf', archive, '-C', packDir, '--strip-components=1', '--exclude=packs/human/clips/cmu'], { stdio: 'inherit' });
  if (!process.env.ACTORS_PACK_FILE) rmSync(archive, { force: true });
  writeFileSync(join(packDir, '.version'), version + '\n');
  console.log(`actors pack ${version}: unpacked to ${packDir}`);
}

// Packs of other versions (an older install, a restored CI cache) go.
for (const old of readdirSync(join(root, '.actors-pack'))) if (old !== version) rmSync(join(root, '.actors-pack', old), { recursive: true, force: true });

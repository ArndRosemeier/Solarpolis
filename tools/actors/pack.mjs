#!/usr/bin/env node
// Ported from Dunfinity tools/actors/pack.mjs.
// Fetches the Actors asset pack (bodies, skins, wardrobe, hair, clips) that matches the installed
// @actors/generator into .actors-pack/<version>/human, and the animal packs beside it (squirrel, deer;
// the dog and cat packs are left out of the build, vite.config.ts), once per version. Vite serves it under
// /actors/ and copies it into the build (vite.config.ts). Of the CMU mocap library (~200 MB) only the clips
// the game plays come along (src/render/actors/cmu.json), with an index of just those; a pack unpacked
// before a clip was added gets it on the next run.
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
const CMU = 'packs/human/clips/cmu';
const cmuDir = join(packDir, 'human/clips/cmu');
const wanted = [...new Set(Object.values(JSON.parse(readFileSync(join(root, 'src/render/actors/cmu.json'), 'utf8')).clips).map((c) => c.id))];

/** The pack's archive, downloaded once per run (or ACTORS_PACK_FILE), and whether it is ours to remove. */
let archive = null;
function archiveFile() {
  if (archive) return archive;
  if (process.env.ACTORS_PACK_FILE) return (archive = { file: process.env.ACTORS_PACK_FILE, own: false });
  const file = join(tmpdir(), `actors-packs-${version}-${process.pid}.tar.gz`);
  const url = `https://github.com/ArndRosemeier/Actors/releases/download/v${version}/actors-packs-${version}.tar.gz`;
  console.log(`actors pack ${version}: downloading ${url}`);
  execFileSync('curl', ['-fsSL', '--retry', '4', '-o', file, url], { stdio: 'inherit' });
  return (archive = { file, own: true });
}

/** Whether the CMU index lists every wanted clip and each one's file is there. */
function cmuReady() {
  const index = join(cmuDir, 'index.json');
  if (!existsSync(index)) return false;
  const names = new Set(JSON.parse(readFileSync(index, 'utf8')).clips.map((c) => c.file));
  return wanted.every((id) => names.has(`${id}.bin`) && existsSync(join(cmuDir, `${id}.bin`)));
}

if (existsSync(join(packDir, 'human/manifest.json'))) {
  console.log(`actors pack ${version}: ready in ${packDir}`);
} else {
  const { file } = archiveFile();
  rmSync(packDir, { recursive: true, force: true });
  mkdirSync(packDir, { recursive: true });
  // The archive holds packs/human/, packs/squirrel/, ...; keep them, without the CMU library.
  execFileSync('tar', ['-xzf', file, '-C', packDir, '--strip-components=1', `--exclude=${CMU}`], { stdio: 'inherit' });
  writeFileSync(join(packDir, '.version'), version + '\n');
  console.log(`actors pack ${version}: unpacked to ${packDir}`);
}

if (!cmuReady()) {
  const { file } = archiveFile();
  rmSync(cmuDir, { recursive: true, force: true });
  execFileSync('tar', ['-xzf', file, '-C', packDir, '--strip-components=1', `${CMU}/index.json`, ...wanted.map((id) => `${CMU}/${id}.bin`)], { stdio: 'inherit' });
  // The index of just those clips (and the rigs they use): Actors reads it to play them.
  const index = JSON.parse(readFileSync(join(cmuDir, 'index.json'), 'utf8'));
  const clips = index.clips.filter((c) => wanted.includes(c.file.replace(/\.bin$/, '')));
  const rigs = Object.fromEntries([...new Set(clips.map((c) => c.rig))].map((r) => [r, index.rigs[r]]));
  writeFileSync(join(cmuDir, 'index.json'), JSON.stringify({ ...index, rigs, clips }));
  console.log(`actors pack ${version}: ${clips.length} CMU clips`);
}
if (archive?.own) rmSync(archive.file, { force: true });

// Packs of other versions (an older install, a restored CI cache) go.
for (const old of readdirSync(join(root, '.actors-pack'))) if (old !== version) rmSync(join(root, '.actors-pack', old), { recursive: true, force: true });

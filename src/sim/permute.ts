/**
 * A seeded shuffle of 0 … n−1 that is never stored: `permute` sends an index to its place and `unpermute` brings it
 * back, both in a few hashes. The population uses it to deal out each day's outings: resident i goes where slot
 * `permute(i)` says, and the residents in a court's slots are found by `unpermute`, so every resident is in exactly
 * one place a day and either question is answered without looking at anyone else.
 *
 * A four-round Feistel network on the smallest even power of two that holds n, walked round until it lands below n
 * (cycle walking: on average under four steps). Pure.
 */
import { hashCombine } from '@futuremagic/core';

const ROUNDS = 4;

export interface Shuffle {
  readonly n: number;
  permute(i: number): number;
  unpermute(j: number): number;
}

export function shuffleOf(n: number, seed: number): Shuffle {
  let half = 1;
  while (2 ** (2 * half) < n) half++;
  const mask = 2 ** half - 1, keys: number[] = [];
  for (let r = 0; r < ROUNDS; r++) keys.push(hashCombine(seed, r + 1));
  const f = (x: number, r: number): number => hashCombine(keys[r], x) & mask;
  const encrypt = (x: number): number => {
    let l = Math.floor(x / (mask + 1)), r = x & mask;
    for (let k = 0; k < ROUNDS; k++) { const t = r; r = l ^ f(r, k); l = t; }
    return l * (mask + 1) + r;
  };
  const decrypt = (x: number): number => {
    let l = Math.floor(x / (mask + 1)), r = x & mask;
    for (let k = ROUNDS - 1; k >= 0; k--) { const t = l; l = r ^ f(l, k); r = t; }
    return l * (mask + 1) + r;
  };
  const walk = (x: number, step: (x: number) => number): number => {
    do x = step(x); while (x >= n);
    return x;
  };
  return { n, permute: (i) => walk(i, encrypt), unpermute: (j) => walk(j, decrypt) };
}

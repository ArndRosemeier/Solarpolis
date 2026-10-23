# Sounds and music (`node scripts/sound/make.mjs`)

Every sound in the game is generated from a prompt in [`sounds.json`](sounds.json) and lands in `public/sound`, with `public/sound/index.json` listing the files the player (`src/audio/sound.ts`) loads. The script is never part of CI: it needs an OpenRouter key and costs money (step 1, 2026-10-23: 31 sounds and 3 title takes for $0.95).

```
NODE_USE_ENV_PROXY=1 node scripts/sound/make.mjs --raw /mnt/project-files/audio/raw   # make what is missing, then cut all
node scripts/sound/make.mjs --only step/grass,bed/lake                                   # re-cut some from their raw takes
NODE_USE_ENV_PROXY=1 node scripts/sound/make.mjs --again bed/lake                        # a new take
node scripts/sound/make.mjs --dry                                                        # which models, how many takes
```

- The key is `$OPEN_ROUTER_KEY` (or `$OPENROUTER_API_KEY`); the script never prints it. `NODE_USE_ENV_PROXY=1` sends Node's fetch through the cloud container's proxy.
- Raw takes are kept in `--raw` (default `.sound-raw/`, git-ignored; the project keeps them in `/mnt/project-files/audio/raw`), so cutting again costs nothing.
- Models follow Arnd's preferences and are looked up when the script runs: sounds from the newest ByteDance Seed Audio (a text-to-speech model: a prompt must start with "The sound of", or it speaks the words), music from the newest Google Lyria Pro (audio comes only streamed). Audio is handled as bytes throughout.
- Kinds: `bed` (a long take, trimmed and levelled to −24 dBFS RMS, mono at 32 kHz, 64 kbit/s; the player crossfades it into a loop), `loop` (the same for a sound with a place, cut to its middle `seconds`, default 8: a drone's hum, a lift portal, the rush of flight), `steps` (a take of separate hits, cut into its `count` clearest: footsteps, hooves, saw strokes, clinks), `call` (one sound, trimmed, peak at −3 dBFS), `music` (−16 LUFS, streamed; stereo, or mono with `"mono": true` for music played at a place, such as a party's; only a take whose `out` is set goes into the game).
- Check new takes for voices before using them: Seed Audio speaks a prompt that does not start with "The sound of", and a quick listen by an audio model (a Gemini Pro; Flash misdescribes short effects) catches a take that went wrong.
- Listen to a new sound before it goes in. There is no model that can describe a sound reliably; a transcriber (`google/gemini-3.5-transcribe` returns nothing for a sound that has no speech in it) can at least tell whether a take turned into speech.

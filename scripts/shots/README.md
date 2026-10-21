# Real-GPU screenshots (`npm run shots`)

The cloud containers draw WebGPU in software (SwiftShader): a frame takes minutes and the device is lost after a few. Arnd's PC (an RTX 5070) draws the real thing in headless Chrome at 60 fps, so it is the render machine. This tool runs there; it is never part of CI.

```
npm run shots -- --ref claude/my-branch --views inside,outside-earth --publish
npm run shots -- --list
```

- `--ref <branch|sha>`: what to render. It is fetched into a clone of its own (`.render/src`), so the checkout the tool runs from is never touched. Without `--ref` the tool builds its own checkout as it is.
- `--views a,b` (or `all`): views from [`views.mjs`](views.mjs). Default: `title`, `lab`, `inside`, `outside`.
- `--size 1600x900` (the default), `--id <name>` (the result folder's name), `--wgsl all` (write every shader, not only those with messages), `--headed` (a visible window, for watching).
- `--publish`: push the result to the `renders` branch.

It builds with Vite (no typecheck: a branch that does not typecheck yet can still be looked at), serves the build, opens each view in a fresh page, waits until the view has its canvas, lets it settle, runs the view's steps and takes the picture. For every view it also records:

- the WebGPU adapter (a software adapter fails the view),
- every WGSL module the app compiles, with its compilation messages (errors and warnings fail the view and are saved under `wgsl/`),
- uncaptured WebGPU errors, failed pipelines and a lost device (each fails the view),
- console errors and warnings, the shader monitor's report (policy violations are listed, not failed), the debug menu's info block (fps, memory, tiles, clock, position).

A whole view takes about 6 s, a screenshot about 70 ms; rendering another ref adds a fetch, a build and, when the lock file changed, `npm ci`.

## Adding a view

Add it to [`views.mjs`](views.mjs) in your branch and ask for it by name: the tool reads `views.mjs` from the ref it renders. Steps press keys (`KeyboardEvent.code`), click debug menu items by label, look around with the right mouse button, turn the wheel, wait, take extra pictures, or run any Playwright code. `npm test` checks the catalogue.

## Reading results (from a cloud thread)

```
git fetch origin renders
git show origin/renders:index.json                       # the latest sets, newest first
git show origin/renders:<id>/report.json                 # what happened, per view
git show origin/renders:<id>/inside.png > /tmp/inside.png  # then look at the file
```

The `renders` branch is one commit without history holding the latest 20 sets, so it never grows. Never merge it.

## Asking for a render

The render helper is the thread "GPU rendering on Arnd's PC" in the Solarpolis project. Push your branch, then send that thread's session a message naming the ref and the views (and a size if it matters). It runs the tool with `--publish` and answers with the result's id and what it saw.

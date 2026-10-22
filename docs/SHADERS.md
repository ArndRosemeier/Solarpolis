# Shader policy

Shader compiles are the worst kind of stutter: the frame waits for a driver. Scale fought this for a long time and ended with strict rules; Dunfinity and SimWorld have them from the first commit, and so does Solarpolis.

## The rules

1. **Each shader compile blocks for under 100 ms.** Aim for about 10 ms.
2. **After the loading screen, shader builds take at most a third of the time, spread evenly: after a build of t ms the next waits 2t ms, and at most one per frame** (Arnd, 2026-10-22; it was 5 per second, 200 ms apart, which made a person's dozen 1–2 ms shadow builds take seconds).
3. **Nothing compiles on the render path.** An object enters the scene only after its shaders are ready.
4. **One build per kind, not per copy.** The same shader built again for every person, tile or plant is how stalls keep coming back. The monitor hashes the code of every build and names the same code built more than once after warm-up (`shaders.repeats()`, in `shaders.report()`, the debug menu's shader line and every render report on Arnd's PC). Share the material or node so the next copy hits the cache.

## How the code keeps them

The renderer foundation (the Stage, the compile cap, the renderer hooks and the build monitor) comes from `@futuremagic/stage` in the AssetGenerator packages (from Dunfinity), so all of Arnd's games share one copy.

| Piece | What it does |
|---|---|
| Material registry (`src/render/materials.ts`) | Every material is a *kind* from a closed list, and every mesh of a kind shares one material. Variation goes in vertex attributes or uniforms, never in a new material. |
| Stage | `warmUp()` compiles every kind against the real scene behind the loading screen, then the cap switches on. `add(obj)` compiles an object first and only then puts it into the scene. `warmLater` compiles under the cap in the background. |
| Cap | Hands out build slots: `share` (1/3) of the time, a build of t ms followed by 2t ms without one, one per frame. `slot()` resolves to a `release` to call once the build is done (its time sets the wait). |
| Renderer hooks | The safety net on three r186 internals: async builds queue behind the cap; an uncompiled pipeline is skipped until ready. |
| Monitor | Records every build; breaches show in the debug menu. |

## What you must do

- **A new look is a new kind** in the material registry.
- **Lights are a fixed pool** (`src/render/lights.ts`: one directional key light and one ambient sky light), made before the warm-up: the number and order of lights is part of every lit shader's cache key. The kinds do not use them (the sunline lights them inside their own shaders); they light what three.js's own materials draw, Actors' bodies. The key light casts the one near shadow map; kinds use it only through `sunShadow` (`lights.ts`), which is a plain 1 in the shadow pass: three's shadow pass draws a caster with its `colorNode`'s alpha, and a pass that samples the map it draws is invalid in WebGPU.
- **Humans are the one exception to the registry** (as in Dunfinity): Actors (`@actors/three/webgpu`'s `nodeMaterials`, for `Figure`s) makes their node materials (skin, eyes, hair, garments). A figure enters with `stage.add`, which compiles it under the cap first.
- **Actors' animals** draw their bodies with Actors' node materials the same way, except their fur and eyes: those are registry materials made once and shared (`furMaterial()`, `furMaterial(true)` for a deer's spots, `animalEyeMaterial()` in `materials.ts`; the coat baked per vertex, `gen/coat.ts`, since Actors' fur shells are WebGL-only GLSL). They are not kinds of the warm-up: an animal's figure is compiled with `stage.prepare` before it is shown.
- **Put things into the scene with `stage.add`** (or `stage.prepare` for your own groups), never plain `scene.add` for anything with a new material or geometry layout.
- **Never** construct a material outside the registry, use `onBeforeCompile`, or call `renderer.compile*` outside the Stage. `npm test` fails on all three (`tools/guards/rules.json`).
- **WebGPU only**: no `forceWebGL`, no WebGL context, no fallback path.
- **Textures sampled with `.grad()`, `.level()` or plain sampling must be filterable**, placeholders included: three r186's WGSL builder declares no sampler for a texture with nearest min and mag filters, but `.grad()` still samples through one, so the pipeline fails to compile in WebGPU only (WebGL hides it). Give stand-ins `LinearFilter`, as `blank()` in `src/render/skyShaders.ts` does.
- **Check new shaders in WebGPU, not only in a screenshot**: dump each material's WGSL with `renderer.debug.getShaderAsync` and validate it with `createShaderModule` + `getCompilationInfo` on a fresh device, and render a frame watching for uncaptured validation errors. Headless WebGL hides WebGPU-only failures. `npm run shots` on the render PC does all of this for every module the app compiles in the views it captures (scripts/shots/README.md).
- **Textures a worker fills in later are placeholders updated in place** (the bark and leaf atlases: `setFoliage` in `materials.ts` copies into the `DataTexture`s the kinds were built with and sets `needsUpdate`), so no shader is built again when they arrive.
- **A texture array's layer index is an integer from the start** (`int(k)`, not `float(k).toInt()`): three r186 drops the conversion when a float index feeds `.depth()` in `.grad()` sampling, and WGSL refuses the shader (`floorSurface` in `groundShaders.ts`).
- **A figure's shadow shaders are its own**: prepare it with `{ everyCaster: true }`, only the parts it wears casting, and see-through two-sided parts casting from one side (three draws those in two passes, two shader builds in one slot). `loadPlayer` in `view.ts` does all three.
- **Alpha-tested kinds mask the shadow pass too** (`LEAF`, `HULL`: `maskNode`, which three's shadow pass uses when there is no `maskShadowNode`), so shadows are leaf-shaped and a dissolved crown edge casts none.

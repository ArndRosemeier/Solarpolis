# Shader policy

Shader compiles are the worst kind of stutter: the frame waits for a driver. Scale fought this for a long time and ended with strict rules; Dunfinity and SimWorld have them from the first commit, and so does Solarpolis.

## The rules

1. **Each shader compile blocks for under 100 ms.** Aim for about 10 ms.
2. **After the loading screen, at most 5 new shaders per second, at least 200 ms apart, and at most one per frame.**
3. **Nothing compiles on the render path.** An object enters the scene only after its shaders are ready.

## How the code keeps them

The renderer foundation (the Stage, the compile cap, the renderer hooks and the build monitor) comes from `@futuremagic/stage` in the AssetGenerator packages (from Dunfinity), so all of Arnd's games share one copy.

| Piece | What it does |
|---|---|
| Material registry (`src/render/materials.ts`) | Every material is a *kind* from a closed list, and every mesh of a kind shares one material. Variation goes in vertex attributes or uniforms, never in a new material. |
| Stage | `warmUp()` compiles every kind against the real scene behind the loading screen, then the cap switches on. `add(obj)` compiles an object first and only then puts it into the scene. `warmLater` compiles under the cap in the background. |
| Cap | Hands out build slots: at most 5 per second, at least 200 ms apart, one per frame. |
| Renderer hooks | The safety net on three r186 internals: async builds queue behind the cap; an uncompiled pipeline is skipped until ready. |
| Monitor | Records every build; breaches show in the debug menu. |

## What you must do

- **A new look is a new kind** in the material registry.
- **Lights are a fixed pool** (`src/render/lights.ts`: one directional key light and one ambient sky light), made before the warm-up: the number and order of lights is part of every lit shader's cache key. The kinds do not use them (the sunline lights them inside their own shaders); they light what three.js's own materials draw, Actors' bodies.
- **Humans are the one exception to the registry** (as in Dunfinity): Actors (`@actors/three/webgpu`'s `nodeMaterials`, for `Figure`s) makes their node materials (skin, eyes, hair, garments). A figure enters with `stage.add`, which compiles it under the cap first.
- **Put things into the scene with `stage.add`** (or `stage.prepare` for your own groups), never plain `scene.add` for anything with a new material or geometry layout.
- **Never** construct a material outside the registry, use `onBeforeCompile`, or call `renderer.compile*` outside the Stage. `npm test` fails on all three (`tools/guards/rules.json`).
- **WebGPU only**: no `forceWebGL`, no WebGL context, no fallback path.
- **Textures sampled with `.grad()`, `.level()` or plain sampling must be filterable**, placeholders included: three r186's WGSL builder declares no sampler for a texture with nearest min and mag filters, but `.grad()` still samples through one, so the pipeline fails to compile in WebGPU only (WebGL hides it). Give stand-ins `LinearFilter`, as `blank()` in `src/render/skyShaders.ts` does.

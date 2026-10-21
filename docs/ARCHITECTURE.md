# Seam index

Each row is a question you will have while coding, and the one place that answers it. Before writing a helper, look here. A new seam gets its row in the same PR. *Planned* rows name the seam to build when it is needed.

## The habitat blueprint (`src/blueprint`, pure)

| Question | The one way |
|---|---|
| What are the inputs that define a habitat? | `HabitatParams` (`params.ts`). Add a field there, never a constant elsewhere. |
| What follows from them (spin, hull, light, heat, population...)? | `derive(params)` → `Habitat` (`derive.ts`). |
| How strong is gravity, or how dense is the air, at a radius? | `habitat.gravityAt(r)`, `habitat.pressureAt(r)`. |
| How far does a dropped thing drift (Coriolis)? | `habitat.dropOffset(h)`. |
| What shape is the inside (floor, endcap slopes)? | `habitat.profile` (`makeProfile`, `profile.ts`): the meridian curve, sampled by arc length `s`. |
| Where is a point in the world, and back? | `toWorld(profile, {theta, s, h})`, `fromWorld(profile, x, y, z)`, `groundNormal` (`frame.ts`). World axis is +z from the wild wall (z = 0) to the port wall (z = L); spin is +θ. |
| Is this habitat buildable, and what is odd about it? | `validate(habitat)` → findings `invalid` / `unusual`; `isValid` (`validate.ts`). |
| Which habitats do tests run on? | `MATRIX` and `REFERENCE`, `withParams` (`reference.ts`). |

## Generating the habitat (`src/gen`, pure)

| Question | The one way |
|---|---|
| How high is the ground at (θ, s), and what is it (meadow, forest, rock, shore, lake bed)? | `makeTerrain(habitat)` (`terrain.ts`): `heightAt`, `standAt` (ground or water surface), `colorAt`, `lake`; sizes from `HabitatParams.relief`. Noise is sampled at world positions, so it wraps. |
| What hides the sunline from a ground point? | `horizonAt(terrain, θ, s)` (`horizon.ts`): the horizon angles toward the port and the wild end, from the ground in the point's meridian; tiles bake them per point (`TileMesh.horizon`). |
| How is the ground cut into pieces for drawing, and which pieces does a view need? | The tile tree (`tiles.ts`): `makeLayout` (bands along s, columns by circumference), `roots`, `children`, `parent`, `select(terrain, layout, eye, pixelsPerRadian, maxPixels, errorOf)` by measured error on screen, `buildTile` (mesh relative to its `origin`, skirts, water, `morph` towards the parent's surface). |

## Being in the habitat (`src/world`, pure)

| Question | The one way |
|---|---|
| How much light from the sunline reaches a point? | `irradiance(h, emission, p, n, towardPort, towardWild)` (`sunline.ts`), the reference of the shaders' sum; `sunlineEmission(h)` is the brightness along the axis (the day cycle will shape it), `sunlineNorm(h)` makes the mid floor 1. |
| Where is the player, which way is up, where do they look? | `Walker` (`walker.ts`): position in (θ, s, h), heading and pitch → `view()` eye, look, up (up is the ground's normal). `startOf(profile)` is where a walk begins; the eye stands on a ground function (`terrain.standAt`). |

## Drawing (`src/render`)

| Question | The one way |
|---|---|
| How do I get a renderer? | `createRenderer(canvas, { backends: 'webgpu', depth: 'reversed' })` from `@futuremagic/stage`, called once in `view.ts`. |
| How does a mesh get a material? | A kind from `materials.ts` (`GROUND`, `WATER`, `SUNLINE`, `allKinds`; own attributes on warm-up stand-ins via `standInAttribute`); the mesh carries exactly the kind's attributes. |
| How does a thing enter the scene? | `stage.add(obj)` (the Stage from `@futuremagic/stage`, made in `view.ts`). |
| How are things lit? | By the sunline as a line light, in the kinds' shaders (no three.js lights): `sunlit(horizon)` in `materials.ts` integrates the emission texture along the axis past the two horizon angles, plus `air.skyLight` scaled by the open sky. `setSunline` loads a habitat's emission, scale and length. |
| How does distance look? | `air` uniforms in `materials.ts` (haze colour, extinction from `HAZE_DIAMETER`); every kind sees through the air. |
| Where does the camera sit, given the huge distances? | At the origin: meshes are placed at `frame.toView(eye, origin)` (float64), and shaders get the world eye from `view.eye` (`materials.ts`). |
| How does the terrain reach the screen? | `TerrainView` (`render/terrain.ts`): `follow(eye, pixelsPerRadian)` each frame selects tiles, asks the worker pool for missing ones, caches and evicts; sets each tile's `userData.morphFar` so GROUND geomorphs it into its parent's shape before they swap. |
| What is drawn inside? | `InteriorView` (`view.ts`): terrain tiles, sunline, walker camera. |

## Workers (`src/workers`)

| Question | The one way |
|---|---|
| How does heavy generation run off the main thread? | `WorkerPool.job(request)` (`pool.ts`), the only `new Worker`; requests and answers are typed in `gen.worker.ts`, buffers are transferred. |

## The app (`src/app`)

| Question | The one way |
|---|---|
| How do I report memory I hold, or give it back under pressure? | `memory.track(owner, bytes)`, `memory.onPressure('soft' \| 'hard', shed)` (`memory.ts`). Only `browserHeap` reads `performance.memory`. |
| Where do developer tools go? | The debug menu: `debug.add`, `debug.addInfo` (`debug.ts`, made in `main.ts`). |
| What version is this, and what changed? | `VERSION`, `whatsNewButton` (`whatsNew.ts`), from `CHANGELOG.md` (`changelog.ts`). |
| How do habitat parameters go into and out of a URL? | `habitatFromUrl`, `habitatToUrl`, `URL_FIELDS` (`params.ts`). |
| How do I make a DOM element? | `el(tag, className, text)` (`dom.ts`). |

## Planned

| Question | The one way (to build) |
|---|---|
| Which way is up, and how strong is gravity, at a world point? | `world.upAt(p)`, `world.gravityAt(p)` (`src/world`), from the blueprint. |
| How is a person or a robot made? | Arnd's Actors package (`Figure`, humanoid robot bodies). |
| Who lives here, and what are they doing now? | Derived from seed + clock (`src/sim`); only touched people are simulated. |

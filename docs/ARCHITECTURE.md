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
| What does the whole interior surface look like from afar? | `buildSurface(habitat, cells?)` (`surface.ts`): the profile swept around the axis, sized by a cell budget (`SURFACE_CELLS`), seeded ground colours. |

## Being in the habitat (`src/world`, pure)

| Question | The one way |
|---|---|
| Where is the player, which way is up, where do they look? | `Walker` (`walker.ts`): position in (θ, s, h), heading and pitch → `view()` eye, look, up (up is the ground's normal). `startOf(profile)` is where a walk begins. |

## Drawing (`src/render`)

| Question | The one way |
|---|---|
| How do I get a renderer? | `createRenderer(canvas, { backends: 'webgpu', depth: 'reversed' })` from `@futuremagic/stage`, called once in `view.ts`. |
| How does a mesh get a material? | A kind from `materials.ts` (`GROUND`, `SUNLINE`, `allKinds`); the mesh carries exactly the kind's attributes. |
| How does a thing enter the scene? | `stage.add(obj)` (the Stage from `@futuremagic/stage`, made in `view.ts`). |
| How are things lit? | From the axis, in the kinds' shaders (no three.js lights): the sunline lights every point from the axis direction, plus `air.skyLight`. |
| How does distance look? | `air` uniforms in `materials.ts` (haze colour, extinction from `HAZE_DIAMETER`); every kind sees through the air. |
| What is drawn inside? | `InteriorView` (`view.ts`): surface, sunline, walker camera. |

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
| Where does the camera sit, given the huge distances? | `frame.toView` (camera-relative floats; needed once detail is drawn at the centimetre scale far from the origin). |
| What is the ground like close up? | Chunks in (θ, s) with their own seeds (`src/gen`), replacing the coarse surface near the viewer. |
| How is a person or a robot made? | Arnd's Actors package (`Figure`, humanoid robot bodies). |
| Who lives here, and what are they doing now? | Derived from seed + clock (`src/sim`); only touched people are simulated. |

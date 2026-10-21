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
| What does the habitat look like from outside (endcap faces, radiator brims, dock spindle, mast)? | `habitat.exterior` (`makeExterior`, `exterior.ts`), sized from the heat in `derive`; shape inputs in `HabitatParams.exterior`. |
| How far is a point from the habitat's outside? | `exteriorDistance(habitat.exterior, p)` (`exterior.ts`): the nearest of `exterior.pieces` (drum, brims, spindle, mast), negative inside. |
| How much of the skin pipes light in, and how much makes power? | `habitat.collectorShare` (`derive.ts`): light collectors sized to the piped light (`pipedLight`, `collectorEfficiency`, `SUNLIGHT_VISIBLE`); the rest of the skin is solar cells (`solarPower`). |
| Is this habitat buildable, and what is odd about it? | `validate(habitat)` → findings `invalid` / `unusual`; `isValid` (`validate.ts`). |
| Which habitats do tests run on? | `MATRIX` and `REFERENCE`, `withParams` (`reference.ts`). |

## Generating the habitat (`src/gen`, pure)

| Question | The one way |
|---|---|
| How high is the ground at (θ, s)? | `makeTerrain(habitat)` (`terrain.ts`): `heightAt`, `standAt` (ground or water surface), `waterDepth(p)`, `lake`; sizes from `HabitatParams.relief`. Noise is sampled at world positions, so it wraps. |
| What grows where, and what colour is the ground? | `makeEcology(terrain)` (`gen/ecology.ts`): `biomesAt(θ, s, h, slope, out)` (shares of the climate's biomes), `moistureAt`, `colorAt` (biomes, then sand, lake bed and rock; with a `canopy` array also the woods' canopy layer: colour from afar and height, from `canopyOf(biome)`), `nearestWood` (debug Go entries). With a `floor` array, each point's shares of the `FLOOR_LAYERS` (grass, litter, sand, rock …: 0–255, 8 per point), from each biome's `floor` and the same overlays; tiles carry them as `floorA`/`floorB`. The biomes and where each is planted come from the habitat's climate: `CLIMATES` / `climateOf(name)` in `blueprint/climates.ts`, named by `HabitatParams.climate` (an unknown name is an invalid habitat). Sizes are shares of the radius. |
| What plants are there, and what do they look like? | Each biome's `plants` (`PlantSpec` in `blueprint/climates.ts`: one of `PLANT_FORMS`, height and spacing in metres). `buildTree(form, seed, variant, detail)` (`gen/trees.ts`, ported from Scale): one unit high, wood (bark-atlas uv), leaf cards (leaf-atlas uv, tint, occlusion), crown hull; `LITE_DETAIL` for the lighter tree. Textures: `barkAtlas()` (`gen/foliage.ts`) and `leafAtlas()` (`workers/leaves.ts`, OffscreenCanvas), both drawn in a worker (`kind: 'foliage'`); shapes too (`kind: 'tree'`). |
| Where does each plant stand, and at which level is it drawn? | `gen/scatter.ts`: each plant's own lattice (any cell size gives the same plants). `LEVELS` (full, lite, hull) with their fade bands in sight units (`unit(spec)`); `plantsOf(ecology)` (species with per-level cell sizes and bands in metres), `canopyBand(ecology)` (where the ground's canopy takes over the woods), `cellsNear(ecology, species, level, eye)`, `plantCell(ecology, plants, key)` (instances per shape, `PLANT_STRIDE` floats each), `cellBytes`. Runs in the generation workers (`kind: 'plants'`). |
| What hides the sunline from a ground point? | `horizonAt(terrain, θ, s)` (`horizon.ts`): the horizon angles toward the port and the wild end, from the ground in the point's meridian; tiles bake them per point (`TileMesh.horizon`). |
| How is the ground cut into pieces for drawing, and which pieces does a view need? | The tile tree (`tiles.ts`): `makeLayout` (bands along s, columns by circumference), `roots`, `children`, `parent`, `select(terrain, layout, eye, pixelsPerRadian, maxPixels, errorOf)` by measured error on screen, `buildTile` (mesh relative to its `origin`, skirts, water, `morph` towards the parent's surface). |
| What is each panel of the outer skin (solar cell, light collector, starfloor window), how old, how does it look? | `makeSkin(habitat)` (`skin.ts`): `panelAt(skin, i, j)`, `panelOf(skin, p)`, `lookOf`, `isCollector`, `campaignAt`, from integer hashes of the skin's seed; the shader (`render/hullShaders.ts`) mirrors the same hashes bit for bit, so the interior's starfloor rooms read the windows here. `columnsOf` and `skinFlux` give a far habitat's light (its glint). |
| Where are the maintenance drones and their tracks? | `isTrack(skin, i)`, `tracksOf`, `dronesAt(skin, t)` (`skin.ts`): a track in the seam below every `exterior.drones.trackEvery`-th column, each drone back and forth over its own stretch, from seed and clock. `trackMean` is how the far view counts them. |
| What ground does the physics stand on? | `buildPatch(terrain, θ, s, size, cell)` (`patch.ts`): a square trimesh of the ground around a point, relative to its `origin`; built in the worker pool (request kind `'patch'`). |
| What does the skin look like up close (bays, modules, beams, bolts, cables)? | `gen/hullDetail.ts`: each skin panel is a bay of `Skin.modules`² solar modules (`exterior.parts`: module and cell size); `skinGrid`/`skinEye` lay it out for the detail tree (`wantedTiles(skin, eye)`), `buildHullTile(skin, key)` one tile's glass (with its `grid` attribute) and parts, more of them the smaller the tile (`detailOf`, sizes in `PART` as shares of bay, module or track). Each tile owns its parts exactly (`cellsOf` cuts: areas cut, bars by their middle line, fittings by their centre), so any two levels meet. Built in the worker pool as the first part of `detailParts` (request kind `'hull'`, part `'skin'`). `railTop` is where the drones ride. |
| How does detail come in as the eye comes closer (any surface or part)? | `gen/detailTree.ts` (pure): a part lays its cells out as a `Grid` (around, wrapping or not, and along; root and finest levels); `wantedCells(grid, eye)` is the quadtree around a `GridEye` (split within `SPLIT` × a tile's edge, roots within `reachOf(grid)`), `cellsOf(grid, key)` the cells a tile holds with what it owns of each (`CellCut`), `coverOf(wanted, built)` what to draw while tiles stream in (a parent until all its children are built) and whether a part is wholly covered. Every detailed part uses it; never a quadtree of its own. |
| What does the hardware look like up close (spindle plating, berth arms, mast, dishes)? | `gen/hullParts.ts` (pure): `detailParts(habitat, skin)` lists every detailed part with its frame (`'body'` or the despun `'spindle'`), its `Grid` and its `Place`; `partEye`/`partDistance`/`partTiles` place an eye over it, `buildPartTile(habitat, skin, part, key)` builds one tile (the skin's through `buildHullTile`), more parts the smaller the tile (`partDetail`, sizes in `PLATING`, `TRUSS`, `DISH` as shares of the plate, truss width or dish diameter, `exterior.parts.handrail` for what people hold). A truss's or dish's root tile (`wholeTile`) is the whole part and is its far form too. `antennas(habitat)` places the dishes and the mast's whips. |
| How do I build a mesh as plain arrays (in a worker, or for the renderer)? | `Shape` (`gen/shapes.ts`, pure): `band`, `box`, `block` (any axes), `quad`, `prism`, `sweep`, `append`, `arrays`; `bytesOf(arrays)` for what built arrays hold. The renderer's `ShapeBuilder` (`render/geometry.ts`) is a `Shape` with `build()`. |

## Being in the habitat (`src/world`, pure)

| Question | The one way |
|---|---|
| How thick is the air, and how much haze lies between two points? | `world/air.ts`: `densityFalloff(h)` from the blueprint's `pressureAt`, `hazeAlong(h, emission, extinction, sky, eye, p)` (transmittance and in-scatter, the shaders' reference). |
| How does the camera fly? | `Flyer` (`flyer.ts`): world eye, look and up; up swings toward the axis (rolls over when crossing it), speed grows with height, never below the ground. `walker.land(θ, s, look)` sets down under it. |
| How much light from the sunline reaches a point? | `irradiance(h, emission, p, n, towardPort, towardWild)` (`sunline.ts`), the reference of the shaders' sum; `sunlineEmission(h, t)` is the brightness along the axis at clock time t (the travelling sun, `HabitatParams.day`), `dayPhase`, `dayLevel`, `emissionMean`, `sunlineNorm(h)` makes the mid floor 1. `lightVector(h, emission, p, port, wild, norm)` is the same light as one direction and strength (for three.js's own lights); `lightShares(...)` splits it into equal shares along the axis (the shadow filter's rays). |
| How does something move in the turning habitat? | `apparentAcceleration(h, p, v)` (`motion.ts`): centrifugal plus Coriolis in the habitat's own frame (Ω = +ω ẑ); `coast` is the RK4 reference the physics is tested against. |
| Which way is up, and how strong is gravity, at a world point? | `upAt(p)` (`motion.ts`): toward the axis (null on it); strength `habitat.gravityAt(r)`. Up never follows the ground's slope. |
| Where is the player, which way is up, where do they look? | `Walker` (`walker.ts`): position in (θ, s, h), heading (0 = +z) and pitch → `view()` eye, look, up (`upAt`); `stride(input)` is the velocity the keys ask of the physics body, `follow(feet)` stands on it; it glides only until the physics has ground. `startOf(profile)` is where a walk begins; the eye stands on a ground function (`terrain.standAt`). |

## Space around the habitats (`src/space`, pure)

| Question | The one way |
|---|---|
| What time is it in the sky? | The sim clock is seconds since `SpaceParams.epochJd`; `jdAt`, `julianDay`, `centuries` (`time.ts`). |
| Where are the Sun, Earth and Moon, and which way does Earth face? | `earthAt`, `moonAt`, `moonFromEarthAt`, `earthAxesAt`, `eclipticAxesAt` (`ephemeris.ts`), J2000 ecliptic, metres. Physical constants of the real bodies live in `constants.ts`. |
| How do I get a position from one frame to another? | `space.frames.position(p, from, to, t)`, `.direction`, `.relative` (`frames.ts`), float64, via the nearest common frame. Ids: `sun`, `earth`, `earth.fixed`, `moon`, `<habitat>.orbit`, `<habitat>.body` (the blueprint frame of `toWorld`). Then `toView` for the GPU. |
| Which habitats exist, and where? | `makeSpace(params).habitats` from `necklace()` (`necklace.ts`): the geostationary ring, home first, neighbours seeded from the world seed. `REFERENCE_SPACE` (`reference.ts`). |
| How do rotations and poses compose? | `Mat3`, `Pose`, `compose`, `invert`, `rotX`, `rotZ` (`pose.ts`). |
| What does the sky hold from a point (Sun, Earth, Moon, eclipses)? | `skyFrom(space, frame, eye, t)` → `SkyView` (`sky.ts`): directions, sizes, body axes, `sunlight` (share of the Sun's disc not hidden); `sunlightFrom(sun, earth, moon)` for any point given the centres relative to it. |
| How does the camera fly outside? | `SpaceFlyer` (`flyer.ts`): float64 eye in one frame, speed a share of the clearance to the nearest body, never closer than `MIN_CLEARANCE`, never beyond `MAX_RANGE`. |
| What does a ship look like? | `torchShip(ShipParams)` → `ShipShape` (`ship.ts`): parts along the ship's x axis (drive exit at 0, nose at `length`), the plume's length and radius. `TORCH_SHIP` is the title flight's. |
| How is the title flight framed? | `attractLoop(space, start, keepOut, shipLength)` → `Cinema.at(elapsed)` (`cinema.ts`): eye, target, up, fov, the ship's pose and throttle, the title's fade, shot by shot, every distance in outer radii. `chooseStart` picks the moment (habitat in sunlight, Earth gibbous behind it). |
| Where are the stars, how bright, what colour? | `decodeStars(bytes)` (`stars.ts`) on `public/sky/stars.bin` (Hipparcos to magnitude 8, J2000 ecliptic directions, flux relative to the Sun). `calendarOf(jd)` turns a date back into the calendar. |

## Drawing (`src/render`)

| Question | The one way |
|---|---|
| How do I get a renderer? | `createRenderer(canvas, { backends: 'webgpu', depth: 'reversed' })` from `@futuremagic/stage`, once per view (`view.ts`, `outside.ts`). |
| How does a mesh get a material? | A kind from `materials.ts` (`GROUND`, `WATER`, `SUNLINE`, `BALL`, `BARK`, `LEAF`, `HULL`, `allKinds`; own attributes on warm-up stand-ins via `standInAttribute`); the mesh carries exactly the kind's attributes. |
| How does a thing enter the scene? | `stage.add(obj)` (the Stage from `@futuremagic/stage`, made in `view.ts`). |
| How are things lit? | By the sunline as a line light, in the kinds' shaders (no three.js lights): `sunlit(horizon)` in `materials.ts` integrates the emission texture along the axis past the two horizon angles, plus `air.skyLight` scaled by the open sky. `setSunline` loads a habitat's scale and length, `setEmission` the hour's emission profile. |
| How does distance look? | `throughAir` in `materials.ts`: every kind sees through the air, marched per pixel in `HAZE_STEPS` pieces with the sunline's halo integrated exactly; `air` (colour, extinction from `HAZE_DIAMETER`, sky light) and `airShape` (`setAir`) uniforms. Reference: `hazeAlong` (`world/air.ts`). |
| How is something lit that three.js's own materials draw (Actors' bodies)? | The fixed light pool in `lights.ts` (`key`, `sky`, `addLights(scene)`; the only place a three.js light is made; before the warm-up): `shineOn(...)` aims the directional key light from the sunline's `lightVector` at a point, past its horizons, and sets the ambient sky light, both scaled to match the kinds. |
| How do things cast shadows? | The key light's one shadow map (`lights.ts`): ±40 m around the player, its v along the axis, snapped to texels. Its filter follows `SHADOW_RAYS` rays toward the light's equal shares along the axis (`lightShares` in `world/sunline.ts`), so shadows are sharp across the axis and soft along it. Kinds multiply `sunShadow` into their direct light (`sunlit`); Actors' materials get it through the light. A mesh casts or receives with `castShadow`/`receiveShadow` (kinds: `shadow` in the registry); the player's body is on `BODY_LAYER`, which the shadow camera always sees. |
| Where does the camera sit, given the huge distances? | At the origin: meshes are placed at `frame.toView(eye, origin)` (float64), and shaders get the world eye from `view.eye` (`materials.ts`). |
| How does the terrain reach the screen? | `TerrainView` (`render/terrain.ts`): `follow(eye, pixelsPerRadian)` each frame selects tiles, asks the worker pool for missing ones, caches and evicts; sets each tile's `userData.morphFar` so GROUND geomorphs it into its parent's shape before they swap. |
| What does the ground look like up close? | `GROUND_LAYERS` / `groundLayer(index, size)` (`gen/groundTex.ts`, ported from Scale's texgen): one tileable albedo + relief (slope, height, occlusion) per floor layer, and its mean colour; drawn in the workers (`kind: 'floor'`), loaded once per page by `loadFloor` into texture arrays (`render/groundShaders.ts`). `floorSurface(color, normal)` blends the point's two largest layers by their relief, mapped biplanar from `setFloorEye` (eye modulo 12 m), and scales them so their mean is the far colour. The texture painting kit (periodic noise, Worley, stamping, `finish`) is `gen/texgen.ts`. |
| How is a texture set up for sampling? | `filtered(texture, {srgb, mips, anisotropy, repeat})` (`render/textures.ts`): linear filters (every sampled texture must be filterable in WebGPU), mips, colour space and wrapping in one place. |
| How does the view stream things the workers build? | `StreamCache` (`render/streamed.ts`): `want([{id, request}])` each frame, most needed first; asks the pool a few at a time, drops its own queued jobs no longer wanted (never another cache's), evicts the least recently drawn; `shed()` for the memory watchdog. Terrain tiles, plant cells and the hull's detail tiles use it, all on the one pool every view shares (`sharedPool()`, `workers/pool.ts`). |
| How do plants reach the screen? | `PlantView` (`render/plants.ts`): `follow(eye)` streams each species' cells at each level, shared shapes per form × variant × level, instanced BARK + LEAF meshes (full, lite) or one HULL mesh (hull) per cell and shape (`plantInstances(geometry, data or shared buffer)` in `materials.ts`). Levels hand plants over by `userData.band` (dithered, per plant); the atlases arrive through `setFoliage`, the canopy band through `setCanopyBand`. |
| What is drawn outside? | `OutsideView` (`outside.ts`): the sky dome (`SKY`: Sun, Earth, Moon per pixel), the stars (`STARS`, each quad sized by `starReach` to hold its flare), and every habitat of the ring through `NecklaceView` (`necklace.ts`): meshes when near (`SKIN`, `RADIATOR`, `HARDWARE` from `hullGeometry` in `hull.ts` plus the berth arms, mast and dishes as their parts' root tiles, `SKIN_DETAIL` for the skin up close, each mesh's skin in `userData.skin` via `skinUniforms`), glints through the STARS kind when far. Shader pieces: `skyShaders.ts` (the `outside` uniforms) and `hullShaders.ts`; kinds listed by `outsideKinds()`. |
| How bright is it outside, and how do eyes follow? | `exposureFor(meterable, rays, darkest)` and `adapt` (`exposure.ts`): units where sunlit white paper is 1, anchored to the light in view (`ANCHOR_LEVEL`); the `outside.exposure` uniform scales every outside kind, and `DISPLAY_CAP` (`skyShaders.ts`) keeps exposed light inside the half-float frame. |
| How bright is it inside, and how do eyes follow? | `view.exposure` (`materials.ts`) scales every inside kind (in `throughAir`) and three's lights; `adaptEyes` in `view.ts` meters the crowns over the eye (`crownsClosed` from the canopy raise, `gen/ecology.ts`) into `underCrowns` and `insideExposure` (`exposure.ts`) and follows it with `adapt`. Past the shadow map's reach, GROUND shades the floor under woods by the same `crownsClosed` and `UNDER_CROWNS`. |
| What do the 3D views share (frame loop, held keys, canvas size, right-drag looking, drawing a frame)? | `FrameLoop` (frame loop and the keys held while shown), `moveKeys`, `runFrames`, `fitCanvas`, `dragToLook`, `draw(stage)` (`surface.ts`). Each view is a `PageView` in `main.ts`'s `ViewSlot`. |
| How do I turn arrays into a mesh geometry, and pose it? | `meshGeometry(index, attributes)` (`geometry.ts`); `arraysGeometry(arrays)` for a built shape's arrays (position, normal, colour when present). Shapes (habitats from outside, ships, drones): `ShapeBuilder` in the same file, a `Shape` (gen/shapes.ts) with `build()`. `setPose(mesh, axes, origin)` places a mesh relative to the eye. |
| How are the drones drawn? | `DroneMesh` (`drones.ts`), one per meshed habitat in `NecklaceView`: a HARDWARE mesh near the skin (`moveTo(t)`), beyond `DRONES_WITHIN` drone lengths one STARS point each (`glow`, with `userData.plainExposure` so they take the eyes' exposure, not the stars'). Nothing vanishes with distance (Arnd, 2026-10-21): each far form carries the near one's light. |
| How does the hull up close (skin, plating, arms, mast, dishes) reach the screen? | `HullDetailView` (`render/hullDetail.ts`), one per habitat the eye is near any detailed part of (`NecklaceView.followDetail`): streams every part's `partTiles` through one `StreamCache`, draws each part's `coverOf` in its frame (`Frames`: the body's or the spindle's), each tile a HARDWARE mesh of its parts and, for the skin, a SKIN_DETAIL mesh of its glass; `covers(part)` tells the necklace when a whole part's far form can hide. Below the smallest tiles the shaders carry on (`skinDetailColor`, `hardwareColor` in `hullShaders.ts`): every fine layer fades in by `shows` (its period on screen), lines are box-filtered by `lineAt`, and `keepMean` keeps each layer's mean, so the near view's light is the far view's. |
| How does the free camera stay with a surface to look at it? | `NecklaceView.holdStation(eye, look, t0, t1)`: near a drum the eye turns with the habitat (fully within `HOLD_NEAR` outer radii, not beyond `HOLD_FAR`), and lets go as the eye comes nearer the despun spindle and its parts than the drum (`SPINDLE_NEAR`, `SPINDLE_FAR`); `OutsideView.frame` applies it each frame. |
| How is a ship drawn? | `shipGeometry(shape)` (`ship.ts`): the body as HARDWARE (an albedo per part), the plume as FLAME (additive; `userData.flame` sets length and throttle). The title's ship is placed by `OutsideView` (`startAttract`, `stopAttract`). |
| What is drawn inside? | `InteriorView` (`view.ts`): terrain tiles, sunline, the player's body, the walker's or the flyer's camera (`toggleFlying`, key F; on foot `zoom(deltaY)`, the mouse wheel, glides from the eyes out to behind the player). |
| How is a person drawn? | An Actors `Figure` (`render/actors/figure.ts`, ported from Dunfinity): `Figure.load(look)`, `update({ feet, up, front, speed, anim }, dt, time)` stands it on the curved floor; `FigureAnimator` (`animator.ts`) plays the pack's clips per move state. The pack: `HUMAN_PACK`, `packFetch`, `humanCatalog()` (`pack.ts`; served and built under /actors/ by the `actorsPack` Vite plugin, fetched by `tools/actors/pack.mjs`). Looks: `playerLook(seed)` (`looks.ts`). |
| What time is it in the habitat? | `InteriorView.time` (clock s since the first dawn), advanced by frame time × `timeScale`; the debug menu's Time group changes it. Nothing reads the wall clock. |
| How does the view run physics? | `InteriorView.simulate(dt, eye)`: asks the pool for a ground patch when the bubble needs one, advances the `PhysicsWorld`, draws each body as a BALL mesh. `dropBall(height)` and `clearBalls()` are in the debug menu's Physics group. |

## Physics (`src/physics`, the only place that imports Rapier)

| Question | The one way |
|---|---|
| How do bodies fall, roll and collide? | `PhysicsWorld` (`world.ts`): `create(habitat)` loads Rapier; no engine gravity, each fixed step (`PHYSICS_STEP`) adds `apparentAcceleration` as a force. A bubble around the player: `needsGround(p)` / `setGround(patch)` move its origin and rebase the bodies, so floats stay precise anywhere. `addBall`, `remove`, `advance(dt)`, `states()` in world coordinates, `offPatch(p)`, `blend` (for drawing between steps). |
| How does the player's body move? | `Character` (`character.ts`), from `PhysicsWorld.addCharacter(feet, water)`: a capsule on Rapier's character controller, up from `upAt`, the spin's gravity and Coriolis in the air, buoyancy in water; set its `stride` (walk velocity, jump). |

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
| Where does the page open, and how does it get there again? | The title (`TitleCard`, `title.ts`) over the Outside view playing `startAttract`; `showTab('title' \| 'lab' \| 'inside' \| 'outside')` in `main.ts`, with `?view=` for the others. The header's name goes back to the title. |
| How do I make a DOM element? | `el(tag, className, text)` (`dom.ts`). |

## Planned

| Question | The one way (to build) |
|---|---|
| Who lives here, and what are they doing now? | Derived from seed + clock (`src/sim`); only touched people are simulated. |

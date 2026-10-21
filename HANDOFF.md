# Handoff

Where the work stands, for the next thread. Update it in the PR that changes it.

## Done

- **v0.001, foundation**: house rules (guards, duplication ratchet, change notes and versioning, CI under 2 minutes, Pages deploy); `src/blueprint` (params → derive → validate, profile, (θ, s, h) frame) tested over the four-habitat `MATRIX`; memory watchdog, debug menu, What's new, Blueprint Lab.
- **Shared render foundation**: `@futuremagic/stage` in AssetGenerator (renderer, Stage, cap, hooks, monitor; from Dunfinity). Solarpolis uses it WebGPU only, with reversed depth.
- **First look inside**: the Inside tab draws the whole interior surface (`src/gen/surface.ts`, a coarse seeded backdrop), the sunline and the haze, from a walker on the floor (`src/world/walker.ts`).
- **Terrain tiles (milestone 2, part 1)**: `relief` in the blueprint (hills, ring lake, terrace step); `src/gen/terrain.ts` height field; `src/gen/tiles.ts` wrapping tile tree with LOD by measured error (reference view ~600 tiles, large ~1100); built in a worker pool; drawn camera-relative; WATER kind for the lake; the walker stands on the ground or the water. Arnd chose built hills and lakes, the deck below follows the ground.
- **Geomorphing**: each tile carries a `morph` offset to its parent's surface; the GROUND kind blends it in over the last 40 % before the parent's distance, so level swaps don't pop (normals still switch; a lighting-only change).
- **Sunline light**: `src/world/sunline.ts` (line-light integral over an emission profile along the axis) and `src/gen/horizon.ts` (two horizon angles per point, baked per tile on a 9×9 grid). The shaders sum the integral in 8 steps per pixel instead of the plan's (r, z) table: horizons need a per-point integral anyway, and it needs no compute pass. The day cycle only rewrites the emission texture.
- **Haze**: `src/world/air.ts` and `throughAir`: density from the blueprint's pressure profile, lit by the sunline (a halo near it), marched per pixel in 10 pieces with the halo term integrated exactly. The plan's froxel volume (compute) is not built: per pixel is exact and needs no compute pass. It becomes worth it when clouds and night lights join the air (milestone 4).
- **Travelling sun**: `HabitatParams.day` and `sunlineEmission(h, t)`: a bright stretch crosses the tube from the wild end to the port end over the daylight hours, the tube dims at night; the sunline mesh, ground light, sky light and haze all follow it. The view's clock runs ×60 by default (a day in 24 minutes); debug menu, Time.
- **Rotating-frame physics (milestone 3, part 1)**: `src/world/motion.ts` (centrifugal plus Coriolis), `src/physics/world.ts` (Rapier with gravity off and the apparent force added per step, a bubble that moves with the player over a ground patch from the worker pool). Debug menu, Physics: a ball dropped from 20 m lands about `habitat.dropOffset(20)` behind the spot below it, tested over the whole `MATRIX`.
- **Character controller**: `src/physics/character.ts`, the player's capsule on Rapier's character controller. Up is toward the axis everywhere (`upAt`), gravity is the spin's, so the view stays upright on the endcap slopes and jumps carry further up them; Coriolis acts in the air; in the lake the body floats and swims. Space jumps. The walker only glides until the first ground patch arrives.
- **The player is an Actors human**: Actors 0.5.0 (packages from its release, the asset pack fetched by `tools/actors/pack.mjs` and copied into the Pages build; the CI check builds without it). `render/actors/` is ported from Dunfinity (pack, figure, animator); the figure stands along the spin's up. Bodies are lit by `render/lights.ts` (a key light from the sunline's `lightVector`, an ambient sky light). V shows the player from behind. Two things belong elsewhere later: the animator should move into Actors (the plan's ask), and the reversed-depth bias fix (`reverseDepthBias` in `figure.ts`: three r186 flips the depth test but not the polygon offset) belongs in `@futuremagic/stage` for every material.
- **Fly camera**: `src/world/flyer.ts`, F in the Inside view; E/Space climb, Q/C sink; speed grows with height.

## Next

1. Milestone 3, "Standing in it": the near shadow map (cast by the `Lights` key light).
2. Dunfinity can switch to `@futuremagic/stage` and drop its own copy (its own PR, in its own thread).

## The outside (plan "Solarpolis: the outside": https://claude.ai/artifact/5aV6F3oGzxDapsjV59haXi)

Arnd approved the whole plan on 2026-10-21: the reference habitat sits in the geostationary ring ("the Necklace"), its axis on the ecliptic pole; radiators are flat brims at the endcaps; the port hub is a despun spindle; ships fly on laser-pushed solar sails or fusion torches (habitats stay solar-only); Earth in 3026 looks like today with smaller, darker cities; the title is a live docking flight that ends in the Hub.

- **Done (O1)**: `src/space`: clock, ephemeris of Sun, Earth and Moon, the float64 frame tree, the Necklace (`makeSpace`), tested against 2026 equinox, solstice and eclipses and over the whole `MATRIX`.
- **Done (O2)**: `derive()` heat is what is released inside (electricity plus the piped share of the sunline light, `pipedLight`); `habitat.exterior` (`src/blueprint/exterior.ts`): endcap faces, radiator brims sized to the heat (stacked inward when one ring per end is not enough; view factor between stacked brims; tip stress checked against `brimMaterial`), despun spindle, mast. The Lab section draws them. Reference: 203 GW, one brim per end out to 5.9 km; long: 5 stacked brims per end.
- **Next (O3)**: the sky (SKY and PLANET kinds: stars, Sun, Earth, Moon, exposure), then O4 the habitat from outside and the title attract loop.
- **Later**: outside material kinds (SKY, PLANET, HULL, BRIM, HARDWARE, GLINT, WINDOW); the interior generator places starfloor rooms, the Hub lounge and endcap ports. `toView(eye, p)` stays the eye-relative step; positions from other frames go through `frames.position` first.

## News from Arnd

- 2026-10-21: humanoid robot bodies have landed in the Actors package; animals are in progress there. Use both when the people milestone comes (robots on the paths, animals in the park and the nature reserve).

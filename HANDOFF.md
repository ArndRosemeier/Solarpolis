# Handoff

Where the work stands, for the next thread. Update it in the PR that changes it.

## Done

- **v0.001, foundation**: house rules (guards, duplication ratchet, change notes and versioning, CI under 2 minutes, Pages deploy); `src/blueprint` (params → derive → validate, profile, (θ, s, h) frame) tested over the four-habitat `MATRIX`; memory watchdog, debug menu, What's new, Blueprint Lab.
- **Shared render foundation**: `@futuremagic/stage` in AssetGenerator (renderer, Stage, cap, hooks, monitor; from Dunfinity). Solarpolis uses it WebGPU only, with reversed depth.
- **First look inside**: the Inside tab draws the whole interior surface (`src/gen/surface.ts`, a coarse seeded backdrop), the sunline and the haze, from a walker on the floor (`src/world/walker.ts`).
- **Terrain tiles (milestone 2, part 1)**: `relief` in the blueprint (hills, ring lake, terrace step); `src/gen/terrain.ts` height field; `src/gen/tiles.ts` wrapping tile tree with LOD by measured error (reference view ~600 tiles, large ~1100); built in a worker pool; drawn camera-relative; WATER kind for the lake; the walker stands on the ground or the water. Arnd chose built hills and lakes, the deck below follows the ground.
- **Geomorphing**: each tile carries a `morph` offset to its parent's surface; the GROUND kind blends it in over the last 40 % before the parent's distance, so level swaps don't pop (normals still switch; a lighting-only change).
- **Sunline light**: `src/world/sunline.ts` (line-light integral over an emission profile along the axis) and `src/gen/horizon.ts` (two horizon angles per point, baked per tile on a 9×9 grid). The shaders sum the integral in 8 steps per pixel instead of the plan's (r, z) table: horizons need a per-point integral anyway, and it needs no compute pass. The day cycle only rewrites the emission texture.

## Next

1. Milestone 2, remaining parts: the haze froxel volume, a fly camera.
2. The sunline's day: the travelling sun and the night dimming.
3. Physics for the walker (Rapier, Coriolis), then Actors' humanoid bodies.
4. Dunfinity can switch to `@futuremagic/stage` and drop its own copy (its own PR, in its own thread).

## The outside (plan "Solarpolis: the outside": https://claude.ai/artifact/5aV6F3oGzxDapsjV59haXi)

Arnd approved the whole plan on 2026-10-21: the reference habitat sits in the geostationary ring ("the Necklace"), its axis on the ecliptic pole; radiators are flat brims at the endcaps; the port hub is a despun spindle; ships fly on laser-pushed solar sails or fusion torches (habitats stay solar-only); Earth in 3026 looks like today with smaller, darker cities; the title is a live docking flight that ends in the Hub.

- **Done (O1)**: `src/space`: clock, ephemeris of Sun, Earth and Moon, the float64 frame tree, the Necklace (`makeSpace`), tested against 2026 equinox, solstice and eclipses and over the whole `MATRIX`.
- **Next (O2, outside thread)**: `derive()` heat fix (radiators carry only the heat released inside) and a pure `exterior(habitat)` (brims, spindle, outer profile).
- **Later**: outside material kinds (SKY, PLANET, HULL, BRIM, HARDWARE, GLINT, WINDOW); the interior generator places starfloor rooms, the Hub lounge and endcap ports. `toView(eye, p)` stays the eye-relative step; positions from other frames go through `frames.position` first.

## News from Arnd

- 2026-10-21: humanoid robot bodies have landed in the Actors package; animals are in progress there. Use both when the people milestone comes (robots on the paths, animals in the park and the nature reserve).

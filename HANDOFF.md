# Handoff

Where the work stands, for the next thread. Update it in the PR that changes it.

## Done

- **v0.001, foundation**: house rules (guards, duplication ratchet, change notes and versioning, CI under 2 minutes, Pages deploy); `src/blueprint` (params → derive → validate, profile, (θ, s, h) frame) tested over the four-habitat `MATRIX`; memory watchdog, debug menu, What's new, Blueprint Lab.
- **Shared render foundation**: `@futuremagic/stage` in AssetGenerator (renderer, Stage, cap, hooks, monitor; from Dunfinity). Solarpolis uses it WebGPU only, with reversed depth.
- **First look inside**: the Inside tab draws the whole interior surface (`src/gen/surface.ts`, a coarse seeded backdrop), the sunline and the haze, from a walker on the floor (`src/world/walker.ts`).

## Next

1. Detail near the viewer: chunks in (θ, s) with their own seeds, real terrain height (hills, the ring lake), replacing the coarse surface close by; camera-relative coordinates (`frame.toView`) when detail needs it.
2. The sunline's day: the travelling sun and the night dimming.
3. Physics for the walker (Rapier, Coriolis), then Actors' humanoid bodies.
4. Dunfinity can switch to `@futuremagic/stage` and drop its own copy (its own PR, in its own thread).

## Proposals waiting for Arnd (from the outside plan, "Solarpolis: the outside": https://claude.ai/artifact/5aV6F3oGzxDapsjV59haXi)

- `frame.toView` takes positions in any frame of a float64 frame tree (heliocentric → Earth → orbit → habitat body → interior); the camera's anchor frame can change mid-shot.
- `derive()`: radiators carry only the heat released inside (electricity used plus piped light), since the panels shed their own waste heat; about halves `radiatorArea`. A pure `exterior(habitat)` (radiator brims, despun spindle, outer profile).
- Outside material kinds: SKY, PLANET, HULL, BRIM, HARDWARE, GLINT, WINDOW.
- The interior generator places the starfloor rooms, the Hub lounge and the endcap ports.

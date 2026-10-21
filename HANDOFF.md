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

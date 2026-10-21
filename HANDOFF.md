# Handoff

Where the work stands, for the next thread. Update it in the PR that changes it.

## Done (milestone 1, first PR)

- Repo skeleton with Dunfinity's and SimWorld's house rules: guards, duplication ratchet, change notes and versioning, CI under 2 minutes, Pages deploy.
- `src/blueprint`: parametric habitat (params → derive → validate), interior profile and the (θ, s, h) frame, tested over the four-habitat `MATRIX`.
- App shell: memory watchdog, debug menu (Shift+Ctrl+F12), What's new button, and the Blueprint Lab (sliders, presets, findings, a to-scale section) as the first view.

## Next

1. Extract `@futuremagic/stage` (renderer, Stage, cap, monitor, patches) and the guards into AssetGenerator packages, so Dunfinity, SimWorld and Solarpolis share one copy.
2. WebGPU renderer foundation: a camera-relative frame (`frame.toView`), the interior surface from the profile, sunline and sky haze.
3. Walk inside the cylinder (milestone 2), with Actors' humanoid bodies once they land.

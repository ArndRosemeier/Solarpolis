# The far view of the interior

Running notes on how the interior reads from far away: from a few hundred metres over the floor, across the curve, to the far side overhead and down the length of the tube. Arnd's bar (2026-10-21): nothing vanishes with distance; whole forests need aggregate LOD with visible canopy structure; looking up at the far side km away must still show forests, relief, rivers, lakes and landmarks; detail is "fractal" in both directions; no cartoony look. The look target is his reference image Cylinder1.png: clear far side with mild haze, clouds, the sunline, a waterfall endcap and a lake. Its towns and towers do not match the design (the surface is a park with a few landmarks).

## How to look

The debug menu's **Go** group has viewpoints high over the land (`viewpoint` in `src/main.ts`), every distance a share of the habitat's radius:

| Shots view | Debug entry | Where |
|---|---|---|
| `far-low` | Fly: low over the floor, looking along it | 0.05 R up (200 m in the reference), looking 2.5 R along |
| `far-across` | Fly: a quarter of the way up, looking across the curve | 0.25 R up, looking a quarter turn round |
| `far-side` | Fly: halfway up, looking at the far side | 0.5 R up, looking across the axis |
| `far-down` | Fly: high up, looking down | 0.6 R up, looking down ahead |
| `far-tube` | Fly: near the axis at the wild end, looking along the tube | 0.9 R up at the foot of the wild endcap |
| `far-endcap` | Fly: over the floor, looking up the wild endcap | 0.1 R up near the wild end, looking up its slope |
| `far-tube-clear` | (as `far-tube`, clouds set to none) | to tell the air's glow from the clouds |
| `far-meadow-up` | (Into the nearest meadow, then look up) | on foot, looking up at the far side |

Ask for them on Arnd's PC: `git push origin HEAD:refs/heads/shots-req/<who>/far-low,far-across,far-side,far-down,far-tube,far-meadow-up` (scripts/shots/README.md).

## Distance bands

In the reference habitat (R 4 km, 1600×900, 70° field of view: 740 px per radian):

| Band | Distance | One pixel | What carries the look |
|---|---|---|---|
| Near | < 40 m | < 5 cm | grass tufts, floor textures, stones, full trees |
| Middle | 40 m to 1.5 km | 5 cm to 2 m | lite trees, crown hulls (to 45–60 tree heights), debris, floor colour |
| Far | 1.5 to 8 km | 2 to 11 m | the ground tiles' canopy layer: woods, glades, rivers, the lake, relief |
| Across | 8 to 35 km | 11 to 50 m | the far side and the endcaps, through the haze |

## Findings, v0.040 (renders 20261021-165354-farview-before)

1. **Woods past the crown hulls are blurred colour blobs.** Beyond the hull level (about 1.3 to 1.7 km), a wood is the ground tile's `canopy` attribute: one colour and height per tile point. From high up only the 47 root tiles are drawn (68 m cells, 6 px apart across the tube, 25 px at 2 km), because tiles split only by the error of their shape, and the floor is flat. Blending colour between points 68 m apart gives soft blobs with no edges, no crowns and no gaps. The crown noise in GROUND (a 6 m pattern) fades out by 4 to 9 km and is sub-pixel long before.
2. **The haze swallows the far side.** With the air at a quarter of the light per 20 km, looking across the axis keeps 62% of the ground's light and adds 0.76 of the haze colour (`hazeAlong`). The ground's own colour (albedo 0.05 to 0.2) is then about a tenth of what the eye sees: pale green-grey, no contrast. Along the tube from near the axis it is nearly white.
3. **The hull-level trees and the canopy layer do not match.** At 1.5 km the crown hulls are dark, separate crowns with lit meadow between them; just beyond, the canopy layer is lighter and smooth. The handover is a visible line.
4. **No relief.** The sunline lights from overhead, so slopes barely change the light, and the tile normals come from the same 68 m grid. Hills (60 m) and valleys don't read. Nothing darkens hollows or lightens ridges.
5. **Water reads, barely.** The ring lake is a grey-blue band (it mirrors the haze colour). Rivers show as thin lines on the far side. Both lose their banks and valleys.
6. **No landmarks or clouds yet.** Nothing stands up from the land to give scale. Clouds belong to the interior thread (Implementation tech plan).
7. A dark square showed under the eye in `far-down`. It was the near shadow map (80 m, following the eye): three r186 tests only depth ≤ 1 for a shadow map, which in a reversed depth buffer lets everything past the map's far plane through, so the floor 2 km under a flyer compared against an empty map and read as shaded. Fixed in `sunlineFilter` (render/lights.ts).

## Changes

PR "The interior from far away" (renders 20261021-165354-farview-before → 20261021-1805…-farview-woods5 and later):

- **Clearer air**: the air's clearness is a habitat parameter, `air.hazeDistance` (the distance over which a quarter of a surface's light gets through), 60 km in the reference instead of the fixed 20 km. Across the axis 85% of the ground's light now arrives and the haze adds 0.30 instead of 0.76. A designed habitat filters its air much cleaner than a city's.
- **Far tiles fine enough for their content**: a tile also splits while its cells look bigger than `CELL_PIXELS` (12 px), not only by the error of its shape. From high up 140 to 170 tiles are drawn instead of the 47 roots; at 56 to 60 fps on Arnd's PC.
- **Woods from afar** (`woodsFromAfar`, render/groundShaders.ts): each tile point carries the crowns' cover and the trees' spacing (`horizon.zw`; WebGPU allows only 8 vertex buffers, so they ride in the horizon attribute). Per pixel, crowns on a jittered 3D lattice of the trees' spacing (a crown in each cell by chance, so that they cover the point's share), lit tops and darker rims, the floor between them in their shade; groves, clumps and stands make the cover wander where woods thin, so edges break into groves, clearings and single trees. Every scale fades to its mean by the pixel's footprint. The crowns' mean light matches the hull level's dark crowns, so the handover at 1.3 to 1.7 km no longer shows as a lighter band.
- **Hollows and ridges**: each tile point's rise over the ground around it (as a slope, two to four cells out, and four to eight for the parent, packed in `morph.w`) darkens hollows and lightens ridges in GROUND, blended to the parent's with the geomorph.

PR "Endcaps in ledges and walls" (renders …-farview-endcap0 → …-farview-endcap):

- **The endcaps were a grey disc of perfect rings** (finding of v0.046): the terraces were axisymmetric, and the ecology took the profile's own tilt as the ground's least slope, so even a flat tread counted as a 65° wall and showed rock. On the steep upper slopes the old risers also leaned past sheer (heights go along the profile's normal), folding the ground. Now the terraces are nearly level ledges (10°) and nearly sheer walls (78°), their share of each step set by the slope so a wall never tips past sheer: broad ledges at the foot, narrow ones high up, none where the slope is already steeper than a wall. Their levels wander around the axis (most of a step, over ten steps' length) and some walls wear down toward the plain slope. `groundSlope` (gen/terrain.ts) measures steepness against true up for tiles and plants alike, so the ledges hold meadow, heath and pines and the walls stay rock.
- `fromWorld` undoes `toWorld` exactly also far above or below the profile (the endcap's ledges sink tens of metres under it): it was centimetres off, enough to misplace a stone on a wall.
- **The dark square under a high flyer** (finding 7): fixed in `sunlineFilter` (render/lights.ts), see above.

PR "Woods seen at a slant" (renders …-farview-endcap2 → …-farview-slant):

- At a slant a pixel's footprint is long down the view and short across it (at 3 km from 200 m up about 60 m by 4 m). `woodsFromAfar` faded each pattern by the long side, so groves and clumps were gone from 1.5 km on and far woods smeared. Now a pattern fades by the footprint's area (the geometric mean of the two sides) and only past where the long side still samples it twice, so it can't alias into streaks.
- What is left of the smear is foreshortening: a 200 m wood 3 km off, seen from 200 m up, is fifteen times wider than tall on screen. Real woods there show as a dark wall of trees with a bumpy top (25 m trees are 6 px tall at 3 km), not a flat stain. The canopy layer raises the ground by the trees' height, but smoothly over the tile's cells (tens of metres), so a wood's edge is a gentle slope. Next: give wood edges their wall and silhouette (a steeper raise at the edge, or the hull level drawn farther out).

## The view along the tube from near the axis

Measured with the CPU reference (`hazeAlong`, world/air.ts) for the `far-tube` eye (0.1 R from the axis, at the foot of the wild endcap), at 60 km haze distance:

| Hour | Straight down | 1 R along | 3 R along |
|---|---|---|---|
| midday (sun mid-tube) | T 0.93, glow 0.06 | 0.90, 0.10 | 0.78, 0.36 |
| mid-morning (sun a quarter along, 2–5 km from the eye) | 0.93, 0.22 | 0.90, 0.39 | 0.78, 0.82 |

The air is clear (T stays high); what veils the land is the air's own glow. Near the axis the line lights the air R / r times as strongly as on the floor (10× at 0.1 R), and the travelling sun's bright stretch more than doubles that near it. So in the morning, looking from the axis toward the sun, the glow is as bright as the land itself or brighter (the haze colour at glow 1 is as bright as a surface of albedo 0.67 in full light; meadows are 0.15 to 0.3). Without clouds (`far-tube-clear`) the view is still milky, so this is the air, not the clouds. It is what the model's physics gives. Arnd's call (2026-10-21): the eyes adapt, the glow stays. `insideGlare` (render/exposure.ts) meters the frame on a 7 × 5 grid ten times a second: each ray's land (lit by the sunline and the sky light, albedo 0.15) through the air plus the air's glow. The log-average of the brightest quarter of rays against `BRIGHT_VIEW` (0.6) sets how far the eyes stop down (making up 0.8 of it, as the shade does the other way).

Measured in the reference habitat (brightest quarter → eyes):

| View | Morning (sun a quarter along) | Noon |
|---|---|---|
| on foot along the floor | 0.2 → ×1 | 0.4 → ×1 |
| on foot looking up at the far side | 0.3 → ×1 | 0.8 → ×0.8 |
| `far-side` (halfway up, across) | 0.5 → ×1 | 0.85 → ×0.76 |
| `far-tube` (near the axis toward the sun) | 1.0 → ×0.67 | 0.5 → ×1 |
| from the port hub toward the sun (afternoon) | 1.2 → ×0.6 | 0.5 → ×1 |

A wider habitat has more air to glow, so its eyes stop down sooner (the large one at ×0.5 from the axis); the small one has too little air to glare at all.

## Rock and the endcaps from afar (2026-10-21)

The endcaps became landforms (the Mountain and the Gate, PR #58). From afar the Mountain read as pale, even grey rock. The climate has one rock colour (0.28, 0.26, 0.22), and the air near the endcap veils it. GROUND now gives rock its own look (`rockFromAfar`): packages of darker, warmer and paler beds folded across the slope (showing on steep rock only; a ledge's top weathers to one surface), dark streaks down walls, broad iron-stained tones over thirty beds, and lichen. Each pattern fades to its mean by the pixel's footprint. Because it changes the vertex colour before the near floor textures take it, rock looks the same colour near and far (Arnd's LOD rule, 2026-10-21). Two traps: a streak frame built from each facet's normal sampled noise at world coordinates tens of kilometres out, so every facet jumped and drew contour-like lines; the streaks now use the habitat's frame (around the axis, along z). A footprint (`dFdx`) is only defined outside a branch, so `rockFromAfar` computes its fades before the `If` that skips ground without rock.

The Gate's faces read by kind in `colorAt`: the Stair face is dressed stone (rock ×1.6), the Vine face green over its walls, and the Water face dark wet rock (×0.55) with pools on its treads (the bed colour).

Near the axis the land gets many times the floor's light (7× at 90 m from the axis in the reference). So the eyes' meter now walks the real terrain (`landHit`, with `heightAt`) for rays from or onto the endcaps; standing on the Mountain near its tip the eyes stop down to about ×0.6. That rock still reads very bright there: the meter takes the land at albedo 0.15, and pale rock near the axis is more.

## Still open

- The endcaps: waterfalls where the rivers drop over the walls (the rivers already fall in cascades); landmarks.
- The reference relief (hills 60 m in a 4 km radius) is too small to read from across the axis; the hollows-and-ridges light helps only where there is relief.
- Clouds (the interior thread), landmarks (none yet), paths.

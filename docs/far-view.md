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
7. A dark square showed under the eye in `far-down` (one tile shaded differently). Not yet explained.

## Changes

PR "The interior from far away" (renders 20261021-165354-farview-before → 20261021-1805…-farview-woods5 and later):

- **Clearer air**: the air's clearness is a habitat parameter, `air.hazeDistance` (the distance over which a quarter of a surface's light gets through), 60 km in the reference instead of the fixed 20 km. Across the axis 85% of the ground's light now arrives and the haze adds 0.30 instead of 0.76. A designed habitat filters its air much cleaner than a city's.
- **Far tiles fine enough for their content**: a tile also splits while its cells look bigger than `CELL_PIXELS` (12 px), not only by the error of its shape. From high up 140 to 170 tiles are drawn instead of the 47 roots; at 56 to 60 fps on Arnd's PC.
- **Woods from afar** (`woodsFromAfar`, render/groundShaders.ts): each tile point carries the crowns' cover and the trees' spacing (`horizon.zw`; WebGPU allows only 8 vertex buffers, so they ride in the horizon attribute). Per pixel, crowns on a jittered 3D lattice of the trees' spacing (a crown in each cell by chance, so that they cover the point's share), lit tops and darker rims, the floor between them in their shade; groves, clumps and stands make the cover wander where woods thin, so edges break into groves, clearings and single trees. Every scale fades to its mean by the pixel's footprint. The crowns' mean light matches the hull level's dark crowns, so the handover at 1.3 to 1.7 km no longer shows as a lighter band.
- **Hollows and ridges**: each tile point's rise over the ground around it (as a slope, two to four cells out, and four to eight for the parent, packed in `morph.w`) darkens hollows and lightens ridges in GROUND, blended to the parent's with the geomorph.

## Still open

- The view along the tube from near the axis is still white: the eye sits in the sunline's halo (the R / r term). A phase function for the halo, or less of it, would open it up.
- The far endcaps read as a grey ringed disc (terraces of rock). The look target has a mountain with waterfalls; the endcaps need their own landforms and colour.
- The reference relief (hills 60 m in a 4 km radius) is too small to read from across the axis; the hollows-and-ridges light helps only where there is relief.
- The dark square under the eye in `far-down` (finding 7).
- Clouds (the interior thread), landmarks (none yet), paths.

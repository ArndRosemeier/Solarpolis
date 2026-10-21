# Changelog

Every merge to main is the next version, v0.001 and up by 0.001. The notes come from `changes/` (see changes/README.md); never edit this file by hand.

## v0.034 — Grass up close

- Meadows now have real grass: tufts of blades around your feet, swaying as waves of wind roll along the cylinder. Farther out they sink into the grass texture of the ground, so nothing pops.
- The heath up the endcaps and the dry Mediterranean hills grow dry tussocks; a few tufts grow between the leaves of the woods.
- The debug menu's Go entries work again with the walking body, and there is a new one: Into the nearest meadow.

## v0.033 — Light in the woods

- Your eyes adapt in a wood: walking under closed crowns, the view opens up over a few seconds, and closes again when you step back into the open.
- Woods stay shaded all the way out, not just near you: past the reach of the near shadows, the floor under closed crowns is lit the way the shadows would light it.

## v0.032 — The ground up close

- Walking on the floor, the ground now shows what it is made of: grass, dry grass, leaf litter, pine needles, bare earth, gravel, sand and rock, each with its own relief and shading.
- Each biome has its own floor (leaf litter under oaks, needles under pines, stony earth in the maquis), and the two main layers at a spot blend by their relief, so grass grows between stones instead of fading into them.
- From afar the ground keeps the colours it had; the textures add detail only as you come closer.
- Trees now cast their shadows on the ground: under a closed wood the floor lies in shade, with sunflecks where the crowns open.

## v0.031 — The spindle, berth arms, mast and dishes up close

- The berth arms and the mast are real trusses now, from any distance: chords, battens and diagonals, and as you fly in, tubes, gusset plates, bolts, cable trays with their cables and ties, lights, and on the arms a walkway with handrails and, up close, a grating deck.
- The despun spindle is plated: plates with seams, ring frames and stringers, hatches, lights on the nodes, conduits with their clamps, handrails for people working outside, and rivets along every plate.
- The dishes are built of petals with ribs and ring stiffeners behind them, a rim, a feed held by three struts with its horn, actuators and rivets.
- Near the spindle the camera no longer turns with the drum, so the arms stay still while you look at them.

## v0.030 — Real-GPU screenshots

- Behind the scenes: `npm run shots` renders any branch on Arnd's PC in real WebGPU, checks every shader the game compiles, and publishes the pictures and a report to the `renders` branch, so every change can be looked at as it really draws.

## v0.029 — Real trees, and woods that never vanish

- The trees are new, grown like the ones in Scale: branching wood with bark textures, leaf cards drawn from real twigs (oak, linden, maple, birch, chestnut, plane, ginkgo, pines, cypress) plus new willow, olive, heather and holm oak, all moving in the wind.
- Trees no longer disappear as you walk away. Near you see the full tree, farther off a lighter one, then its crown; past that the woods become a raised, shaded canopy on the ground, so even across the cylinder and overhead the forests are there.
- Debug menu, Go: "Before the nearest wood" and "Into the nearest wood".

## v0.028 — Details all the way down on the hull

- Fly close to the habitat's skin and it keeps getting more detailed: the panels become bays between beams, then solar modules in their frames, then bolts, clamps, cable trays and sensor posts, then washers, cables and the beams' chamfered edges.
- Closer still you see the cells themselves, their silver fingers and busbars, the odd dead cell, the light collectors' Fresnel lenses, and two centuries of wear: dust, scratches and tiny meteoroid pits.
- Near the hull the camera now holds station with the turning skin, so it stays under you instead of racing past at 200 m/s.
- The drones ride on real rails.

## v0.027 — Up close on the hull

- Fly to the hull (Outside, F) and you'll find maintenance drones running along tracks between the solar panels, each one carrying a spare panel. Seen from far away they turn into faint specks of light rather than disappearing.
- Panel frames now catch the sunlight at their own angle.
- The dock spindle's tip carries a cluster of antenna dishes, the far end's mast has whips and a dish, and every berth arm ends in a docking collar with clamps.

## v0.026 — Star flares

- Bright stars outside now have small lens flares: a soft glow and four thin spikes, bigger for brighter stars. Faint stars stay sharp points.

## v0.025 — Jumps look like jumps

- Your body now pushes off when you jump, holds a pose in the air and lands with a little give, instead of one looping clip.
- Stepping off a small ledge no longer flips into the jump pose; landing while running carries straight on into the stride.
- The Inside clock now runs in real time by default, like the Outside; faster speeds are in the debug menu.

## v0.024 — Woods, groves and reeds

- Trees, shrubs and reeds now grow in the cylinder: oaks and hazel in the woods, pines up the endcaps, willows and reeds by the lake, heather and juniper on the heath (olive groves in rows, holm oaks and stone pines in the Mediterranean climate).
- Each biome is planted as densely as its plants really grow; they sway a little in the air and fade out softly far away.
- Trees cast shadows near you.

## v0.023 — The outside runs in real time

- The Outside view's clock now runs in real time by default, so the habitat turns at its true, stately pace. Faster clocks are still in the debug menu (Outside).

## v0.022 — Heroic stars

- Outside, the stars now shine bright whenever the Sun is out of view, even next to sunlit Earth or a habitat: your eyes adapt to them, as a camera would. With the Sun in view they fade, as they should.
- The debug menu (Outside) can switch back to stars as unaugmented eyes would see them.

## v0.021 — A title screen: arriving by torch ship

- The game now opens on a title screen: a torch ship brakes outside the habitat ring with Earth behind it, its camera zooms in on home, then flies along the patchwork of solar panels. Press Start or any key to go inside.
- Click the name Solarpolis in the header to come back to the title. The Blueprint Lab is still one click away.
- Sunlit surfaces outside no longer glare white when the view is mostly dark.

## v0.020 — The habitats from outside

- The home habitat's skin is a patchwork of two centuries of repairs: panels in black and weathered blue, glassy stripes of light collectors, and lit starfloor windows on the dark side. It turns visibly.
- The radiator brims, endcap faces, spindle and mast have their own materials.
- The other 23 habitats of the ring shine as points of light that flicker as they turn, and become real habitats when you get close. Key 4 looks at the nearest one.
- F lets you fly freely outside, from 50,000 km away down to a metre off the hull (W A S D, E up, Q down, Shift faster). The number keys turn you toward the habitat, Earth, the Moon or the nearest neighbour.
- Light collectors now take their share of the skin, so a habitat makes less electricity and needs smaller radiators. The Blueprint shows the collectors' share.
- Dark surfaces in sunlight now stay dark, and the Sun no longer shows a black hole in its middle.

## v0.019 — Biomes

- The land is planted: meadows and woods on the floor, reed beds by the lake, pinewoods and heath up the endcaps, in patches with clear edges like designed parkland.
- A habitat's climate picks its biomes. A Mediterranean one (golden grass, olive groves, holm oak, maquis) is in the catalogue too.

## v0.018 — The mouse wheel shows you

- On foot, the mouse wheel glides the camera smoothly from your own eyes out to behind you and back, instead of the V key. Flying still shows no body.

## v0.017 — Shadows near you

- You and things near you cast shadows on the ground. The sunline is a long tube of light, so shadows are sharp across the cylinder and soft along it, crisp where they touch the ground and blurred higher up.

## v0.016 — The sky outside draws in WebGPU

- The Outside tab shows black space, white stars, Earth and the Moon again. In WebGPU the sky shader failed to compile (its stand-in maps had no sampler), so the page's grey showed through, the stars looked black, and keys 2 and 3 pointed at nothing.
- Behind the sky is now black space, so a sky that fails to draw never shows the page.

## v0.015 — The view from outside

- A new Outside tab: your habitat hanging in the geostationary ring, with Earth below, the Moon, the Sun and 41,000 real stars exactly where they are at this hour in 3026.
- Earth has its continents, drifting clouds, sunglint on the oceans, a thin blue rim of air, and only a faint scatter of city lights at night.
- Your eyes adapt: next to the sunlit hull the stars vanish, in Earth's shadow they come out. The debug menu has a "Night eyes" augmentation that opens them further.
- Around midnight near the equinoxes Earth passes in front of the Sun, and its rim glows with sunsets all around. The debug menu can jump there.
- Hold the right mouse button to swing around the habitat, use the wheel to come closer, and press 1, 2 or 3 to look at the habitat, Earth or the Moon.

## v0.014 — You have a body

- You are now a person: press V to see yourself from behind, and V again to look through your own eyes.
- Your body walks, runs, jumps and swims along with you, and stays upright toward the axis wherever you stand.
- It is lit by the sunline like everything around it, and its light changes with the hour.

## v0.013 — Walking with real weight

- On foot you now have a body: you walk over the hills, Space jumps, and you fall off ledges.
- Up always points to the axis. On the endcap slopes you stay upright while the ground tilts away, and gravity gets weaker the higher you climb, so jumps there carry further.
- Walk into the lake and you float with your head out and swim slowly.
- The debug menu shows whether you are standing, in the air or swimming, and how strong gravity is where you are.

## v0.012 — Things fall the way they do in a spinning habitat

- Physics arrives: in the debug menu (Physics), drop a ball from 20 m or 100 m. It falls, bounces and rolls on the hills.
- It does not land straight below where it was let go: the habitat turns under it, so it lands a little behind, by exactly as much as the blueprint predicts (Coriolis).

## v0.011 — The travelling sun

- The sunline now has a day. In the morning its brightest stretch rises out of the wild end, crosses the cylinder over the day and sinks into the port end in the evening. Then the tube dims to a faint night glow.
- The ground, the sky light and the haze follow the sun: the land under it is brightest, and at night everything goes dark blue.
- A day takes about 24 minutes for now. The debug menu has a new Time section to change the speed or jump two hours ahead.

## v0.010 — Radiator brims and a dock spindle

- The habitat now has an outside: flat radiator rings ("brims") around both endcaps, a despun dock spindle at the port end and a mast at the wild end. The Blueprint section draws them to scale.
- Radiators now carry only the heat released inside the habitat; the solar panels shed their own. The reference habitat sheds 203 GW through one brim per end reaching 5.9 km from the axis; long, thin habitats stack several.

## v0.009 — The sky gets a clock

- The habitat now has a place in space: the geostationary ring ("the Necklace"), 42,164 km above Earth, with 24 habitats strung around it and yours hanging over 10° East.
- The Sun, Earth and Moon move as they really will in 3026, from one game clock, so the windows and the title flight to come show the right sky at every moment.

## v0.008 — Haze that glows around the sunline

- The air is now thinner toward the axis, as its pressure says, so in a large cylinder the far side shows through more clearly.
- The air around the sunline glows: the light tube wears a soft halo, and looking along the axis the air shines brighter.

## v0.007 — Fly through the cylinder

- Press F to take off and F again to land. In the air, W A S D moves where you look, E or Space climbs, Q or C sinks, and Shift goes faster.
- The higher you are, the faster you fly, so you can cross the cylinder in moments and still drift slowly over the grass.
- Up always points toward the axis. Fly through the middle and the view rolls over smoothly, with the far side becoming the ground below.

## v0.006 — Light from the sunline

- The light now comes from the whole glowing line along the axis: the middle of the floor is brightest, the ends near the walls get less, and the endcap slopes close to the axis glow.
- Hills, banks and the endcaps hide part of the sunline, so valleys and the foot of the endcaps lie a little darker.

## v0.005 — Smooth detail changes

- As you walk, the ground no longer jumps when a patch switches between finer and coarser detail: each patch eases into its coarser shape before the swap.

## v0.004 — Hills and a lake inside the cylinder

- The floor is no longer flat: rolling hills, forests and meadows, terraced slopes up the endcaps, and a ring lake that runs all the way around the cylinder.
- Detail follows you: the ground close by is sharp down to half a metre, the far side stays light, and it all wraps around without a seam.
- You walk on the ground now, up and down the hills, and you stay on the water's surface over the lake.
- The land is built in the background, so walking stays smooth.

## v0.003 — Look around with the right mouse button

- Inside, hold the right mouse button to look around. The pointer stays visible and free, so the left button is kept for clicking things in the world. On a touch screen, drag with one finger.

## v0.002 — A first look inside

- New Inside tab: stand on the floor of the habitat you designed and look around. The land curves up on both sides and overhead, the far side fades into blue haze, and the sunline runs along the axis.
- Drag to look, W A S D to walk, Shift to run. The debug menu (Shift+Ctrl+F12) can take you to the endcaps.
- Solarpolis needs WebGPU; browsers without it get a clear message instead of a black screen.

## v0.001 — The cylinder gets a blueprint

- The first page is the Blueprint Lab: drag the radius, length, gravity and more, and see what kind of habitat that makes (spin, hull, sunlight, heat, population) with a to-scale cross-section.
- The Lab says when a habitat could not be built, or would feel odd (too fast a spin, hazy far side, thin air at the axis).
- A What's new button shows each version's changes.
- Shift+Ctrl+F12 opens the debug menu; a memory watchdog warns before the browser runs out of memory.


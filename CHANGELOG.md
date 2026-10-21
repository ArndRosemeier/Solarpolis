# Changelog

Every merge to main is the next version, v0.001 and up by 0.001. The notes come from `changes/` (see changes/README.md); never edit this file by hand.

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


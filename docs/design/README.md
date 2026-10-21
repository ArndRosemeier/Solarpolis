# Design

- **Implementation plan** (Claude Doc, the source of truth for milestones and tech): https://claude.ai/artifact/Qm1aq6xVG6s6JFXjzcWjv5
- **Solarpolis: the outside** (exterior, space, windows, title flight, milestones O1 to O7): https://claude.ai/artifact/5aV6F3oGzxDapsjV59haXi
- **Inside the Cylinder: a first take** (the interior proposal Arnd liked): https://claude.ai/artifact/YC6UVyCXfoPa46FYucHb1b

## Arnd's decisions so far (2026-10-21)

| Topic | Decision |
|---|---|
| Setting | About 1000 years ahead. Post-scarcity; people and AIs live together, often indistinguishable. Basically everything technical has a mind; the habitat has one. |
| Start | Inside an O'Neill cylinder in Earth orbit, about 200 years old. The cylinder is a building block of a much bigger setting. |
| Player | A human with some common augmentations. No set objective yet: enjoy the sim. |
| Surface | Park and nature reserve with only landmark buildings. No houses. |
| Living | An outer layer below the surface, ceilings around 20 m, nearly every wall can be a screen. |
| Construction | Asteroid material; what is not useful for building is packed outside the hull as shielding. Outermost layer is solar panels; solar only. |
| Rotation | Hull, padding and solar skin all rotate together. Heat leaves through the endcaps and radiator fins edge-on to the Sun. |
| Procedural | Everything procedural, no hardcoded dimensions: the cylinder is a parametric blueprint. |
| Tech | Dunfinity's stack and rules. WebGPU only, no fallbacks. Actors package for bodies. |
| Population | Derived from seed + clock; only touched people are simulated. |
| Process | Automatic merges. CI capped at 2 minutes. Versioning v0.001 + 0.001 per build with a What's new button. Memory watchdog and debug menu from the start. |
| Orbit | The reference habitat sits in the geostationary ring ("the Necklace", Earth 17° wide), axis on the ecliptic pole so the Sun stays side-on. |
| Outside | Radiators are flat brims at the endcaps; the port hub is a despun spindle where ships dock; the title is a live docking flight into the Hub. |
| Ships | Two modes: laser-pushed solar sails (lasers on the Moon and other bodies; cheapest, slowest) and fusion torch ships with continuous thrust (what citizens use). Habitats stay solar-only. |
| Earth in 3026 | Much like today (the sea rose and fell back). Cities smaller and darker: targeted light, citizens who hardly need it. |

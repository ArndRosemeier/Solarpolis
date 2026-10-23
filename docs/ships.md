# Recipe-built ships

The first inhabited ship is **A Perfectly Reasonable Detour**, a Mind with guests and drone companions. It is a worked recipe, not a crewed spaceship template. Its six decks fit the same pressure hull shown outside. From Outside, choose **Visit exploration ship**, then **Enter airlock**. This is an observer transition; continuous boarding from a habitat is not implemented yet.

## Authoring another ship

`src/space/vessel.ts` owns `VesselRecipe`, `vesselPlan` and the reference `EXPLORER`. Make a new recipe record and pass it to `VesselVisit`; the renderer does not need to know its name or deck count. Outside and Ship Tour now present the long-range derivative `TOUR_SHIP`, **This Will Only Take A Little While**; the reference `EXPLORER` remains the simpler authoring example. See [Passenger voyages](passenger-voyages.md).

- Identity: stable ID, ship Mind name, class, seed and authored greeting. `companions` explicitly records whether a drone is a person. No human crew is required. The greeting is authored text; the portable conversation engine has not been connected.
- Structure: radius, shell thickness, deck pitch and lift radius. Two to twelve decks are supported, with validated headroom and a clear circulation core. Total length follows the pressure volume through the existing torch-ship machinery proportions, rather than independently stretching rooms into a fixed hull.
- Deck stack: an ordered list of named `arrival`, `commons`, `suites`, `care`, `workshop` and `observatory` modules. Each module derives partitions, furnishings, access and descriptive text. Repeated modules have unique instance IDs. Add a new module in `vesselPlan` with its clearance checks rather than special-casing a ship in the renderer.
- Finish: ceramic shell, floor, fabric and accent colours. Screen images, panel joints, rounded furniture, cove lighting, wayfinding and exterior deck bands follow the same plan. `ShipShape.colours` supplies exterior finish overrides through the shared ship renderer.
- Propulsion: dry mass, initial reaction mass, thrust and exhaust velocity in SI. These are provisional fictional performance parameters, not a fusion-engine engineering claim. Radiator geometry is modular but a coupled power, waste-heat and radiator-sizing model remains to be built.

`test/vessel.test.ts` checks compact, reference, long-range and extended recipes. It checks room bounds and clear lift space, access to every deck, reaction-mass conservation, the rocket equation and the difference between coast and powered motion. A new module should add meaningful fit/access coverage there. The ship dimensions are independent of habitat dimensions.

## Coordinate system and gravity

The existing ship frame is retained: **+x is the bow**, **−x the engine**, and y/z lie across a deck. Floors face the bow. The central lift crosses the stack along x. There is no gravity plating, automatic spin gravity or invisible gravity switch.

`VesselDrive.advance` integrates constant thrust with mass loss analytically, including propellant exhaustion during a step. A coast preserves velocity and consumes no propellant. Apparent acceleration aboard is the negative of engine acceleration. In braking flight the whole ship will need to turn; the deck orientation inside it does not reverse. The passenger-tour navigation now supplies the ship pose, turnover and acceleration through `VesselVisit.setFlight`; full rigid-body attitude dynamics remain future work.

The visit offers a 20-second departure trial. Its engine plume, fuel consumption, gained velocity, relative position and passenger gravity use the same drive state. The ship starts 5,000 km from the habitat, away from its local traffic. This is a local commissioning scene in the habitat orbit frame, not a solved heliocentric trajectory: the Ship Tour tab supplies the separate gravity-aware, finite-fuel navigation model. The trial advances in real time only while this ship is being visited. Returning to the habitat stops thrust; it is an observer change, not a return flight. No instant interplanetary travel is offered as physical ship travel.

`VesselPassenger` retains drift in coast and applies thrust gravity during a burn. WASD and E/Q request mobility assistance; B arrests drift. This is an explicit accessibility aid, not a source of gravity. The camera retains a chosen up orientation in freefall. The lift is powered transport in either state; select a deck near its central opening. Furniture retracts into the deck and restores, with occupied space protected. The simplified collision envelope includes pressure walls, slabs, partitions and furnishings; rotating-body and articulated-contact physics remain future work.

## Rendering and ownership

`render/vessel.ts` draws bounded shared rounded-box and drone instance pools, static deck/screen geometry and the existing `ShipMeshes` exterior. `vesselDetails.ts` derives the segmented radiator wings, tank shoulders, docking collar, deck bands, sensors and attitude-control pods. Companion drones are stylised stand-ins; their personhood and roles come from the recipe. Deck signs use one 1024² atlas for the visited ship. A many-ship renderer should give each atlas its own object binding or texture-array layer before showing different interiors simultaneously.

All materials are registry kinds, prepared through the Stage. Ship geometry and its sign atlas are built on first use. Outside reports retained ship allocations to the memory watchdog, releases an idle ship under memory pressure, and drops static CPU geometry after upload. A ship owns and disposes its mesh pools and sign atlas. No habitat interior, neighbourhood or resident code is owned by this feature.

The WebGPU tour is `npm run shots -- --views exploration-ship`; it visits all six decks, withdraws/restores furniture, starts a burn, moves the passenger, observes the powered hull and returns to the habitat, then records the heap.

Reference-PC validation of this first recipe: 35 shader modules validated, no GPU/pipeline errors, a worst compile block of 6 ms and no duplicate shader builds. After the tour the complete outside view reported about 145 MB including its sky assets, with a 65 MB JS heap. The recipe/physics checks and full suite passed (893 tests at this revision).

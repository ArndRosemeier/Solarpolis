# The whole system

The cylinder is a sample habitat; the setting is the solar system of the [world bible](world-bible.md), a very big sandbox whose story hooks come as situations on their own clock, never a forced plot. The plan is "The Whole System" (https://claude.ai/artifact/XdinpntDM6cx9rGRkaiURD). This page says what is built and which choices are ours, not the bible's.

## Three resolutions

The system has three resolutions, the same rule as the population (seed + clock, only what the player touches in detail):

1. **The ledger** (`src/system`, pure). Every habitat and polity is a record: orbit, form, size, people, name, steward Mind and polity. Some forty-three thousand of them, about 1.75 billion people with the reference habitat's density, ten times Earth's. Only the Necklace and the bible's polities are kept. The rest are derived from the world seed when asked (`Ledger.habitat`, `nth`, `each`), about 4 µs each.
2. **The exterior** (`src/render`). Near enough, a habitat is a point of its own reflected sunlight (`HabitatLights`). The Necklace is drawn as meshes by `NecklaceView`. Later, a habitat's blueprint will be derived and drawn as the Necklace's are.
3. **The interior**. Going inside derives its land and people, as for the sample habitat.

## Light is slow

Nothing travels faster than light (bible, Part II). Whatever happens somewhere is known elsewhere when its light gets there (`system/light.ts`, `Ledger.arrival`). That takes minutes across the inner system and hours to Saturn and beyond, and the receiver moves while the light travels.

Light time and news always use the data-free mean orbits (`space/meanPlanets.ts`, Standish elements). They are within 1 % of DE441 over 3020–3080, and within a light-second for the inner planets. Because of that, the Inside view (which has no ephemeris pack) and the Outside view agree to the second on when anything is heard. Drawing uses the exact pack.

## News

`newsIn(ledger, t0, t1)` lists what happened in any span of time, with the same news for the same span:

- notable solar flares;
- Aurelipolis's twenty arks leaving Mercury orbit;
- the Assembly's sessions, each deciding one of the bible's recurring questions (Enceladus, uplift, the arks, array fees, Krillix's seat), most of them put off;
- Velloran Reach's elections.

Residents talk about a piece of news only once its light has reached their habitat and they have heard of it. Most hear soon after, a few only near the end of `NewsParams.spread` (`talk/news.ts`). Arnd's conversation engine says it, as "I got a message about it", and may add how many minutes it took to reach them.

## Our choices (the bible does not fix them)

| What | Ours | Where to change it |
|---|---|---|
| Thraxipolis | Sun–Earth L4, seat of the Assembly | `polities.ts`, `NewsParams.assembly.seat` |
| Tessivorn, Krillix | Earth–Moon L5, a torus and a water drum | `polities.ts` |
| The Long Afternoon of Threnody | a bubble over Mars, at 8 Mars radii | `polities.ts` |
| The Slow Verdict of Mossgrown Things | its own eccentric orbit about the Sun (1.7 AU, e 0.28) | `polities.ts` |
| Grixmaw | a swarm on a Kuiper object, the lawless edge | `polities.ts` |
| Velloran Reach | five habitats on Mimas's orbit about Saturn | `polities.ts` |
| Regions and counts | L4/L5 2000 each, Mercury 400, Venus 2500, Mars 4000, Belt 20000 (each on its own rock), Trojans 4000, Jupiter 3000, Saturn 2500, Uranus 500, Neptune 500, outer dark 1500 | `REFERENCE_SYSTEM.regions` |
| Names | the bible's four styles: grave (-polis), punk, Mind names, plain; wilder and harder markets toward the outer dark | `names.ts`, region `styles` |
| Schedules | first ark February 3026, then about every eleven weeks; the Assembly every 61 days; Velloran Reach votes every four years from May 3026 | `REFERENCE_SYSTEM.news` |

## The overlay

Everybody has a neural link with a visual overlay, as common as phones today (Arnd, 2026-10-23, canon). The names beside the habitats' points are what the overlay shows. So is the Habitats part of the Solar system panel, with each polity's light time to home. The same overlay is how later steps show what is going on without telling: a voyage's news catching up, an array's window, a ship passing.

## Visiting another habitat (a proof of concept)

The Habitats panel tells, for the habitat chosen, how far it is from where you are and how long the trip would take by sail, by coasting torch ship and in a hurry (`tripsTo`, `TravelParams`: about two months, a week or two days to Mars; nine months, three months or eight days to Saturn). Visit takes you there at once and you step out on its arrival terrace: the sample habitat at that habitat's size, with its own seed, Mind and people (`blueprintOf`), its news heard with its own light-lag. Clicking a name in view chooses it. Return home goes back. The Outside view stays at home for now.

In the game it will not be this easy (Arnd, 2026-10-23): you find a ship going your way, or have one, or a friend has one, and ships are often people with one or more avatars. The trip times are what such a voyage takes; S5 lives them.

## Next

Other habitat forms are parked (Arnd, 2026-10-23): until something is playable, every habitat is drawn and entered as the sample cylinder, sized from its record; the ledger keeps each one's form for later. The plan's order after this step, without S3 (a second form): arrays and sail traffic (S4), voyages lived with the speed hierarchy (sails, coasting torch ships, a full burn only in a hurry) and long voluntary sleep instead of hibernation (S5), law and money (S6), the bible's situations (S7), named places (S8).

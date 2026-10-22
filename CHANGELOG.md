# Changelog

Every merge to main is the next version, v0.001 and up by 0.001. The notes come from `changes/` (see changes/README.md); never edit this file by hand.

## v0.092 — Renders publish in seconds again

- Behind the scenes: the render PC pushes each result set on top of the last one, so it uploads only the new pictures instead of the whole branch (seconds, not minutes), and a hung network call can no longer stop the watcher for good.

## v0.091 — Riding the lifts down and up

- Click the bronze doors in an entrance court's portal (left button, or a tap) and you step into a lift cabin that rides down its shaft into the Understorey. The pointer turns into a hand over doors you can use.
- Below, click a lift's open bronze cage: its cabin comes down out of the vault, and you ride it back up to the court.
- The cabin waits at the top until the pillar forest below is ready, so you never arrive in an empty dark.
- Debug menu: "To a lift: at its doors" and "Below: at a lift cage" put you in front of one.

## v0.090 — Light wells and lift cages below the courts

- Under every entrance court, its light well now comes down through the vault: look up from the wellhead and the court's glass glows with the day, and a pool of daylight falls on the floor below.
- Next to it stands the court's lift: an open bronze cage from the floor up into the vault, in the bay its portal above faces. Riding it comes next.
- The pillar forest reads as lamplight now, warm and dimmer, and the ribs on the vaults are rounded mouldings instead of flickering dark lines.
- Courts now sit over the middle of a bay below, and a court whose rim a path or river crosses is dug deep enough there too.

## v0.089 — Entrance courts keep off the ends of the land

- No entrance court is dug into the foot of the Gate any more, or set right at the edge of the wild reserve: each keeps about an eighth of the entrance spacing from both. One court in the reference habitat used to sit 6 m from the Gate, its floor 68 m down.

## v0.088 — The pillar forest below the land

- Below the land there is now a place to stand: the Understorey, a forest of stone pillars whose fan vaults hold up the land above, lit by warm lamps under each capital and fading into lamp-lit mist.
- It follows the land: under a hill its ceiling rises, under a lake it dips, and its floor never gets steeper than a gentle walk.
- For now the debug menu takes you down ("Below: …") and back up; the lifts in the entrance courts come next.

## v0.087 — People turn detailed sooner, and come in every skin tone

- Walking up to someone, their detailed figure is there in moments instead of about ten seconds. Shader builds may now use a third of the time, spread evenly, so quick builds no longer wait a fifth of a second each.
- Figures start getting ready from 50 m away, and the nearest people always get theirs first.
- Teeth, tongue, eyes, lashes and brows no longer cast shadows of their own.
- Residents' skin spans the whole range from dark to light. Before, the detailed figures' skin came out nearly white (Actors' photo skins don't reach the screen with its new shared materials), so figures wear a plain skin in their own tone until Actors fixes that.

## v0.086 — The plan of the city below

- The Blueprint tab's "Under the floor" now maps the Understorey, the living layer under the land: a grid of stone pillars carrying the land, a hamlet of about 800 people under every entrance court (wellhead, halls, homes in lanes), galleries under the land's ways, rings of cisterns that balance the spin, and the open, dim pillar forest between them.
- The pillars are sized from the weight of the land they carry and the stone they are cast from (about 2 m thick in the reference); a habitat whose stone cannot carry its land is refused.

## v0.085 — Actors 0.6.5

- People and animals come from Actors 0.6.5: only the clothes a person actually wears are fitted and drawn, and a change of outfit costs one pass.
- Fixes from Actors: no red glow along wrists, fingertips and beards facing away from the light, no missing shoes, and no pinholes at clothing seams from afar.

## v0.084 — A better look at the deer

- Debug menu: "Fly: the nearest deer from 60 m" (and the squirrel one from 15 m) now stays low, under the trees, instead of ending up in a crown.

## v0.083 — Deer on the wild land

- Herds of deer live on the wild reserve and in the districts kept for herds or let go wild: fallow, red, roe, sika, white-tailed and chital deer, each herd one kind, from Actors 0.6.3.
- Their day follows the light where they live: they come out of the woods to graze as the light comes up, drift slowly over their meadow, walk back under the trees to lie up round the brightest hours, come out again for the afternoon and evening, and go back into cover after dark. They walk in file from place to place, and ford a stream but never cross a lake.
- Fallow, sika and chital deer have their spots, drawn sharp up close; every deer has its rump patch, dorsal stripe and markings from Actors.
- Near ones are full animals, further off each is a speck in its coat's colours out to about 2 km, handed over in one frame so a deer never vanishes.
- Every deer is somewhere at every moment, worked out from the seed and the clock. How many per km², how big a herd and how far it roams are habitat settings.
- Debug menu: "Before the nearest herd", "Fly: beside the nearest deer" and "…from 60 m"; a deer line counts them by level and any handover holes.

## v0.082 — Squirrels in the woods

- Squirrels from Actors live in the woods and orchards: each has its own home tree, and by day comes down to forage round it, hopping a short way or running a long one, eating, sitting up alert, flicking its tail, and going back to its tree. At night they are up in their trees.
- Grey, red, fox and black squirrels, each with its coat from Actors (white belly, darker back, nose, eyes), and fine locks of fur up close.
- Every squirrel is somewhere at every moment, worked out from the seed and the clock: the same squirrel is at the same tree for everyone. How many live per hectare of woods, how far they roam and how long they stay down are habitat settings.
- Near ones are full animals; further off each is a speck in its coat's colours, handed over in one frame so a squirrel never vanishes.
- Debug menu: "Fly: beside the nearest squirrel" and "…from 15 m"; the animals line counts them by level and any handover holes. Deer come once Actors has them.

## v0.081 — Drones work the land

- Drones from Actors' drone kit fly over the interior, each with a job: couriers carry things from the entrance courts to the places around them along the ways, tenders work the orchards and the Vine face, surveyors circle the reserve and the Mountain, lifters bring loads down the Gate's face, gliders ride the thin air near the axis, and guardians hover over the lake and off the flight launch.
- Every drone is somewhere at every moment, worked out from the seed and the clock: couriers rest on their pads between rounds, and the same drone is in the same place for everyone.
- Up close their rotors spin, strobes flash, and they bob, tilt into their way and bank into turns as the gravity where they fly asks. Further off they are drawn simpler, and far away as specks, so a drone never vanishes.
- Debug menu: "Fly: beside the nearest drone at work" and "…from 60 m"; the drones line counts them by level and any handover holes.

## v0.080 — Crowds stay visible at any distance

- People no longer vanish beyond 1.5 km: everyone up on the land in the whole habitat is drawn, far off as a faint speck the size of the body, so a crowd on the far side shows as the tint it makes.
- Walkers far away keep walking between updates, and specks take each person's own clothes colours once their look is known.
- Close by nothing changes: figures near, stand-ins out to where a body is about 3 pixels tall, then specks, each handing over in the same frame.
- Standing on the Lift Stair is worked out 4.5 times faster in big habitats.

## v0.079 — People on the land around you

- The residents are out on the land in 3D now. They come up at the entrance courts, walk the paths to their places, talk in groups, work kneeling on the makers' commons, lie on the grass, tread water at the lake, and walk the Sunwalk with the light.
- Up close they are Actors people and shells (Actors' plated humanoid bodies), each always the same person in their own clothes and colours. Further out, out to 1.5 km, each one is a small stand-in with the same height, colours and stride, so nobody vanishes with distance. Close figures use Actors' own detail levels.
- Arriving in a big crowd (two thousand people around the Lift Stair in the afternoon), people come in nearest first over a few seconds instead of freezing a frame. Measuring them no longer keeps Actors' body targets in memory, and the pack's files are not kept twice; the memory line lists `people` on its own.
- Finding where someone stands on the Lift Stair is about 40 times faster (the same result), which also helps when you walk near the Stair yourself.
- Debug menu: "Before the nearest crowd" takes you to the busiest spot within 2 km, and the `people` line counts figures, stand-ins and handover holes (always 0).
- Actors is updated to 0.6.0.

## v0.078 — Who is out on the land: the first people, on a map

- The Blueprint tab has a new map, "Who is out on the land": every resident up on the land at an hour you pick with a slider, one dot each, coloured by what they are doing.
- People follow the light. On a fine afternoon about one in ten residents is up on the land, and because each outing starts by local daylight the crowd moves down the tube during the day, from the Mountain to the Gate.
- They come up at the entrance courts, walk the ways to the commons, the Sunwalk, the lake shore or a landmark, stay a while and go back down. A long procession walks the Sunwalk with the bright stretch, and at dusk thousands gather on the Stair face.
- Everyone is a regular: the same person comes back to the same place at about the same hour on their weekdays, worked out from the seed and the clock, with nobody simulated.
- Nothing is drawn in the 3D view yet; people on the land come next.

## v0.077 — Grown halls in the grove districts

- In each grove district, near an entrance and on level ground, stands a hall grown from two rows of lindens. Over two centuries their limbs were trained across the nave into pointed arches, crosswise into ribs and along the rows into an arcade, fused into knots where they meet. Their crowns close above it into one roof, seen from far away.
- Low down, young stems woven between the trunks make a lattice screen, open where a path comes in. Inside are a long table with benches, a stone hearth at one end and a low stone dais at the other. The floor is a lawn.
- You can walk in and stand on the dais. The hall comes in from far away and gains its ribs, knots, roots and lattice up close.
- Debug menu: "To a grown hall: in its nave, by the table", "To a grown hall: on its dais", "Fly: beside a grown hall", "Fly: a grown hall from afar".

## v0.076 — Bridges where the ways cross the rivers

- Wherever a way meets a river, the district has built its crossing its own way: humped stone bridges on arches with cutwaters and parapets in the stone gardens (glazed brick among the makers), timber bridges on trestles with planks and rails in the orchards, living halls and pastures, stepping stones by the water and where people play, and a log laid across with a rope handline where the land was let go.
- Each is sized to its river: wider rivers get more arches, more bents, more stones; the arches and beams always clear the water.
- You can walk over them; plants keep off them. They come in from far away and gain their planks, voussoirs and coping up close.
- Debug menu: "Onto the nearest river crossing", and "Fly: by the nearest …" for each kind.

## v0.075 — Orchards and vineyards

- Near the entrances of the orchard districts, blocks of apple trees (olive groves in the Mediterranean climate) stand in straight rows on level ground, with a mown strip round each.
- The Gate's Vine face is wine country now: its lower terraces are cut into parcels of vines, orchards and meadow, so the face reads as a patchwork from anywhere in the habitat. The vines stand in rows along each terrace.
- New debug menu entries take you into the nearest orchard, the nearest vineyard, or flying over the floor before the Vine face.
- On hills the nearest plants, grass and stones were missing: they were measured and culled from the cylinder's base surface, not the ground. Now they stand around you on high ground too.

## v0.074 — Entrance courts lead down to the city below

- Every entrance to the city under the land is now a built court: a round sunken hollow lined with a stone wall (darker plinth, pilasters, coping), a floor paved in rings and a stone walk along its rim.
- In the middle of each court a round light well of glass looks down into the city below, with a stone seat around it.
- Two stairs curve down along the wall from a landing at the rim's lowest point. Opposite them, where the wall is highest, a stone portal rising above the rim walk frames tall bronze lift doors, with lamps on either side. Stone benches stand at the wall's foot.
- Each district builds its courts its own way. Orchards use warm sandstone, water districts pale limestone and makers glazed brick. Where the land was let go, the courts have no railings, the stone is weathered and slabs are missing from the paving.
- Courts show from across the cylinder and gain stairs, railings, doors and benches as you come closer. You can walk on the floor, the stairs and the walk, and plants keep out of the courts. The debug menu's Go group takes you into a court, onto its rim walk or over it.

## v0.073 — The paths are in the land

- The Sunwalk runs the length of the floor as a broad way of pale stone, levelled into the hills, down the side of the main valley.
- Ways join every entrance to the Sunwalk and swing gently from side to side. Each district lays its stretch in its own material: mown grass in the orchards, laid stone in the stone gardens, leaf litter in the groves, trodden earth in the pastures, pale sand by the playing fields. You can see a way change where it crosses a border.
- A trail climbs the Mountain to the summit hut.
- Trees, bushes and stones keep off the paths. From far away a path shows as a faint pale line.
- Debug menu → Go: onto the Sunwalk, onto the nearest way, onto the Mountain trail.

## v0.072 — A summit hut hangs on the Mountain's cliff

- High on the Mountain, below the snow, a hut hangs on the rock face: a stone buttress built into the cliff, and an open timber hall under a steep slate roof whose ridge points down the whole length of the cylinder.
- Past the hall there is a railed terrace, and beyond it a narrow launch prow out over the drop, where flyers step off in low gravity.
- Inside are a hearth in the rock wall, a long table with benches, and lanterns under the front beam. Under the floor, stone corbels and timber struts rake back into the rock.
- You can walk on its floor, terrace and prow, and plants keep off the rock it hangs on. The debug menu's Go group takes you onto the terrace, or flies you beside it, under it or far out from it.

## v0.071 — The ground-tile speed check moves to the slow tests

- Behind the scenes: the check that a ground tile builds within 40 ms now runs warmed up in the slow test suite, because GitHub's machines vary too much in speed for it to be fair on every change.

## v0.070 — Ground tiles build a little faster again

- The ground streams in a little faster: the district lookup skips neighbours that cannot be nearest, and a few slow distance calculations in the ground's inner loops are done the quick way.

## v0.069 — The floor has its valleys, and the entrances their courts

- The floor now rises from each valley's middle to the ridges between the valleys, so each valley is a long room: a broad meadow floor with its river down the middle, and rolling, drier ground up its sides, where heath takes the driest ridge tops.
- Every entrance to the living layer digs its court into the ground: a level floor a few metres under the lowest ground on its rim, laid in gravel and stone, with a steep wall up to the rim and no trees over it or round it. Its walls and stairs come next.

## v0.068 — The Lift Stair climbs the Gate

- The Gate at the port end now has its Lift Stair: a stone stair from a forecourt on the floor all the way up to near the hub, about 13,000 steps over almost 4 km of height in the reference habitat.
- It zigzags across the Gate's ramp in long flights between turning platforms, with landings every 18 steps. As gravity fades on the way up, the steps get taller (the same effort per step), until near the hub they are ledges you bound up.
- It is there from anywhere in the habitat. Closer in, single steps and parapets appear, and up close bronze nosings, copings, handrails and lamps. A finer version only replaces a coarser one once it is ready, so nothing pops away.
- You can walk on it, and no trees or bushes grow through it. The debug menu has Go entries for its foot, a landing halfway up, and views from beside it, close up and near the hub.

## v0.067 — Snow on the Mountain

- The top of the Mountain at the wild end now lies under snow, from the snow line up to the axis. The Gate's top stays bare.
- The snow's edge is torn and patchy. Steep rock shows through it as dark ribs and walls.
- Near the axis, where gravity is weak, snow clings to walls far steeper than it could on Earth.
- The snow looks the same from across the habitat as it does underfoot. No trees, grass or small stones stand on it; big boulders stand out of it.
- Your eyes stop down when you look at a sunlit snowfield.

## v0.066 — Bushes: low, the same colour near and far, and never gone before the near one is there

- Bushes are clearly lower now: most are knee to chest high, none reaches the eyes of someone standing.
- Walking up to plants, the distant version of a bush, tree, tuft of grass or stone stays until the close-up version is ready, then hands over plant by plant. Nothing vanishes and waits any more.
- Distant bushes and trees have the colour of their leaves. Before, they were darker and greener than the bush you then walked up to.
- In the hand-over zone no plant goes missing for a moment any more (the two levels used to disagree about which plant to draw).
- Debug menu: a "plant LOD" line counts holes (always 0), and Render → "Plants: every level → only the full → …" shows one level at a time to compare them.

## v0.065 — Ground tiles build faster again

- A biome that cannot grow at a point no longer works out its patch pattern there, and the district lookup is cheaper (one octave for the bending borders, the style's lean kept ready). The ground's colour per point is back to what it cost before the districts came, with the same result.
- The districts' test has its own file, keeping the ecology tests under their time budget.

## v0.064 — The districts show in the land

- Each district of the worked floor now grows its land in its style: groves keep closed woods with glades, herds keep wood pasture in wide sweeps, play districts open fields, water districts wet ground with reeds, orchards and makers small blocks of trees over meadow. Districts that let their land go keep the climate's own mix.
- Belts of trees run along the borders between districts, broken here and there, like hedgerows marking out a worked land, so the plan reads from the far side.
- District borders bend with the land instead of running straight.

## v0.063 — The ground keeps to its memory budget

- Near the endcaps' rock walls (Arnd saw it at the foot of the Gate) the ground no longer eats gigabytes: cliffs are drawn as finely as their cells can show, not split down to the smallest tiles everywhere they are seen.
- The ground has a hard memory budget: if a view would need more, it is drawn a little coarser until it fits, and the debug menu says so ("coarser ×…", or "OVER BUDGET").
- The debug menu has a Copy button that puts its whole info text on the clipboard.

## v0.062 — The Mountain's summit band, the Water face's basins

- Near the axis the Mountain's spurs no longer stand as a ring of thin rock fins hanging toward the floor: a spur only stands as tall as it has room to be wide, so the valleys close into one broad summit band.
- The Gate's Water face has bigger, fewer basins (tens of metres across), so it no longer reads as a fine crinkle from afar.

## v0.061 — Rock with beds, streaks and lichen

- The Mountain's rock is no longer one pale grey: it shows folded beds of darker, warmer and paler stone on its walls, dark streaks where water runs down, iron-stained tones and lichen, the same colour near and far.
- The Gate's faces read from afar by what they are: the Stair face pale dressed stone, the Vine face green, the Water face dark wet rock with pools.
- Standing high on the Mountain near the axis, your eyes now stop down in its blazing light.

## v0.060 — Clouds on the move

- The clouds drift with a breeze you can see in real time, and change shape slowly as they go: their heaps and edges slide through the big shapes. Their shadows on the land drift with them.

## v0.059 — The endcaps become land: the Mountain and the Gate

- The wild end is now a mountain: couloirs climb up each valley between rocky spurs, all turning a little with the spin as they rise, a horn stands at the head of the main valley, and a cirque is dug into the far side under its headwall.
- The port end is now the Gate: one face per valley, between rock buttresses. The Stair face climbs in level rings of formal terraces with a plain ramp up its middle where the Lift Stair will go; the Vine face is narrow contour terraces; the Water face is broad basins over sheer drops.
- The rivers now run where the habitat's plan wants them: the great river down the main valley from the Mountain's snow, the canal from the Water face, brooks and cascades in the other valleys.
- Stones lie properly on rock that slopes two ways at once.

## v0.058 — The founders' grove

- On its site near the port end stands the founders' grove: a ring of the oldest and tallest oaks in the habitat (stone pines in a Mediterranean habitat) around a mown lawn, planted when the habitat was new. A small habitat gets one great tree instead.
- The ring stays visible from far away and from the far side, where it shows as a ring of dark crowns in the land.
- Go → "To the founders' grove" takes you into its clearing.

## v0.057 — The pavilion on the Sunwalk

- The assembly pavilion now stands where the habitat plan puts it: in the middle of the ring lake, where the Sunwalk crosses it. The long path runs over its bridges and through its hall.

## v0.056 — Eyes adapt to the glow near the axis

- Looking down the tube from near the axis toward the sun, your eyes now stop down, so the bright air reads as sunlit haze instead of burning out to white.
- Views along the floor look as before; looking up at the far side at noon is a touch darker.

## v0.055 — The habitat has a plan for its land

- The Blueprint tab shows a new "Land plan": the floor unrolled and both endcaps face-on, as the habitat's mind planned them.
- Three valleys run along the axis. The wild fifth of the floor is a reserve, and the rest is cut into districts, one above each neighbourhood of the living layer. Each district shapes its commons in its own style: orchards, water gardens, stone gardens, grown groves, herds, play fields, makers' workshops, or land let go wild.
- The port end becomes the Gate, with a Stair face, a Vine face and a Water face. The wild end becomes the Mountain, with its summit up the main valley and snow near the axis.
- The plan marks the entrances down to the living layer, the ways between them, the rivers with their roles (the great river, the canal, brooks, cascades), and the Sunwalk, the long path you can walk with the travelling sun.
- It is only a plan for now: the land itself follows it in the next updates.

## v0.054 — Ragged cloud bottoms

- Seen from low over the floor, the cloud layer no longer ends in one hard line where your view just grazes its underside. Each patch of clouds now has its own base height, so the edge breaks up into single cloud bottoms.

## v0.053 — An assembly pavilion on the ring lake

- The first landmark: a wide, open round hall on piers in the middle of the ring lake, with rows of seats around a speaking floor and an open pool in the centre, under a tiled roof with an oculus.
- Two bridges lead to it from either shore. You can walk across them and onto the deck and seats.
- It stands where the shore is quiet, away from the river mouths, and plants keep clear of it and its landings.
- It is visible from anywhere in the habitat and gains detail as you come closer: stone courses, deck planks, bronze rails with patina, roof tiles. Under the roof the light falls in past the eaves and through the oculus.

## v0.052 — Woods seen at a slant keep their groves

- Looking along the floor from a little height, distant woods no longer smear into soft dark streaks: their groves, clumps and ragged edges stay visible much farther out.

## v0.051 — Endcaps in ledges and rock walls

- The endcap slopes no longer look like a grey disc of perfect rings from afar. They climb in green ledges and steep rock walls that wander around the axis, merge and part, and wear down here and there. Ledges hold meadow, heath and pines; trees no longer grow on sheer rock.
- Flying high over the floor, a dark square no longer shows on the ground below you.

## v0.050 — The ground needs a quarter of the memory

- Each piece of ground now judges its distance from you by its own height, not by the tallest terrace in the habitat. Flat ground nearby no longer gets the finest detail out to 150 m, where it showed nothing more. Ground memory on the floor drops from about 300 MB to about 70 MB, and at the endcaps' tips from about 440 MB to about 230 MB. The picture stays the same.

## v0.049 — Softer cloud bases

- Cloud bases are flat under each cloud's middle and lift toward its rim, so where they meet the horizon they no longer form one ruler-straight line.
- Long views along the axis no longer show ring patterns in the clouds.

## v0.048 — Clouds

- A cloud layer a kilometre or so above the floor: grey-bottomed cumulus overhead, bright where the sunline shines through a thin edge, and their sunlit tops on the far side of the cylinder.
- The wind carries them along and around the axis, and their shadows drift over the land.
- The habitat's weather is a schedule: some days nearly clear, some grey, with cumulus building through the afternoon. Every habitat sets its own layer (height, thickness, cover, cloud size, wind); a small one has none.
- Debug menu: fly up under or into the clouds (Go), and set the cover by hand (Time).

## v0.047 — The interior from far away

- Clearer air: the far side across the axis keeps its colours instead of fading into pale haze. How clear a habitat's air is is now one of its parameters.
- Woods seen from far away show crowns, shaded gaps, clumps and glades instead of soft colour blobs, and the far land is drawn in finer pieces, so wood edges, rivers and banks stay sharp across the cylinder.
- The debug menu's Go group has viewpoints high over the land ("Fly: …") for looking at the interior from above.

## v0.046 — The crossing into the Hub

- After your ship latches, the arrival goes on: you float down the spindle's bore, a pale tube lit by lamp strips, through the bearing's seal into the sleeve that turns with the habitat. The air there slowly carries you into the spin, and a small window shows the stars wheeling past. Light ahead.
- A short fade, and you float in the Hub beside the sunline, looking down it toward the wild end, in control (fly as usual). The interior is built while your ship comes in, so it is ready when you arrive.
- Any key still skips the whole arrival.

## v0.045 — Hung renders end sooner

- Behind the scenes: when a view on the render PC never finishes building, the other views of the same page in that request are skipped instead of each waiting two minutes, and the report says what the page still showed.

## v0.044 — Bushes: fewer, lower, and seen from afar

- Bushes are lower (most below head height) and there are about half as many, in the woods and in the meadows.
- Seen from afar a bush keeps its size: its distant version used to be much smaller than the bush, so bushes seemed to swell up as you came near. Trees' distant versions now match their crowns the same way.
- Bushes stay in view until they are a pixel or two tall (a kilometre or so for a two-metre bush) instead of vanishing past a few hundred metres.

## v0.043 — Arrival after Start

- Start on the title no longer cuts straight inside. Your ship carries on: first a view from above its back, looking down its corridor past the nose at the spindle growing in front of the turning endcap, then close on the berth as the nose meets the docking collar and latches with a soft jolt. Then you go inside. Any key skips it (and on the title card, any key still goes straight in).
- Ships at the spindle now fly nose first down their corridor, stop a couple of ship lengths out from their berth, pitch over and come straight in along the arm to the collar. Before, they slid onto the collar sideways.
- Your ship is the same one the title shows braking, sized for this habitat's berths, and it gets a berth that no other ship is due at.

## v0.042 — Half the memory inside

- The ground's tiles and the hull's detail tiles no longer keep a second copy in the browser's memory once the graphics card has them. Inside, near the endcap, the page's memory drops from about 585 MB to about 200 MB.
- For developers: `npm run shots` can take a heap snapshot and say who holds the memory (views `memory-inside` and `memory-title`).

## v0.041 — No more flicker where the sunline meets the endcaps

- The ground near the endcaps' tips no longer flickers. Near the axis the terrain was cut into thousands of thin slivers, far more than the tile cache holds, so tiles kept being dropped and built again. Tiles now stay about square there, and a view at the tip needs about as many as one on the floor.
- Tiles a view still uses are never dropped from the cache when it is full, and a tile just built is no longer the first to go. Before, once the cache was full (after a walk), finer ground near you could be built and thrown away over and over without ever showing, or whole stretches fell back to a coarse tile for a moment.
- Debug menu: the terrain line counts tiles that came on screen in the last frame and tiles built so far (both stop when you stand still), and two new Go entries take you near the wild endcap's tip and the port endcap's hub.

## v0.040 — Rivers

- Rivers now run through the habitat: they rise from springs high on both endcaps, tumble down the terraces as white cascades and waterfalls, and wind across the floor into the ring lake.
- Each river has carved its own channel and valley through the hills. You can wade in and swim, as in the lake.
- The water flows: ripples move downstream, rapids and falls foam white, the shallows by the banks show the riverbed, and the sunline glints off the moving surface.
- The banks are wetter, so reeds and willows grow along them, with gravel at the water's edge. The woods open over the water.
- Rivers stay visible from far away, even across the cylinder.
- Debug menu: Go to the nearest river, or to below the nearest falls.

## v0.039 — Render requests are not lost

- Behind the scenes: the render PC's watcher renders a request at the commit it saw and keeps a request that was pushed again meanwhile; only one watcher can run at a time.

## v0.038 — Ships at the spindle

- The spindle now has traffic. Torch ships and laser-sail freighters (sail folded in its drum) sit at the berth arms, nose on the docking collar, and others come and go.
- Arriving ships brake on their torch far out, its flame a bright point that goes out at the keep-out distance, then come in on thrusters, turn nose-in and drift the last stretch to the berth at half a metre per second. Leaving is the same backwards.
- Which ship is where comes from the world's seed and the clock, so every visit is the same each time you look, at any speed of the clock. The debug menu shows how many ships are berthed and moving.

## v0.037 — Memory no longer runs away

- Moving around inside (most of all near the endcaps, where the sunline meets the hull) no longer eats gigabytes: ground tiles, plants and hull detail that go out of view are now really freed. Before, they were only half freed and memory grew by a few gigabytes in a couple of minutes.
- The caches for ground tiles, plants and hull detail now also have a size limit in megabytes, not just a count.
- Debug menu, Memory: "Show memory details" lists what holds memory and the last totals right in the panel, and "Free the caches now" gives back what is not on screen.

## v0.036 — Stones and fallen wood

- Stones lie on the ground now: pebbles on gravel, field stones on bare earth, rocks and big boulders on the steep rock of the endcaps. Each is a rough lump with broken faces, mossy on top in the temperate climate, and they lie along the slope.
- Woods have fallen trunks and branches on their floor, in the bark of the trees they fell from, greyed where they face the sky.
- Big things are seen from far away (a boulder from kilometres), small ones only nearby, and up close every stone shows its grain.
- Debug menu: Go to the nearest fallen trunk, or the nearest boulder.
- On the endcaps' steep rock the eyes no longer adjust as if under trees, so it is no longer washed out.

## v0.035 — The hull up close: no more flicker, details from farther away

- Close to the cylinder the solar panels no longer sparkle and flicker in speckled patches. Each module's own shade and glint now only show while a module is bigger than a pixel, and half a panel no longer takes its neighbour's look.
- Where the detailed panels are drawn, the distant hull underneath steps aside, and the distant hull is cut into shorter pieces, so the two can never fight over the same surface.
- Details come in from about twice as far away: module frames, bolts, clamps and cables on the skin, and the finer parts of the plating, arms, mast and dishes.

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


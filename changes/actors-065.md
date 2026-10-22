# Actors 0.6.5

- People, animals and their clothes come from Actors 0.6.5. Every person now shares one shader per kind of material (skin, eyes, clothes, hair) instead of building their own, so walking into a crowd stutters less while shaders are made.
- Only the clothes a person actually wears are fitted and drawn, and a change of outfit costs one pass, which keeps memory down in crowds.
- Fixes from Actors: no red glow along wrists, fingertips and beards facing away from the light, no missing shoes, and no pinholes at clothing seams from afar.

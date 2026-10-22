# Eyes and real skin on people; the shader monitor names repeated shaders

- The debug menu's shader line now says how many shaders were built again with exactly the same code after the loading screen, and `shaders.repeats()` lists them, the costliest first. Each one is a thing that builds its shader per copy instead of once, the usual reason stutters come back.
- Eyes and photo skins show on every person again: the shared renderer now swaps in each figure's own textures (they stayed on a white placeholder).

# No more flicker where the sunline meets the endcaps

- The ground near the endcaps' tips no longer flickers. Near the axis the terrain was cut into thousands of thin slivers, far more than the tile cache holds, so tiles kept being dropped and built again. Tiles now stay about square there, and a view at the tip needs about as many as one on the floor.
- Tiles a view still uses are never dropped from the cache when it is full, which also stops whole stretches of ground from falling back to a coarse tile for a moment after a long walk.
- Debug menu: the terrain line counts tiles that came on screen in the last frame and tiles built so far (both stop when you stand still), and two new Go entries take you near the wild endcap's tip and the port endcap's hub.

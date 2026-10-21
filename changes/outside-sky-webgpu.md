# The sky outside draws in WebGPU

- The Outside tab shows black space, white stars, Earth and the Moon again. In WebGPU the sky shader failed to compile (its stand-in maps had no sampler), so the page's grey showed through, the stars looked black, and keys 2 and 3 pointed at nothing.
- Behind the sky is now black space, so a sky that fails to draw never shows the page.

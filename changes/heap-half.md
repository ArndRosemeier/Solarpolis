# Half the memory inside

- The ground's tiles and the hull's detail tiles no longer keep a second copy in the browser's memory once the graphics card has them. Inside, near the endcap, the page's memory drops from about 585 MB to about 200 MB.
- For developers: `npm run shots` can take a heap snapshot and say who holds the memory (views `memory-inside` and `memory-title`).

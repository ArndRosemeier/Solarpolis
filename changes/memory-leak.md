# Memory no longer runs away

- Moving around inside (most of all near the endcaps, where the sunline meets the hull) no longer eats gigabytes: ground tiles, plants and hull detail that go out of view are now really freed. Before, they were only half freed and memory grew by a few gigabytes in a couple of minutes.
- The caches for ground tiles, plants and hull detail now also have a size limit in megabytes, not just a count.
- Debug menu, Memory: "Show memory details" lists what holds memory and the last totals right in the panel, and "Free the caches now" gives back what is not on screen.

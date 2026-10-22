# Renders publish in seconds again

- Behind the scenes: the render PC pushes each result set on top of the last one, so it uploads only the new pictures instead of the whole branch (seconds, not minutes), and a hung network call can no longer stop the watcher for good.

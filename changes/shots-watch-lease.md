# Render requests are not lost

- Behind the scenes: the render PC's watcher renders a request at the commit it saw and keeps a request that was pushed again meanwhile; only one watcher can run at a time.

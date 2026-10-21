# The ground-tile speed check moves to the slow tests

- Behind the scenes: the check that a ground tile builds within 40 ms now runs warmed up in the slow test suite, because GitHub's machines vary too much in speed for it to be fair on every change.

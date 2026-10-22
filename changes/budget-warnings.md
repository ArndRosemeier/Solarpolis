# A slow test warns instead of failing

- Behind the scenes: a single test or test file over its time budget now shows as a warning on the change instead of failing it. Only the whole test run going over its 30 s limit fails. Test machines vary in speed, so one test near its limit used to fail at random and block everyone's changes. Nothing in the game changes.

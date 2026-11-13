// TASK 576 (node port of tests/axis-snap-live-session.test.js, TASK 537 part: session). Runs the scenarios named in ONLY of tests/axis-snap-node-runner.js.
process.env.ONLY = 'session,setting off';
await import('./axis-snap-node-runner.js');

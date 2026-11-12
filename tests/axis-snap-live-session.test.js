// TASK 537 live (part: session). Runs the scenarios named in ONLY of tests/axis-snap-live-runner.js.
process.env.ONLY = 'session,setting off';
await import('./axis-snap-live-runner.js');

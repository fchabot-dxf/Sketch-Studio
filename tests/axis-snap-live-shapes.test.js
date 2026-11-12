// TASK 537 live (part: shapes). Runs the scenarios named in ONLY of tests/axis-snap-live-runner.js.
process.env.ONLY = 'circle centre on Y axis,polygon centre on X axis,arc centre on X axis,select drag to X axis';
await import('./axis-snap-live-runner.js');

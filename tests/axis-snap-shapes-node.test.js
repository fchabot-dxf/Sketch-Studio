// TASK 576 (node port of tests/axis-snap-live-shapes.test.js, TASK 537 part: shapes). Runs the scenarios named in ONLY of tests/axis-snap-node-runner.js.
process.env.ONLY = 'circle centre on Y axis,polygon centre on X axis,arc centre on X axis,select drag to X axis';
await import('./axis-snap-node-runner.js');

// TASK 576 (node port of tests/axis-snap-live-lines.test.js, TASK 537 part: lines). Runs the scenarios named in ONLY of tests/axis-snap-node-runner.js.
process.env.ONLY = 'line end on X axis,line end on Y axis,line start on X axis,rect corner on X axis';
await import('./axis-snap-node-runner.js');

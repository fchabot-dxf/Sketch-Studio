// TASK 537 live (part: lines). Runs the scenarios named in ONLY of tests/axis-snap-live-runner.js.
process.env.ONLY = 'line end on X axis,line end on Y axis,line start on X axis,rect corner on X axis';
await import('./axis-snap-live-runner.js');

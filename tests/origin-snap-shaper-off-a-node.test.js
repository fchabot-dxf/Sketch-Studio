// TASK 576 (node port of tests/origin-snap-live-shaper-off-a.test.js): Shaper Design tab, axis snap off, default zoom and zoomed in 4 steps. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'shaper'; process.env.AXIS = 'off'; process.env.ZOOMS = '0,4';
await import('./origin-snap-node-runner.js');

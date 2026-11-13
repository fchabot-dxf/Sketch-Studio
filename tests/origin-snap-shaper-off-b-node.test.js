// TASK 576 (node port of tests/origin-snap-live-shaper-off-b.test.js): Shaper Design tab, axis snap off, zoomed out 4 steps, + no axis snap away from the origin. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'shaper'; process.env.AXIS = 'off'; process.env.ZOOMS = '-4'; process.env.AWAY = '1';
await import('./origin-snap-node-runner.js');

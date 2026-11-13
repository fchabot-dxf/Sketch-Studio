// TASK 576 (node port of tests/origin-snap-live-studio-off-z0.test.js): SketchStudio, axis snap off, default zoom, + no axis snap away from the origin. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'sketchstudio'; process.env.AXIS = 'off'; process.env.ZOOMS = '0'; process.env.AWAY = '1';
await import('./origin-snap-node-runner.js');

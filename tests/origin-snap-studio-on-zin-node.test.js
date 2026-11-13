// TASK 576 (node port of tests/origin-snap-live-studio-on-zin.test.js): SketchStudio, axis snap on, zoomed in 4 steps. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'sketchstudio'; process.env.AXIS = 'on'; process.env.ZOOMS = '4';
await import('./origin-snap-node-runner.js');

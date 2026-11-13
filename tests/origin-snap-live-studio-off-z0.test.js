// TASK 554 live: SketchStudio, axis snap off, default zoom, + no axis snap away from the origin. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'sketchstudio'; process.env.AXIS = 'off'; process.env.ZOOMS = '0'; process.env.AWAY = '1';
await import('./origin-snap-live-runner.js');

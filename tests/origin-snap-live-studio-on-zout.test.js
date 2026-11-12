// TASK 554 live: SketchStudio, axis snap on, zoomed out 4 steps. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'sketchstudio'; process.env.AXIS = 'on'; process.env.ZOOMS = '-4';
await import('./origin-snap-live-runner.js');

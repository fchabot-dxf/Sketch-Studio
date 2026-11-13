// TASK 554 live: SketchStudio, axis snap on, default zoom, + axis snap away from the origin. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'sketchstudio'; process.env.AXIS = 'on'; process.env.ZOOMS = '0'; process.env.AWAY = '1';
await import('./origin-snap-live-runner.js');

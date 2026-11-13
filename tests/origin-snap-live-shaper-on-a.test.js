// TASK 554 live: Shaper Design tab, axis snap on, default zoom and zoomed in 4 steps. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'shaper'; process.env.AXIS = 'on'; process.env.ZOOMS = '0,4';
await import('./origin-snap-live-runner.js');

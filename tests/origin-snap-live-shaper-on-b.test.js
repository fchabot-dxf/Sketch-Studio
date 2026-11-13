// TASK 554 live: Shaper Design tab, axis snap on, zoomed out 4 steps, + axis snap away from the origin. Runs tests/origin-snap-live-runner.js (snap onto the origin after "New design", every tool).
process.env.HOST = 'shaper'; process.env.AXIS = 'on'; process.env.ZOOMS = '-4'; process.env.AWAY = '1';
await import('./origin-snap-live-runner.js');

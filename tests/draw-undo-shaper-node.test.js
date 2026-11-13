// TASK 576 (node port of tests/draw-undo-live-shaper.test.js): every scenario of the runner in the Shaper Design tab + journal labels.
process.env.HOST = 'shaper';
await import('./draw-undo-node-runner.js');

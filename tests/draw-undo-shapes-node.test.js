// TASK 576 (node port of tests/draw-undo-live-shapes.test.js): arc, polygon and bezier are one undo step each.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'arc,polygon,bezier';
await import('./draw-undo-node-runner.js');

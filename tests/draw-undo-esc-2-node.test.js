// TASK 576 (node port of tests/draw-undo-live-esc-2.test.js): Esc mid-draw (arc, polygon, bezier) leaves nothing and no undo step.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'esc mid-arc,esc mid-polygon,esc mid-bezier';
await import('./draw-undo-node-runner.js');

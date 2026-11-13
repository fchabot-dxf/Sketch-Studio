// TASK 576 (node port of tests/draw-undo-live-esc.test.js): Esc mid-draw (line, rect, circle) leaves nothing and no undo step.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'esc mid-line,esc mid-rect,esc mid-circle';
await import('./draw-undo-node-runner.js');

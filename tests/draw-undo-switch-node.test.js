// TASK 576 (node port of tests/draw-undo-live-switch.test.js): picking another tool mid-draw (line, rect, circle) leaves nothing, no step.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'switch tool mid-line,switch tool mid-rect,switch tool mid-circle';
await import('./draw-undo-node-runner.js');

// TASK 576 (node port of tests/draw-undo-live-switch-2.test.js): picking another tool mid-draw (arc, polygon, bezier) leaves nothing, no step.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'switch tool mid-arc,switch tool mid-polygon,switch tool mid-bezier';
await import('./draw-undo-node-runner.js');

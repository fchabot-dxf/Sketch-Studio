// TASK 549 live (SketchStudio): picking another tool mid-draw leaves nothing and no undo step (line, rect, circle).
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'switch tool mid-line,switch tool mid-rect,switch tool mid-circle';
await import('./draw-undo-runner.js');

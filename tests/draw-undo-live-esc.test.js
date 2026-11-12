// TASK 549 live (SketchStudio): Esc mid-draw leaves nothing and no undo step (line, rect, circle).
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'esc mid-line,esc mid-rect,esc mid-circle';
await import('./draw-undo-runner.js');

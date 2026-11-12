// TASK 549 live (SketchStudio): picking another tool mid-draw leaves nothing and no undo step (arc, polygon, bezier).
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'switch tool mid-arc,switch tool mid-polygon,switch tool mid-bezier';
await import('./draw-undo-runner.js');

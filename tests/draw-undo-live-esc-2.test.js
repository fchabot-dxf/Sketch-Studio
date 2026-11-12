// TASK 549 live (SketchStudio): Esc mid-draw leaves nothing and no undo step (arc, polygon, bezier).
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'esc mid-arc,esc mid-polygon,esc mid-bezier';
await import('./draw-undo-runner.js');

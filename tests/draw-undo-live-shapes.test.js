// TASK 549 live (SketchStudio): arc, polygon and bezier are one undo step each.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'arc,polygon,bezier';
await import('./draw-undo-runner.js');

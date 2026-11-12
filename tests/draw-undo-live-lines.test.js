// TASK 549 live (SketchStudio): one drawn line = ONE undo step (empty-to-empty, from an existing point); a chain of 3 lines = three steps with no orphan point; a fillet = one step.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'line empty-to-empty,line from existing point,chain of 3 lines,fillet';
await import('./draw-undo-runner.js');

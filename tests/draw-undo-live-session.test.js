// TASK 549 live (SketchStudio): LINE_CHAIN_UNDO = 'per-tool-session': one Ctrl+Z removes the whole chain; rect and circle are one step each.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'chain per-tool-session,rect,circle';
await import('./draw-undo-runner.js');

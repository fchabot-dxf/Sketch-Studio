// TASK 576 (node port of tests/draw-undo-live-session.test.js): LINE_CHAIN_UNDO per-tool-session; Ctrl+Z while the Line tool is active; rect, circle.
process.env.HOST = 'sketchstudio';
process.env.ONLY = 'chain per-tool-session,ctrl+z while line active,rect,circle';
await import('./draw-undo-node-runner.js');

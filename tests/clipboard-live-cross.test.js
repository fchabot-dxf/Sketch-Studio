// TASK 559 live: copy in SketchStudio, reload into Shaper (the shared Design tab), Ctrl+V there: the system clipboard crosses apps and reloads.
process.env.HOST = 'sketchstudio';
process.env.CROSS = '1';
await import('./clipboard-live-runner.js');

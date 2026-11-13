// TASK 539 glyph live (part a). The gate runs each *.test.js under 90 s: SCEN selects the scenarios of test./reference-lines-glyph-live-runner.js.
process.env.SCEN = '^(parallel|perpendicular)';
await import('./reference-lines-glyph-live-runner.js');

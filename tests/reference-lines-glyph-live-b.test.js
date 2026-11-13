// TASK 539 glyph live (part b). The gate runs each *.test.js under 90 s: SCEN selects the scenarios of test./reference-lines-glyph-live-runner.js.
process.env.SCEN = '^(collinear|point on)';
await import('./reference-lines-glyph-live-runner.js');

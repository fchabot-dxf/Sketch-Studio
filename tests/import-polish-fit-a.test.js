// tests/import-polish-fit-a.test.js — TASK 570 / 601 (a part of the old import-polish.test.js, split so no live file runs over ~40 s): after an import
// the shared importer FITS the view to the imported shapes, in SketchStudio and Shaper (the other two apps: import-polish-fit-b). Live, headless Edge.
//  FIT RULE: the screen box of the imported shapes lies inside the canvas box (1.5 px tolerance) AND fills at least half of the canvas in its
//  tighter dimension (the fit leaves a 10 % margin on every side, so the box takes about 80 %). The asserts are in tests/helpers/import-polish-fit.js.
import { runImportFit } from './helpers/import-polish-fit.js';

await runImportFit(['SketchStudio', 'Shaper'], '570a');

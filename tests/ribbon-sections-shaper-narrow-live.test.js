// tests/ribbon-sections-shaper-narrow-live.test.js — TASK 647: in shaper the tool ribbon never scrolls; each section shows the tools in the bar that fit, then its name
// (the dropdown: every tool runs from there, checkbox in the bar, hold-drag reorder, Reset), at 1280 / 390 / 360 portrait and 844 x 390 landscape, real
// mouse and touch; the layout survives a reload. The checks are tests/helpers/ribbon-sections.js (shared by the per-host, per-part files: wide / narrow / customise).
import { runRibbonSections } from './helpers/ribbon-sections.js';

await runRibbonSections('shaper', 'narrow');

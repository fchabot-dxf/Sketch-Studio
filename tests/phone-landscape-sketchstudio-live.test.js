// tests/phone-landscape-sketchstudio-live.test.js — TASK 602: phone LANDSCAPE in sketchstudio at 844 x 390 and 780 x 360, real touch: the canvas gets >= 60 % of the height,
// the ribbon is a left rail every tool of which is reachable and activates with a real tap, every other control is 44 px and uncovered, the SKETCHES box
// starts collapsed. The checks are tests/helpers/phone-landscape.js (shared by the four per-host files).
import { runPhoneLandscape } from './helpers/phone-landscape.js';

await runPhoneLandscape('sketchstudio');

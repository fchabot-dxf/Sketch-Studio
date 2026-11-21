// tests/text-845-penplotter-phone-live.test.js — TASK 845, Pen Plotter on a phone (390 x 844, touch): the Text tool's letters are the plotted strokes
// (tests/helpers/text-845-live.js plotterTextPhase).
import { plotterTextPhase } from './helpers/text-845-live.js';

await plotterTextPhase({ phone: true });

// tests/text-845-penplotter-live.test.js — TASK 845, Pen Plotter desktop (1280 x 800, mouse): a text from the Design tab's Text tool (an outline font, then a
// single-line font) is plotted as lines: every letter curve a stroke of the drawing, the text shape none (tests/helpers/text-845-live.js plotterTextPhase).
import { plotterTextPhase } from './helpers/text-845-live.js';

await plotterTextPhase({ phone: false });

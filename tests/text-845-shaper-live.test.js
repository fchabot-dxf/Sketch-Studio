// tests/text-845-shaper-live.test.js — TASK 845, Shaper desktop (1280 x 800, mouse, mm): a text placed with the Design tab's Text tool is cut in Prepare like any
// outline: a click on the ring of its 'o' picks the letter WITH its counter as a hole and Pocket assigns it; a single-line text (Hershey Simplex) is open strokes:
// On line; the exported file writes the o with its counter (tests/helpers/text-845-live.js shaperTextPhase).
import { shaperTextPhase } from './helpers/text-845-live.js';

await shaperTextPhase({ phone: false });

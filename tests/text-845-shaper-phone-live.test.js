// tests/text-845-shaper-phone-live.test.js — TASK 845, Shaper on a phone (390 x 844, touch): the Text tool's text in Prepare: the o's ring is a Pocket with its
// counter as a hole, the Hershey stroke On line (tests/helpers/text-845-live.js shaperTextPhase).
import { shaperTextPhase } from './helpers/text-845-live.js';

await shaperTextPhase({ phone: true });

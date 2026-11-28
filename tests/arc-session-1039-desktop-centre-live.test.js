// tests/arc-session-1039-desktop-centre-live.test.js — TASK 1039, split by TASK 1043: the Center Point Arc on the desktop (1280x800, mouse) in a real
// browser: typed radius 12 + sweep 90 (Enter / Enter, click / click), nothing typed with the end on b (click x3, click x2 + hover + Enter, drag-release +
// click); each group the same document, the preview before the last step the arc built. The cases and checks: tests/arc-session-1039-live-runner.js.
import assert from 'node:assert';
import { runArcSession } from './arc-session-1039-live-runner.js';

const failures = await runArcSession({ width: 1280, height: 800, tag: 'desktop', variants: ['centre'] });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('arc-session-1039-desktop-centre-live: PASS');

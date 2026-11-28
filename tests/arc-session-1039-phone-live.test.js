// tests/arc-session-1039-phone-live.test.js — TASK 1039, split by TASK 1043: both Arc variants on the phone (390x844, touch) in a real browser: Center
// Point Arc typed (tap the box + Enter twice, tap the box + tap the canvas) and untyped (tap x3, finger drag + tap: the short way round); 3-Point Arc
// typed (tap the box + Enter + tap the side, tap the box + tap x2) and untyped (tap x3, finger drag + tap); each group the same document. The cases and
// checks: tests/arc-session-1039-live-runner.js.
import assert from 'node:assert';
import { runArcSession } from './arc-session-1039-live-runner.js';

const failures = await runArcSession({ width: 390, height: 844, tag: 'phone', variants: ['centre', '3pt'] });
assert.deepStrictEqual(failures, [], `${failures.length} check(s) failed`);
console.log('arc-session-1039-phone-live: PASS');

// tests/transform-753-shaper-desktop-live.test.js — TASK 753: a group's transform box in Shaper (desktop mouse): the shared scenario of
// tests/helpers/transform-box-live.js (hover vs selection, uniform scale by a corner + one undo, rotate by the handle, a typed 30, move, the green
// padlock (no handles, still moves), the red padlock (no move, the reason at the box), the menu reading the same lock states).
import { runTransformLive, HOSTS } from './helpers/transform-box-live.js';

await runTransformLive(HOSTS.shaper, 'desktop');

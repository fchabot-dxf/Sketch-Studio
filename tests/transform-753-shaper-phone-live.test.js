// tests/transform-753-shaper-phone-live.test.js — TASK 753: a group's transform box in shaper (phone): the shared scenario of tests/helpers/transform-box-live.js
// (desktop: hover vs selection, uniform scale by a corner + one undo, rotate by the handle with its live readout, a typed 30, move, the green padlock (no
// handles, still moves), the red padlock (no move, the reason at the box), the menu reading the same lock states; phone: the same by touch, 44 px
// targets, a second finger cancelling a handle drag, no hover box). One file per app and phase so each stays short.
import { runTransformLive, HOSTS } from './helpers/transform-box-live.js';

await runTransformLive(HOSTS.shaper, 'phone');

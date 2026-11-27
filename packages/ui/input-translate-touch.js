// ═══════════════════════════════════════════════════════════════════════════════
// TOUCH TRANSLATOR (task 1031 plan 2.4; task 1034: Circle is its first user)
// ═══════════════════════════════════════════════════════════════════════════════
// A finger on the canvas, turned into the same tool-session calls by THE gesture rule (#ui/input-translate-desktop.js). What is the phone's
// own is declared here:
//   - the boxes open WITHOUT the focus (a focused box pops the phone keyboard on every tap and shrinks the view): tapping the box focuses it;
//   - a finger hovers only while it is down (there is no hover between taps), so Enter steps where the last tap or drag left the finger.
// Still in input-manager's front door, shared by every tool until each one is migrated (plan 5.2, close-out): the held press of TASK 1030
// (a pinch's first finger presses nothing), the long-press hold, the two-finger pan / zoom, the 2x pick reach (snapBoostFor).

import { createPointerTranslator } from '#ui/input-translate-desktop.js';

export const touchTranslator = createPointerTranslator({ focusBoxes: false });

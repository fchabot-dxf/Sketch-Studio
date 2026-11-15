// packages/ui/input-handlers/active-sketch-warning.js - task 660: the tiny helper Fillet, Trim, Break, Offset and Mirror call when a press found
// no curve of the ACTIVE sketch but one of another visible, unlocked sketch. The text and the test are #core/sketch-model.js otherSketchWarning.
import { otherSketchWarning } from '#core/sketch-model.js';
import { showNotification } from '#ui/notification-manager.js';

/** Shows the ONE warning for `shape` (a curve of another sketch) and returns true; false (nothing shown) when it is not one. A press only: a hover never calls it. */
export function warnOtherSketch(state, toolName, shape) {
  const msg = otherSketchWarning(state, toolName, shape);
  if (msg) showNotification(msg, 'warning');
  return !!msg;
}

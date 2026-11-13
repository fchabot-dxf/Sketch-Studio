// packages/ui/input-handlers/mirror-tool.js - task 585: the MIRROR tool (Create group of the shared ribbon), like Fusion's Create > Mirror.
// Flow (Fusion's): the OBJECTS, then the mirror LINE, then confirm.
//   1. OBJECTS  the selection is the objects: a selection made before the tool counts (pre-selection), and with one the tool starts at step 2.
//               A click on a shape or a point adds it to the selection, a second click removes it. Enter (Done on touch) ends the step.
//   2. LINE     a click on a line, a construction line or the X / Y axis picks the mirror line (the axes are pickable at this step only:
//               #core/reference-lines.js REFERENCE_PICK_STEP); it lights up like the selection. Enter (Done on touch) mirrors: ONE undo step
//               (recordConstraintStep, task 571's), the selection is cleared and the tool ends.
//   Esc cancels at any step (input-manager.js handleEscape: nothing is made, no undo step).
// Each step is announced in a toast (the shared notification-manager), and a refusal (#core/mirror.js: data, nothing changes) says why.
import { TOOL_MODES, MIRROR_STEPS, ORIGIN_JOINT_ID } from '#core/constants.js';
import { mirrorObjects, mirrorObjectsOf, mirrorObjectsRefusal, mirrorLineRefusal, MIRROR_UNDO_LABEL } from '#core/mirror.js';
import { referenceShape } from '#core/reference-lines.js';
import { recordConstraintStep } from '#ui/input-handlers/constraint-tools.js';
import { showNotification } from '#ui/notification-manager.js';

const HINT_MS = 6000;
export const MIRROR_HINTS = Object.freeze({
  [MIRROR_STEPS.OBJECTS]: 'Mirror: click the objects to mirror, then press Enter (Done on touch).',
  [MIRROR_STEPS.LINE]: 'Mirror: pick the mirror line (a line, a construction line or the X / Y axis), then press Enter (Done on touch).',
});
const hint = (text) => showNotification(text, 'info', HINT_MS);
const refuse = (reason) => showNotification('Mirror: ' + reason + '.', 'warning', HINT_MS);

const selectionObjects = (state) => mirrorObjectsOf([...state.selectedShapes], [...state.selectedJoints]);
const isEmpty = (o) => !o.shapes.length && !o.joints.length;

/** The tool starts (the ribbon's Mirror button): a pre-selection is the objects, so it starts at the LINE step; else at OBJECTS. */
export function beginMirror(state) {
  const objects = selectionObjects(state);
  const ready = isEmpty(objects) ? null : objects;
  state.mirror = { step: ready ? MIRROR_STEPS.LINE : MIRROR_STEPS.OBJECTS, objects: ready, line: null };
  hint(MIRROR_HINTS[state.mirror.step]);
}

/** The current step while the Mirror tool is on, else null. */
export const mirrorStep = (state) => (state.currentTool === TOOL_MODES.MIRROR && state.mirror ? state.mirror.step : null);

export function handleMirrorPointerDown(e, svg, state, hitJoint, hitShape) {
  const step = mirrorStep(state);
  const shape = !hitJoint && hitShape && hitShape.shape ? hitShape.shape : null;
  if (step === MIRROR_STEPS.OBJECTS) {
    if (hitJoint && hitJoint.id !== ORIGIN_JOINT_ID) toggle(state.selectedJoints, hitJoint.id);
    else if (shape && !shape.reference) toggle(state.selectedShapes, shape.id);
    else return false;
    return true;
  }
  if (step === MIRROR_STEPS.LINE) {
    if (!shape || shape.type !== 'line') return false;
    const m = state.mirror;
    const why = mirrorLineRefusal(state, m.objects, shape.id);
    if (why) { refuse(why); return true; }
    if (m.line && !m.objects.shapes.includes(m.line)) state.selectedShapes.delete(m.line);
    m.line = shape.id;
    state.selectedShapes.add(shape.id); // lit like the selection (an axis too: svg-renderer lights a reference line in the selected set)
    const name = shape.reference ? referenceShape(shape.id).label : (shape.isConstruction ? 'the construction line' : 'the line');
    hint(`Mirror line: ${name}. Press Enter (Done on touch) to mirror, Esc to cancel.`);
    return true;
  }
  return false;
}
function toggle(set, id) { if (set.has(id)) set.delete(id); else set.add(id); }

/**
 * Enter / the touch Done button. OBJECTS: the selection becomes the objects (refused when empty) -> LINE. LINE: mirror (one undo step).
 * Returns 'mirrored' when the copy was made (the caller ends the tool), else 'next' / 'refused' / 'wait'.
 */
export function mirrorDone(state) {
  const m = state.mirror;
  if (mirrorStep(state) === MIRROR_STEPS.OBJECTS) {
    const objects = selectionObjects(state);
    const why = mirrorObjectsRefusal(state, objects);
    if (why) { refuse(why); return 'refused'; }
    m.objects = objects; m.step = MIRROR_STEPS.LINE;
    hint(MIRROR_HINTS[MIRROR_STEPS.LINE]);
    return 'next';
  }
  if (mirrorStep(state) !== MIRROR_STEPS.LINE) return 'wait';
  if (!m.line) { hint(MIRROR_HINTS[MIRROR_STEPS.LINE]); return 'wait'; }
  const res = recordConstraintStep(state, MIRROR_UNDO_LABEL, () => mirrorObjects(state, m.objects, m.line));
  if (!res.ok) { refuse(res.reason); return 'refused'; }
  state.selectedShapes.clear(); state.selectedJoints.clear(); state.selectedConstraints.clear();
  state.mirror = null;
  return 'mirrored';
}

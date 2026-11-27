// ═══════════════════════════════════════════════════════════════════════════════
// DESKTOP TRANSLATOR (task 1031 plan 2.4; task 1034: Circle is its first user)
// ═══════════════════════════════════════════════════════════════════════════════
// A pointer's press / move / release on the canvas, turned into tool-session calls. input-manager keeps its routing order in front of it
// (pinch, middle button, menu target, the ignored right press, the snap update, the pattern session, the transform box, the curve refusal,
// the held touch press) and hands the translator the pointer's world point and the click's snap, made as it makes them for every tool.
// THE gesture rule (one place, for the mouse, the pen and the finger alike):
//   - a step that fires on the PRESS (a centre) is made at the press;
//   - its press released without a drag opens the next step's boxes (a click); a drag past the threshold goes on to the release;
//   - a step that fires on the RELEASE (a rim) is made at the release of a click, or of a drag (drag-release = click-click); a press-step's drag
//     whose release placed nothing (back onto its point) is a click there: the step's boxes open;
//   - every move is a hover (the preview, the box following the pointer).
// The device differences are a policy: desktop boxes take the focus; the touch translator (#ui/input-translate-touch.js) declares its own.

import { checkDragThreshold, shownSnap } from '#ui/input-handlers/base-tool.js';
import { setHoverFromSnap } from '#ui/hover-manager.js';

/** the snap a step takes: THE snap the cursor shows (base-tool shownSnap, task 1033), else the one the click found; a hover takes the shown one (Enter steps with it) */
const stepSnap = (state, hitSnap) => shownSnap(state) || hitSnap || null;
const screenOf = (e) => ({ x: e.clientX, y: e.clientY });

/** a pointer translator for one device `policy` ({ focusBoxes }) */
export function createPointerTranslator(policy) {
    let press = null; // the press in progress: { screen, stepped (it made a press-step), dragging }
    return {
        down(e, state, session, hitSnap, w) {
            const screen = screenOf(e);
            press = { screen, stepped: false, dragging: false };
            if (session.firesOn() === 'press') press.stepped = session.step({ at: w, snap: stepSnap(state, hitSnap), screen, via: 'click' }) === 'next';
            return true;   // the press is the tool's (a second click's press waits for its release): it never pans
        },
        move(e, state, session, w) {
            if (press && !press.dragging && checkDragThreshold(e, press.screen)) press.dragging = true;
            if (session.pending()) setHoverFromSnap(state);   // the hover highlight follows the snap while a draw is open, as for every drawing tool
            return this.hover(state, session, screenOf(e), w);
        },
        /** a hover with no pointer event: the re-preview after a wheel zoom or a pan (input-manager) */
        hover(state, session, screen, w) {
            return session.hover({ at: w, snap: shownSnap(state), screen });
        },
        up(e, state, session, hitSnap, w) {
            const p = press;
            press = null;
            if (p && p.stepped && !p.dragging) { session.openBoxes({ screen: screenOf(e), focus: policy.focusBoxes }); return true; }
            if (session.firesOn() !== 'release') return true;
            const screen = screenOf(e);
            const made = session.step({ at: w, snap: stepSnap(state, hitSnap), screen, via: p && p.dragging ? 'release' : 'click', focus: policy.focusBoxes });
            // a press-step dragged back onto its own point placed nothing: that is a click there (its step's boxes open, task 1033 A-1, task 1039)
            if (made === 'ignored' && p && p.stepped) session.openBoxes({ screen, focus: policy.focusBoxes });
            return true;
        },
    };
}

/** mouse and pen: the boxes take the focus (a digit typed now goes in) */
export const desktopTranslator = createPointerTranslator({ focusBoxes: true });

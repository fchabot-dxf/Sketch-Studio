// ═══════════════════════════════════════════════════════════════════════════════
// TOOL SESSION: the ONE engine a tool described as data runs in (task 1031 plan, section 2; task 1034: Circle is its first user)
// ═══════════════════════════════════════════════════════════════════════════════
// A tool file exports ONE description, made by defineTool: its steps (what each step's pick takes, when it fires, which value boxes it
// offers, how a typed value holds its point) and ONE build that turns the finished picks and values into geometry. The tool never sees a
// DOM event: the translators (#ui/input-translate-desktop.js, #ui/input-translate-touch.js, #ui/input-translate-box.js) turn each input
// device into the same few calls on the session: hover, step, values, openBoxes, typeInto, cancel. A step runs the same code whatever
// produced it (a click, a drag's release, a tap, Enter in the box): `via` is written in the step log only and nothing branches on it.
// The picks are plain points held here until the build (risk R-4): the document is written once, inside the draw's undo step, so a
// cancel has nothing to remove. The renderer draws the held points as the points they become (state.active.heldPoints).

import { tooSmall, snapPoint } from '#ui/input-handlers/base-tool.js';
import { updatePreview } from '#ui/preview-manager.js';
import { openStepBox, followStepBox, closeStepBox, boxRefuses } from '#ui/input-translate-box.js';

/** What a step's pick takes. `point`: a point, snapped as the drawing tools snap today (#ui/input-manager.js toolSnap, no picks filter). */
export const PICK = Object.freeze({ point: Object.freeze({ kind: 'point' }) });
const PICKS = Object.values(PICK);
const FIRES = ['press', 'release'];   // the press makes the step (a centre), or the release of a click / drag does (a rim)
const AFTER = ['stay'];               // what the tool does after its build ('select' and 'chain' come with Offset / Mirror and Line)
const QUANTITIES = ['length', 'angle', 'count'];

const fail = (desc, why) => { throw new Error(`defineTool(${desc && desc.tool}): ${why}`); };
const fnOrNone = (v) => v === undefined || typeof v === 'function';

/** Check a tool description's shape and freeze it. Throws with the reason when a field is missing or of the wrong kind. */
export function defineTool(desc) {
    if (!desc || typeof desc.tool !== 'string' || !desc.tool) fail(desc, 'tool must be a TOOL_MODES id');
    if (desc.variantKey !== undefined && typeof desc.variantKey !== 'string') fail(desc, 'variantKey must be a state key');
    if (typeof desc.build !== 'function') fail(desc, 'build must be a function');
    if (!AFTER.includes(desc.after)) fail(desc, `after must be one of ${AFTER.join(', ')}`);
    const names = desc.variants && Object.keys(desc.variants);
    if (!names || !names.length) fail(desc, 'variants must name at least one variant');
    for (const name of names) {
        const steps = desc.variants[name] && desc.variants[name].steps;
        if (!Array.isArray(steps) || !steps.length) fail(desc, `variant ${name} has no steps`);
        const ids = new Set();
        for (const s of steps) {
            if (!s || typeof s.id !== 'string' || ids.has(s.id)) fail(desc, `variant ${name}: every step needs its own id`);
            ids.add(s.id);
            if (!PICKS.includes(s.pick)) fail(desc, `step ${s.id}: pick must be one of PICK`);
            if (!FIRES.includes(s.fires)) fail(desc, `step ${s.id}: fires must be ${FIRES.join(' or ')}`);
            if (!fnOrNone(s.resolve) || !fnOrNone(s.tooSmall) || !fnOrNone(s.preview)) fail(desc, `step ${s.id}: resolve / tooSmall / preview must be functions`);
            const boxes = s.boxes || [];
            if (!Array.isArray(boxes) || boxes.length > 1) fail(desc, `step ${s.id}: boxes is a list of at most one box (the two-field box comes with the Polygon / Rect merges)`);
            for (const b of boxes) {
                if (!b || typeof b.id !== 'string' || !QUANTITIES.includes(b.quantity) || typeof b.positions !== 'boolean' || typeof b.live !== 'function' || !fnOrNone(b.refuse)) {
                    fail(desc, `step ${s.id}: a box needs id, quantity (${QUANTITIES.join(' | ')}), positions (boolean), live (function) and an optional refuse`);
                }
            }
        }
        Object.freeze(steps);
    }
    return Object.freeze(desc);
}

const NO_VALUE = Object.freeze({ value: NaN, typed: false, expression: null, name: null, assign: null });

function createSession(state, desc) {
    // What the session holds between its steps lives ON state.active (THE record of a draw in progress: task 1030's pending / cancel rules
    // and the renderer read it): { stepIndex, picks, values, boxOpen }. Any path that drops state.active (a tool switch, Esc, the footer Clear,
    // a document loaded in place) drops the held picks with it: there is no second copy to keep in step. Before the first step nothing is held.
    const IDLE = Object.freeze({ stepIndex: 0, picks: Object.freeze({}), values: Object.freeze({}), boxOpen: false });
    const held = () => (state.active && state.active.mode === desc.tool && state.active.held) || IDLE;
    const log = [];       // every step made or ignored, and every build: what the step-log proof reads (task 1034)
    const session = { desc, log, builds: 0, lastHover: null };

    const steps = () => desc.variants[desc.variantKey ? state[desc.variantKey] : Object.keys(desc.variants)[0]].steps;
    const current = () => steps()[held().stepIndex];
    const valuesOf = (step) => Object.fromEntries((step.boxes || []).map((b) => [b.id, held().values[b.id] || NO_VALUE]));
    // the point a step lands on: the locked snap's point (the snap the cursor shows), else the pointer's world point
    const landing = (at, snap) => (snap && snap.isLocked && snapPoint(snap)) || at;
    const liveValue = (step, box, at) => box.live(held().picks, at, valuesOf(step));
    const heldPoints = (picks) => Object.values(picks).map((p) => ({ x: p.at.x, y: p.at.y }));

    function reset() {
        const h = held();
        if (h.boxOpen) closeStepBox();
        if (h !== IDLE) state.active = null;
    }

    function showPreview(at) {
        const step = current();
        if (!step.preview) return;
        const p = step.preview(held().picks, at, valuesOf(step));
        updatePreview(state, p.type, p.fixed, p.at, p.props);
        state.active.heldPoints = heldPoints(held().picks);
    }

    /** THE pick pending rule of a session tool (input-manager TOOL_PENDING): a step made */
    session.pending = () => held().stepIndex > 0;
    /** the step the next pick fires on: does it fire on a press, or on the release of a click / drag? */
    session.firesOn = () => current().fires;

    /** hover: the pointer is at `at` (world) / `screen`, showing `snap`. Remembered for Enter; previews the current step once one is made. */
    session.hover = ({ at, snap, screen }) => {
        session.lastHover = { at, snap, screen };
        const h = held();
        if (h.stepIndex === 0) return false;
        const step = current();
        const p = landing(at, snap);
        if (h.boxOpen) followStepBox(screen, liveValue(step, step.boxes[0], p));
        showPreview(p);
        return true;
    };

    /** a box edit: the value typed in box `boxId` (typed false = the box shows the live value again) */
    session.values = (boxId, v) => {
        const h = held();
        if (h.stepIndex === 0) return;   // the draw this box belonged to is gone
        h.values[boxId] = v.typed ? v : NO_VALUE;   // an untyped field shows the live value: it holds nothing
        if (session.lastHover) showPreview(landing(session.lastHover.at, session.lastHover.snap));
    };

    /**
     * THE step (plan 2.2), the same for every device and for Enter: 1. a value the box refuses refuses the step; 2. the typed values hold the
     * point (resolve); 3. the snap is kept unless a typed field positions the point; 4. a step too small is ignored (the tool keeps waiting);
     * 5. the pick is held, then the next step is current, or after the last one the ONE build runs inside the draw's undo step.
     * Returns 'refused' | 'ignored' | 'next' | 'built'.
     */
    session.step = ({ at, snap = null, screen = null, via }) => {
        const h = held();
        const step = current();
        if (boxRefuses()) { log.push({ step: step.id, via, result: 'refused' }); return 'refused'; }
        session.lastHover = { at, snap, screen: screen || (session.lastHover && session.lastHover.screen) };
        const vals = valuesOf(step);
        const base = landing(at, snap);
        const point = step.resolve ? step.resolve(h.picks, base, vals) : base;
        const typedPositions = (step.boxes || []).some((b) => b.positions && vals[b.id].typed);
        const keep = !!(snap && snap.isLocked && !typedPositions);
        if (step.tooSmall && tooSmall(...step.tooSmall(h.picks, point))) { log.push({ step: step.id, via, result: 'ignored' }); return 'ignored'; }
        if (h.stepIndex === 0) state.beginDrawStep();
        const picks = { ...h.picks, [step.id]: { at: point, snap: keep ? snap : null, values: vals } };
        log.push({ step: step.id, via, at: { x: point.x, y: point.y }, snap: keep ? { type: snap.type, id: snap.id || snap.targetId || null } : null, values: vals, result: 'picked' });
        if (h.stepIndex < steps().length - 1) {
            const next = { stepIndex: h.stepIndex + 1, picks, values: { ...h.values }, boxOpen: h.boxOpen };
            if (h === IDLE) state.active = { mode: desc.tool, startPt: picks[steps()[0].id].at, preview: null, heldPoints: heldPoints(picks), held: next };
            else { state.active.held = next; state.active.heldPoints = heldPoints(picks); }
            return 'next';
        }
        session.builds++;
        log.push({ build: desc.tool });
        try { desc.build(state, picks); }
        finally { state.endUndoGroup(); reset(); }
        return 'built';
    };

    /** the press that made a press-step ended without a drag: the current step's boxes open beside the pointer (focus: not on a phone) */
    session.openBoxes = ({ screen, focus }) => {
        const h = held();
        const step = current();
        if (h.stepIndex === 0 || h.boxOpen || !(step.boxes && step.boxes.length)) return false;
        const at = session.lastHover ? landing(session.lastHover.at, session.lastHover.snap) : h.picks[steps()[0].id].at;
        h.boxOpen = true;
        openStepBox(session, step.boxes[0], { screen, value: liveValue(step, step.boxes[0], at), focus });
        return true;
    };

    /** a value key typed on the canvas (B-4): it goes into the current step's box, opened (again) beside the pointer with that key */
    session.typeInto = (key) => {
        const h = held();
        const step = current();
        if (h.stepIndex === 0 || !(step.boxes && step.boxes.length) || !session.lastHover) return false;
        const box = step.boxes[0];
        h.boxOpen = true;
        openStepBox(session, box, { screen: session.lastHover.screen, value: liveValue(step, box, landing(session.lastHover.at, session.lastHover.snap)), focus: true, initialKey: key });
        return true;
    };

    /** cancel: everything held goes (the picks, the typed values, the boxes). The draw's undo step is closed by its caller (cancelActiveWork). */
    session.cancel = () => { log.push({ cancel: desc.tool }); reset(); };

    return session;
}

const sessions = new WeakMap();   // state -> Map(tool id -> session)
/** THE session of `desc` on `state` (one per tool per document state, made on first use) */
export function toolSession(state, desc) {
    let m = sessions.get(state);
    if (!m) {
        m = new Map(); sessions.set(state, m);
        state.onDrawCancelled(() => cancelToolSessions(state));   // a draw dropped by ANY path (the footer Clear, a document-tab switch): THE cancel of Esc / another tool / Undo
    }
    if (!m.has(desc.tool)) m.set(desc.tool, createSession(state, desc));
    return m.get(desc.tool);
}
/** cancel every session `state` holds (input-manager cancelActiveWork: Esc, another tool, Undo with a pick pending) */
export function cancelToolSessions(state) {
    const m = sessions.get(state);
    if (m) for (const s of m.values()) if (s.pending()) s.cancel();
}

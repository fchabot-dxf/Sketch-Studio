// packages/ui/transform-box.js — TASK 753: the TRANSFORM BOX of a user group, in the shared Design tab of every app (SketchStudio, Shaper,
// Pen Plotter, Trace: every host with groups; the box is drawn by the shared renderer, svg-renderer.js, and driven by input-manager.js).
//
// SHOWN only with the Select tool, and only on a group (never on a single curve):
//   selected (the selection is ONE whole group, TASK 751's rule): the box outline, a ROTATE handle above it (turns about the box centre, the
//     declared snaps of #core/transform.js), four CORNER handles (UNIFORM scale from the opposite corner), and the two PADLOCKS;
//   hovered (a fine pointer only, `(hover: hover)`; the group the hover lights, TASK 756): the outline and the padlocks in their state, no handles;
//   anything else: nothing (a locked group draws nothing extra; its lock shows on its browser row).
// With "Lock size & angle" (or "Full lock") on, the box has no rotate / scale handles. A move is the existing group drag (a press on the group).
// The PADLOCKS (on opposite corners: GREEN round "Lock size & angle" under the bottom-left corner, RED square "Full lock" over the top-right
// one) are shortcuts to the group's two lock commands (#ui/group-actions.js toggleGroupLock: the canvas / hold menu and the browser row run the
// same). Closed shackle + filled badge = on; open shackle + white badge = off; each has a tooltip and an aria-label.
// A click / tap on the rotate handle (no drag) opens a typed angle, on a corner a typed scale (a percent, or a width with its unit).
// Every transform runs #core/transform.js (ONE operation, ONE undo step). A refusal shows its reason AT THE HANDLE (a tip on the canvas).
// TOUCH: one finger on a handle (a 44 px target) turns / scales; a second finger cancels the handle (the group goes back) and pinches / pans as
// always; a finger anywhere else does what it did before (the handles are hit first, only within their 44 px targets).

import { DRAG_TYPES, TOOL_MODES } from '#core/constants.js';
import { selectedGroups, hoveredUnit, shapesInGroup, groupLockState, lockHolder, GROUP_LOCKS } from '#core/group-model.js';
import { groupBox, planGroupTransform, applyGroupTransform, settleTransform, snapshotTransform, restoreTransform, runGroupTransform,
  snapAngle, MIN_SCALE, TRANSFORM_UNDO_LABELS } from '#core/transform.js';
import { screenToWorld, worldToScreen, getZoomFactor } from '#ui/coords.js';
import { docUnit, lengthText, angleDecimals } from '#core/settings-manager.js';
import { parse as parseLength } from '#core/units.js';
import { SolverConfig } from '#core/solver-config.js';
import { ensureNumericInputStyles, handleBoxUndoKey, placeAnchoredBox } from '#ui/numeric-input-manager.js';
import { openChoiceModal } from '#ui/template-picker.js';
import { toggleGroupLock } from '#ui/group-actions.js';
import { track } from '#ui/analytics.js';

// THE sizes of the box, in SCREEN px: `fine` for a mouse, `coarse` for a finger (the app's 44 px touch target: hit radius 22).
export const TBOX = Object.freeze({
  pad: { fine: 6, coarse: 8 },          // the outline's gap around the geometry
  minHalf: { fine: 18, coarse: 46 },    // the box is drawn at least this big around its centre (no two targets of a tiny group overlap)
  handle: { fine: 9, coarse: 16 },      // a drawn handle (corner square side / rotate circle diameter)
  hit: { fine: 8, coarse: 22 },         // a handle's / padlock's hit radius
  rotate: { fine: 26, coarse: 50 },     // the rotate handle's distance above the box
  lock: { fine: 24, coarse: 48 },       // a padlock's distance from its corner (straight out, up / down: a wide group keeps them on a phone screen)
  badge: { fine: 18, coarse: 30 },      // a padlock badge's size
});
export const TIP_MS = 4500;             // how long a refusal's reason stays at its handle
const CLICK_PX = 5;                     // a press that moves less is a click (it opens the typed value)

const media = (q) => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(q).matches;
const coarse = () => media('(pointer: coarse)');
const canHover = () => typeof window === 'undefined' || typeof window.matchMedia !== 'function' || window.matchMedia('(hover: hover)').matches;
const kindOf = (isCoarse) => (isCoarse ? 'coarse' : 'fine');
const nameOf = (state, gid) => ((state.groups || []).find((g) => g.id === gid) || {}).name || 'Group';

// The box's targets now: [{ gid, mode: 'select' | 'hover' }] (the selected group first; a hovered other group after it).
export function boxTargets(state) {
  if (!state || state.currentTool !== TOOL_MODES.SELECT) return [];
  if (state.drag && state.drag.type === DRAG_TYPES.TRANSFORM) return [{ gid: state.drag.gid, mode: 'select' }];
  const out = [];
  const sel = selectedGroups(state);
  const shapes = state.selectedShapes instanceof Set ? state.selectedShapes : new Set();
  const joints = state.selectedJoints instanceof Set ? state.selectedJoints.size : 0;
  if (sel.length === 1 && !joints && shapesInGroup(state, sel[0]).length === shapes.size) out.push({ gid: sel[0], mode: 'select' });
  const h = canHover() ? hoveredUnit(state) : null;
  if (h && !out.some((t) => t.gid === h)) out.push({ gid: h, mode: 'hover' });
  return out;
}

// The box's layout in WORLD units for a group box, z = world units per screen px: the outline, the four corners (each with its opposite,
// the scale pivot, from the geometry box itself), the rotate handle, the two padlocks.
export function boxLayout(box, z, isCoarse) {
  const k = kindOf(isCoarse), pad = TBOX.pad[k] * z, minHalf = TBOX.minHalf[k] * z;
  const hw = Math.max(box.w / 2 + pad, minHalf), hh = Math.max(box.h / 2 + pad, minHalf);
  const x0 = box.cx - hw, x1 = box.cx + hw, y0 = box.cy - hh, y1 = box.cy + hh;
  const corner = (id, x, y, ox, oy) => ({ id, x, y, opposite: { x: ox, y: oy } });
  const L = TBOX.lock[k] * z;
  return {
    k, z, x0, x1, y0, y1, centre: { x: box.cx, y: box.cy },
    corners: [corner('nw', x0, y0, box.maxX, box.maxY), corner('ne', x1, y0, box.minX, box.maxY), corner('se', x1, y1, box.minX, box.minY), corner('sw', x0, y1, box.maxX, box.minY)],
    rotate: { x: box.cx, y: y0 - TBOX.rotate[k] * z },
    locks: { sizeAngle: { x: x0, y: y1 + L }, full: { x: x1, y: y0 - L } },
  };
}

// What a press at screen (sx, sy) is on: { lock: kind } | { handle: 'rotate' } | { handle: 'scale', corner } | null. Padlocks first, then the
// rotate handle, then the corners (hover mode: padlocks only; a locked group: no handles).
function hitBox(svg, lay, target, locks, sx, sy, touch) {
  const r = Math.max(TBOX.hit[lay.k], touch ? TBOX.hit.coarse : 0);
  const on = (p) => { const q = worldToScreen(svg, p); return Math.hypot(q.x - sx, q.y - sy) <= r; };
  for (const kind of ['full', 'sizeAngle']) if (on(lay.locks[kind])) return { lock: kind };
  if (target.mode !== 'select' || locks.sizeAngle) return null;
  if (on(lay.rotate)) return { handle: 'rotate' };
  for (const c of lay.corners) if (on(c)) return { handle: 'scale', corner: c };
  return null;
}

// ---- the refusal tip (one at a time; shown at its handle for TIP_MS) and the gesture's live readout
let tip = null;
function showTip(gid, text, world) { tip = { gid, text, world, until: Date.now() + TIP_MS }; }
/** The refusal shown now, or null (tests and the renderer read it). */
export function currentTip() { return tip && Date.now() < tip.until ? tip : null; }

// ---- drawing (svg-renderer.js calls this once per frame, in world units; z = world units per screen px)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const at = (p, z, body, extra = '') => `<g transform="translate(${p.x} ${p.y}) scale(${z})"${extra}>${body}</g>`;
function padlock(kind, on, p, lay, gid, name) {
  const S = TBOX.badge[lay.k], h = S / 2, label = `${GROUP_LOCKS[kind].label}: ${on ? 'on' : 'off'} (${name})`;
  const fill = on ? (kind === 'full' ? 'var(--sk-lock-full, #dc2626)' : 'var(--sk-lock-size, #16a34a)') : 'var(--sk-lock-off-fill, #ffffff)';
  const ink = on ? '#ffffff' : 'var(--sk-lock-off, #4b5563)';
  const badge = kind === 'full' ? `<rect x="${-h}" y="${-h}" width="${S}" height="${S}" rx="${S * 0.18}"/>` : `<circle r="${h}"/>`;
  const k = S / 18; // the glyph is drawn for an 18 px badge
  const shackle = on ? 'M-3.2 -0.5 V-4 A3.2 3.2 0 0 1 3.2 -4 V-0.5' : 'M-3.2 -0.5 V-4 A3.2 3.2 0 0 1 3.2 -4 V-3';
  return at(p, lay.z, `<title>${esc(label)}</title><g style="fill:${fill};stroke:${on ? '#ffffff' : 'var(--sk-lock-off, #4b5563)'}" stroke-width="1.5">${badge}</g>`
    + `<g transform="scale(${k}) translate(${on ? 0 : 0.8} 1)"><path d="${shackle}" fill="none" style="stroke:${ink}" stroke-width="1.6" stroke-linecap="round"/>`
    + `<rect x="-5" y="-1" width="10" height="7.5" rx="1.2" style="fill:${ink}"/></g>`,
  ` class="tbox-lock" data-lock="${kind}" data-state="${on ? 'on' : 'off'}" data-group-id="${esc(gid)}" role="button" aria-pressed="${on}" aria-label="${esc(label)}" style="cursor:pointer"`);
}
// A text chip at world point p; `leftward`: it ends at p instead of starting there (a handle on the right of the box). `view` = the visible world
// x range { x0, x1 } (the canvas viewBox): the chip is kept inside it, and a text too wide for it is broken after its ": " (a phone's 390 px).
function label(p, z, text, cls, colour, leftward = false, view = null) {
  const widthOf = (t) => Math.round(t.length * 6.6) + 12;
  const room = view ? (view.x1 - view.x0) / z - 8 : Infinity;
  const cut = text.indexOf(': ');
  const lines = widthOf(text) > room && cut > 0 ? [text.slice(0, cut + 1), text.slice(cut + 2)] : [text];
  const w = Math.max(...lines.map(widthOf)), h = 20 * lines.length;
  let x = leftward ? -w : 0;
  if (view) x = Math.max((view.x0 - p.x) / z + 4, Math.min(x, (view.x1 - p.x) / z - w - 4)); // inside the visible canvas
  return at(p, z, `<rect x="${x}" y="-11" width="${w}" height="${h}" rx="4" style="fill:${colour}" fill-opacity="0.95"/>`
    + lines.map((t, i) => `<text x="${x + 6}" y="${3.5 + 20 * i}" font-size="12" font-weight="600" style="fill:#ffffff">${esc(t)}</text>`).join(''),
  ` class="${cls}" role="status" pointer-events="none"`);
}

/** The box markup of every target (boxTargets), the gesture's readout and the refusal tip, in world units. '' when there is none.
 *  view: the visible world x range { x0, x1 } (the chips stay inside it). */
export function transformBoxMarkup(state, z, view = null) {
  if (!state || !(z > 0)) return '';
  const isCoarse = coarse(), out = [];
  for (const t of boxTargets(state)) {
    const box = groupBox(state, t.gid);
    if (!box) continue;
    const lay = boxLayout(box, z, isCoarse), locks = groupLockState(state, t.gid), name = nameOf(state, t.gid);
    const parts = [`<rect class="tbox-outline" x="${lay.x0}" y="${lay.y0}" width="${lay.x1 - lay.x0}" height="${lay.y1 - lay.y0}" fill="none" style="stroke:var(--sk-tbox, var(--sk-selection, #017AFD))" stroke-width="${z}" stroke-dasharray="${4 * z},${3 * z}" pointer-events="none"/>`];
    if (t.mode === 'select' && !locks.sizeAngle) {
      const H = TBOX.handle[lay.k], hit = TBOX.hit[lay.k];
      const target = lay.k === 'coarse' ? `<circle r="${hit}" style="fill:var(--sk-tbox, var(--sk-selection, #017AFD))" fill-opacity="0.12"/>` : '';
      parts.push(`<line x1="${lay.centre.x}" y1="${lay.y0}" x2="${lay.rotate.x}" y2="${lay.rotate.y}" style="stroke:var(--sk-tbox, var(--sk-selection, #017AFD))" stroke-width="${z}" pointer-events="none"/>`);
      parts.push(at(lay.rotate, z, `<title>Rotate ${esc(name)} (drag; click to type an angle)</title>${target}<circle r="${H / 2 + 1}" style="fill:var(--sk-tbox-handle-fill, #ffffff);stroke:var(--sk-tbox, var(--sk-selection, #017AFD))" stroke-width="1.5"/>`
        + `<path d="M-2.6 -1.6 A3 3 0 1 1 -2.2 2.2" fill="none" style="stroke:var(--sk-tbox, var(--sk-selection, #017AFD))" stroke-width="1.2" transform="scale(${H / 9})"/>`,
      ` class="tbox-handle" data-handle="rotate" role="button" aria-label="Rotate ${esc(name)}" style="cursor:grab"`));
      for (const c of lay.corners) {
        parts.push(at(c, z, `<title>Scale ${esc(name)} from the opposite corner (drag; click to type a scale)</title>${target}<rect x="${-H / 2}" y="${-H / 2}" width="${H}" height="${H}" style="fill:var(--sk-tbox-handle-fill, #ffffff);stroke:var(--sk-tbox, var(--sk-selection, #017AFD))" stroke-width="1.5"/>`,
          ` class="tbox-handle" data-handle="scale-${c.id}" role="button" aria-label="Scale ${esc(name)}" style="cursor:${c.id === 'nw' || c.id === 'se' ? 'nwse' : 'nesw'}-resize"`));
      }
    }
    parts.push(padlock('sizeAngle', locks.sizeAngle, lay.locks.sizeAngle, lay, t.gid, name));
    parts.push(padlock('full', locks.full, lay.locks.full, lay, t.gid, name));
    out.push(`<g class="tbox" data-group-id="${esc(t.gid)}" data-mode="${t.mode}">${parts.join('')}</g>`);
  }
  const d = state.drag && state.drag.type === DRAG_TYPES.TRANSFORM ? state.drag : null;
  if (d && d.readout) out.push(label({ x: d.readout.world.x + 14 * z, y: d.readout.world.y - 18 * z }, z, d.readout.text, 'tbox-readout', 'var(--sk-tbox, var(--sk-selection, #017AFD))', false, view));
  const tp = currentTip();
  if (tp) {
    const b = groupBox(state, tp.gid), right = !!b && tp.world.x > b.cx;
    out.push(label({ x: tp.world.x + (right ? 12 : -12) * z, y: tp.world.y + 30 * z }, z, tp.text, 'tbox-tip', 'var(--sk-error, #ef4444)', right, view));
  }
  return out.join('');
}

// ---- the readout texts
const userDegrees = (worldAngle) => -worldAngle * 180 / Math.PI; // the canvas is y-down: a positive (counter-clockwise on screen) angle is a negative world angle
const degText = (deg) => `${Number(deg.toFixed(angleDecimals(1)))}°`;
const scaleText = (s, box) => `${Number((s * 100).toFixed(1))}% · ${lengthText(box.w * s, { auto: 2, trim: 'auto' })} × ${lengthText(box.h * s, { auto: 2, trim: 'auto', show: 'unit' })}`;

// ---- the gesture (a handle dragged)
/** A press with the Select tool (input-manager.js has captured the pointer; it releases it on pointerup): on a padlock it toggles that lock; on a rotate / corner handle of the selected group's box it starts the
 *  gesture (or, when the group cannot turn / scale, shows the reason at the handle). -> true when the press was the box's. */
export function transformBoxPointerDown(e, svg, state, notify = () => {}) {
  if (!state || state.currentTool !== TOOL_MODES.SELECT || (e.button !== undefined && e.button !== 0)) return false;
  const touch = e.pointerType === 'touch' || !!e.isTouch;
  const z = getZoomFactor(svg), isCoarse = coarse();
  for (const target of boxTargets(state)) {
    const box = groupBox(state, target.gid);
    if (!box) continue;
    const lay = boxLayout(box, z, isCoarse), locks = groupLockState(state, target.gid);
    const hit = hitBox(svg, lay, target, locks, e.clientX, e.clientY, touch);
    if (!hit) continue;
    if (hit.lock) {
      const r = toggleGroupLock(state, hit.lock, target.gid, notify);
      if (r.refused) showTip(target.gid, r.refused, lay.locks[hit.lock]);
      return true;
    }
    const handleAt = hit.handle === 'rotate' ? lay.rotate : hit.corner;
    const probe = hit.handle === 'rotate' ? { pivot: lay.centre, angle: 0.01, scale: 1 } : { pivot: hit.corner.opposite, angle: 0, scale: 1.01 };
    const pre = planGroupTransform(state, target.gid, probe);
    if (!pre.ok) { showTip(target.gid, pre.reason, handleAt); return true; }
    state.drag = {
      type: DRAG_TYPES.TRANSFORM, gid: target.gid, handle: hit.handle, corner: hit.corner || null, box, lay, handleAt,
      startClient: { x: e.clientX, y: e.clientY }, startWorld: screenToWorld(svg, e.clientX, e.clientY), pointerId: e.pointerId,
      start: snapshotTransform(state), undo: state.captureUndoSnapshot(), moved: false, op: null, readout: null, jointIds: [],
    };
    return true;
  }
  return false;
}

// The op of the gesture at the pointer (world point w): rotate about the box centre (snapped), or scale from the opposite corner (uniform:
// the pointer projected on the corner's diagonal).
function gestureOp(d, w, shift) {
  if (d.handle === 'rotate') {
    const c = d.lay.centre;
    const raw = Math.atan2(w.y - c.y, w.x - c.x) - Math.atan2(d.startWorld.y - c.y, d.startWorld.x - c.x);
    const wrapped = Math.atan2(Math.sin(raw), Math.cos(raw));
    return { pivot: c, angle: snapAngle(wrapped, shift), scale: 1 };
  }
  const o = d.corner.opposite, v = { x: d.startWorld.x - o.x, y: d.startWorld.y - o.y }, L2 = v.x * v.x + v.y * v.y;
  const s = L2 > 0 ? ((w.x - o.x) * v.x + (w.y - o.y) * v.y) / L2 : 1;
  return { pivot: o, angle: 0, scale: Math.max(MIN_SCALE, s) };
}

/** A pointer move during the gesture: the group goes back to where it started and takes the new op (a preview: the solve's quick pass). */
export function transformBoxPointerMove(e, svg, state) {
  const d = state.drag;
  if (!d || d.type !== DRAG_TYPES.TRANSFORM) return false;
  if (!d.moved && Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) <= CLICK_PX) return true;
  d.moved = true;
  const w = screenToWorld(svg, e.clientX, e.clientY);
  const op = gestureOp(d, w, !!e.shiftKey);
  restoreTransform(state, d.start);
  const plan = planGroupTransform(state, d.gid, op);
  if (!plan.ok) { d.op = null; d.readout = null; showTip(d.gid, plan.reason, d.handleAt); return true; }
  applyGroupTransform(state, plan, op, { removals: false });
  settleTransform(state, plan.joints, SolverConfig.QUICK_SOLVE || 8);
  d.op = op;
  d.readout = { world: w, text: d.handle === 'rotate' ? degText(userDegrees(op.angle)) : scaleText(op.scale, d.box) };
  return true;
}

/** Undo the gesture in progress (a second finger landed, Esc): the group goes back where it was; nothing is recorded. */
export function cancelTransformGesture(state) {
  const d = state && state.drag;
  if (!d || d.type !== DRAG_TYPES.TRANSFORM) return false;
  restoreTransform(state, d.start);
  state.drag = null;
  return true;
}

/** The release: a click (no move) opens the typed value; a drag runs the transform from the start pose (ONE undo step), asking the one
 *  confirm first when it removes horizontal / vertical constraints; a refusal puts everything back and shows its reason at the handle. */
export function transformBoxPointerUp(e, svg, state) {
  const d = state.drag;
  if (!d || d.type !== DRAG_TYPES.TRANSFORM) return false;
  state.drag = null;
  if (!d.moved) { restoreTransform(state, d.start); openTransformInput(svg, state, d.gid, d.handle, d.handleAt); return true; }
  if (!d.op) { restoreTransform(state, d.start); return true; }
  commitTransform(state, d.gid, d.op, { undo: d.undo, start: d.start, at: d.handleAt });
  return true;
}

/** THE commit every box entry ends in (the handle's release, a typed value): #core/transform.js runGroupTransform from the state as it was
 *  (`start`: the gesture's rollback point; the preview is first put back), the confirm when it asks one, ONE undo step (`undo`: the snapshot
 *  taken before anything moved). A refusal: everything back, the reason at `at`. -> a Promise of the result. */
export async function commitTransform(state, gid, op, { undo = state.captureUndoSnapshot(), start = null, at = null, notify = null } = {}) {
  if (start) restoreTransform(state, start);
  const kind = Math.abs(op.angle || 0) > 1e-12 ? 'rotate' : 'scale';
  let res = runGroupTransform(state, gid, op);
  if (res.needsConfirm) {
    const begin = snapshotTransform(state);
    applyGroupTransform(state, res.plan, op, { removals: false }); // the user sees what the confirm is about
    const choice = await openChoiceModal({ label: res.needsConfirm, options: [{ id: 'rotate', label: 'Rotate' }] });
    restoreTransform(state, begin);
    if (!choice) return { ok: false, cancelled: true };
    res = runGroupTransform(state, gid, op, { confirmed: true });
  }
  if (!res.ok) {
    const text = `Can't ${kind} ${nameOf(state, gid)}: ${res.reason}`;
    if (at) showTip(gid, text, at); else if (notify) notify(text, 'warning');
    return res;
  }
  state.saveStateForce(TRANSFORM_UNDO_LABELS[kind], undo);
  if (kind === 'rotate') track('group-rotate'); else track('group-scale');
  return res;
}

// ---- the typed value (the app's numeric box: .dim-input, placed by placeAnchoredBox, lengthText for a width)
export const TRANSFORM_INPUT_ID = 'tbox-input';
let openBox = null;
function closeInput() { if (openBox && openBox.el.parentNode) openBox.el.parentNode.removeChild(openBox.el); openBox = null; }
/** Is the typed angle / scale box open (tests, the Done check)? */
export function transformInputOpen() { return !!openBox; }

/** The op a typed text asks for, or { error }. Rotate: degrees, counter-clockwise ("30", "-45°"). Scale: a percent ("150", "150%") or a WIDTH
 *  with its unit ("80 mm", "3 in": the box's width becomes it). */
export function parseTransformInput(kind, text, box) {
  const t = String(text || '').trim();
  if (kind === 'rotate') {
    const m = /^([-+]?(?:\d+\.?\d*|\.\d+))\s*(?:°|deg)?$/i.exec(t);
    if (!m) return { error: 'type an angle in degrees, e.g. 30' };
    return { pivot: { x: box.cx, y: box.cy }, angle: -Number(m[1]) * Math.PI / 180, scale: 1 };
  }
  if (/[a-z"]/i.test(t.replace(/%$/, ''))) {
    const w = parseLength(t, docUnit());
    if (!(w > 0) || !(box.w > 0)) return { error: 'type a width with its unit, e.g. 80 mm' };
    return { pivot: { x: box.cx, y: box.cy }, angle: 0, scale: w / box.w };
  }
  const m = /^((?:\d+\.?\d*|\.\d+))\s*%?$/.exec(t);
  if (!m || !(Number(m[1]) > 0)) return { error: 'type a scale above 0 %, e.g. 150, or a width, e.g. 80 mm' };
  return { pivot: { x: box.cx, y: box.cy }, angle: 0, scale: Number(m[1]) / 100 };
}

/** Open the typed angle (kind 'rotate') or scale ('scale') of group `gid`, beside `world` (its handle). Enter runs it, Esc closes. */
export function openTransformInput(svg, state, gid, kind, world) {
  closeInput();
  if (typeof document === 'undefined') return null;
  ensureNumericInputStyles();
  const box = groupBox(state, gid), name = nameOf(state, gid);
  const el = document.createElement('input');
  el.id = TRANSFORM_INPUT_ID; el.type = 'text'; el.className = 'dim-input';
  el.setAttribute('aria-label', kind === 'rotate' ? `Rotate ${name} by (degrees, counter-clockwise)` : `Scale ${name}: a percent, or a width with its unit`);
  const initial = kind === 'rotate' ? '0' : '100%';
  el.value = initial; el.style.position = 'fixed'; el.style.width = '96px';
  document.body.appendChild(el);
  openBox = { el, gid, kind };
  placeAnchoredBox({ el, svg, world });
  const run = async () => {
    const op = parseTransformInput(kind, el.value, groupBox(state, gid) || box);
    if (op.error) { el.setAttribute('aria-invalid', 'true'); showTip(gid, op.error, world); return; }
    closeInput();
    await commitTransform(state, gid, op, { at: world });
  };
  el.addEventListener('input', () => el.removeAttribute('aria-invalid'));
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation(); // typing never reaches the canvas shortcuts
    if (handleBoxUndoKey(ev, el, initial, () => {})) return;
    if (ev.key === 'Enter') { ev.preventDefault(); run(); }
    else if (ev.key === 'Escape') { ev.preventDefault(); closeInput(); }
  });
  el.addEventListener('blur', () => { setTimeout(() => { if (openBox && openBox.el === el && document.activeElement !== el) closeInput(); }, 150); });
  // the press that opened it is still in flight: its click would take the focus back to the canvas
  const focusIt = () => { if (openBox && openBox.el === el) { el.focus(); el.select(); } };
  focusIt();
  if (typeof window !== 'undefined') window.addEventListener('pointerup', () => setTimeout(focusIt, 0), { once: true, capture: true });
  setTimeout(focusIt, 60);
  return el;
}

/** TASK 753: a group drag that leaves the click radius on a FULL-LOCKED group: the reason at the box (the solver holds it: nothing moves). */
export function noteGroupDragStart(svg, state) {
  const t = boxTargets(state).find((x) => x.mode === 'select');
  if (!t) return;
  const holder = lockHolder(state, t.gid, 'full');
  if (!holder) return;
  const box = groupBox(state, t.gid);
  if (box) showTip(t.gid, `${nameOf(state, holder)} has ${GROUP_LOCKS.full.label} on: unlock it (red padlock) to move`, boxLayout(box, getZoomFactor(svg), coarse()).locks.full);
}

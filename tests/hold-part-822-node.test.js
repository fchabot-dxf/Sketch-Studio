// tests/hold-part-822-node.test.js — TASK 822 (owner turn 2771): TABS ON A TIGHT OUTLINE + DRAGGABLE TABS (#core/hold-part.js tabLayout `fit` / `at`, tabHandles,
// holdTabDragAt; Prepare's tab handles, apps/shaper/src/prepare-view.js; the shape's dragged tabs on its operation's geometry ref, `tabsAt`).
//  1. the owner's keyhole (circle R 0.375 in + a 0.313 in wide stem, its round end 1.375 in below the circle's centre), Inside, depth 0.156 in, tabs 0.063 in wide
//     and thick, 1/8 in bit: the even spread put tabs in the stem, where the gap strips (bit + 1 mm wide) do not fit, and the WHOLE hold was refused ('strip', at
//     every commit since 742: see WORK-LOG TURN 822). Now the tabs go where the strips fit: 5 asked = 5 placed, all on the circle, 0 in the stem; 20 asked = the 8
//     that fit; the note says so; every strip's end caps exactly the strip width (the strips are built). A slot where no strip fits anywhere: still refused.
//  2. the drag (core): a tab moved along the circle (its gap strips fit there) is placed there, every tab's centre returned (what is stored); into the stem: refused
//     (the tab stays); the export follows the stored positions; a stale stored position (no longer fitting) is snapped to where it fits.
//  3. the app: the tab handles show only while the operation is OPEN; dragging one moves the tab (stored on that shape's geometry ref, saved), the count row shows
//     the number (not Auto); Cancel restores; OK = ONE undo step (Undo / Redo); a refused spot moves nothing; Auto lays the tabs out again (one step); save + reload.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import SettingsManager from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { loopPolygon } from '#core/loop-geometry.js';
import { deriveCuts } from '#core/stepped-cut.js';
import { HOLD_PART, loopWalk, walkAt, tabLayout, stripFit, holdStrips, tabHandles, holdTabDragAt } from '#core/hold-part.js';
import { planEntries, keyOf, holdNoteItems } from '../apps/shaper/src/cut-plan.js';
import { membersOf } from '../apps/shaper/src/operations-store.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { editStep } from './helpers/prepare-open.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const IN = 25.4, BIT = IN / 8, STRIP = BIT + HOLD_PART.stripExtraMm;
const R = 0.375 * IN, H = 0.313 * IN / 2, L = 1.375 * IN, YJ = -Math.sqrt(R * R - H * H); // the circle, the stem's half width, its length, the neck's y

// the owner's keyhole: the big arc from the right neck corner round the top to the left one, the stem's left wall, its round end, its right wall
function keyhole() {
  const joints = new Map([['c', { x: 0, y: 0 }], ['jr', { x: H, y: YJ }], ['jl', { x: -H, y: YJ }], ['bl', { x: -H, y: -L }], ['br', { x: H, y: -L }], ['cb', { x: 0, y: -L }]]);
  const shapes = [
    { id: 'big', type: 'arc', subType: 'CENTER', joints: ['c', 'jr', 'jl'], sweep: true },
    { id: 'sl', type: 'line', joints: ['jl', 'bl'] },
    { id: 'bot', type: 'arc', subType: 'CENTER', joints: ['cb', 'bl', 'br'], sweep: true },
    { id: 'sr', type: 'line', joints: ['br', 'jr'] },
  ];
  return { joints, shapes, constraints: [], groups: [], profiles: [] };
}
const OWNER = { cutType: 'interior', cutDepth: 0.156 * IN, cutOffset: 0, toolDia: BIT, holdPart: 'tabs', tabCount: 5, tabWidth: 0.063 * IN, holdThickness: 0.063 * IN };
const loopOf = (st, edge) => findLoops(st).find((l) => l.edges.includes(edge));
const polysOf = (st) => { const by = new Map(st.shapes.map((s) => [s.id, s])); const lp = {}; for (const l of findLoops(st)) lp[l.id] = loopPolygon(l, st, by); return lp; };
const cutsOf = (st, edge, rec) => deriveCuts({ kind: 'loop', id: loopOf(st, edge).id }, rec, st, findLoops(st), polysOf(st), new Set());
const holdOf = (cuts) => cuts.find((c) => c.hold && c.hold.role !== 'strip').hold;
const stripsOf = (cuts) => cuts.filter((c) => c.hold && c.hold.role === 'strip');
const where = (p) => (p.y > YJ + 1e-6 ? 'circle' : p.y < -L + 1e-6 ? 'end' : 'stem');
const onCircle = (p) => Math.abs(Math.hypot(p.x, p.y) - R) < 1e-6;
const exportOf = (st, entries) => exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: 'mm', options: {}, loopPolys: polysOf(st) });

// ── 1. the keyhole: tabs go where the gap strips fit ──
{
  const st = keyhole(), loop = loopOf(st, 'big'), w = loopWalk(loop, st);
  // the cause (before): the even spread of 5 (no `fit`) put 2 tabs in the stem, where no end cap reaches the offset at the strip width
  const plain = tabLayout(w, { count: 5, width: OWNER.tabWidth, bitRadius: BIT / 2, gap: STRIP, side: -1 });
  eq(plain.tabs.map((t) => where(walkAt(w, t.s).point)), ['circle', 'circle', 'circle', 'stem', 'stem'], 'the even spread of 5 (as before): 2 tabs in the stem');
  const fit = stripFit(w, -1, STRIP);
  ok(plain.tabs.filter((t) => where(walkAt(w, t.s).point) === 'stem').every((t) => fit.capRing(t.s0) < 0 && fit.capRing(t.s1) < 0), 'a stem tab\'s gap strips do not fit (its end caps do not reach the offset at the strip width)');
  eq(holdStrips(w, plain, -1, STRIP, fit), null, 'so the strips of that layout cannot be built (the whole hold was refused)');
  // now
  const cuts = cutsOf(st, 'big', OWNER), hold = holdOf(cuts);
  eq([hold.role, hold.requested, hold.count, hold.narrow, stripsOf(cuts).length], ['pass', 5, 5, true, 5], 'the owner\'s keyhole: 5 tabs asked, 5 placed (narrow), 5 gap strips');
  const hs = tabHandles(loop, OWNER, st);
  eq(hs.map((h) => where(h.point)), Array(5).fill('circle'), 'all 5 on the circle, 0 in the stem');
  ok(hs.every((h) => onCircle(h.point)), 'each tab centre is ON the circle (R 0.375 in)');
  const ang = hs.map((h) => Math.atan2(h.point.y, h.point.x));
  ok(Math.abs(ang[0] + ang[4] - Math.PI) < 1e-6 || Math.abs(ang[0] + ang[4] + Math.PI) < 1e-6 || Math.abs(Math.abs(hs[0].point.x) - Math.abs(hs[4].point.x)) < 1e-6, 'spread evenly over the circle (symmetric about the stem\'s axis)');
  for (let i = 1; i < 5; i++) ok(Math.abs(Math.hypot(hs[i].point.x - hs[i - 1].point.x, hs[i].point.y - hs[i - 1].point.y) - Math.hypot(hs[1].point.x - hs[0].point.x, hs[1].point.y - hs[0].point.y)) < 1e-6, `even spacing (tab ${i})`);
  // each strip's end caps are exactly the strip width (checked by holdStrips); the strips start / end at the tabs' ends
  const lay = tabLayout(w, { count: 5, width: OWNER.tabWidth, bitRadius: BIT / 2, gap: STRIP, side: -1, fit });
  ok(lay.tabs.every((t) => fit.capRing(t.s0) === 0 && fit.capRing(t.s1) === 0), 'every tab end: its cap reaches ring 0 at the strip width');
  // the note (inch document)
  SettingsManager.set('DOC_UNIT', 'in'); SettingsManager.set('LENGTH_PRECISION', null);
  eq(holdNoteItems(OWNER, hold).map((i) => i.text), ['Inside: 5 tabs, 0.063 in wide, 0.063 in thick: 1 pass at 0.093 in + 5 gaps at 0.156 in', 'Placed where a gap strip fits: part of the outline is too narrow for one', 'Gaps: cut the side against the part; the return leg is optional'], 'the note: the honest fact');
  ok(holdNoteItems(OWNER, hold)[1].warn, 'in the warning style (TASK 825: a line of its own, listed first on the card)');
  const many = holdOf(cutsOf(st, 'big', { ...OWNER, tabCount: 20 }));
  eq([many.role, many.requested, many.count], ['pass', 20, 8], '20 asked: the 8 that fit on the circle');
  eq(holdNoteItems(OWNER, many)[1].text, 'Only 8 of 20 tabs fit: part of the outline is too narrow for a gap strip', 'the note: only 8 of 20 tabs fit');
  const auto = holdOf(cutsOf(st, 'big', { ...OWNER, tabCount: 'auto' }));
  eq([auto.role, auto.requested, auto.count, tabHandles(loop, { ...OWNER, tabCount: 'auto' }, st).every((h) => onCircle(h.point))], ['pass', 3, 3, true], 'Auto (3): 3 on the circle');
  // a slot where no gap strip fits anywhere (7 mm wide, strips 4.175 mm from each side): still refused, today's line
  const slot = { joints: new Map([['a', { x: 0, y: 0 }], ['b', { x: 100, y: 0 }], ['c', { x: 100, y: 7 }], ['d', { x: 0, y: 7 }]]), shapes: [['s0', 'a', 'b'], ['s1', 'b', 'c'], ['s2', 'c', 'd'], ['s3', 'd', 'a']].map(([id, p, q]) => ({ id, type: 'line', joints: [p, q] })), constraints: [], groups: [], profiles: [] };
  const sh = holdOf(cutsOf(slot, 's0', { ...OWNER, cutType: 'interior', tabWidth: 6 }));
  eq([sh.role, sh.error], ['refused', 'strip'], 'a 7 mm slot, Inside: no stretch where a strip fits: refused');
  SettingsManager.set('DOC_UNIT', 'mm');
  eq(holdNoteItems({ ...OWNER, cutType: 'interior' }, sh)[0].text, 'Inside: tabs refused: the outline is too tight for the gap strips here (or the offset is wider than the strip allows); cut without them', 'its note: today\'s line');
}

// ── 2. the drag (core) ──
{
  const st = keyhole(), loop = loopOf(st, 'big');
  const hs = tabHandles(loop, OWNER, st);
  // tab 0 (nearest the right neck corner) moved 1.5 mm further toward the neck, along the circle
  const a0 = Math.atan2(hs[0].point.y, hs[0].point.x), a1 = a0 - 1.5 / R, target = { x: R * Math.cos(a1), y: R * Math.sin(a1) };
  const moved = holdTabDragAt(loop, OWNER, st, hs[0].at, { x: target.x * 1.05, y: target.y * 1.05 }); // the pointer a little off the outline: the nearest outline point
  ok(moved && moved.ok, 'a tab dragged along the circle where its strips fit: placed');
  ok(Math.hypot(moved.point.x - target.x, moved.point.y - target.y) < 1e-6, 'at the outline point nearest the pointer');
  eq(moved.at.length, 5, 'every tab\'s centre returned (5)');
  ok(moved.at.every((f, i) => i === 0 || f > moved.at[i - 1]), 'sorted');
  const recMoved = { ...OWNER, tabsAt: moved.at };
  const hm = tabHandles(loop, recMoved, st);
  ok(hm.some((h) => Math.hypot(h.point.x - target.x, h.point.y - target.y) < 1e-6) && hs.slice(1).every((h) => hm.some((x) => Math.hypot(x.point.x - h.point.x, x.point.y - h.point.y) < 1e-6)), 'stored: the dragged tab at its new place, the 4 others where they were');
  const pass = holdOf(cutsOf(st, 'big', recMoved));
  eq([pass.role, pass.count, pass.fixed, pass.narrow], ['pass', 5, true, undefined], 'the hold with the dragged tabs: 5, fixed (the stored positions all fit: not narrow)');
  const into = holdTabDragAt(loop, OWNER, st, hs[0].at, { x: H, y: -20 }); // the stem's right wall
  eq([into.ok, Math.abs(into.point.x - H) < 1e-9], [false, true], 'into the stem: refused (the tab stays where it was)');
  const tooNear = holdTabDragAt(loop, OWNER, st, hs[0].at, hs[1].point); // onto its neighbour
  eq(tooNear.ok, false, 'onto another tab: refused');
  // the export follows the stored positions
  const k = keyOf('loop', loop.id);
  const svgA = exportOf(st, [{ key: k, planKey: k, target: { kind: 'loop', id: loop.id }, rec: OWNER }]), svgB = exportOf(st, [{ key: k, planKey: k, target: { kind: 'loop', id: loop.id }, rec: recMoved }]);
  ok(svgA !== svgB && (svgB.match(/shaper:cutType="inside"/g) || []).length === (svgA.match(/shaper:cutType="inside"/g) || []).length, 'the export follows the dragged tab (the same 1 pass + 5 strips, another layout)');
  // a stale stored position (the stem: no longer fits, e.g. after a design edit) is moved to where its strips fit, the others kept
  const w = loopWalk(loop, st), sStem = (() => { let best = 0, bd = Infinity; for (let i = 0; i < 2000; i++) { const s = (i / 2000) * w.length, p = walkAt(w, s).point; const d = Math.hypot(p.x - H, p.y + 20); if (d < bd) { bd = d; best = s; } } return best / w.length; })();
  const stale = holdOf(cutsOf(st, 'big', { ...OWNER, tabsAt: [sStem, ...hs.slice(1).map((h) => h.at)] }));
  eq([stale.role, stale.count, stale.narrow, tabHandles(loop, { ...OWNER, tabsAt: [sStem, ...hs.slice(1).map((h) => h.at)] }, st).every((h) => where(h.point) === 'circle')], ['pass', 5, true, true], 'a stored tab in the stem: moved onto the circle (5 kept, narrow)');
  // On line's tabs (the same layout): a stored position is used too
  const onl = { cutType: 'online', cutDepth: 3, cutOffset: 0, toolDia: BIT, holdPart: 'tabs', tabCount: 3, tabWidth: 6 };
  const ho = tabHandles(loop, onl, st);
  const dragged = holdTabDragAt(loop, onl, st, ho[0].at, { x: 0, y: R });
  eq([ho.length, dragged.ok, tabHandles(loop, { ...onl, tabsAt: dragged.at }, st).some((h) => Math.hypot(h.point.x, h.point.y - R) < 1e-6)], [3, true, true], 'On line: its tabs dragged the same way (the top of the circle)');
}

// ── 3. the app ──
SettingsManager.set('DOC_UNIT', 'in');
const drawKeyhole = (app) => {
  const st = app.state, src = keyhole();
  for (const k of [...st.joints.keys()]) st.joints.delete(k);
  st.shapes.length = 0; st.constraints.length = 0;
  for (const [k, v] of src.joints) st.joints.set(k, v);
  st.shapes.push(...src.shapes);
};
const harness = (app) => {
  const doc = app.document, q = (s) => doc.querySelector(s), qa = (s) => [...doc.querySelectorAll(s)];
  const pressRaw = (s) => { const e = q(s); assert(e, s + ' not found'); app.press(e); };
  const pressEl = (s) => editStep(app, () => pressRaw(s));
  const pc = () => doc.getElementById('prepare-canvas');
  const clickAt = (x, y) => { const p = worldToScreen(pc(), { x, y }); app.click(Math.round(p.x), Math.round(p.y), { target: pc() }); };
  const typed = (cls, v) => editStep(app, () => { const i = q(cls); i.value = v; i.dispatchEvent(new app.window.Event('change')); });
  const handles = () => qa('#prepare-canvas .sk-tab-handle').map((g) => { const m = /translate\(([-\d.e]+) ([-\d.e]+)\)/.exec(g.getAttribute('transform')); return { g, x: Number(m[1]), y: Number(m[2]), at: Number(g.getAttribute('data-tab-at')) }; });
  // a pointer drag from a handle to world point `to` (the handle drag of task 778 / 822, with the pointer)
  const drag = (h, to, { moves = [to] } = {}) => {
    const p0 = worldToScreen(pc(), { x: h.x, y: h.y });
    h.g.dispatchEvent(new app.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, button: 0, isPrimary: true, clientX: p0.x, clientY: p0.y }));
    const seen = [];
    for (const m of moves) {
      const p = worldToScreen(pc(), m);
      pc().dispatchEvent(new app.window.PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 7, buttons: 1, clientX: p.x, clientY: p.y }));
      const g = q('#prepare-canvas .sk-tab-handle.is-dragging');
      seen.push({ refused: Boolean(g && g.classList.contains('is-refused')), preview: qa('#prepare-lead-drag-group .sk-tab-mark').length, faded: q('#prepare-toolpath-group').classList.contains('is-tab-dragging') });
    }
    const p1 = worldToScreen(pc(), moves[moves.length - 1]);
    pc().dispatchEvent(new app.window.PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 7, button: 0, clientX: p1.x, clientY: p1.y }));
    return seen;
  };
  const countRow = () => [q('.cut-tab-count').value, q('.cut-tab-count').placeholder, qa('.cut-row[data-row="tabCount"] .cut-preset.is-active').length];
  return { q, pressRaw, pressEl, clickAt, typed, handles, drag, countRow };
};
const refOf = (app) => { const k = keyOf('loop', loopOf(app.state, 'big').id); const m = membersOf(k)[0]; return m ? m.ref : null; };
let opId = null, svgSaved = null, tabsSaved = null;
const profile = await createProfile();
await createNamedDesign(profile, 'shaper', 'Tabs 822');
{
  const app = await open({ host: 'shaper', profile });
  try {
    const h = harness(app), st = app.state;
    h.pressRaw('.sk-header-tab[data-tab="design"]');
    drawKeyhole(app);
    st.saveState('draw the keyhole');
    h.pressRaw('.sk-header-tab[data-tab="prepare"]');
    h.clickAt(0, -L / 2); // inside the keyhole, in its stem (TASK 847: Node arc fallback fixed (847-C): in Node an arc is sampled by its two ENDS, so the keyhole's polygon here is the stem; the circle's centre, the click before, was only inside while the fallback returned [centre, end])
    h.pressEl('#op-type-interior'); // the quick flow (TASK S3: the operations toolbar): a new Inside operation, open
    opId = app.prepare.openId();
    ok(opId, 'an Inside operation, open');
    h.typed('.cut-depth', '0.156');
    h.pressEl('.cut-row[data-row="holdPart"] .cut-preset[data-value="tabs"]');
    h.typed('.cut-tab-count', '5'); h.typed('.cut-tab-width', '0.063'); h.typed('.cut-hold-thickness', '0.063');
    ok(h.q('.cut-note').textContent.includes('Inside: 5 tabs, 0.063 in wide') && h.q('.cut-note').textContent.includes('Placed where a gap strip fits'), 'the card note: 5 tabs, placed where a gap strip fits');
    let hs = h.handles();
    eq(hs.length, 5, 'the open operation: 5 tab handles on the outline');
    ok(hs.every((x) => onCircle(x)), 'each on the circle');
    ok(h.q('#prepare-canvas .sk-tab-handle .sk-lead-hit').getAttribute('r') === '22' && h.q('#prepare-canvas .sk-tab-handle').classList.contains('sk-lead-handle'), 'the lead-in handle\'s style (sk-lead-handle) and its 44 px target (r 22 px)');
    app.prepare.ok();
    eq(h.handles().length, 0, 'closed (OK): no tab handle');
    h.clickAt(0, -L / 2); // in the stem (TASK 847, above)
    eq(h.handles().length, 0, 'a click only selects: no tab handle');
    app.prepare.edit(opId);
    hs = h.handles();
    eq(hs.length, 5, 'opened again: the handles');
    eq(h.countRow(), ['5', 'Auto', 0], 'the count row: 5 (typed)');
    // drag tab 0 toward the neck: placed, previewed while dragging; Cancel restores
    const n0 = st.history.length;
    const a0 = Math.atan2(hs[0].y, hs[0].x), a1 = a0 - 1.5 / R, target = { x: R * Math.cos(a1), y: R * Math.sin(a1) };
    const seen = h.drag(hs[0], target);
    eq(seen, [{ refused: false, preview: 5, faded: true }], 'while dragging: the handle not refused, the 5 tabs redrawn in the drag layer, the old ones faded');
    eq(h.q('#prepare-toolpath-group').classList.contains('is-tab-dragging'), false, 'released: nothing faded');
    const ref = refOf(app);
    ok(Array.isArray(ref.tabsAt) && ref.tabsAt.length === 5, 'the dragged tabs are stored on the shape\'s geometry ref (tabsAt, 5 centres)');
    const after = h.handles();
    ok(after.some((x) => Math.hypot(x.x - target.x, x.y - target.y) < 1e-6), 'the tab is where it was dropped');
    eq(h.countRow(), ['5', 'Auto', 0], 'the count row: 5, fixed (Auto not active)');
    app.prepare.cancel();
    eq([refOf(app).tabsAt, st.history.length], [undefined, n0], 'Cancel: the tabs as before, nothing in the undo stack');
    // drag again, OK = one undo step; Undo / Redo
    app.prepare.edit(opId);
    h.drag(h.handles()[0], target);
    const svgDragged = exportOf(st, planEntries());
    app.prepare.ok();
    eq(st.history.length, n0 + 1, 'OK: ONE undo step');
    ok(Array.isArray(refOf(app).tabsAt), 'kept');
    app.undo();
    eq(refOf(app).tabsAt, undefined, 'Undo: the tabs as laid out before');
    app.redo();
    ok(Array.isArray(refOf(app).tabsAt) && exportOf(st, planEntries()) === svgDragged, 'Redo: the dragged tabs, the same export');
    // a refused spot moves nothing
    app.prepare.edit(opId);
    const before = JSON.stringify(refOf(app).tabsAt), hb = st.history.length;
    const seenStem = h.drag(h.handles()[0], { x: H, y: -20 });
    eq([seenStem[0].refused, JSON.stringify(refOf(app).tabsAt), st.history.length], [true, before, hb], 'into the stem: the handle shows refused, the tab does not move');
    // the count typed while the tabs are fixed / Auto: they are laid out again (the dragged positions dropped)
    h.pressRaw('.cut-row[data-row="tabCount"] .cut-preset[data-value="auto"]');
    eq([refOf(app).tabsAt, h.countRow()], [undefined, ['', 'Auto (3)', 1]], 'Auto: the tabs laid out again, the count Auto (3)');
    app.prepare.ok();
    eq(st.history.length, hb + 1, 'Auto: ONE undo step');
    app.undo();
    ok(Array.isArray(refOf(app).tabsAt), 'Undo: the dragged tabs back');
    // save: the dragged tabs are in the document
    app.prepare.edit(opId); app.prepare.ok();
    svgSaved = exportOf(st, planEntries());
    tabsSaved = JSON.stringify(refOf(app).tabsAt);
    const d = await app.storedDoc();
    ok(d.hosts.shaper.operations.some((o) => o.geometry.some((g) => Array.isArray(g.tabsAt) && JSON.stringify(g.tabsAt) === tabsSaved)), 'the autosave stores the shape\'s tabsAt on its geometry ref');
  } finally { await app.close(); }
}
{
  const app = await open({ host: 'shaper', profile });
  try {
    app.modes.showMode('prepare');
    eq(JSON.stringify(refOf(app).tabsAt), tabsSaved, 'reloaded: the dragged tabs');
    eq(exportOf(app.state, planEntries()), svgSaved, 'and the export byte-identical');
  } finally { await app.close(); }
}
console.log(`hold-part-822-node: ok (${checks} checks)`);

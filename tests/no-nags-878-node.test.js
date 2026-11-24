// tests/no-nags-878-node.test.js — TASK 878 (owner turns 3472-3474: "too many warning, make me think something is wrong, but its just infantilising me"):
// a toast shows ONLY when something is wrong and the user must act (an error, a refusal, data that could not be read). In SketchStudio, through
// tests/helpers/node-app.js, each trigger of a REMOVED notice now shows no toast, and a refusal next to it still does:
//  1. Group (Ctrl+G) / Ungroup (Ctrl+Shift+G): no "Grouped ..." / "Ungrouped ..."; Group with one thing selected: still refused with its reason;
//  2. a group's lock toggled: no "<group>: Full lock on";
//  3. Equal (E with two lines selected): no "Equal constraint applied";
//  4. a constraint / dimension tool started with a group selected: no "The selected group is not used" message;
//  5. Mirror: the tool's start (objects step and, with a selection, line step) and the mirror line's pick: no step message; Enter with no
//     object: still refused with its reason;
//  6. Close path started with nothing selected: no "click an open outline" message (its ribbon hint says what to click);
//  7. Offset applied: no "Offset applied (...)".
// The Settings panel's preset save / delete / reset: tests/notice-levels-node.test.js; Fillet applied: tests/fillet-polish-666-node.test.js; Close path
// that closed everything: tests/close-path-760-node.test.js; Combine / Uncombine: tests/profile-model.test.js; Shaper's Stock and Recalculate notices:
// tests/stock-loop-node.test.js, tests/opbar-s3-node.test.js; the cut plan's one-time notice: tests/bezier-loops-761-node.test.js, tests/hole-rule-774-node.test.js.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { toggleGroupLock } from '#ui/group-actions.js';
import { RIBBON_HINTS } from '#ui/design-hints.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };

// two rectangles, each a group (R: group-1, Q: group-2), and a loose line S
const rect = (p, [x0, y0, x1, y1], gid) => ({
  joints: { [p + '1']: [x0, y0], [p + '2']: [x1, y0], [p + '3']: [x1, y1], [p + '4']: [x0, y1] },
  shapes: [[1, 2], [2, 3], [3, 4], [4, 1]].map(([a, b], i) => ({ id: p + 'E' + (i + 1), type: 'line', joints: [p + a, p + b], userGroupId: gid })),
});
const R = rect('r', [0, 0, 30, 20], 'group-1'), Q = rect('q', [40, 0, 70, 20], 'group-2');
const DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries({ ...R.joints, ...Q.joints, s1: [0, 40], s2: [70, 40], t1: [0, 60], t2: [50, 60] }).map(([id, [x, y]]) => [id, { x, y, fixed: false, sketchId: 'sketch-1' }])],
  shapes: [...R.shapes, ...Q.shapes, { id: 'S', type: 'line', joints: ['s1', 's2'] }, { id: 'T', type: 'line', joints: ['t1', 't2'] }].map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
  constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1',
  groups: [{ id: 'group-1', name: 'R', sketchId: 'sketch-1' }, { id: 'group-2', name: 'Q', sketchId: 'sketch-1' }], profiles: [], parameters: [] } };
const rIds = R.shapes.map((s) => s.id), qIds = Q.shapes.map((s) => s.id);

const profile = await createProfile();
const id = await createNamedDesign(profile, 'sketchstudio', 'Task 878');
{ const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(DOC, { app: 'sketchstudio', id }); }
const app = await quiet(open)({ host: 'sketchstudio', profile });
try {
  const st = app.state, doc = app.document;
  app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: 35, y: 30, w: 140 }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
  const toasts = () => [...doc.querySelectorAll('#notification-container [data-level]')].map((t) => t.getAttribute('data-level') + ': ' + t.querySelector('pre').textContent);
  const clear = () => doc.querySelectorAll('#notification-container [data-level]').forEach((t) => t.remove());
  const select = (ids) => { st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear(); for (const x of ids) st.selectedShapes.add(x); };
  const mid = (sid) => { const s = st.shapes.find((x) => x.id === sid), a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return app.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2); };

  // 1. Group / Ungroup
  clear(); select(['S']); app.key('g', { ctrl: true });
  eq(toasts(), ['warning: Select 2+ shapes to group'], '1: Group with one thing selected: still refused, with its reason');
  clear(); select([...rIds, ...qIds]); const g0 = st.groups.length; app.key('g', { ctrl: true });
  eq([st.groups.length - g0, toasts()], [1, []], '1: Ctrl+G grouped R and Q: no toast');
  app.key('g', { ctrl: true, shift: true });
  eq([st.groups.length, toasts()], [g0, []], '1: Ctrl+Shift+G ungrouped it: no toast');

  // 2. a group's lock toggled (the padlock, the menus and the browser row all run toggleGroupLock)
  clear(); const lockNotes = [];
  eq(toggleGroupLock(st, 'full', 'group-1', (m, l) => lockNotes.push(l + ': ' + m)), { on: true }, '2: Full lock on');
  eq(lockNotes, [], '2: no "R: Full lock on" message');
  ok(toggleGroupLock(st, 'sizeAngle', 'group-1', (m, l) => lockNotes.push(l + ': ' + m)).refused && lockNotes.length === 1 && lockNotes[0].startsWith('warning: R: Full lock is on'), '2: a refused lock still says why: ' + lockNotes);
  toggleGroupLock(st, 'full', 'group-1');

  // 3. Equal: E with two lines selected applies it at once
  clear(); select(['S', 'T']); const c0 = st.constraints.length;
  app.key('e');
  eq([st.constraints.filter((c) => c.type === CONSTRAINT_TYPES.EQUAL).length, toasts()], [1, []], '3: E applied Equal to the two lines: no toast');
  ok(st.constraints.length > c0, '3: (the constraint is there)');
  app.esc(); app.tool('select');

  // 4. a constraint / dimension tool started with a whole group selected
  for (const tool of ['dim', 'parallel', 'equal']) {
    clear(); app.tool('select'); select(rIds);
    app.tool(tool);
    eq(toasts(), [], `4: the ${tool} tool started with group R selected: no message`);
    app.esc();
  }
  app.tool('select');

  // 5. Mirror
  clear(); select([]); app.tool('mirror');
  eq([st.mirror && st.mirror.step, toasts()], ['objects', []], '5: Mirror started, nothing selected: the objects step, no message');
  app.enter();
  ok(toasts().length === 1 && toasts()[0].startsWith('warning: Mirror: '), '5: Enter with no object: still refused with its reason: ' + toasts());
  app.esc(); app.tool('select');
  clear(); select(rIds); app.tool('mirror');
  eq([st.mirror && st.mirror.step, toasts()], ['line', []], '5: Mirror started with R selected: the line step, no message');
  const p = mid('S'); app.click(p.x, p.y);
  eq([st.mirror.line, toasts()], ['S', []], '5: the mirror line picked: no "Mirror line: the line" message');
  app.esc(); app.tool('select');
  ok(/mirror line/.test(RIBBON_HINTS.mirror) && /open ends are marked/.test(RIBBON_HINTS.closePath), '5/6: the steps are in the tools\' ribbon hints');

  // 6. Close path with nothing selected
  clear(); select([]); app.tool('closePath');
  eq([st.currentTool, toasts()], ['closePath', []], '6: Close path started with nothing selected: no message');
  app.tool('select');

  // 7. Offset applied (Enter on its box)
  clear(); select([]); app.tool('offset');
  const t = mid('T'); app.click(t.x, t.y);
  const box = doc.getElementById('offset-distance-input');
  ok(box, '7: the offset box is open');
  const n0 = st.shapes.length;
  app.enter();
  eq([st.shapes.length > n0, toasts()], [true, []], '7: the offset applied: no "Offset applied" toast');
  app.tool('select');

  console.log(`no-nags-878-node: ok (${checks} checks)`);
} finally { await app.close(); }
process.exit(0);

// tests/groups-commands-756-node.test.js — TASK 756 (node, through tests/helpers/node-app.js): user groups in every app, the SHARED commands.
//  1. #core/group-model.js groupCommands (THE answer to "what can Group / Ungroup / Enter / Leave do on this selection") and the
//     #ui/group-actions.js functions the keys, the canvas menu and a group's browser row all run: Group (two or more things at the entered
//     level; one undo step), Ungroup (one level; one undo step), Enter group, Leave group (session UI);
//  2. the same functions reached the user's ways, in SketchStudio (not Shaper: task 751 had them in Shaper only): Ctrl+G / Ctrl+Shift+G, the
//     canvas right-click menu (a right click on a member selects its whole group first; the entries shown only when they apply), a group's
//     row in the design browser (its menu: Ungroup / Enter group / Leave group);
//  3. delete: a group whose shapes are all deleted leaves no entry (#core/delete-manager.js removeGeometry, the ONE place); a group that keeps
//     a shape stays;
//  4. copies of a WHOLE group are groups (same name, nesting kept, beside the original; the paste: in the entered group): paste, mirror,
//     pattern (an instance removed by a smaller count takes its copy group with it); a copy of part of a group is loose, as before.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { groupCommands, selectUnit, shapesInGroup, childGroups } from '#core/group-model.js';
import { groupSelection, ungroupSelection, enterSelectedGroup, leaveEnteredGroup, groupMenuActions } from '#ui/group-actions.js';
import { contextMenuItems } from '#ui/context-menu.js';
import { selectionToEnvelope, pasteDocument } from '#ui/clipboard.js';
import { mirrorObjects } from '#core/mirror.js';
import { applyPattern, patternDefaults, editPattern } from '#core/pattern.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' });
const quiet = (fn) => async (...a) => { const log = console.log; console.log = () => {}; try { return await fn(...a); } finally { console.log = log; } };
let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const measured = {};
const PAIR_GAP_MS = 600;

// two rectangles, each a group (R: group-1, Q: group-2), and a loose line S, in SketchStudio
const rect = (p, [x0, y0, x1, y1], gid) => ({
  joints: { [p + '1']: [x0, y0], [p + '2']: [x1, y0], [p + '3']: [x1, y1], [p + '4']: [x0, y1] },
  shapes: [[1, 2], [2, 3], [3, 4], [4, 1]].map(([a, b], i) => ({ id: p + 'E' + (i + 1), type: 'line', joints: [p + a, p + b], userGroupId: gid })),
});
const R = rect('r', [0, 0, 30, 20], 'group-1'), Q = rect('q', [40, 0, 70, 20], 'group-2');
const DOC = { version: 3, hosts: {}, geometry: {
  joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], ...Object.entries({ ...R.joints, ...Q.joints, s1: [0, 40], s2: [70, 40] }).map(([id, [x, y]]) => [id, { x, y, fixed: false, sketchId: 'sketch-1' }])],
  shapes: [...R.shapes, ...Q.shapes, { id: 'S', type: 'line', joints: ['s1', 's2'] }].map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
  constraints: [], sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }], activeSketchId: 'sketch-1',
  groups: [{ id: 'group-1', name: 'R', sketchId: 'sketch-1' }, { id: 'group-2', name: 'Q', sketchId: 'sketch-1' }], profiles: [], parameters: [] } };
const rIds = R.shapes.map((s) => s.id), qIds = Q.shapes.map((s) => s.id);
async function openDoc(opts = {}) {
  const profile = await createProfile();
  const id = await createNamedDesign(profile, 'sketchstudio', 'Task 756');
  { const store = profile.createProjectStore({ adapter: profile.adapter, legacySource: async () => null, channel: null }); await store.save(DOC, { app: 'sketchstudio', id }); }
  const app = await quiet(open)({ host: 'sketchstudio', profile, ...opts });
  const st = app.state; app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: 35, y: 20, w: 120 }); st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`); app.frames();
  return app;
}
const select = (st, ids) => { st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear(); for (const id of ids) st.selectedShapes.add(id); };
const sel = (st) => [...st.selectedShapes].sort();
const names = (st) => st.groups.map((g) => g.name + (g.parentId ? '<' + st.groups.find((p) => p.id === g.parentId).name : ''));
const mid = (app, id) => { const st = app.state, s = st.shapes.find((x) => x.id === id), a = st.joints.get(s.joints[0]), b = st.joints.get(s.joints[1]); return app.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2); };

// ---- 1. the command functions
{
  const app = await openDoc();
  try {
    const st = app.state, said = [];
    const notify = (m, level) => said.push(level + ': ' + m);
    select(st, rIds);
    eq(groupCommands(st), { group: false, ungroup: ['group-1'], enter: 'group-1', leave: false }, 'one whole group selected: Ungroup / Enter group (not Group: one thing)');
    eq(groupSelection(st, notify), null, 'Group refuses one thing');
    select(st, [...rIds, ...qIds, 'S']);
    eq(groupCommands(st), { group: true, ungroup: ['group-1', 'group-2'], enter: null, leave: false }, 'two groups + a line: Group, Ungroup (both), no Enter');
    const h0 = st.history.length;
    const g = groupSelection(st, notify);
    eq([g.name, names(st), st.history.length - h0], ['Group 3', ['R<Group 3', 'Q<Group 3', 'Group 3'], 1], 'Group: the two groups nested whole, the line a member; ONE undo step');
    eq([selectUnit(st, 'rE1'), selectUnit(st, 'S'), sel(st)], [g.id, g.id, [...rIds, ...qIds, 'S'].sort()], 'a click now selects the new group; the selection is kept');
    app.undo();
    eq(names(st), ['R', 'Q'], 'undo: the two groups as they were');
    select(st, rIds);
    eq(ungroupSelection(st, notify), 1, 'Ungroup dissolves the selected group');
    eq([names(st), st.shapes.filter((s) => rIds.includes(s.id)).map((s) => s.userGroupId || null)], [['Q'], [null, null, null, null]], 'R gone, its curves loose');
    app.undo();
    select(st, rIds);
    eq([enterSelectedGroup(st), st.enteredGroupId, st.selectedShapes.size], ['group-1', 'group-1', 0], 'Enter group: R entered, nothing selected');
    eq(groupCommands(st).leave, true, 'Leave group offered while R is entered');
    eq([leaveEnteredGroup(st), st.enteredGroupId], [true, null], 'Leave group: back to the top');
    eq(said, ['warning: Select 2+ shapes to group', 'success: Grouped 9 shapes → Group 3', 'success: Ungrouped 1 group'], 'the messages');
    // the menu entries, declared once (context-menu.js): what applies only
    const ids = (kind) => contextMenuItems(kind, { target: {}, actions: { ...groupMenuActions(st), lockState: () => ({ locked: false }), toggleLock() {}, deleteSelection() {} } }).map((i) => i.id);
    select(st, rIds);
    eq([ids('geometry'), ids('group')], [['geo-lock', 'geo-delete', 'grp-ungroup', 'grp-enter'], ['grp-ungroup', 'grp-enter']], 'one group: Ungroup + Enter group (canvas menu after its own entries; the row menu alone)');
    select(st, [...rIds, 'S']);
    eq(ids('group'), ['grp-group', 'grp-ungroup'], 'a group + a line: Group + Ungroup');
    st.enteredGroupId = 'group-1'; select(st, ['rE1']);
    eq(ids('group'), ['grp-ungroup', 'grp-leave'], 'inside R, a curve: Ungroup (its group, task 751) + Leave group');
    st.enteredGroupId = null;
    measured.commands = said;
  } finally { await app.close(); }
}

// ---- 2. reached the user's ways, in SketchStudio: keys, the canvas right-click menu, the browser row menu
{
  const app = await openDoc({ designBrowser: true });
  try {
    const st = app.state, doc = app.document;
    const menuIds = () => [...doc.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id);
    const choose = (id) => { app.press(doc.querySelector(`.sk-context-menu .sk-context-item[data-id="${id}"]`)); app.frames(); };
    // keys
    select(st, [...rIds, ...qIds]); app.key('g', { ctrl: true });
    eq(names(st), ['R<Group 3', 'Q<Group 3', 'Group 3'], 'Ctrl+G groups in SketchStudio');
    app.key('g', { ctrl: true, shift: true });
    eq(names(st), ['R', 'Q'], 'Ctrl+Shift+G ungroups (one level)');
    // the canvas menu: a right click on a member of R (nothing selected) selects R whole, then the menu
    app.esc(); select(st, []);
    let p = mid(app, 'rE2'); app.rightClick(p.x, p.y);
    eq([sel(st), menuIds()], [rIds, ['geo-lock', 'geo-delete', 'grp-ungroup', 'grp-enter']], 'right click on a member of R: R selected, the menu offers Ungroup / Enter group');
    choose('grp-enter');
    eq([st.enteredGroupId, st.selectedShapes.size], ['group-1', 0], 'Enter group from the menu');
    p = mid(app, 'rE3'); app.rightClick(p.x, p.y);
    eq([sel(st), menuIds().filter((id) => id.startsWith('grp-'))], [['rE3'], ['grp-ungroup', 'grp-leave']], 'inside R: a right click selects the curve; Leave group offered');
    choose('grp-leave');
    eq(st.enteredGroupId, null, 'Leave group from the menu');
    // a right click on Q while R is selected whole: Q replaces the selection; then Shift-add S and right click on S: Group offered
    select(st, rIds); p = mid(app, 'qE1'); app.rightClick(p.x, p.y);
    eq(sel(st), qIds, 'right click on Q (outside the selection): Q becomes the selection');
    app.esc();
    await app.pause(PAIR_GAP_MS); p = mid(app, 'qE1'); app.click(p.x, p.y);
    await app.pause(PAIR_GAP_MS); p = mid(app, 'S'); app.click(p.x, p.y, { shift: true });
    p = mid(app, 'S'); app.rightClick(p.x, p.y);
    eq([sel(st), menuIds().filter((id) => id.startsWith('grp-'))], [[...qIds, 'S'].sort(), ['grp-group', 'grp-ungroup']], 'Q + S selected: Group offered (and Ungroup for Q)');
    choose('grp-group');
    eq(names(st), ['R', 'Q<Group 3', 'Group 3'], 'Group from the menu');
    app.undo();
    // the browser row: its menu (contextmenu on the row) selects that group and offers Ungroup / Enter group
    app.esc();
    { const tw = doc.querySelector('.sk-sketch-node .sk-sketch-tw'); if (tw && tw.classList.contains('is-collapsed')) { tw.click(); app.frames(); } } // the sketch's rows shown
    const row = (name) => [...doc.querySelectorAll('.sk-group-row')].find((r) => r.querySelector('.sk-info-lbl').textContent === name);
    ok(row('R') && row('Q'), 'the browser lists the groups R and Q');
    row('Q').dispatchEvent(new app.window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50, button: 2 })); app.frames();
    eq([sel(st), menuIds()], [qIds, ['grp-ungroup', 'grp-enter']], 'the row menu: Q selected; Ungroup / Enter group');
    choose('grp-ungroup');
    eq([names(st), app.browser.panel.el.querySelectorAll('.sk-group-row').length], [['R'], 1], 'Ungroup from the row: Q dissolved, its row gone');
    measured.ways = 'ok';
  } finally { await app.close(); }
}

// ---- 3. delete: an emptied group leaves no entry
{
  const app = await openDoc();
  try {
    const st = app.state;
    st.enteredGroupId = 'group-2'; select(st, ['qE1']); app.key('Delete');
    eq([names(st), shapesInGroup(st, 'group-2').length], [['R', 'Q'], 3], 'one curve of Q deleted: Q stays (3 curves)');
    st.enteredGroupId = null; select(st, rIds); app.key('Delete');
    eq(names(st), ['Q'], 'every curve of R deleted: the R entry is gone too');
    app.undo();
    eq(names(st), ['R', 'Q'], 'undo brings R back');
    measured.delete = names(st);
  } finally { await app.close(); }
}

// ---- 4. copies of a whole group are groups: paste, mirror, pattern
{
  const app = await openDoc();
  try {
    const st = app.state;
    // paste: Q whole -> a copy group "Q"; one curve of R -> a loose copy
    select(st, qIds);
    const pasted = pasteDocument(st, selectionToEnvelope(st).document);
    const qCopy = st.groups[st.groups.length - 1];
    eq([qCopy.name, qCopy.parentId || null, shapesInGroup(st, qCopy.id).sort(), selectUnit(st, pasted.shapes[0])], ['Q', null, [...pasted.shapes].sort(), qCopy.id], 'paste of Q: a group "Q" of the 4 pasted curves (a click selects it)');
    select(st, ['rE1']);
    const pasted1 = pasteDocument(st, selectionToEnvelope(st).document);
    eq(st.shapes.find((s) => s.id === pasted1.shapes[0]).userGroupId, undefined, 'paste of one curve of R: a loose curve, as before');
    // paste inside an entered group: the copy group goes in it
    const F = groupSelectionOf(st, [...rIds, ...qIds]);
    st.enteredGroupId = F; select(st, qIds);
    const pasted2 = pasteDocument(st, selectionToEnvelope(st).document);
    const q2 = st.groups.find((g) => g.id === st.shapes.find((s) => s.id === pasted2.shapes[0]).userGroupId);
    eq([q2.name, q2.parentId], ['Q', F], 'paste of Q while its parent group is entered: the copy is a group inside it');
    st.enteredGroupId = null;
    // mirror Q about S: the copy a group beside Q (in F)
    const m = mirrorObjects(st, { shapes: qIds, joints: [] }, 'S');
    ok(m.ok, 'mirror made: ' + m.reason);
    const qm = st.groups.find((g) => g.id === st.shapes.find((s) => s.id === m.shapes[0]).userGroupId);
    eq([qm && qm.name, qm && qm.parentId, shapesInGroup(st, qm.id).sort()], ['Q', F, [...m.shapes].sort()], 'mirror of Q: a group "Q" of the mirrored curves, beside Q (in its group)');
    // pattern of R (3 x 1): two copy groups, beside R; a count of 2 takes one away with its copies
    const nG = st.groups.length;
    const pat = applyPattern(st, CONSTRAINT_TYPES.RECTANGULAR_PATTERN, { shapes: rIds, joints: [] }, { ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN), quantity: [3, 1], distance: [100, 10] });
    ok(pat.ok, 'pattern made: ' + pat.reason);
    const instGroups = () => pat.constraint.instances.map((i) => [...new Set(i.shapes.map((id) => st.shapes.find((s) => s.id === id).userGroupId))]);
    const ig = instGroups();
    eq([st.groups.length - nG, ig.map((x) => x.length), ig.map((x) => st.groups.find((g) => g.id === x[0]).name), ig.map((x) => st.groups.find((g) => g.id === x[0]).parentId)], [2, [1, 1], ['R', 'R'], [F, F]], 'pattern of R: each copy is a group "R", beside R');
    const res = editPattern(st, pat.constraint, { quantity: [2, 1] });
    ok(res.ok, 'pattern count 2: ' + res.reason);
    eq(st.groups.length - nG, 1, 'the removed instance took its copy group with it');
    measured.copies = { groups: names(st) };
  } finally { await app.close(); }
}
function groupSelectionOf(st, ids) { select(st, ids); return groupSelection(st).id; }

console.log(`groups-commands-756-node: ok (${checks} checks) ${JSON.stringify(measured)}`);

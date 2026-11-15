// tests/pattern-tool-658-node.test.js - TASK 658: the CIRCULAR / RECTANGULAR PATTERN tools in the real app (tests/helpers/node-app.js: the
// page's own modules, its ribbon, input-manager, renderer, history; SketchStudio's own tool switch). The ribbon: both tools in Modify right
// after Mirror, in exactly the hosts that have Mirror. The flows on an L of two lines drawn with the Line tool:
//   Circular: the dialog opens (Esc: nothing, no undo step); a click picks the line, Enter -> the centre step, a click on the corner -> the live
//   pattern (3); Quantity 5, Total angle 90 -> 0 / 22.5 / ... / 90; an impossible Quantity (1) is refused (the field is marked, Enter warns,
//   nothing changes); Symmetric; Suppress: a click on a copy leaves it out, a click on its dashed ghost brings it back; OK -> ONE undo step.
//   Rectangular: the pre-selected line, the tool -> live at once; Direction 1 picked on the other line; Total keeps the copies where they are;
//   Quantity 1 = 3; the green check applies (touch). A double click on the label: the dialog on the stored pattern, Quantity 2 = 2, Enter ->
//   the copies regenerate (ONE undo step). Undo / Redo.
import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';
import { labelEl, labelBoxCenter } from './helpers/node-dom-read.js';

let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

// ---- the ribbon: present exactly where Mirror is, in Modify right after it
for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
  const profile = await createProfile();
  await createNamedDesign(profile, host, 'Pattern 658 ' + host);
  const app = await open({ host, profile });
  try {
    const doc = app.document, mirror = doc.getElementById('tool-mirror');
    const circ = doc.getElementById('tool-circularPattern'), rect = doc.getElementById('tool-rectangularPattern');
    ok(!!circ === !!mirror && !!rect === !!mirror, `${host}: the pattern tools are present exactly where Mirror is (mirror ${!!mirror}, circular ${!!circ}, rectangular ${!!rect})`);
    if (!mirror) continue;
    const g = circ.closest('.sk-ribbon-group');
    const tools = [...g.querySelectorAll('.sk-ribbon-btn')].map((x) => x.id);
    ok(g.querySelector('.sk-ribbon-group-label').textContent === 'Modify' && tools.indexOf('tool-circularPattern') === tools.indexOf('tool-mirror') + 1
      && tools.indexOf('tool-rectangularPattern') === tools.indexOf('tool-mirror') + 2, `${host}: Modify, right after Mirror (${tools})`);
    ok(circ.getAttribute('aria-label') === 'Circular Pattern' && rect.getAttribute('aria-label') === 'Rectangular Pattern', `${host}: accessible names`);
    ok(circ.querySelector('svg.sk-ribbon-ic') && rect.querySelector('svg.sk-ribbon-ic'), `${host}: inline icons in the ribbon's icon style`);
    ok(circ.hidden && rect.hidden, `${host}: not in the bar by default (Modify shows its first tool only: defaultInBar unchanged)`);
  } finally { await app.close(); }
}

const profile = await createProfile();
await createNamedDesign(profile, 'sketchstudio', 'Pattern 658 flow');
const app = await open({ host: 'sketchstudio', profile });
try {
  const st = app.state, doc = app.document;
  const r = app.svg.getBoundingClientRect();
  const C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const at = (dx, dy) => ({ x: C.x + dx, y: C.y + dy });
  const click = (p, o) => app.click(p.x, p.y, o);
  const dialog = () => doc.querySelector('.sk-pattern-dialog:not([hidden])');
  const field = (name) => doc.querySelector(`.sk-pattern-dialog [data-field="${name}"]`);
  const typeIn = (name, text) => { const f = field(name); f.focus(); f.select(); app.type(text); };
  const pats = () => st.constraints.filter((c) => /Pattern$/.test(c.type));
  const lines = () => st.shapes.filter((s) => s.type === 'line');
  const P = (id) => st.joints.get(id);
  const toasts = () => (doc.getElementById('notification-container') || { textContent: '' }).textContent;
  // the L: from the top down to the corner, then right (screen px)
  const P1 = at(-150, -150), P2 = at(-150, 100), P3 = at(150, 100);
  app.tool('line'); click(P1); click(P2); click(P3); app.esc();
  app.tool('select');
  ok(lines().length === 2, 'the L is drawn: two lines');
  const [vertical, horizontal] = [...lines()].sort((a, b) => Math.abs(P(a.joints[0]).x - P(a.joints[1]).x) - Math.abs(P(b.joints[0]).x - P(b.joints[1]).x));
  const corner = at(-150, 100);
  const h0 = st.history.length, n0 = st.shapes.length, c0 = st.constraints.length;

  // ---- Circular: open, Esc
  app.tool('circularPattern');
  ok(dialog() && dialog().getAttribute('aria-label') === 'Circular Pattern', 'Circular: the dialog opens');
  ok(st.pattern && st.pattern.step === 'objects', 'it starts at the objects step');
  app.esc();
  ok(!dialog() && st.shapes.length === n0 && st.history.length === h0 && st.currentTool === 'select', 'Esc: no dialog, nothing made, no undo step, Select');

  // ---- Circular: the line, Enter, the corner -> live; values
  app.tool('circularPattern');
  click(at(-150, -50));
  ok(st.selectedShapes.has(vertical.id), 'a click on the vertical line picks it');
  app.enter();
  ok(st.pattern.step === 'centre', 'Enter: the centre step');
  click(corner);
  ok(pats().length === 1 && lines().length === 4, `a click on the corner: the live pattern, Fusion's 3 (${lines().length} lines)`);
  ok(st.history.length === h0 + 1, 'the live pattern holds ONE undo step');
  const c = pats()[0];
  ok(c.centre === vertical.joints[1] || c.centre === horizontal.joints[0] || st.constraints.some((k) => k.type === 'coincident' && k.joints.includes(c.centre)), 'the centre is the corner point');
  typeIn('Quantity', '5'); typeIn('Total angle', '90');
  ok(c.quantity === 5 && c.angle === 90 && c.instances.length === 4, `Quantity 5, Total angle 90 (${c.quantity} / ${c.angle} / ${c.instances.length})`);
  const Cw = P(c.centre);
  const ang = (s) => { const a = P(s.joints[0]), b = P(s.joints[1]), m = { x: (a.x + b.x) / 2 - Cw.x, y: -((a.y + b.y) / 2 - Cw.y) }; return Math.atan2(m.y, m.x) * 180 / Math.PI; };
  const base = ang(vertical);
  const turns = c.instances.map((i) => ((ang(st.shapes.find((s) => s.id === i.shapes[0])) - base + 540) % 360) - 180);
  ok(JSON.stringify(turns.map((t) => Number(t.toFixed(6)))) === JSON.stringify([22.5, 45, 67.5, 90]), `90 / 5: the copies 22.5 deg apart (${turns})`);
  // an impossible value is refused: the field is marked, Enter warns, nothing changes
  typeIn('Quantity', '1');
  ok(field('Quantity').getAttribute('aria-invalid') === 'true' && c.quantity === 5, 'Quantity 1: the field is marked, the pattern keeps 5');
  app.enter();
  ok(dialog() && /quantity must be a whole number of 2 or more/.test(toasts()), `Enter on it: refused with a warning, the dialog stays (${toasts()})`);
  typeIn('Quantity', '4');
  ok(c.quantity === 4 && c.instances.length === 3, 'Quantity 4 accepted');
  // Symmetric: the angle split both sides
  app.press(field('Symmetric'));
  ok(c.symmetric === true && c.instances.length === 6, `Symmetric: 3 copies each side (${c.instances.length})`);
  app.press(field('Symmetric'));
  ok(c.symmetric === false && c.instances.length === 3, 'Symmetric off again');
  // Suppress: a click on a copy leaves its instance out, a click on its dashed ghost brings it back
  app.press(field('Suppress'));
  const victim = c.instances[2], vs = st.shapes.find((s) => s.id === victim.shapes[0]);
  const vm = app.toScreen((P(vs.joints[0]).x + P(vs.joints[1]).x) / 2, (P(vs.joints[0]).y + P(vs.joints[1]).y) / 2);
  click(vm);
  ok(c.suppressed.includes('3') && c.instances.length === 2 && !st.shapes.some((s) => s.id === vs.id), `a click on a copy suppresses its instance (${c.suppressed})`);
  ok(app.svg.querySelectorAll('#pattern-tool-overlay .pattern-ghost[data-slot="3"]').length === 1, 'its dashed ghost is drawn');
  click(vm);
  ok(c.suppressed.length === 0 && c.instances.length === 3, 'a click on the ghost brings it back');
  doc.querySelector('.sk-pattern-dialog .sk-pat-ok').click(); app.frames();
  ok(!dialog() && st.history.length === h0 + 1 && st.currentTool === 'select', 'OK: the dialog closes, ONE undo step, Select');
  app.undo();
  ok(pats().length === 0 && st.shapes.length === n0 && st.constraints.length === c0, 'one Undo removes the pattern and every copy');
  app.redo();
  ok(pats().length === 1 && pats()[0].instances.length === 3, 'Redo brings it back');

  // ---- Rectangular: pre-selected horizontal line, live at once; Direction 1 on the vertical line; Total; Quantity 1 = 3; touch check
  st.selectedShapes.clear(); st.selectedShapes.add(horizontal.id);
  const h1 = st.history.length;
  app.tool('rectangularPattern');
  const q = pats().find((k) => k.type === 'rectangularPattern');
  ok(q && q.instances.length === 1 && dialog().getAttribute('aria-label') === 'Rectangular Pattern', 'Rectangular: live at once from the pre-selection (2 x 1)');
  doc.querySelector('.sk-pattern-dialog [data-pick="dir0"]').click(); app.frames();
  ok(st.pattern.step === 'dir0', 'the Direction 1 button: pick a line');
  click(at(-150, -100));
  ok(q.directions[0] === vertical.id && st.pattern.step === 'values', `Direction 1 is the vertical line (${q.directions[0]})`);
  const copy0 = () => { const s = st.shapes.find((x) => x.id === q.instances[0].shapes[0]); return P(s.joints[0]); };
  const before = { ...copy0() };
  const typeSel = field('Distance type'); typeSel.value = 'total'; typeSel.dispatchEvent(new app.window.Event('change', { bubbles: true })); app.frames();
  ok(q.distanceType === 'total' && Math.abs(copy0().x - before.x) < 1e-9 && Math.abs(copy0().y - before.y) < 1e-9, 'Spacing -> Total keeps the copies where they are');
  typeIn('Quantity 1', '3');
  ok(q.quantity[0] === 3 && q.instances.length === 2, 'Quantity 1 = 3 (Total kept: the copies close up)');
  const check = doc.querySelector('.sk-done');
  app.move(at(300, 0).x, at(300, 0).y, { pointerType: 'touch' }); app.down(at(300, 0).x, at(300, 0).y, { pointerType: 'touch' }); app.up(at(300, 0).x, at(300, 0).y, { pointerType: 'touch' });
  ok(check && !check.hidden && check.getAttribute('aria-label') === 'Apply the pattern', `the green check shows (${check && check.getAttribute('aria-label')})`);
  check.click(); app.frames();
  ok(!dialog() && st.history.length === h1 + 1, 'the check applies (ONE undo step)');

  // ---- the label: a double click opens the dialog on the stored pattern; Quantity 2 = 2, Enter
  app.tool('select');
  const iq = st.constraints.indexOf(q);
  const lab = labelEl(app, iq);
  ok(lab && /3/.test(lab.textContent), `the rectangular pattern's label (${lab && lab.textContent.trim()})`);
  const h2 = st.history.length;
  await app.pause(550);
  const cc = labelBoxCenter(app, lab);
  app.dblclick(cc.x, cc.y, { target: () => labelEl(app, iq) });
  ok(dialog(), 'a double click on the label opens the dialog');
  await app.waitFor(() => doc.activeElement === field('Distance 1'), 'the distance field focused');
  ok(true, 'its distance field has the focus (type, Enter: like the offset label)');
  typeIn('Quantity 2', '2');
  app.enter();
  ok(!dialog() && q.quantity[1] === 2 && q.instances.length === 5 && st.history.length === h2 + 1, `Enter: 3 x 2 regenerated, ONE undo step (${q.instances.length})`);
  app.undo();
  const q2 = pats().find((k) => k.type === 'rectangularPattern');
  ok(q2 && q2.quantity[1] === 1 && q2.instances.length === 2, 'Undo: back to 3 x 1');
} finally { await app.close(); }

// ---- the active sketch (task 659's rule): another sketch's curves / points are not picks at all (no pick, no message, no step)
{
  const prof = await createProfile();
  await createNamedDesign(prof, 'sketchstudio', 'Pattern 658 active sketch');
  const a2 = await open({ host: 'sketchstudio', profile: prof });
  try {
    const st = a2.state, doc = a2.document;
    const r = a2.svg.getBoundingClientRect(), C = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    for (let i = 0; i < 20 && Math.abs(a2.toScreen(60, 0).x - a2.toScreen(0, 0).x) > 300; i++) a2.wheel(C.x, C.y, 300);
    const J = (x, y, sk) => { const id = st.genJ(); st.joints.set(id, { x, y, fixed: false, sketchId: sk }); return id; };
    st.clearDocument(); st.sketches.splice(1); st.sketches.push({ id: 'sketch-2', name: 'Sketch 2', visible: true }); st.activeSketchId = 'sketch-1';
    const o1 = J(5, -10, 'sketch-2'), o2 = J(35, -10, 'sketch-2'), m1 = J(0, 40, 'sketch-1'), m2 = J(30, 40, 'sketch-1'), d1 = J(60, -20, 'sketch-2'), d2 = J(60, 60, 'sketch-2');
    st.shapes.push({ id: 'other', type: 'line', joints: [o1, o2], sketchId: 'sketch-2' }, { id: 'own', type: 'line', joints: [m1, m2], sketchId: 'sketch-1' }, { id: 'odir', type: 'line', joints: [d1, d2], sketchId: 'sketch-2' });
    a2.frames();
    const P = (x, y) => a2.toScreen(x, y);
    const toasts = () => [...doc.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim());
    const h = st.history.length;
    a2.tool('circularPattern');
    a2.click(P(20, -10).x, P(20, -10).y);
    ok(st.selectedShapes.size === 0, "circular: another sketch's line is not an object");
    a2.click(P(15, 40).x, P(15, 40).y);
    ok(st.selectedShapes.has('own'), 'circular: the active line is an object');
    a2.enter();
    a2.click(P(5, -10).x, P(5, -10).y);
    ok(!st.constraints.some((k) => k.type === 'circularPattern') && st.pattern.step === 'centre', "circular: another sketch's point is not the centre");
    ok(st.history.length === h && toasts().length === 0, `no undo step, no message (${toasts()})`);
    a2.esc();
    st.selectedShapes.clear(); st.selectedShapes.add('own');
    a2.tool('rectangularPattern');
    doc.querySelector('.sk-pattern-dialog [data-pick="dir0"]').click(); a2.frames();
    a2.click(P(60, 20).x, P(60, 20).y);
    const q = st.constraints.find((k) => k.type === 'rectangularPattern');
    ok(q && q.directions[0] === null && st.pattern.step === 'dir0', "rectangular: another sketch's line is not a direction");
    ok(q.instances.every((i) => i.shapes.every((id) => (st.shapes.find((x) => x.id === id) || {}).sketchId === 'sketch-1')), 'the copies are in the active sketch');
    a2.esc();
  } finally { await a2.close(); }
}

console.log(`pattern-tool-658-node: ${checks} checks passed`);

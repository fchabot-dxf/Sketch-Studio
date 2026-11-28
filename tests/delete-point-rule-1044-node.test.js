// tests/delete-point-rule-1044-node.test.js — TASK 1044: the fixes of the delete audit (docs/DELETE-AUDIT-1042.md), on the REAL Design tab in Node
// (tests/helpers/node-app.js: the page's own pointer / key listeners, the ribbon tools, the footer, the right-click menu, the undo history).
//   POINT RULE (owner 2026-11-27, Fusion measured; D-02..D-19, D-22, D-25, D-75, D-81c): Delete on a selected point that is a CURVE's point (an end,
//     a shared corner, the origin) deletes NOTHING and shows the hint, by every path: the Delete key, Backspace, the right-click menu's Delete, the
//     footer red X (enabled, so it agrees with the key: O-08b / O-08c), the touch-and-hold menu (the phone's). The origin alone: its own hint.
//     A free point (no curve: a centre rectangle's centre) still deletes (D-01). A MIXED selection deletes the curves only, with no hint (D-75).
//   BUG-A (O-09b / O-09c): deleting a line that USES the origin keeps the other curves' dimensions / coincidents to the origin.
//   BUG-C (D-33): deleting a fillet arc takes its virtual sharp point and the point-on-line constraints holding it, in the same undo step.
//   BUG-D (D-56 / D-60 / D-48): a left click on a glyph's ink selects the glyph (as the right click does) even inside a point's pick reach; a press
//     on a point's drawn ring still picks the point, under a glyph's icon too (advisor ruling).
import assert from 'node:assert';
import { open, loadGlyphSheetFromDisk } from './helpers/node-app.js';
import SettingsManager from '#core/settings-manager.js';
import { hasSelection } from '#core/delete-manager.js';
import { LONG_PRESS_MS } from '#ui/long-press.js';

SettingsManager.set('GRID_MAGNETISM', 0.001, { persist: 'none' }); // no grid magnet: the clicks land where they are aimed
await loadGlyphSheetFromDisk(); // the glyph pick (hover-manager glyphAt) reads the drawn icon's outlines

const CURVE_HINT = 'Select the line to delete it, or the corner mark to separate.';
const ORIGIN_HINT = "The origin can't be deleted.";

let app = null;
const W = (x, y) => app.toScreen(x, y);
const click = (x, y, o) => { const p = W(x, y); app.click(p.x, p.y, o); };
const esc2 = () => { app.esc(); app.esc(); };
const line = (...pts) => { app.tool('line'); for (const p of pts) click(...p); esc2(); app.tool('select'); };
const rect2 = (a, b) => { app.tool('rect'); app.state.rectMode = 'rect-2pt'; click(...a); click(...b); esc2(); app.tool('select'); };
const rectCentre = (c, corner) => { app.tool('rect'); app.state.rectMode = 'rect-center'; click(...c); click(...corner); esc2(); app.tool('select'); };
const slot = (a, b, w) => { app.tool('slot'); app.state.slotMode = 'slot-c2c'; click(...a); click(...b); click(b[0], b[1] + w / 2); esc2(); app.tool('select'); };
const fillet = (corner, r) => {
  app.tool('fillet'); click(...corner);
  const box = app.document.getElementById('fillet-radius-input');
  box.focus(); box.select(); app.type(String(r)); app.enter(); esc2(); app.tool('select');
};
const dimension = (picks, place) => { app.tool('dim'); for (const p of picks) click(...p); click(...place); app.enter(); esc2(); app.tool('select'); };
const constrain = (toolName, ...picks) => { app.tool(toolName); for (const p of picks) click(...p); esc2(); app.tool('select'); };
// TASK 1045: a line that USES the origin joint itself, as a file saved before task 1045 stores it (the Line tool started a line ON j_origin then; since 1045
// a line started at the origin is its own point glued to it by a Coincident, Fusion measured). Such files load unchanged, so the rule is tested on both.
const oldOriginLine = (to) => { const st = app.state, id = st.genJ(); st.joints.set(id, { x: to[0], y: to[1] }); st.shapes.push({ id: 's_old_' + id, type: 'line', joints: ['j_origin', id] }); st.saveState('old file line'); app.frames(2); };

async function openBlank(host = 'sketchstudio', w = 200) {
  if (app) await app.close();
  app = await open({ host });
  const st = app.state, r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: 0, y: 0, w }); st.view.h = w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${-w / 2} ${-st.view.h / 2} ${w} ${st.view.h}`); app.frames(2);
  app.tool('select');
}
const toastText = () => (app.document.getElementById('notification-container') || { textContent: '' }).textContent;
const clearToasts = () => { const c = app.document.getElementById('notification-container'); if (c) c.innerHTML = ''; };
const docKey = () => JSON.stringify({ s: app.state.shapes.map((s) => s.id), j: [...app.state.joints.keys()], c: app.state.constraints.length });
const jointAt = (x, y) => [...app.state.joints].find(([, j]) => Math.hypot(j.x - x, j.y - y) < 0.2)?.[0]; // a click lands on the nearest screen pixel

// THE delete paths (each acts on the current selection)
const PATHS = {
  key: () => app.key('Delete'),
  backspace: () => app.key('Backspace'),
  footer: () => {
    const b = app.document.getElementById('btn-delete-selection');
    assert.strictEqual(b.disabled, false, 'the footer red X is enabled for the selection (its click answers with the hint)');
    app.press(b);
  },
  menu: (at) => { const p = W(...at); app.rightClick(p.x, p.y); pressMenuDelete('menu at ' + at); },
  hold: async (at) => { // the phone's touch-and-hold menu (#ui/long-press.js: a finger held still for LONG_PRESS_MS)
    const p = W(...at), o = { pointerType: 'touch' };
    app.down(p.x, p.y, o); await app.pause(LONG_PRESS_MS + 150); app.up(p.x, p.y, o);
    pressMenuDelete('hold at ' + at);
  },
};
function pressMenuDelete(what) {
  const rows = [...app.document.querySelectorAll('.sk-context-menu .sk-context-item')];
  const row = rows.find((r) => r.dataset.id === 'geo-delete');
  assert(row, `${what}: the point's menu has its Delete row (rows ${JSON.stringify(rows.map((r) => r.dataset.id))})`);
  app.press(row);
}

// each section runs on its own and its failure is reported (every failing section is listed, then the test exits 1)
const failures = [];
async function section(name, fn) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { failures.push(name); console.log('FAIL ' + name + ': ' + e.message); }
}

// ---------------------------------------------------------------- THE POINT RULE, every path, a curve end and a shared corner (3 hosts)
await section('THE POINT RULE, every path, a curve end and a shared corner', async () => {
for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
  await openBlank(host);
  line([-30, 10], [30, 10]); // a lone line: its end is a curve's point
  app.tool('polygon'); click(0, -30); app.move(...Object.values(W(15, -30))); click(15, -30); esc2(); app.tool('select'); // a polygon: its corners are SHARED by 2 sides + the radius line
  const end = [30, 10];
  const cid = [...app.state.joints.keys()].find((id) => app.state.shapes.filter((s) => !s.isConstruction && (s.joints || []).includes(id)).length === 2);
  assert(cid, host + ': the polygon has a corner SHARED by two sides');
  const corner = [app.state.joints.get(cid).x, app.state.joints.get(cid).y];
  for (const [name, del] of Object.entries(PATHS)) {
    for (const at of [end, corner]) {
      esc2(); click(...at);
      assert.strictEqual(app.state.selectedJoints.size, 1, `${host} ${name}: the click selected the point`);
      const before = docKey(), h0 = app.state.history.length;
      clearToasts();
      await del(at);
      assert.strictEqual(docKey(), before, `${host} ${name} at ${at}: a curve's point deletes NOTHING`);
      assert.strictEqual(app.state.history.length, h0, `${host} ${name}: no undo step`);
      assert(toastText().includes(CURVE_HINT), `${host} ${name}: the hint is shown (got "${toastText()}")`);
    }
  }
}
});

// ---------------------------------------------------------------- the origin (O-08b / O-08c / D-20): the key and the footer agree: nothing + the origin's hint
await section('the origin', async () => {
// (a) the lines USE j_origin (a file saved before task 1045)
await openBlank();
oldOriginLine([30, 20]); oldOriginLine([-30, 25]);
for (const name of ['key', 'backspace', 'footer']) {
  esc2(); click(0, 0);
  assert(app.state.selectedJoints.has('j_origin'), name + ': the origin is selected');
  assert.strictEqual(hasSelection(app.state), true, 'hasSelection: Delete answers an origin selection (with the hint), so the red X is enabled');
  const before = docKey(); clearToasts();
  PATHS[name]();
  assert.strictEqual(docKey(), before, name + ': the origin clicked: no line through it is deleted');
  assert(toastText().includes(ORIGIN_HINT), `${name}: the origin's hint (got "${toastText()}")`);
  assert(!toastText().includes(CURVE_HINT), name + ': not the corner-mark sentence for the origin');
  const o = app.state.joints.get('j_origin');
  assert(o && o.x === 0 && o.y === 0 && o.fixed, name + ': the origin stays at (0, 0), fixed');
}
// (b) TASK 1045: the Line tool's lines from the origin: each its own start point, glued to the origin; a click there picks one of the stacked points
await openBlank();
line([0, 0], [30, 20]); line([0, 0], [-30, 25]);
assert(!app.state.shapes.some((s) => s.joints.includes('j_origin')) && app.state.constraints.some((c) => c.type === 'coincident' && c.joints.includes('j_origin')), '1045: the lines start at the origin glued to it, none uses it');
for (const name of ['key', 'backspace', 'footer']) {
  esc2(); click(0, 0);
  const picked = [...app.state.selectedJoints][0];
  assert(picked && Math.hypot(app.state.joints.get(picked).x, app.state.joints.get(picked).y) < 1e-9, name + ' (1045): a point at the origin is selected');
  const before = docKey(); clearToasts();
  PATHS[name]();
  assert.strictEqual(docKey(), before, name + ' (1045): nothing is deleted');
  const hint = picked === 'j_origin' ? ORIGIN_HINT : CURVE_HINT;
  assert(toastText().includes(hint), `${name} (1045): the hint of the point picked (${picked}: got "${toastText()}")`);
  const o = app.state.joints.get('j_origin');
  assert(o && o.x === 0 && o.y === 0 && o.fixed, name + ' (1045): the origin stays at (0, 0), fixed');
}
});

// ---------------------------------------------------------------- a FREE point still deletes (D-01), with its constraints; no hint
await section('a FREE point still deletes', async () => {
await openBlank();
rectCentre([0, 0], [30, 20]); // the centre rectangle's centre point is on no curve (held on the diagonals by point-on-line)
{
  const centre = [...app.state.joints.keys()].find((id) => id !== 'j_origin' && !app.state.shapes.some((s) => (s.joints || []).includes(id)));
  assert(centre, 'a centre rectangle has a free centre point');
  esc2(); click(...[app.state.joints.get(centre).x, app.state.joints.get(centre).y]);
  if (!app.state.selectedJoints.has(centre)) { app.state.selectedJoints.clear(); app.state.selectedShapes.clear(); app.state.selectedJoints.add(centre); }
  const n0 = app.state.shapes.length, h0 = app.state.history.length; clearToasts();
  app.key('Delete');
  assert(!app.state.joints.has(centre), 'the free point is deleted');
  assert(!app.state.constraints.some((c) => c && (c.joint === centre || (c.joints || []).includes(centre))), 'its constraints go with it');
  assert.strictEqual(app.state.shapes.length, n0, 'no curve goes');
  assert.strictEqual(app.state.history.length, h0 + 1, 'ONE undo step');
  assert(!toastText().includes(CURVE_HINT), 'no hint when something was deleted');
}
});

// ---------------------------------------------------------------- MIXED (D-75): a line + another line's end: the line only, no hint
await section('MIXED', async () => {
await openBlank();
line([-40, 10], [-10, 10]); line([10, 10], [40, 10]);
{
  esc2(); click(-25, 10); click(40, 10, { shift: true });
  assert.strictEqual(app.state.selectedShapes.size, 1, 'mixed: one line selected');
  assert.strictEqual(app.state.selectedJoints.size, 1, 'mixed: + one other line\'s end');
  clearToasts();
  app.key('Delete');
  assert.strictEqual(app.state.shapes.filter((s) => s.type === 'line').length, 1, 'mixed: the selected line only is deleted');
  assert(app.state.shapes.some((s) => s.type === 'line' && s.joints.includes(jointAt(40, 10))), 'the other line (its end selected) stays');
  assert(!toastText().includes(CURVE_HINT), 'mixed: no hint, something was deleted');
}
});

// ---------------------------------------------------------------- BUG-A (O-09b / O-09c): the OTHER curves' ties to the origin survive
await section('BUG-A', async () => {
// (a) the deleted line USES j_origin (a file saved before task 1045); (b) TASK 1045: the Line tool's line from the origin, its start glued to it
for (const structure of ['uses the origin', 'glued (1045)']) {
for (const [id, tie] of [['O-09b', 'distance'], ['O-09c', 'coincident']]) {
  await openBlank();
  if (structure === 'uses the origin') oldOriginLine([30, 20]);
  line([-40, 25], [-20, 30]);
  const other = jointAt(-20, 30);
  if (tie === 'distance') dimension([[-20, 30], [0, 0]], [-40, -10]);
  else constrain('coincident', [-20, 30], [0, 0]);
  if (structure !== 'uses the origin') line([0, 0], [30, 20]); // drawn after the tie: the tie's pick at (0, 0) is the origin alone
  const ties = () => app.state.constraints.filter((c) => c && c.type === tie && (c.joints || []).includes('j_origin') && (c.joints || []).includes(other));
  assert.strictEqual(ties().length, 1, `${id} (${structure}): the other line has its ${tie} to the origin`);
  esc2(); click(15, 10);
  assert.strictEqual(app.state.selectedShapes.size, 1, `${id} (${structure}): the line from the origin is selected`);
  app.key('Delete');
  assert.strictEqual(app.state.shapes.filter((s) => s.type === 'line').length, 1, `${id} (${structure}): the line from the origin is deleted`);
  assert.strictEqual(ties().length, 1, `${id} (${structure}): the other line's ${tie} to the origin SURVIVES`);
  assert(app.state.joints.has('j_origin'), `${id} (${structure}): the origin stays`);
}
}
});

// ---------------------------------------------------------------- BUG-C (D-33): the fillet arc takes its virtual sharp
await section('BUG-C', async () => {
await openBlank();
rect2([-20, -10], [40, 30]); fillet([40, 30], 6);
{
  const arc = app.state.shapes.find((s) => s.type === 'arc');
  assert(arc && arc.filletSharp, 'D-33: the fillet arc and its virtual sharp');
  const V = arc.filletSharp;
  const holds = () => app.state.constraints.filter((c) => c && c.joint === V).length;
  assert(app.state.joints.has(V) && holds() === 2, 'V is held on both trimmed sides');
  const before = JSON.stringify({ j: [...app.state.joints.keys()].sort(), c: app.state.constraints.length });
  const c = app.state.joints.get(arc.joints[0]), a = app.state.joints.get(arc.joints[1]), b = app.state.joints.get(arc.joints[2]);
  const r = Math.hypot(a.x - c.x, a.y - c.y), m = Math.atan2((a.y + b.y) / 2 - c.y, (a.x + b.x) / 2 - c.x);
  esc2(); click(c.x + r * Math.cos(m), c.y + r * Math.sin(m));
  assert(app.state.selectedShapes.has(arc.id), 'D-33: the arc is selected');
  const h0 = app.state.history.length;
  app.key('Delete');
  assert(!app.state.shapes.includes(arc), 'the arc is deleted');
  assert(!app.state.joints.has(V), 'BUG-C: the virtual sharp goes with its fillet arc');
  assert.strictEqual(holds(), 0, 'BUG-C: and the point-on-line constraints that held it');
  assert(![...app.state.joints.entries()].some(([id, j]) => id !== 'j_origin' && j.virtualSharp), 'no stray virtual sharp is left');
  assert.strictEqual(app.state.history.length, h0 + 1, 'ONE undo step');
  app.undo();
  assert.strictEqual(JSON.stringify({ j: [...app.state.joints.keys()].sort(), c: app.state.constraints.length }), before, 'ONE Undo gives the arc and its virtual sharp back');
}
});

// ---------------------------------------------------------------- BUG-D (D-56 / D-60 / D-48): ONE pick rule (hover-manager glyphOrJointPick) for the
// left click, the hover and the right click: the point's drawn ring first, then a glyph's ink, then the rest of the point's reach
const { glyphAt, glyphOrJointPick } = await import('#ui/hover-manager.js');
const { pointMarkRadiusPx } = await import('#ui/svg-renderer.js');
const { SNAP } = await import('#core/constants.js'); const JOINT_SNAP_RADIUS_PX = SNAP.JOINT_PX;
// the glyph's ink pixel nearest its centre that is OUTSIDE every point's drawn ring (where a user aims at the glyph)
function inkOf(c) {
  const ring = pointMarkRadiusPx();
  const offRings = (x, y) => [...app.state.joints.values()].every((j) => { const q = W(j.x, j.y); return Math.hypot(q.x - x, q.y - y) > ring + 1; });
  for (const at of (Array.isArray(c.glyphPos) ? c.glyphPos : [c.glyphPos])) for (let rr = 0, g = W(at.x, at.y); rr <= 14; rr++) for (let k = 0; k < 16; k++) {
    const x = Math.round(g.x + rr * Math.cos(k * Math.PI / 8)), y = Math.round(g.y + rr * Math.sin(k * Math.PI / 8));
    if (glyphAt(app.svg, app.state, x, y) === c && offRings(x, y)) return { x, y };
  }
  return null;
}
const nearestJointPx = (p) => Math.min(...[...app.state.joints.values()].map((j) => { const q = W(j.x, j.y); return Math.hypot(q.x - p.x, q.y - p.y); }));
async function glyphCase(id, scene, pick, { selectPoint = null } = {}) {
  await openBlank(); scene(); app.frames(2);
  const c = pick();
  assert(c, id + ': the constraint exists');
  if (selectPoint) { esc2(); const j = app.state.joints.get(selectPoint(c)); click(j.x, j.y); app.frames(2); } // a point glyph shows while its point is selected
  else esc2();
  const ink = inkOf(c);
  assert(ink, `${id}: a pixel of the glyph's ink off every point's ring`);
  const d = nearestJointPx(ink);
  assert(d < JOINT_SNAP_RADIUS_PX, `${id}: that ink pixel is inside a point's pick reach (${d.toFixed(1)} px < ${JOINT_SNAP_RADIUS_PX}): the case the rule decides`);
  app.move(ink.x, ink.y);
  assert.strictEqual(app.state.hoveredConstraint, c, `${id}: the hover on the glyph's ink lights the glyph (hover = click)`);
  app.click(ink.x, ink.y);
  assert(app.state.selectedConstraints.has(c) && app.state.selectedConstraints.size === 1 && app.state.selectedJoints.size === 0 && app.state.selectedShapes.size === 0,
    `${id}: the LEFT click on the glyph's ink selects the glyph alone, not the point`);
  const shapes0 = app.state.shapes.length, cons0 = app.state.constraints.length;
  app.key('Delete');
  assert.strictEqual(app.state.shapes.length, shapes0, id + ': no curve goes');
  assert.strictEqual(app.state.constraints.length, cons0 - 1, id + ': only that constraint goes');
  assert(!app.state.constraints.includes(c), id + ': it is deleted');
}
await section('BUG-D Tangent (D-56)', () => glyphCase('D-56', () => slot([-30, 10], [20, 10], 16), () => app.state.constraints.find((c) => c && c.type === 'tangent')));
await section('BUG-D Symmetric (D-60)', () => glyphCase('D-60', () => {
  line([0.5, 40], [0.5, -40]); line([-30, 10], [-20, 30]); line([30, 12], [20, -30]);
  app.tool('symmetric'); click(-30, 10); click(30, 12); click(0.5, 25); esc2(); app.tool('select');
}, () => app.state.constraints.find((c) => c && c.type === 'symmetric')));
await section('BUG-D the 2nd glued Coincident (D-48)', () => glyphCase('D-48', () => {
  line([-40, 10], [10, 10]); line([20, 30], [40, -20]); constrain('coincident', [10, 10], [20, 30]);
  line([30, 40], [60, 40]);
  const e = app.state.joints.get(app.state.shapes.filter((s) => s.type === 'line')[0].joints[1]);
  constrain('coincident', [e.x, e.y], [30, 40]);
}, () => app.state.constraints.filter((c) => c && c.type === 'coincident')[1], { selectPoint: (c) => c.joints[c.joints.length - 1] }));

// the ring wins (advisor ruling): a press EXACTLY on a point under a glyph's icon (a slot's tangency point, its tangent glyph drawn 6 px off it)
// picks the point, for the left click, the hover and the right click
await section('the point ring wins over a glyph drawn on it', async () => {
  await openBlank(); slot([-30, 10], [20, 10], 16); app.frames(2);
  const tangent = app.state.constraints.find((c) => c && c.type === 'tangent');
  const arc = app.state.shapes.find((s) => s.id === tangent.circle), side = app.state.shapes.find((s) => s.id === tangent.line);
  const jid = side.joints.find((j) => arc.joints.includes(j));
  const p = W(app.state.joints.get(jid).x, app.state.joints.get(jid).y);
  assert.strictEqual(glyphAt(app.svg, app.state, p.x, p.y), tangent, "the tangent glyph's ink covers its tangency point (the case the ring decides)");
  assert.deepStrictEqual(glyphOrJointPick(app.svg, app.state, { id: jid }, p.x, p.y), { joint: { id: jid } }, 'THE rule: the point under its ring');
  esc2(); app.move(p.x, p.y);
  assert.strictEqual(app.state.hoveredJoint, jid, 'the hover on the point lights the point');
  app.click(p.x, p.y);
  assert(app.state.selectedJoints.has(jid) && app.state.selectedConstraints.size === 0, 'the click exactly on the point selects the point, not the glyph over it');
  esc2(); app.rightClick(p.x, p.y);
  const rows = [...app.document.querySelectorAll('.sk-context-menu .sk-context-item')].map((r) => r.dataset.id);
  assert(rows.includes('geo-delete') && !rows.includes('con-delete'), `the right click there opens the POINT's menu (${JSON.stringify(rows)})`);
  app.esc();
});

await app.close();
if (failures.length) { console.log('FAILED sections: ' + failures.join(' | ')); process.exit(1); }
console.log('delete-point-rule-1044-node: ok');

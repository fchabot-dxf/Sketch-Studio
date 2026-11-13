// tests/dimension-d-preselect-node.test.js - TASK 589: pressing D with geometry selected starts the Dimension tool WITH that selection as its
// first pick(s), the label following the pointer (Fusion). SketchStudio through tests/helpers/node-app.js (ribbon, the canvas's own listeners, the
// real D / Esc / Ctrl+Z keys). Every selection ends in the same function a click on those things in that order ends in (dimension-tool.js).
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
  const o = app.toScreen(0, 0);
  const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
  const st = app.state;
  const isRef = (c) => (c.shapes || []).some((id) => String(id).startsWith('ref_')) || (c.joints || []).some((j) => j === 'j_origin' || String(j).startsWith('j_ref'));
  const mine = () => st.constraints.filter((c) => (c.type === 'distance' || c.type === 'angle') && !isRef(c));
  const dims = () => mine().filter((c) => c.type === 'distance');
  const clear = () => { app.esc(); app.tool('select'); app.esc(); app.document.getElementById('btn-clear').click(); app.frames(); };
  const draw = (tool, ...pts) => { app.tool(tool); for (const p of pts) app.click(p.x, p.y); app.esc(); app.tool('select'); };
  const selectAt = (p, opt) => app.click(p.x, p.y, opt);
  const step = () => st.history.length;
  const pending = () => !!(st.placingConstraint && st.placingConstraint.__placing);
  const boxOpen = () => !app.document.getElementById('dimInput').classList.contains('hidden');

  const A = [P(150, 100), P(450, 100)], B = [P(150, 220), P(450, 220)], C = [P(200, 300), P(400, 420)];
  const mid = (seg) => ({ x: (seg[0].x + seg[1].x) / 2, y: (seg[0].y + seg[1].y) / 2 });
  const EMPTY = P(600, 330), EMPTY2 = P(640, 250);
  const reset = () => { clear(); draw('line', ...A); draw('line', ...B); draw('line', ...C); };
  reset();
  assert.strictEqual(st.shapes.filter((s) => s.type === 'line' && !String(s.id).startsWith('ref_')).length, 3, 'three lines drawn');

  // 1. a line selected + D: a pending length dimension whose label follows the pointer; a click on empty space places it; ONE undo step
  selectAt(mid(A));
  assert.strictEqual(st.selectedShapes.size, 1, 'the line is selected');
  const before = step();
  app.key('d');
  assert.strictEqual(st.currentTool, 'dim', 'D: the Dimension tool is active');
  assert(pending(), 'D: a dimension is pending');
  assert.strictEqual(st.selectedShapes.size, 0, 'the selection is cleared when the tool takes it');
  assert.strictEqual(mine().length, 1, 'one pending length dimension');
  app.move(EMPTY.x, EMPTY.y); const g1 = { ...st.placingConstraint.glyphPos };
  app.move(EMPTY2.x, EMPTY2.y + 60); const g2 = { ...st.placingConstraint.glyphPos };
  assert(Math.hypot(g1.x - g2.x, g1.y - g2.y) > 1e-6, 'the label follows the pointer');
  app.click(EMPTY.x, EMPTY.y);
  assert(!pending(), 'a click on empty space places the label');
  await app.waitFor(boxOpen, 'the value box');
  app.enter();
  assert.strictEqual(dims().length, 1, 'the length dimension exists');
  assert(Math.abs(dims()[0].value - Math.hypot(st.joints.get(dims()[0].joints[0]).x - st.joints.get(dims()[0].joints[1]).x, st.joints.get(dims()[0].joints[0]).y - st.joints.get(dims()[0].joints[1]).y)) < 1e-6, 'with the line length as its value');
  assert.strictEqual(step(), before + 1, 'placing is ONE undo step (history ' + before + ' -> ' + step() + ')');
  app.undo();
  assert.strictEqual(mine().length, 0, 'one Ctrl+Z removes the dimension');
  console.log('1. line + D: ok');

  // 2. a line + D, then a click on a point: the point-to-line distance (555)
  reset();
  selectAt(mid(A)); app.key('d');
  app.click(C[1].x, C[1].y);
  assert(dims().some((c) => c.joints && c.joints.length === 3), 'a point-to-line distance (3 joints) exists: ' + JSON.stringify(mine()));
  console.log('2. line + D + point click: ok');

  // 3. nothing selected + D: the tool is active, nothing pending, nothing created
  reset();
  app.tool('select'); app.esc();
  app.key('d');
  assert.strictEqual(st.currentTool, 'dim');
  assert(!st.placingConstraint, 'nothing pending');
  assert.strictEqual(mine().length, 0, 'nothing created');
  console.log('3. nothing selected: ok');

  // 4. Esc forgets the pick
  app.tool('select'); app.esc();
  selectAt(mid(A)); app.key('d');
  assert(pending(), 'pending after D');
  app.esc();
  assert(!st.placingConstraint, 'Esc forgot the pick');
  assert.strictEqual(mine().length, 0, 'and left no dimension');
  console.log('4. Esc: ok');

  // 5. two lines: parallel = line-line distance, crossing = angle (what clicking them in that order makes)
  const twoLines = async (first, second, kind) => {
    app.tool('select'); app.esc();
    selectAt(mid(first)); selectAt(mid(second), { shift: true });
    assert.strictEqual(st.selectedShapes.size, 2, 'two lines selected');
    const h = step();
    app.key('d');
    assert(pending(), kind + ': pending');
    const c = st.placingConstraint;
    assert.strictEqual(c.type, kind === 'angle' ? 'angle' : 'distance', kind + ': type ' + c.type);
    if (kind === 'distance') assert.strictEqual(c.shapes && c.shapes.length, 2, 'line-line distance');
    app.click(EMPTY.x, EMPTY.y);
    await app.waitFor(boxOpen, 'the value box'); app.enter();
    assert.strictEqual(mine().length, 1, kind + ': created');
    assert.strictEqual(step(), h + 1, kind + ': ONE undo step (' + h + ' -> ' + step() + ')');
    app.undo();
    assert.strictEqual(mine().length, 0, kind + ': one undo removes it');
  };
  reset();
  await twoLines(A, B, 'distance');
  await twoLines(A, C, 'angle');
  console.log('5. two lines: parallel distance, crossing angle: ok');

  // 6. the "Line already dimensioned" path: A has its length dimension; a PARALLEL second line still gives the line-line distance
  reset();
  selectAt(mid(A)); app.key('d'); app.click(EMPTY.x, EMPTY.y);
  await app.waitFor(boxOpen, 'the value box'); app.enter();
  assert.strictEqual(dims().length, 1, 'A has its length dimension');
  app.tool('select'); app.esc();
  selectAt(mid(A)); app.key('d');
  assert(!st.placingConstraint, 'already dimensioned: no second length preview');
  app.click(mid(B).x, mid(B).y);
  assert(pending() && st.placingConstraint.shapes && st.placingConstraint.shapes.length === 2, 'a click on the parallel line made the line-line distance: ' + JSON.stringify(mine().map((c) => c.type)));
  app.esc(); app.undo();
  app.tool('select'); app.esc();
  selectAt(mid(A)); selectAt(mid(B), { shift: true }); app.key('d');
  assert(pending() && st.placingConstraint.shapes && st.placingConstraint.shapes.length === 2, 'both selected, the first already dimensioned: still the distance');
  console.log('6. already dimensioned first line: ok');

  // 7. a circle: its radius (the tool's existing rule); an arc: its radius; two points: their distance
  clear();
  draw('circle', P(300, 200), P(380, 200));
  draw('arc', P(300, 400), P(380, 400), P(300, 480));
  const circ = st.shapes.find((s) => s.type === 'circle'); const arc = st.shapes.find((s) => s.type === 'arc');
  assert(circ && arc, 'circle and arc drawn');
  const select = (...ids) => { app.tool('select'); app.esc(); st.selectedJoints.clear(); st.selectedShapes.clear(); ids.forEach((i) => st.selectedShapes.add(i)); };
  select(circ.id); app.key('d');
  assert(pending() && st.placingConstraint.isRadius && st.placingConstraint.shape === circ.id, 'circle: a radius dimension is pending');
  assert(Math.abs(st.placingConstraint.value - 80 * 0 - st.placingConstraint.value) < 1e-9 && st.placingConstraint.value > 0, 'with its radius');
  app.esc();
  select(arc.id); app.key('d');
  assert(pending() && st.placingConstraint.isRadius && st.placingConstraint.shape === arc.id, 'arc: a radius dimension is pending');
  app.esc();
  app.tool('select'); app.esc();
  const jids = [...st.joints.keys()].filter((k) => k !== 'j_origin' && !String(k).startsWith('j_ref')).slice(0, 2);
  jids.forEach((j) => st.selectedJoints.add(j));
  app.key('d');
  assert(pending() && st.placingConstraint.joints && st.placingConstraint.joints.length === 2, 'two points: their distance is pending');
  app.esc();
  console.log('7. circle / arc / two points: ok');

  // 8. three items: nothing pending, the selection unchanged
  reset();
  app.tool('select'); app.esc();
  selectAt(mid(A)); selectAt(mid(B), { shift: true }); selectAt(mid(C), { shift: true });
  assert.strictEqual(st.selectedShapes.size, 3);
  app.key('d');
  assert.strictEqual(st.currentTool, 'dim');
  assert(!st.placingConstraint, 'three items: nothing pending');
  assert.strictEqual(st.selectedShapes.size, 3, 'and the selection is unchanged');
  console.log('8. three items: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }

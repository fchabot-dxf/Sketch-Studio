// tests/dimension-delete-panel-node.test.js — TASK 610 (node port of tests/dimension-delete-live.test.js, TASK 485; the other routes are tests/dimension-delete-select-node.test.js):
// deleting a DIMENSION removes only its constraint, never geometry, by the fourth route: a line selected FIRST, then the constraint's ROW in the Design info panel (the SKETCHES browser,
// packages/ui/design-browser.js, mounted by the kit's open({ designBrowser: true }), kit addition 17) clicked, then Delete. Per dimension kind: the row's click drops the geometry
// selection and selects the constraint, Delete removes exactly that constraint, no shape removed, no joint removed or moved. Same asserts, same seed, same steps as the browser test;
// the row and the toggle are pressed with the kit's `press` (the browser test pressed their measured centres), the label with the kit's hit-test override 5.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { labelEl, labelPoint } from './helpers/node-dom-read.js';

const app = await open({ host: 'shaper', designBrowser: true });
let failed = null;
try {
  const doc = app.document, st = app.state;
  const counts = () => ({ shapes: st.shapes.length, joints: st.joints.size, constraints: st.constraints.length, pos: [...st.joints.entries()].map(([k, j]) => k + ':' + Math.round(j.x * 100) / 100 + ',' + Math.round(j.y * 100) / 100).sort().join(' '), selShapes: st.selectedShapes.size, selJoints: st.selectedJoints.size, selCons: st.selectedConstraints.size });
  // seed: an L (two lines, 40 + 30), a circle with a radius dim, an arc with a radius dim, a distance dim, an angle dim, a DRIVEN distance dim
  const seed = () => {
    for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k);
    st.shapes.length = 0; st.constraints.length = 0; st.selectedShapes.clear(); st.selectedJoints.clear(); st.selectedConstraints.clear();
    const J = (id, x, y) => st.joints.set(id, { x, y });
    J('a', -45, -20); J('b', -5, -20); J('c', -5, 10);
    st.shapes.push({ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] });
    J('cc', 15, 25); J('cr', 23, 25);
    st.shapes.push({ id: 'C1', type: 'circle', joints: ['cc', 'cr'], radius: 8 });
    J('ac', -30, 30); J('as', -20, 30); J('ae', -30, 20);
    st.shapes.push({ id: 'A1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'] });
    st.constraints.push({ type: 'distance', joints: ['a', 'b'], value: 40, glyphPos: { x: -25, y: -30 } });
    st.constraints.push({ type: 'angle', shapes: ['L1', 'L2'], value: 90, glyphPos: { x: -12, y: -10 } });
    st.constraints.push({ type: 'distance', shape: 'C1', value: 8, isRadius: true, glyphPos: { x: 15, y: 10 } });
    st.constraints.push({ type: 'distance', shape: 'A1', value: 10, isRadius: true, glyphPos: { x: -25, y: 25 } });
    st.constraints.push({ type: 'distance', joints: ['b', 'c'], value: 30, isDriven: true, glyphPos: { x: 8, y: -5 } });
    J('p1', -45, -40); J('p2', -20, -40); // two STANDALONE points (no shape) held only by their distance dimension
    st.constraints.push({ type: 'distance', joints: ['p1', 'p2'], value: 25, glyphPos: { x: -32, y: -43 } });
    app.frames(2);
    return st.constraints.length;
  };
  const labelClick = (idx) => { const p = labelPoint(app, idx); assert(labelEl(app, idx), 'dim label ' + idx + ' is on screen'); app.click(p.x, p.y, { target: () => labelEl(app, idx) }); };
  const KINDS = ['distance (two points)', 'angle (two lines)', 'radius (circle)', 'radius (arc)', 'driven / reference distance', 'distance (two standalone points)'];
  const GEO = { L2: [-5, -5] }; // a point ON line L2 (world mm)
  const clickWorld = (x, y) => { const p = app.toScreen(x, y); app.click(p.x, p.y); };
  // the panel groups rows by type under a collapsed sketch node: expand it (a click), then find the row of constraint i
  const expandPanel = () => { const t = doc.querySelector('.sk-browser-info .sk-sketch-tw'); if (t && t.classList.contains('is-collapsed')) app.press(t); };
  const rows = () => [...doc.querySelectorAll('.sk-browser-info .sk-info-row')];
  const panelRow = (i) => {
    const n = rows().length; let hit = -1;
    for (let j = 0; j < n; j++) { st.selectedConstraints.clear(); rows()[j].click(); if (st.selectedConstraints.has(st.constraints[i])) { hit = j; break; } }
    st.selectedConstraints.clear(); st.selectedShapes.clear(); st.selectedJoints.clear();
    assert(hit >= 0, 'panel row for constraint ' + i + ' exists'); return hit;
  };
  seed(); await app.pause(50); expandPanel(); app.frames(2);
  const base = counts();
  console.log('seeded', JSON.stringify({ shapes: base.shapes, joints: base.joints, constraints: base.constraints }));
  // after a delete the geometry (count AND positions) is exactly as seeded and the constraint count dropped by exactly one
  const onlyTheDimension = (c, msg) => {
    assert.strictEqual(c.shapes, base.shapes, msg + ': no shape removed'); assert.strictEqual(c.joints, base.joints, msg + ': no joint removed');
    assert.strictEqual(c.pos, base.pos, msg + ': no joint moved'); assert.strictEqual(c.constraints, base.constraints - 1, msg + ': exactly one constraint removed');
  };
  for (let i = 0; i < KINDS.length; i++) {
    const K = KINDS[i];
    // C: the Design panel list: a line selected first, then the constraint's ROW clicked, then Delete
    seed(); app.frames(2); labelClick(i); clickWorld(60, -40); // the info panel refreshes only when its signature (counts, values, selected constraints) changes, and a re-seed changes none: select a label, then empty canvas, so the rows are rebuilt for the new
    const hit = panelRow(i); // (found BEFORE the line is selected: the lookup clears the selection sets)
    clickWorld(...GEO.L2); assert.strictEqual(counts().selShapes, 1, K + ': the line is selected');
    app.press(rows()[hit]);
    const pm = counts(); assert.strictEqual(pm.selShapes, 0, K + ': picking the row drops the geometry selection'); assert.strictEqual(pm.selCons, 1);
    app.key('Delete');
    onlyTheDimension(counts(), K + ' / panel row + Delete');
    console.log('ok:', K);
  }
  console.log('dimension-delete-panel-node: ok');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error(failed.stack || failed.message || failed); process.exitCode = 1; }

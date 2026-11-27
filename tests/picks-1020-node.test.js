// tests/picks-1020-node.test.js -- TASK 1020, the real-design audits' pick bugs (docs/DESIGN-RUN-AUDIT-1016.md R1-06 R1-10 R1-14, 1017.md R2-08 R2-09),
// SketchStudio through tests/helpers/node-app.js (the ribbon, the canvas's own pointer and key listeners):
//   1. BUG-210 (R2-09 + R1-14): a tool that takes no point (Equal) never picks one: a small circle's rim, or a line's end, gives the curve;
//      a point beside the curve under the pointer (a circle's centre) no longer steals the rim (Circular Pattern on a bolt hole's rim);
//      a click right on the centre still picks the centre.
//   2. BUG-211 (R1-14b): Esc out of Circular Pattern leaves none of its picks selected; the reopened dialog starts at "Select".
//   3. BUG-212 (R1-06): a click on an R5 fillet arc selects the arc, not the virtual sharp beside it; Delete removes the arc and keeps the dims.
//   4. BUG-213 (R2-08): where curves overlap, the pick goes to the curve the tool takes, then one not yet picked, then a solid one (never the
//      shapes' order): Tangent on an arc apex over the Y centreline, Collinear on two halves under a construction line, Equal's second pick.
//   5. BUG-214 (R1-10): a finished corner drag leaves nothing selected, so D + a click on the adjacent edge dimensions the edge; a plain click
//      on the corner still selects it.
import assert from 'node:assert';
import { docOf, openDoc } from './fixtures/display-1010/doc-kit.js';
import { applyFillet, findCornerAtJoint } from '#core/fillet.js';
import { arcSweepMidpoint } from '#core/geometry.js';

const CANVAS_W = 1566; // the SketchStudio canvas width in node-app (px)
let app = null;
async function openAt(doc, cx, cy, pxPerMm) {
  if (app) { await app.close(); app = null; }
  app = await openDoc(doc);
  const st = app.state;
  app.tool('select');
  const r = app.svg.getBoundingClientRect();
  Object.assign(st.view, { x: cx, y: cy, w: CANVAS_W / pxPerMm });
  st.view.h = st.view.w / (r.width / r.height);
  app.svg.setAttribute('viewBox', `${st.view.x - st.view.w / 2} ${st.view.y - st.view.h / 2} ${st.view.w} ${st.view.h}`);
  app.frames();
  return st;
}
const at = (x, y) => app.toScreen(x, y);
const clickW = (x, y) => { const p = at(x, y); app.click(p.x, p.y); };
const hoverW = (x, y) => { const p = at(x, y); app.move(p.x, p.y); };
const sel = (st) => ({ shapes: [...st.selectedShapes], joints: [...st.selectedJoints] });
const toasts = () => [...(app.document.getElementById('notification-container')?.children || [])].map((el) => el.textContent.trim());
// each bug's block runs on its own, so one run shows which of them fail (the run fails at the end if any did)
const failed = [];
async function block(name, fn) {
  try { await fn(); console.log(`ok   ${name}`); } catch (err) { failed.push(name); console.log(`FAIL ${name}: ${err.message}`); }
}

try {
  // ── 1. BUG-210 (R2-09): Equal on a Ø5 circle's rim at overview zoom (4 px/mm: r = 10 px, inside the 15 px point priority) ──
  await block('BUG-210 R2-09 Equal takes no point', async () => {
    const st = await openAt(docOf(
      { c1: [30, 20, true], c2: [90, 20, true], la: [30, 50, true], lb: [70, 50, true], lc: [30, 70, true], ld: [70, 70, true] },
      [{ id: 'C1', type: 'circle', joints: ['c1'], radius: 2.5 }, { id: 'C2', type: 'circle', joints: ['c2'], radius: 5 },
        { id: 'L1', type: 'line', joints: ['la', 'lb'] }, { id: 'L2', type: 'line', joints: ['lc', 'ld'] }]), 60, 40, 4);
    app.tool('equal');
    hoverW(30, 17.5);
    assert.ok(st.hoveredShape === 'C1' && st.hoveredJoint === null, `R2-09 Equal: the hover on C1's rim lights C1, not its centre (shape=${st.hoveredShape} joint=${st.hoveredJoint})`);
    clickW(30, 17.5);
    clickW(90, 15);
    const eq = st.constraints.find((c) => c.type === 'equal');
    assert.ok(eq && eq.shapes.includes('C1') && eq.shapes.includes('C2'), `R2-09 Equal(C1 rim, C2 rim) is made (constraints=${JSON.stringify(st.constraints.map((c) => c.type))}, toasts=${JSON.stringify(toasts())})`);
    // a point is never Equal's pick: the pointer right on a line's end picks the line
    hoverW(30, 50);
    assert.ok(st.hoveredShape === 'L1' && st.hoveredJoint === null, `R2-09 Equal: the pointer on a line's end lights the line, never the point (shape=${st.hoveredShape} joint=${st.hoveredJoint})`);
    clickW(30, 50); clickW(70, 70);
    assert.ok(st.constraints.some((c) => c.type === 'equal' && c.shapes.includes('L1') && c.shapes.includes('L2')), 'R2-09 Equal on two line ends equals the lines');
  });

  // ── 1b. BUG-210 (R1-14): Circular Pattern on a Ø8 bolt hole's rim at flange zoom (2.5 px/mm: r = 10 px); its centre lies ON the construction bolt circle ──
  await block('BUG-210 R1-14 pattern rim, not centre', async () => {
    const st = await openAt(docOf(
      { bc: [0, -35, true] },
      [{ id: 'BOLT', type: 'circle', joints: ['bc'], radius: 4 }, { id: 'PCD', type: 'circle', joints: ['j_origin'], radius: 35, isConstruction: true }]), 0, -20, 2.5);
    app.tool('circularPattern');
    clickW(4, -35);
    assert.deepStrictEqual(sel(st), { shapes: ['BOLT'], joints: [] }, `R1-14 Circular Pattern: a click on the bolt hole's rim picks the circle, not its centre (${JSON.stringify(sel(st))})`);
    app.esc();
    app.tool('select');
    clickW(0, -35);
    assert.deepStrictEqual(sel(st).joints, ['bc'], `a click right on the centre still selects the centre point (${JSON.stringify(sel(st))})`);
  });

  // ── 2. BUG-211 (R1-14b): Esc out of Circular Pattern leaves none of its picks selected ──
  await block('BUG-211 R1-14b Esc clears the pattern picks', async () => {
    const st = await openAt(docOf({ bc: [0, -35, true] }, [{ id: 'BOLT', type: 'circle', joints: ['bc'], radius: 4 }]), 0, -20, 2.5);
    app.esc();
    app.tool('circularPattern');
    clickW(0, -35); // the centre point (a pattern takes points)
    const lbl = () => app.document.querySelector('[data-pick="objects"] .sk-pat-pick-lbl')?.textContent;
    assert.ok(st.selectedJoints.has('bc') && lbl() === '1 selected', `the centre point is picked (${JSON.stringify(sel(st))}, label=${lbl()})`);
    app.esc();
    assert.deepStrictEqual(sel(st), { shapes: [], joints: [] }, `R1-14b Esc leaves none of the dialog's picks selected (${JSON.stringify(sel(st))})`);
    assert.ok(st.currentTool !== 'circularPattern', `ONE Esc leaves the tool (tool=${st.currentTool})`);
    app.tool('circularPattern');
    assert.ok(st.pattern && st.pattern.step === 'objects' && lbl() === 'Select', `R1-14b the reopened dialog starts empty (step=${st.pattern && st.pattern.step}, label=${lbl()})`);
    app.esc();
  });

  // ── 3. BUG-212 (R1-06): an R5 fillet arc at desktop bracket zoom (3.3 px/mm: the virtual sharp is 6.8 px from the arc's middle) ──
  await block('BUG-212 R1-06 fillet arc, not virtual sharp', async () => {
    const st = await openAt(docOf(
      { a: [0, 0, true], b: [0, -50], c: [50, -50, true] },
      [{ id: 'LV', type: 'line', joints: ['a', 'b'] }, { id: 'LH', type: 'line', joints: ['b', 'c'] }],
      [{ type: 'vertical', joints: ['a', 'b'] }, { type: 'horizontal', joints: ['b', 'c'] },
        { type: 'distance', joints: ['a', 'b'], value: 50, name: 'd4' }, { type: 'distance', joints: ['b', 'c'], value: 50, name: 'd1' }]), 25, -25, 3.3);
    const res = applyFillet(st, findCornerAtJoint(st, 'b'), 5);
    assert.ok(res && res.ok !== false, `setup: the R5 fillet is made (${JSON.stringify(res && res.reason)})`);
    app.frames();
    const arc = st.shapes.find((s) => s.type === 'arc');
    const sharp = [...st.joints.entries()].find(([, j]) => j.virtualSharp);
    assert.ok(arc && sharp, 'setup: a fillet arc and its virtual sharp');
    clickW(0, -50);
    assert.deepStrictEqual(sel(st).joints, [sharp[0]], `a click right on the virtual sharp still selects it (${JSON.stringify(sel(st))})`);
    app.esc();
    const m = arcSweepMidpoint(st.joints.get(arc.joints[0]), st.joints.get(arc.joints[1]), st.joints.get(arc.joints[2]), { sweep: arc.sweep });
    clickW(m.x, m.y);
    assert.deepStrictEqual(sel(st), { shapes: [arc.id], joints: [] }, `R1-06 a click on the fillet arc's middle selects the arc, not the virtual sharp (${JSON.stringify(sel(st))})`);
    app.key('Delete');
    assert.ok(!st.shapes.some((s) => s.id === arc.id), 'R1-06 Delete removes the fillet arc');
    const names = st.constraints.filter((c) => c.name).map((c) => c.name);
    assert.ok(names.includes('d1') && names.includes('d4'), `R1-06 the dimensions d1 and d4 stay (${JSON.stringify(names)})`);
  });

  // ── 4a. BUG-213 (R2-08): Tangent on an arc's apex where it crosses the Y construction centreline (drawn first) ──
  await block('BUG-213 R2-08a Tangent apex over centreline', async () => {
    const st = await openAt(docOf(
      { y1: [0, -40, true], y2: [0, 40, true], ac: [0, 19, true], as: [-8, 6, true], ae: [8, 6, true], g1: [12, 6], g2: [36, 22] },
      [{ id: 'YCL', type: 'line', joints: ['y1', 'y2'], isConstruction: true },
        { id: 'ARC', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'] },
        { id: 'G', type: 'line', joints: ['g1', 'g2'] }]), 10, 10, 8);
    const arc = st.shapes.find((s) => s.id === 'ARC');
    const apex = arcSweepMidpoint(st.joints.get('ac'), st.joints.get('as'), st.joints.get('ae'), { sweep: arc.sweep });
    assert.ok(Math.abs(apex.x) < 1e-6, `setup: the arc's apex lies on the centreline (${JSON.stringify(apex)})`);
    app.tool('tangent');
    hoverW(apex.x, apex.y);
    assert.strictEqual(st.hoveredShape, 'ARC', 'R2-08 Tangent: the hover on the apex lights the solid arc, not the centreline');
    clickW(apex.x, apex.y);
    clickW(24, 14);
    const tan = st.constraints.find((c) => c.type === 'tangent');
    assert.ok(tan && tan.shapes.includes('ARC') && tan.shapes.includes('G'), `R2-08 Tangent(arc apex over the centreline, line) is made (${JSON.stringify(tan)}, toasts=${JSON.stringify(toasts())})`);
  });

  // ── 4b. BUG-213 (R2-08): Collinear on two solid halves lying under a construction line (listed first) ──
  await block('BUG-213 R2-08c Collinear halves under construction', async () => {
    const st = await openAt(docOf(
      { ca: [167.52, -8.32, true], cb: [12.48, -111.68, true], h1: [180, 0, true], hm: [90, -60], h2: [0, -120, true] },
      [{ id: 'MID', type: 'line', joints: ['ca', 'cb'], isConstruction: true },
        { id: 'H1', type: 'line', joints: ['h1', 'hm'] }, { id: 'H2', type: 'line', joints: ['hm', 'h2'] }]), 90, -60, 6);
    app.tool('collinear');
    clickW(150, -20);
    clickW(30, -100);
    const col = st.constraints.find((c) => c.type === 'collinear');
    assert.ok(col && col.shapes.includes('H1') && col.shapes.includes('H2'), `R2-08 Collinear picks both solid halves (${JSON.stringify(col)}, toasts=${JSON.stringify(toasts())})`);
  });

  // ── 4c. BUG-213 (R2-08): Equal's second pick prefers the curve it has not picked yet (two construction pieces on the hypotenuse) ──
  await block('BUG-213 R2-08b Equal prefers the curve not yet picked', async () => {
    const st = await openAt(docOf(
      { ha: [150, 0, true], hb: [0, -100, true], s1: [135, -10], s3: [15, -90] },
      [{ id: 'HYP', type: 'line', joints: ['ha', 'hb'] },
        { id: 'SEG1', type: 'line', joints: ['ha', 's1'], isConstruction: true }, { id: 'SEG3', type: 'line', joints: ['s3', 'hb'], isConstruction: true }]), 75, -50, 6);
    app.tool('equal');
    clickW(142.5, -5); // the solid hypotenuse wins the overlap with SEG1
    hoverW(7.5, -95);
    assert.strictEqual(st.hoveredShape, 'SEG3', 'R2-08 Equal: with the hypotenuse picked, the hover over SEG3 lights SEG3');
    clickW(7.5, -95);
    const eq = st.constraints.find((c) => c.type === 'equal');
    assert.ok(eq && eq.shapes.includes('HYP') && eq.shapes.includes('SEG3'), `R2-08 Equal's second pick is the curve not yet picked (${JSON.stringify(eq)}, toasts=${JSON.stringify(toasts())})`);
  });

  // ── 4d. BUG-213 (R2-08, audit row D-10a): Break at a hole centre on the hypotenuse, under a construction line listed first ──
  await block('BUG-213 R2-08d Break splits the solid line, not the construction line', async () => {
    const st = await openAt(docOf(
      { ca: [167.52, -8.32, true], cb: [12.48, -111.68, true], h1: [180, 0, true], h2: [0, -120, true], hc: [90, -60] },
      [{ id: 'MID', type: 'line', joints: ['ca', 'cb'], isConstruction: true }, { id: 'HYP', type: 'line', joints: ['h1', 'h2'] },
        { id: 'HOLE', type: 'circle', joints: ['hc'], radius: 2.5 }],
      [{ type: 'pointOnLine', joint: 'hc', shape: 'HYP' }]), 90, -60, 4);
    app.tool('break');
    clickW(90, -60);
    const solid = st.shapes.filter((s) => s.type === 'line' && !s.isConstruction).length, constr = st.shapes.filter((s) => s.type === 'line' && s.isConstruction).length;
    assert.ok(solid === 2 && constr === 1, `R2-08 Break splits the solid hypotenuse at the hole centre, not the construction line (solid=${solid} construction=${constr}, toasts=${JSON.stringify(toasts())})`);
    clickW(150, -20); // the tool stays: a plain point of the overlap, away from the hole
    const solid2 = st.shapes.filter((s) => s.type === 'line' && !s.isConstruction).length, constr2 = st.shapes.filter((s) => s.type === 'line' && s.isConstruction).length;
    assert.ok(solid2 === 3 && constr2 === 1, `R2-08 Break on a plain point of the overlap splits the solid line too (solid=${solid2} construction=${constr2})`);
  });

  // ── 5. BUG-214 (R1-10): drag a free corner, then D + a click on the adjacent edge ──
  await block('BUG-214 R1-10 drag leaves no selection', async () => {
    const st = await openAt(docOf(
      { p0: [0, 0, true], p1: [80, 0, true], p2: [80, -50, true], p3: [0, -50] },
      [{ id: 'B', type: 'line', joints: ['p0', 'p1'] }, { id: 'R', type: 'line', joints: ['p1', 'p2'] },
        { id: 'T', type: 'line', joints: ['p2', 'p3'] }, { id: 'LEFT', type: 'line', joints: ['p3', 'p0'] }],
      [{ type: 'vertical', joints: ['p3', 'p0'] }]), 40, -30, 6);
    app.drag(at(0, -50), at(0, -62));
    assert.ok(st.joints.get('p3').y < -55, `setup: the corner moved (y=${st.joints.get('p3').y})`);
    assert.deepStrictEqual(sel(st), { shapes: [], joints: [] }, `R1-10 a finished drag leaves nothing selected (${JSON.stringify(sel(st))})`);
    app.key('d');
    const y = st.joints.get('p3').y;
    clickW(0, y / 2);
    const pc = st.placingConstraint;
    assert.ok(pc && pc.__placing && Array.isArray(pc.joints) && pc.joints.length === 2 && pc.joints.includes('p0') && pc.joints.includes('p3'),
      `R1-10 D + a click on the adjacent edge starts that edge's length dimension (${JSON.stringify(pc && { joints: pc.joints, placing: pc.__placing })}, toasts=${JSON.stringify(toasts())})`);
    app.esc(); app.esc();
    app.tool('select');
    clickW(0, y);
    assert.deepStrictEqual(sel(st).joints, ['p3'], `a plain click on the corner still selects it (${JSON.stringify(sel(st))})`);
  });
  assert.deepStrictEqual(failed, [], 'picks-1020-node: failing blocks');
  console.log('picks-1020-node: all ok');
} finally {
  if (app) await app.close();
}

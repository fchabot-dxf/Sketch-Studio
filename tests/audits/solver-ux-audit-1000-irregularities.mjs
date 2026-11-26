// tests/audits/solver-ux-audit-1000-irregularities.mjs -- TASK 1000 (AUDIT, outside the gate)
// Run: node tests/audits/solver-ux-audit-1000-irregularities.mjs
// Owner focus (turn 3725): systematic pairwise IRREGULARITY hunt across 8 pairs in Node
// (9th pair desktop vs phone/touch runs in solver-ux-audit-1000-live.mjs in real Chrome CDP).
import { design, openDesign, closeAll, J, dist, snapshot, movedText, residualText, statusText, dragWorld, dragJoint, editDim, editText, dim, row, f, pt, quiet, toasts, clearToasts, boxEl, hintText, boxOpen, theApp } from './solver-ux-audit-1000-kit.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { selectionLockState, toggleFixedSelection } from '#ui/input-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { findSnap } from '#ui/snap-detection.js';

const D = (a, b, value, name, extra = {}) => ({ type: 'distance', joints: [a, b], value, name, ...extra });
const H = (a, b) => ({ type: 'horizontal', joints: [a, b] });
const V = (a, b) => ({ type: 'vertical', joints: [a, b] });

function clickRibbon(app, toolId) {
  const btn = app.document.getElementById(`tool-${toolId}`) || app.document.querySelector(`[data-tool="${toolId}"]`);
  if (!btn) return false;
  btn.click();
  app.frames();
  return true;
}

async function clickWorld(app, x, y) {
  const p = app.toScreen(x, y);
  await quiet(async () => { app.move(p.x, p.y); app.down(p.x, p.y); app.up(p.x, p.y); });
}

await (async () => {
  // ================ IR1: TOOL BUTTON vs KEYBOARD SHORTCUT vs RIBBON (+ SKETCHSTUDIO vs SHAPER) ================
  const TWO_LINES = () => design(
    { a: [0, 0, true], b: [60, 10], c: [0, 40], d: [80, 60] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }]);

  // IR1.1: Preselect 2 lines -> E key vs Equal ribbon button
  let app = await openDesign(TWO_LINES(), { centre: { x: 40, y: 30 }, w: 220 });
  {
    app.state.selectedShapes.add('L1'); app.state.selectedShapes.add('L2');
    clearToasts();
    await quiet(async () => app.key('e'));
    row('IR1.1a', `SketchStudio preselect L1+L2, press E key: tool=${app.state.currentTool}, constraints=${app.state.constraints.map((c) => c.type)}, toasts=${JSON.stringify(toasts())}`);
  }
  app = await openDesign(TWO_LINES(), { centre: { x: 40, y: 30 }, w: 220 });
  {
    app.state.selectedShapes.add('L1'); app.state.selectedShapes.add('L2');
    clearToasts();
    const clicked = clickRibbon(app, 'equal');
    row('IR1.1b', `SketchStudio preselect L1+L2, click Equal ribbon (found=${clicked}): tool=${app.state.currentTool}, pending=${JSON.stringify(app.state.pendingConstraint)}, constraints=${app.state.constraints.map((c) => c.type)}, toasts=${JSON.stringify(toasts())}`);
  }

  // IR1.2: Preselect 1 line + 1 circle -> E key vs Equal ribbon button
  const LINE_CIRCLE = () => design(
    { a: [0, 0], b: [60, 0], c: [100, 20] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'C1', type: 'circle', joints: ['c'], radius: 20 }]);
  app = await openDesign(LINE_CIRCLE(), { centre: { x: 50, y: 10 }, w: 260 });
  {
    app.state.selectedShapes.add('L1'); app.state.selectedShapes.add('C1');
    clearToasts();
    await quiet(async () => app.key('e'));
    row('IR1.2a', `preselect L1+C1, press E key: tool=${app.state.currentTool}, toasts=${JSON.stringify(toasts())}`);
  }
  app = await openDesign(LINE_CIRCLE(), { centre: { x: 50, y: 10 }, w: 260 });
  {
    app.state.selectedShapes.add('L1'); app.state.selectedShapes.add('C1');
    clearToasts();
    clickRibbon(app, 'equal');
    row('IR1.2b', `preselect L1+C1, click Equal ribbon: tool=${app.state.currentTool}, toasts=${JSON.stringify(toasts())}`);
  }

  // IR1.3: Preselect 2 lines -> Parallel / Perp ribbon vs E key
  app = await openDesign(TWO_LINES(), { centre: { x: 40, y: 30 }, w: 220 });
  {
    app.state.selectedShapes.add('L1'); app.state.selectedShapes.add('L2');
    clickRibbon(app, 'parallel');
    row('IR1.3', `preselect L1+L2, click Parallel ribbon: tool=${app.state.currentTool}, pending=${JSON.stringify(app.state.pendingConstraint)}, constraints=${app.state.constraints.map((c) => c.type)}`);
  }

  // IR1.4 & IR1.6 & IR1.7: SketchStudio vs Shaper vs PenPlotter Design tab!
  for (const host of ['sketchstudio', 'shaper', 'penplotter']) {
    app = await openDesign(TWO_LINES(), { centre: { x: 40, y: 30 }, w: 220, host });
    app.state.selectedShapes.add('L1');
    const okHV = clickRibbon(app, 'hv');
    const afterHV = { okHV, tool: app.state.currentTool, constraints: app.state.constraints.map((c) => c.type) };
    // Click Parallel ribbon TWICE (toggle off?)
    app.state.selectedShapes.clear();
    const okP1 = clickRibbon(app, 'parallel');
    const toolP1 = app.state.currentTool;
    const okP2 = clickRibbon(app, 'parallel');
    const toolP2 = app.state.currentTool;
    // Preselect 2 shapes then click Coincident
    app.state.selectedShapes.add('L1'); app.state.selectedShapes.add('L2');
    clickRibbon(app, 'coincident');
    const afterCoin = { tool: app.state.currentTool, selCount: app.state.selectedShapes.size, pending: app.state.pendingConstraint };
    // Preselect 1 line + 1 joint, press H vs click H/V
    app = await openDesign(TWO_LINES(), { centre: { x: 40, y: 30 }, w: 220, host });
    app.state.selectedShapes.add('L1'); app.state.selectedJoints.add('c');
    await quiet(async () => app.key('h'));
    const hKeyMixed = { tool: app.state.currentTool, constraints: app.state.constraints.map((c) => c.type) };
    app = await openDesign(TWO_LINES(), { centre: { x: 40, y: 30 }, w: 220, host });
    app.state.selectedShapes.add('L1'); app.state.selectedJoints.add('c');
    clickRibbon(app, 'hv');
    const hBtnMixed = { tool: app.state.currentTool, constraints: app.state.constraints.map((c) => c.type) };
    row(`IR1.host.${host}`, `HV-preselect=${JSON.stringify(afterHV)}; parallel-2x=${toolP1}->${toolP2}; coin-2sel=${JSON.stringify(afterCoin)}; L1+j(c) H-key=${JSON.stringify(hKeyMixed)} vs H-btn=${JSON.stringify(hBtnMixed)}`);
  }

  // ================ IR2: LINE vs ARC vs CIRCLE vs BEZIER ================
  // IR2.1: Lock (F key / toggleFixedSelection) on Line vs Arc vs Circle vs Bezier + Undoability!
  app = await openDesign(design(
    { a: [0, 0], b: [40, 0], cc: [90, 0], ac: [150, 0], as: [170, 0], ae: [150, 20], ba: [200, 0], bb: [240, 0] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 20 },
      { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true },
      { id: 'B1', type: 'bezier', joints: ['ba', 'bb'], c1: [210, 30], c2: [230, 30] },
    ],
    [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }]), { centre: { x: 110, y: 10 }, w: 320 });
  {
    for (const sid of ['L1', 'C1', 'A1', 'B1']) {
      app.state.selectedShapes.clear(); app.state.selectedJoints.clear();
      app.state.selectedShapes.add(sid);
      const h0 = app.state.history.length;
      await quiet(async () => app.key('f'));
      const lockSt = selectionLockState(app.state);
      const st = statusText();
      // For circle, try dragging rim after locking!
      let extra = '';
      if (sid === 'C1') {
        const r0 = app.state.shapes.find((s) => s.id === 'C1').radius;
        await dragWorld({ x: 110, y: 0 }, { x: 130, y: 0 }, 10);
        const r1 = app.state.shapes.find((s) => s.id === 'C1').radius;
        extra = ` rimDrag r:${f(r0)}->${f(r1)}`;
      }
      row(`IR2.1.${sid}`, `Lock ${sid} via F: hist ${h0}->${app.state.history.length}, lockState=${JSON.stringify(lockSt)}, ${st}${extra}`);
    }
    // Try Undo after locking all 4 shapes!
    const lockedBeforeUndo = [...app.state.joints.values()].filter((j) => j.fixed).length;
    await quiet(async () => app.undo());
    const lockedAfterUndo = [...app.state.joints.values()].filter((j) => j.fixed).length;
    row('IR2.1.undo', `fixed joints before Undo=${lockedBeforeUndo}, after Undo=${lockedAfterUndo}, hist=${app.state.history.length}`);
  }

  // IR2.2: Dimension tool / Trim / Break on Line vs Arc vs Circle vs Bezier
  app = await openDesign(design(
    { a: [0, 0], b: [50, 0], cc: [80, 0], ac: [140, 0], as: [160, 0], ae: [140, 20], ba: [180, 0], bb: [230, 0] },
    [
      { id: 'L1', type: 'line', joints: ['a', 'b'] },
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 18 },
      { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true },
      { id: 'B1', type: 'bezier', joints: ['ba', 'bb'], c1: [195, 25], c2: [215, 25] },
    ],
    [{ type: 'equal', joints: ['ac', 'as', 'ac', 'ae'] }]), { centre: { x: 115, y: 10 }, w: 320 });
  {
    const targets = { L1: [25, 0], C1: [98, 0], A1: [154.14, 14.14], B1: [205, 18.75] };
    for (const [sid, [x, y]] of Object.entries(targets)) {
      app.tool('dim'); app.esc(); app.tool('dim'); clearToasts();
      const n0 = app.state.constraints.length;
      await clickWorld(app, x, y);
      const made = app.state.constraints.slice(n0).map((c) => `${c.type}(r=${!!c.isRadius},dia=${!!c.isDiameter},v=${f(c.value)})`);
      row(`IR2.2.dim.${sid}`, `Dim click ${sid}: placing=${!!app.state.placingConstraint}, made=${JSON.stringify(made)}, toasts=${JSON.stringify(toasts())}`);
      app.esc();
    }
    // Trim & Break on Arc, Circle, Bezier
    for (const tool of ['trim', 'break']) {
      for (const sid of ['A1', 'C1', 'B1']) {
        app.tool(tool); clearToasts();
        const s0 = app.state.shapes.length;
        const [x, y] = targets[sid];
        await clickWorld(app, x, y);
        row(`IR2.3.${tool}.${sid}`, `${tool} click ${sid}: shapes ${s0}->${app.state.shapes.length}, toasts=${JSON.stringify(toasts())}`);
      }
    }
  }

  // ================ IR4: SNAP vs TOOL ================
  // IR4.1: Coincident tool on an arc's own start & end vs Select drag-snap collapsing the arc!
  app = await openDesign(design(
    { c: [0, 0, true], s: [40, 0, true], e: [0, 40] },
    [{ id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true }],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }]), { centre: { x: 0, y: 0 }, w: 200 });
  {
    clearToasts();
    const res = ConstraintManager.createConstraint(app.state, CONSTRAINT_TYPES.COINCIDENT, { joints: ['s', 'e'] }, { source: 'toolbar' });
    row('IR4.1a', `Coincident tool on arc's own start & end (s,e): res=${res ? 'ADDED' : 'null'}, e=${pt(J('e'))}, toasts=${JSON.stringify(toasts())}`);
  }
  // IR4.3: Does snap-detection detect midpoint on an ARC (like Midpoint tool task 875 does) vs on a LINE?
  app = await openDesign(design(
    { a: [-60, 0], b: [-10, 0], c: [40, 0], s: [70, 0], e: [40, 30] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true }],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }]), { centre: { x: 0, y: 10 }, w: 220 });
  {
    const lineMidScreen = app.toScreen(-35, 0);
    const arcMidWorld = { x: 40 + 30 * Math.SQRT1_2, y: 30 * Math.SQRT1_2 }; // 45 deg midpoint of 0..90 arc
    const arcMidScreen = app.toScreen(arcMidWorld.x, arcMidWorld.y);
    const snapLine = findSnap(app.state.joints, app.state.shapes, app.svg, lineMidScreen, [], false, false);
    const snapArc = findSnap(app.state.joints, app.state.shapes, app.svg, arcMidScreen, [], false, false);
    row('IR4.3', `snap at LINE midpoint (-35,0): type=${snapLine?.type}; snap at ARC midpoint (${f(arcMidWorld.x)},${f(arcMidWorld.y)}): type=${snapArc?.type} (no arc midpoint snap!)`);
  }

  // ================ IR5: SELECTION ORDER A-then-B vs B-then-A ================
  // IR5.1: Coincident free point p + free line L vs L + p (via real Coincident tool clicks!)
  for (const order of ['P-then-L', 'L-then-P']) {
    app = await openDesign(design(
      { a: [0, 0], b: [80, 0], p: [40, 30], q: [40, 60] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['p', 'q'] }]), { centre: { x: 40, y: 25 }, w: 240 });
    app.tool('coincident'); clearToasts();
    const s0 = snapshot();
    if (order === 'P-then-L') { await clickWorld(app, 40, 30); await clickWorld(app, 20, 0); }
    else { await clickWorld(app, 20, 0); await clickWorld(app, 40, 30); }
    row(`IR5.1.${order}`, `Coincident ${order}: constraints=${app.state.constraints.map((c) => c.type)}, a=${pt(J('a'))}, b=${pt(J('b'))}, p=${pt(J('p'))}, toasts=${JSON.stringify(toasts())}, ${residualText()}`);
  }
  // IR5.2: Midpoint free point p + free arc A vs A + p
  for (const order of ['P-then-A', 'A-then-P']) {
    app = await openDesign(design(
      { c: [0, 0], s: [40, 0], e: [0, 40], p: [60, 40], q: [80, 40] },
      [{ id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true }, { id: 'L1', type: 'line', joints: ['p', 'q'] }],
      [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }]), { centre: { x: 30, y: 20 }, w: 240 });
    app.tool('midpoint'); clearToasts();
    if (order === 'P-then-A') { await clickWorld(app, 60, 40); await clickWorld(app, 28.28, 28.28); }
    else { await clickWorld(app, 28.28, 28.28); await clickWorld(app, 60, 40); }
    row(`IR5.2.${order}`, `Midpoint ${order}: constraints=${app.state.constraints.map((c) => c.type)}, c=${pt(J('c'))}, p=${pt(J('p'))}, toasts=${JSON.stringify(toasts())}, ${residualText()}`);
  }
  // IR5.3: Dimension tool: Line + Point vs Point + Line; Line + X-axis vs X-axis + Line
  for (const order of ['L-then-P', 'P-then-L']) {
    app = await openDesign(design(
      { a: [0, 0, true], b: [80, 0, true], p: [40, 30], q: [40, 60] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['p', 'q'] }]), { centre: { x: 40, y: 25 }, w: 240 });
    app.tool('dim'); clearToasts();
    if (order === 'L-then-P') { await clickWorld(app, 20, 0); await clickWorld(app, 40, 30); await clickWorld(app, 60, 15); }
    else { await clickWorld(app, 40, 30); await clickWorld(app, 20, 0); await clickWorld(app, 60, 15); }
    const cs = app.state.constraints.map((c) => `${c.type}(j=${(c.joints || []).join(',')},v=${f(c.value)},drv=${!!c.isDriven})`);
    row(`IR5.3.${order}`, `Dim tool ${order}: constraints=${JSON.stringify(cs)}, toasts=${JSON.stringify(toasts())}`);
    app.esc();
  }
  for (const order of ['L-then-AxisX', 'AxisX-then-L']) {
    app = await openDesign(design(
      { a: [10, 20], b: [70, 50] },
      [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 40, y: 20 }, w: 240 });
    app.tool('dim'); clearToasts();
    if (order === 'L-then-AxisX') { await clickWorld(app, 40, 35); await clickWorld(app, 40, 0); await clickWorld(app, 60, 15); }
    else { await clickWorld(app, 40, 0); await clickWorld(app, 40, 35); await clickWorld(app, 60, 15); }
    const cs = app.state.constraints.map((c) => `${c.type}(s=${(c.shapes || []).join(',')},v=${f(c.value)},drv=${!!c.isDriven})`);
    row(`IR5.4.${order}`, `Dim tool ${order}: constraints=${JSON.stringify(cs)}, placing=${!!app.state.placingConstraint}, toasts=${JSON.stringify(toasts())}`);
    app.esc();
  }
  // IR5.5: Parallel / Equal / Tangent / Symmetric: free A + free B vs B + A
  for (const [tool, key, pA, pB, docFn] of [
    ['parallel', 'par', [30, 5], [40, 45], () => design({ a: [0, 0], b: [60, 10], c: [0, 40], d: [80, 50] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }])],
    ['equal', 'eq', [30, 5], [40, 45], () => design({ a: [0, 0], b: [60, 10], c: [0, 40], d: [80, 50] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }])],
    ['tangent', 'tan', [30, 0], [50, 45], () => design({ a: [0, 0], b: [60, 0], cc: [30, 45] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }])],
  ]) {
    for (const rev of [false, true]) {
      app = await openDesign(docFn(), { centre: { x: 40, y: 25 }, w: 240 });
      const s0 = snapshot();
      app.tool(tool); clearToasts();
      if (!rev) { await clickWorld(app, ...pA); await clickWorld(app, ...pB); }
      else { await clickWorld(app, ...pB); await clickWorld(app, ...pA); }
      const movedA = Math.max(dist(s0.get('a'), J('a')), dist(s0.get('b'), J('b')));
      const movedB = J('c') ? Math.max(dist(s0.get('c'), J('c')), dist(s0.get('d'), J('d'))) : dist(s0.get('cc'), J('cc'));
      row(`IR5.5.${key}.${rev ? 'B-A' : 'A-B'}`, `${tool} ${rev ? 'B->A' : 'A->B'}: movedA=${f(movedA)}, movedB=${f(movedB)}, constraints=${app.state.constraints.map((c) => c.type)}, ${residualText()}`);
    }
  }

  // ================ IR8: DRAW-TIME BOX vs EDIT BOX ================
  // IR8.1: Line draw-time box (#dualInput): typing "-5" vs "w = 50" vs "d1 * 2"
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [H('a', 'b'), D('a', 'b', 60, 'd1')]), { centre: { x: 40, y: 30 }, w: 240 });
  {
    app.tool('line'); clearToasts();
    const p1 = app.toScreen(0, 30), p2 = app.toScreen(40, 30);
    await quiet(async () => { app.move(p1.x, p1.y); app.down(p1.x, p1.y); app.up(p1.x, p1.y); app.move(p2.x, p2.y); });
    const dual = app.document.getElementById('dualInput');
    const lenInput = dual && dual.querySelector('input');
    const dualOpen = () => dual && !dual.classList.contains('hidden');
    const open0 = dualOpen();
    await quiet(async () => { lenInput.focus(); lenInput.select(); app.key('a', { ctrl: true }); app.type('-5'); app.enter(); });
    row('IR8.1a', `Line draw-time box type "-5"+Enter: opened=${open0}, stillOpen=${dualOpen()}, invalid=${lenInput.getAttribute('aria-invalid')}, hint="${hintText()}", toasts=${JSON.stringify(toasts())}, shapes=${app.state.shapes.length}`);
    clearToasts();
    await quiet(async () => { lenInput.focus(); lenInput.select(); app.key('a', { ctrl: true }); app.type('w = 50'); app.enter(); });
    row('IR8.1b', `Line draw-time box type "w = 50"+Enter: stillOpen=${dualOpen()}, invalid=${lenInput.getAttribute('aria-invalid')}, hint="${hintText()}", params=${app.state.parameters.map((p) => p.name)}, shapes=${app.state.shapes.length}`);
    // Try typing "d1 * 2" in draw-time box!
    clearToasts();
    await quiet(async () => { lenInput.focus(); lenInput.select(); app.key('a', { ctrl: true }); app.type('d1 * 2'); app.enter(); });
    const newL = app.state.shapes.find((s) => s.id !== 'L1');
    const newD = app.state.constraints.find((c) => c.type === 'distance' && c.name !== 'd1');
    row('IR8.1d', `Line draw-time box type "d1 * 2"+Enter: shapes=${app.state.shapes.length}, newDim val=${f(newD?.value)} expr="${newD?.expression}"`);
    app.esc();
  }
  // Contrast IR8.1b: typing "w = 50" in the EDIT box!
  {
    const ed = await editDim('d1', 'w = 50');
    const c = dim('d1') || dim('w') || app.state.constraints.find((x) => x.type === 'distance');
    row('IR8.1c', `EDIT box type "w = 50"+Enter: ${editText(ed)}, dim name=${c?.name} val=${f(c?.value)} expr="${c?.expression}", params=${app.state.parameters.map((p) => `${p.name}=${p.value}`)}`);
  }

  // IR8.3: Circle draw-time box (DIAMETER) vs created dimension (RADIUS!)
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [H('a', 'b'), D('a', 'b', 60, 'd1')]), { centre: { x: 40, y: 30 }, w: 240 });
  {
    app.tool('circle'); clearToasts();
    const p1 = app.toScreen(40, 40), p2 = app.toScreen(60, 40);
    await quiet(async () => { app.move(p1.x, p1.y); app.down(p1.x, p1.y); app.up(p1.x, p1.y); app.move(p2.x, p2.y); });
    await quiet(async () => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type('d1'); app.enter(); });
    const cShape = app.state.shapes.find((s) => s.type === 'circle');
    const cDim = app.state.constraints.find((c) => c.shape === cShape?.id);
    row('IR8.3', `Circle draw-time box type "d1" (d1=60): circle.radius=${f(cShape?.radius)}, created dim: isRadius=${cDim?.isRadius}, isDiameter=${cDim?.isDiameter}, value=${f(cDim?.value)}, expr="${cDim?.expression}"`);
  }

  // IR8.4: Draw-time autocomplete (#dimComplete) in Line draw-time box vs Edit box!
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [H('a', 'b'), D('a', 'b', 60, 'd1')]), { centre: { x: 40, y: 30 }, w: 240 });
  {
    app.tool('line');
    const p1 = app.toScreen(0, 30), p2 = app.toScreen(40, 30);
    await quiet(async () => { app.move(p1.x, p1.y); app.down(p1.x, p1.y); app.up(p1.x, p1.y); app.move(p2.x, p2.y); });
    const lenInput = app.document.querySelector('#dualInput input');
    await quiet(async () => { lenInput.focus(); lenInput.select(); app.key('a', { ctrl: true }); app.type('d'); });
    const compLive = app.document.getElementById('dimComplete');
    const liveShown = compLive && !compLive.classList.contains('hidden');
    app.esc();
    // Contrast with Edit box
    app.tool('select');
    const d1c = dim('d1'); const p = app.toScreen(d1c.glyphPos.x, d1c.glyphPos.y);
    const el = () => app.svg.querySelector('.dim-label[data-constraint-idx]');
    await app.pause(550);
    await quiet(async () => { app.dblclick(p.x, p.y, { target: el }); });
    await app.waitFor(boxOpen, 'edit box', 600);
    await quiet(async () => { const i = boxEl(); i.focus(); i.select(); app.key('a', { ctrl: true }); app.type('d'); });
    const compEdit = app.document.getElementById('dimComplete');
    const editShown = compEdit && !compEdit.classList.contains('hidden');
    app.esc();
    row('IR8.4', `typing "d" autocomplete (#dimComplete) visible: draw-time box=${!!liveShown} vs edit box=${!!editShown}`);
  }

  await closeAll();
})();
console.log('solver-ux-audit-1000-irregularities.mjs: printed (exit 0 whatever the rows say)');

// tests/audits/dimension-audit-1003-picks.mjs -- TASK 1003 (AUDIT ONLY, outside the gate)
// Area 1: PICKS (every pair in BOTH orders A->B and B->A) & PLACEMENT (modes, sides, flipping, drag-release, label drag).
// Run: node tests/audits/dimension-audit-1003-picks.mjs
import {
  design, openDesign, closeAll, theApp, J, S, dist, f, pt, row, quiet,
  toasts, clearToasts, boxOpen, boxEl, dimSummary, allDims, labelTextOf, labelEl,
  moveW, clickW, dragWorld, snapshot, movedText, residualText, resetDimensionState,
} from './dimension-audit-1003-kit.js';
import { findCornerAtJoint, applyFillet } from '#core/fillet.js';
import { offsetChainOf, applyOffset, undimensionOffset } from '#core/offset.js';
import { mirrorObjectsOf, mirrorObjects } from '#core/mirror.js';
import { patternObjectsOf, applyPattern, patternDefaults } from '#core/pattern.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';

function finishIfBoxOpen(app) {
  if (boxOpen()) app.enter();
}

async function pickSeq(points, { placeAt = null, enterAfter = false } = {}) {
  const app = theApp();
  clearToasts();
  app.tool('dim');
  for (const p of points) {
    await clickW(p);
  }
  if (placeAt) {
    await moveW(placeAt);
    await clickW(placeAt);
  }
  if (enterAfter && boxOpen()) {
    await quiet(() => { app.enter(); });
    app.frames();
  }
  const ds = allDims();
  return {
    tool: app.state.currentTool,
    placing: !!app.state.placingConstraint,
    pendingActive: app.state.active ? app.state.active.mode : null,
    box: boxOpen(),
    boxVal: boxOpen() ? boxEl().value : null,
    dims: ds.map(dimSummary),
    labels: ds.map(labelTextOf),
    toasts: toasts(),
  };
}

// ─── P1.1 LINE LENGTH & PLACEMENT MODES ─────────────────────────────────────
{
  const doc = design(
    {
      h1: [-60, 0], h2: [0, 0],            // exact horizontal (len 60)
      v1: [20, -20], v2: [20, 40],         // exact vertical (len 60)
      d1: [50, 0], d2: [80, 40],           // 3-4-5 diagonal (dx=30, dy=40, len=50)
      nh1: [-60, 50], nh2: [0, 53],        // near-horizontal (~2.86 deg)
      nv1: [110, -20], nv2: [113, 40],     // near-vertical (~87.14 deg)
    },
    [
      { id: 'LH', type: 'line', joints: ['h1', 'h2'] },
      { id: 'LV', type: 'line', joints: ['v1', 'v2'] },
      { id: 'LD', type: 'line', joints: ['d1', 'd2'] },
      { id: 'LNH', type: 'line', joints: ['nh1', 'nh2'] },
      { id: 'LNV', type: 'line', joints: ['nv1', 'nv2'] },
    ],
  );

  // Level line placed above and to side
  await openDesign(doc, { centre: { x: 20, y: 20 }, w: 280 });
  let r = await pickSeq([{ x: -30, y: 0 }], { placeAt: { x: -30, y: -15 }, enterAfter: true });
  row('P1.1.level', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} tool=${r.tool}`);

  // Plumb line
  await openDesign(doc, { centre: { x: 20, y: 20 }, w: 280 });
  r = await pickSeq([{ x: 20, y: 10 }], { placeAt: { x: 35, y: 10 }, enterAfter: true });
  row('P1.1.plumb', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);

  // Diagonal line: inside band (aligned), past top (horizontal), past right (vertical)
  await openDesign(doc, { centre: { x: 65, y: 20 }, w: 220 });
  let app = theApp();
  app.tool('dim');
  await clickW({ x: 65, y: 20 }); // click diagonal midpoint
  await moveW({ x: 45, y: 35 });  // inside perpendicular band -> aligned
  const mAligned = dimSummary(allDims()[0]);
  await moveW({ x: 85, y: 65 });  // past top endpoint, vy > vx -> horizontal
  const mHoriz = dimSummary(allDims()[0]);
  await moveW({ x: 115, y: 45 }); // past right endpoint, vx > vy -> vertical
  const mVert = dimSummary(allDims()[0]);
  await moveW({ x: 85, y: 5 });   // flip to opposite side inside band -> aligned
  const mFlip = dimSummary(allDims()[0]);
  await clickW({ x: 85, y: 5 });
  row('P1.1.diagFlip', `inBand=[${mAligned}] pastTop=[${mHoriz}] pastRight=[${mVert}] flipSide=[${mFlip}] box=${boxOpen()} boxVal=${boxEl().value}`);

  // Near-horizontal & near-vertical inside band
  await openDesign(doc, { centre: { x: 20, y: 20 }, w: 280 });
  r = await pickSeq([{ x: -30, y: 51.5 }], { placeAt: { x: -30, y: 70 }, enterAfter: true });
  row('P1.1.nearH', `dims=${JSON.stringify(r.dims)}`);

  await openDesign(doc, { centre: { x: 20, y: 20 }, w: 280 });
  r = await pickSeq([{ x: 111.5, y: 10 }], { placeAt: { x: 130, y: 10 }, enterAfter: true });
  row('P1.1.nearV', `dims=${JSON.stringify(r.dims)}`);
}

// ─── P1.2 POINT-POINT (A->B and B->A, aligned / H / V) ───────────────────────
{
  const doc = design({ a: [10, 10], b: [40, 50] }, []);
  for (const [tag, p1, p2] of [['AB', { x: 10, y: 10 }, { x: 40, y: 50 }], ['BA', { x: 40, y: 50 }, { x: 10, y: 10 }]]) {
    await openDesign(doc, { centre: { x: 30, y: 30 }, w: 200 });
    const app = theApp();
    app.tool('dim');
    await clickW(p1);
    await clickW(p2);
    await moveW({ x: 10, y: 40 });  // inside band -> aligned
    const sA = dimSummary(allDims()[0]);
    await moveW({ x: 45, y: 75 });  // past end, |vy|>|vx| -> horizontal (30)
    const sH = dimSummary(allDims()[0]);
    await moveW({ x: 75, y: 55 });  // past end, |vx|>|vy| -> vertical (40)
    const sV = dimSummary(allDims()[0]);
    await clickW({ x: 75, y: 55 });
    const bVal = boxOpen() ? boxEl().value : null;
    finishIfBoxOpen(app);
    row(`P1.2.ptPt.${tag}`, `aligned=[${sA}] H=[${sH}] V=[${sV}] placedBoxVal=${bVal} final=[${dimSummary(allDims()[0])}]`);
  }
}

// ─── P1.3 POINT-LINE (P->L and L->P, own endpoint, flip across line) ─────────
{
  const doc = design(
    { p: [40, 45], a: [10, 10], b: [70, 10], s1: [10, -30], s2: [60, -10] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'LS', type: 'line', joints: ['s1', 's2'] }],
  );

  // P -> L1
  await openDesign(doc, { centre: { x: 40, y: 15 }, w: 220 });
  let r = await pickSeq([{ x: 40, y: 45 }, { x: 40, y: 10 }], { placeAt: { x: 60, y: 28 }, enterAfter: true });
  row('P1.3.P->L', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} toasts=${JSON.stringify(r.toasts)}`);

  // L1 -> P
  await openDesign(doc, { centre: { x: 40, y: 15 }, w: 220 });
  r = await pickSeq([{ x: 40, y: 10 }, { x: 40, y: 45 }], { placeAt: { x: 60, y: 28 }, enterAfter: true });
  row('P1.3.L->P', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} toasts=${JSON.stringify(r.toasts)}`);

  // Slanted line: P -> LS vs LS -> P
  await openDesign(doc, { centre: { x: 40, y: 15 }, w: 220 });
  r = await pickSeq([{ x: 40, y: 45 }, { x: 35, y: -20 }], { placeAt: { x: 60, y: 15 }, enterAfter: true });
  row('P1.3.P->LS', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);

  await openDesign(doc, { centre: { x: 40, y: 15 }, w: 220 });
  r = await pickSeq([{ x: 35, y: -20 }, { x: 40, y: 45 }], { placeAt: { x: 60, y: 15 }, enterAfter: true });
  row('P1.3.LS->P', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);

  // Own endpoint: ownEnd -> L1 vs L1 -> ownEnd
  await openDesign(doc, { centre: { x: 40, y: 15 }, w: 220 });
  r = await pickSeq([{ x: 10, y: 10 }, { x: 40, y: 10 }]);
  row('P1.3.ownEnd->L', `dims=${JSON.stringify(r.dims)} placing=${r.placing} active=${r.pendingActive} toasts=${JSON.stringify(r.toasts)}`);

  await openDesign(doc, { centre: { x: 40, y: 15 }, w: 220 });
  r = await pickSeq([{ x: 40, y: 10 }, { x: 10, y: 10 }]);
  row('P1.3.L->ownEnd', `dims=${JSON.stringify(r.dims)} placing=${r.placing} box=${r.box} toasts=${JSON.stringify(r.toasts)}`);
}

// ─── P1.4 LINE-LINE PARALLEL (L1->L2 and L2->L1) ─────────────────────────────
{
  const doc = design(
    { a: [10, 10], b: [70, 10], c: [10, 40], d: [70, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
  );
  for (const [tag, p1, p2] of [['L1->L2', { x: 40, y: 10 }, { x: 40, y: 40 }], ['L2->L1', { x: 40, y: 40 }, { x: 40, y: 10 }]]) {
    await openDesign(doc, { centre: { x: 40, y: 25 }, w: 200 });
    const r = await pickSeq([p1, p2], { placeAt: { x: 90, y: 25 }, enterAfter: true });
    row(`P1.4.par.${tag}`, `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} toasts=${JSON.stringify(r.toasts)}`);
  }
  // Clicking the same parallel pair a second time -> recovers existing?
  const app = theApp();
  const countBefore = allDims().length;
  await clickW({ x: 40, y: 10 });
  await clickW({ x: 40, y: 40 });
  const r2 = { placing: !!app.state.placingConstraint, count: allDims().length, countBefore, dims: allDims().map(dimSummary) };
  await clickW({ x: -10, y: 25 });
  row('P1.4.par.2ndTime', `before=${r2.countBefore} during=${r2.count} placing=${r2.placing} afterDrop=${allDims().length} box=${boxOpen()} dims=${JSON.stringify(allDims().map(dimSummary))}`);
}

// ─── P1.5 LINE-LINE ANGLE (L1->L2 and L2->L1, 4 quadrants, across 180) ───────
{
  // Two lines intersecting at (0,0): L1 along +X (0..60, 0), L2 at +60 deg (0..30, 0..51.96)
  const doc = design(
    { a: [-20, 0], b: [60, 0], c: [-10, -17.3205], d: [30, 51.9615] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['c', 'd'] }],
  );
  // Quadrants around (0,0): Q1 (+30, +15) = 60 deg, Q2 (-20, +30) = 120 deg, Q3 (-30, -15) = 60 deg, Q4 (+20, -30) = 120 deg
  const quads = [
    ['Q1_60', { x: 30, y: 15 }],
    ['Q2_120', { x: -20, y: 30 }],
    ['Q3_60', { x: -30, y: -15 }],
    ['Q4_120', { x: 20, y: -30 }],
  ];
  for (const [order, p1, p2] of [['L1->L2', { x: 40, y: 0 }, { x: 20, y: 34.64 }], ['L2->L1', { x: 20, y: 34.64 }, { x: 40, y: 0 }]]) {
    const qRes = [];
    for (const [qName, qPt] of quads) {
      await openDesign(doc, { centre: { x: 10, y: 10 }, w: 220 });
      const r = await pickSeq([p1, p2], { placeAt: qPt, enterAfter: true });
      qRes.push(`${qName}:${r.dims[0] || 'NONE'} lbl=${r.labels[0]}`);
    }
    row(`P1.5.ang.${order}`, qRes.join(' || '));
  }
  // Live sector flip during placement across all 4 quadrants before dropping
  await openDesign(doc, { centre: { x: 10, y: 10 }, w: 220 });
  const app = theApp();
  app.tool('dim');
  await clickW({ x: 40, y: 0 });
  await clickW({ x: 20, y: 34.64 });
  const flips = [];
  for (const [qName, qPt] of quads) {
    await moveW(qPt);
    const c = allDims()[0];
    flips.push(`${qName}:v=${f(c && c.value, 1)},sec=${JSON.stringify(c && c.sector)},lbl=${labelTextOf(c)}`);
  }
  await clickW({ x: -20, y: 30 }); // drop in Q2 (120 deg)
  const droppedBox = boxOpen() ? boxEl().value : null;
  row('P1.5.ang.liveFlip', `${flips.join(' | ')} | droppedBox=${droppedBox}`);
}

// ─── P1.6 CIRCLE & ARC (diameter vs radius, 2nd dim, arc length) ────────────
{
  const doc = design(
    { cc: [0, 0], ac: [80, 0], as: [105, 0], ae: [80, 25] },
    [
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 20 },
      { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true },
    ],
  );
  await openDesign(doc, { centre: { x: 40, y: 0 }, w: 240 });
  let r = await pickSeq([{ x: 20, y: 0 }], { placeAt: { x: 30, y: 20 }, enterAfter: true });
  row('P1.6.circle', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);

  // 2nd dim on same circle (already has driving radius)
  r = await pickSeq([{ x: 20, y: 0 }], { placeAt: { x: -30, y: 20 }, enterAfter: true });
  row('P1.6.circle.2nd', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} toasts=${JSON.stringify(r.toasts)}`);

  // Circle with ONLY a reference radius dim -> click to add new dim
  const docRefC = design(
    { cc: [0, 0] },
    [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 20 }],
    [{ type: 'distance', shape: 'C1', value: 20, isRadius: true, isDriven: true, driven: true, name: 'd1' }],
  );
  await openDesign(docRefC, { centre: { x: 0, y: 0 }, w: 200 });
  r = await pickSeq([{ x: 20, y: 0 }], { placeAt: { x: 35, y: 20 }, enterAfter: true });
  row('P1.6.circle.afterRef', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} toasts=${JSON.stringify(r.toasts)}`);

  // Arc click -> radius (place inside sweep and outside sweep)
  await openDesign(doc, { centre: { x: 40, y: 0 }, w: 240 });
  r = await pickSeq([{ x: 80 + 25 * Math.SQRT1_2, y: 25 * Math.SQRT1_2 }], { placeAt: { x: 115, y: 35 }, enterAfter: true });
  const extIn = theApp().svg.querySelectorAll('.dim-arc-extension').length;
  row('P1.6.arc.inSweep', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} extArcs=${extIn}`);

  await openDesign(doc, { centre: { x: 40, y: 0 }, w: 240 });
  r = await pickSeq([{ x: 80 + 25 * Math.SQRT1_2, y: 25 * Math.SQRT1_2 }], { placeAt: { x: 50, y: -30 }, enterAfter: true });
  const extOut = theApp().svg.querySelectorAll('.dim-arc-extension').length;
  row('P1.6.arc.outSweep', `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} extArcs=${extOut}`);
}

// ─── P1.7 POINT-CIRCLE, LINE-CIRCLE, CIRCLE-CIRCLE & ARC EQUIVALENTS ────────
{
  const doc = design(
    { p: [-50, 0], c1: [0, 0], c2: [70, 0], l1: [-50, 45], l2: [80, 45], ac: [0, -60], as: [20, -60], ae: [0, -40] },
    [
      { id: 'C1', type: 'circle', joints: ['c1'], radius: 20 },
      { id: 'C2', type: 'circle', joints: ['c2'], radius: 15 },
      { id: 'L1', type: 'line', joints: ['l1', 'l2'] },
      { id: 'A1', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true },
    ],
  );
  const pairs = [
    ['P->C1rim', { x: -50, y: 0 }, { x: 20, y: 0 }],
    ['C1rim->P', { x: 20, y: 0 }, { x: -50, y: 0 }],
    ['P->C1ctr', { x: -50, y: 0 }, { x: 0, y: 0 }],
    ['C1ctr->P', { x: 0, y: 0 }, { x: -50, y: 0 }],
    ['L1->C1rim', { x: 10, y: 45 }, { x: 20, y: 0 }],
    ['C1rim->L1', { x: 20, y: 0 }, { x: 10, y: 45 }],
    ['L1->C1ctr', { x: 10, y: 45 }, { x: 0, y: 0 }],
    ['C1ctr->L1', { x: 0, y: 0 }, { x: 10, y: 45 }],
    ['C1rim->C2rim', { x: 20, y: 0 }, { x: 85, y: 0 }],
    ['C2rim->C1rim', { x: 85, y: 0 }, { x: 20, y: 0 }],
    ['C1ctr->C2ctr', { x: 0, y: 0 }, { x: 70, y: 0 }],
    ['C2ctr->C1ctr', { x: 70, y: 0 }, { x: 0, y: 0 }],
    ['P->A1rim', { x: -50, y: 0 }, { x: 14.14, y: -45.86 }],
    ['A1rim->P', { x: 14.14, y: -45.86 }, { x: -50, y: 0 }],
    ['L1->A1rim', { x: 10, y: 45 }, { x: 14.14, y: -45.86 }],
    ['A1rim->L1', { x: 14.14, y: -45.86 }, { x: 10, y: 45 }],
  ];
  for (const [tag, p1, p2] of pairs) {
    await openDesign(doc, { centre: { x: 15, y: 0 }, w: 280 });
    const r = await pickSeq([p1, p2], { placeAt: { x: 35, y: -25 }, enterAfter: true });
    row(`P1.7.${tag}`, `dims=${JSON.stringify(r.dims)} placing=${r.placing} active=${r.pendingActive} box=${r.box} toasts=${JSON.stringify(r.toasts)}`);
  }
}

// ─── P1.8 AXES & ORIGIN AS EITHER PICK (A->B and B->A) ──────────────────────
{
  const doc = design(
    { p: [40, 30], pa: [20, 20], pb: [70, 20], sa: [20, -10], sb: [60, -30], cc: [-50, 30] },
    [
      { id: 'LP', type: 'line', joints: ['pa', 'pb'] },   // parallel to X axis
      { id: 'LS', type: 'line', joints: ['sa', 'sb'] },   // slanted to X axis
      { id: 'C1', type: 'circle', joints: ['cc'], radius: 15 },
    ],
  );
  const cases = [
    ['Origin->P', { x: 0, y: 0 }, { x: 40, y: 30 }, { x: 20, y: 45 }],
    ['P->Origin', { x: 40, y: 30 }, { x: 0, y: 0 }, { x: 20, y: 45 }],
    ['Origin->LP', { x: 0, y: 0 }, { x: 45, y: 20 }, { x: -10, y: 10 }],
    ['LP->Origin', { x: 45, y: 20 }, { x: 0, y: 0 }, { x: -10, y: 10 }],
    ['Origin->C1rim', { x: 0, y: 0 }, { x: -35, y: 30 }, { x: -20, y: 10 }],
    ['C1rim->Origin', { x: -35, y: 30 }, { x: 0, y: 0 }, { x: -20, y: 10 }],
    ['AxisX->P', { x: 50, y: 0 }, { x: 40, y: 30 }, { x: 60, y: 15 }],
    ['P->AxisX', { x: 40, y: 30 }, { x: 50, y: 0 }, { x: 60, y: 15 }],
    ['AxisY->P', { x: 0, y: 40 }, { x: 40, y: 30 }, { x: 20, y: 50 }],
    ['P->AxisY', { x: 40, y: 30 }, { x: 0, y: 40 }, { x: 20, y: 50 }],
    ['AxisX->LP', { x: 50, y: 0 }, { x: 45, y: 20 }, { x: 85, y: 10 }],
    ['LP->AxisX', { x: 45, y: 20 }, { x: 50, y: 0 }, { x: 85, y: 10 }],
    ['AxisX->LS', { x: 50, y: 0 }, { x: 40, y: -20 }, { x: 65, y: -10 }],
    ['LS->AxisX', { x: 40, y: -20 }, { x: 50, y: 0 }, { x: 65, y: -10 }],
    ['AxisX->AxisY', { x: 50, y: 0 }, { x: 0, y: 40 }, { x: 20, y: 20 }],
    ['AxisY->AxisX', { x: 0, y: 40 }, { x: 50, y: 0 }, { x: 20, y: 20 }],
    ['AxisX->C1rim', { x: -50, y: 0 }, { x: -35, y: 30 }, { x: -70, y: 15 }],
    ['C1rim->AxisX', { x: -35, y: 30 }, { x: -50, y: 0 }, { x: -70, y: 15 }],
  ];
  for (const [tag, p1, p2, place] of cases) {
    await openDesign(doc, { centre: { x: 10, y: 10 }, w: 260 });
    const r = await pickSeq([p1, p2], { placeAt: place, enterAfter: true });
    row(`P1.8.${tag}`, `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} placing=${r.placing} active=${r.pendingActive} toasts=${JSON.stringify(r.toasts)}`);
  }
}

// ─── P1.9 CONSTRUCTION GEOMETRY ─────────────────────────────────────────────
{
  const doc = design(
    {
      ca: [-60, 0], cb: [-10, 0],
      sa: [-60, 30], sb: [-10, 30],
      cc: [40, 0],
      ac: [100, 0], as: [120, 0], ae: [100, 20],
    },
    [
      { id: 'CL', type: 'line', joints: ['ca', 'cb'], isConstruction: true },
      { id: 'SL', type: 'line', joints: ['sa', 'sb'], isConstruction: false },
      { id: 'CC', type: 'circle', joints: ['cc'], radius: 18, isConstruction: true },
      { id: 'CA', type: 'arc', joints: ['ac', 'as', 'ae'], sweep: true, isConstruction: true },
    ],
  );
  const cCases = [
    ['constLine', [{ x: -35, y: 0 }], { x: -35, y: -15 }],
    ['constCircle', [{ x: 58, y: 0 }], { x: 68, y: 15 }],
    ['constArc', [{ x: 114.14, y: 14.14 }], { x: 125, y: 25 }],
    ['CL->SL_par', [{ x: -35, y: 0 }, { x: -35, y: 30 }], { x: -80, y: 15 }],
    ['SL->CL_par', [{ x: -35, y: 30 }, { x: -35, y: 0 }], { x: -80, y: 15 }],
    ['Cpt->SL', [{ x: -60, y: 0 }, { x: -35, y: 30 }], { x: -75, y: 15 }],
    ['SL->Cpt', [{ x: -35, y: 30 }, { x: -60, y: 0 }], { x: -75, y: 15 }],
  ];
  for (const [tag, pts, pl] of cCases) {
    await openDesign(doc, { centre: { x: 30, y: 10 }, w: 280 });
    const r = await pickSeq(pts, { placeAt: pl, enterAfter: true });
    row(`P1.9.${tag}`, `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)} toasts=${JSON.stringify(r.toasts)}`);
  }
}

// ─── P1.10 SPLINE / BEZIER ──────────────────────────────────────────────────
{
  const doc = design(
    { b1: [0, 0], b2: [60, 0], l1: [0, 40], l2: [60, 40] },
    [
      { id: 'B1', type: 'bezier', joints: ['b1', 'b2'], c1: [20, 30], c2: [40, 30] },
      { id: 'L1', type: 'line', joints: ['l1', 'l2'] },
    ],
  );
  // Click bezier body (midpoint of cubic at t=0.5 is (30, 22.5))
  await openDesign(doc, { centre: { x: 30, y: 20 }, w: 200 });
  let r = await pickSeq([{ x: 30, y: 22.5 }]);
  row('P1.10.bezierBody', `dims=${JSON.stringify(r.dims)} tool=${r.tool} toasts=${JSON.stringify(r.toasts)}`);

  // Bezier endpoints b1->b2 and b2->b1
  for (const [tag, p1, p2] of [['b1->b2', { x: 0, y: 0 }, { x: 60, y: 0 }], ['b2->b1', { x: 60, y: 0 }, { x: 0, y: 0 }]]) {
    await openDesign(doc, { centre: { x: 30, y: 20 }, w: 200 });
    r = await pickSeq([p1, p2], { placeAt: { x: 30, y: -15 }, enterAfter: true });
    row(`P1.10.${tag}`, `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);
  }

  // Bezier endpoint <-> Line (both orders)
  for (const [tag, p1, p2] of [['b1->L1', { x: 0, y: 0 }, { x: 30, y: 40 }], ['L1->b1', { x: 30, y: 40 }, { x: 0, y: 0 }]]) {
    await openDesign(doc, { centre: { x: 30, y: 20 }, w: 200 });
    r = await pickSeq([p1, p2], { placeAt: { x: -15, y: 20 }, enterAfter: true });
    row(`P1.10.${tag}`, `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);
  }

  // Click Bezier control point c1 (20, 30)
  await openDesign(doc, { centre: { x: 30, y: 20 }, w: 200 });
  r = await pickSeq([{ x: 20, y: 30 }]);
  row('P1.10.bezierCtrlPt', `dims=${JSON.stringify(r.dims)} active=${r.pendingActive} toasts=${JSON.stringify(r.toasts)}`);
}

// ─── P1.11 GEOMETRY FROM FILLET / OFFSET / MIRROR / PATTERN ─────────────────
{
  // Fillet arc + virtual sharp V
  const docF = design(
    { a: [0, 0, true], b: [60, 0], c: [60, 50] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'vertical', joints: ['b', 'c'] }],
  );
  await openDesign(docF, { centre: { x: 30, y: 25 }, w: 200 });
  const appF = theApp();
  await quiet(() => { const corner = findCornerAtJoint(appF.state, 'b'); applyFillet(appF.state, corner, 10); });
  appF.frames();
  const filletArc = appF.state.shapes.find((s) => s.type === 'arc');
  const vId = filletArc && filletArc.filletSharp;
  const vPt = vId ? J(vId) : null;
  const fc = filletArc ? J(filletArc.joints[0]) : null;
  const fRim = fc ? { x: fc.x + 10 * Math.SQRT1_2, y: fc.y - 10 * Math.SQRT1_2 } : null;
  const rFilArc = fRim ? await pickSeq([fRim], { placeAt: { x: 75, y: -15 }, enterAfter: true }) : null;
  row('P1.11.filletArc', `arcId=${filletArc && filletArc.id} vPt=${pt(vPt)} dims=${JSON.stringify(rFilArc && rFilArc.dims)} labels=${JSON.stringify(rFilArc && rFilArc.labels)}`);

  // Virtual sharp V -> a and a -> V
  for (const [tag, p1, p2] of [['V->a', vPt, { x: 0, y: 0 }], ['a->V', { x: 0, y: 0 }, vPt]]) {
    await openDesign(docF, { centre: { x: 30, y: 25 }, w: 200 });
    await quiet(() => { const corner = findCornerAtJoint(theApp().state, 'b'); applyFillet(theApp().state, corner, 10); });
    theApp().frames();
    const r = await pickSeq([p1, p2], { placeAt: { x: 30, y: -20 }, enterAfter: true });
    row(`P1.11.filletSharp.${tag}`, `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);
  }

  // Offset pair: dimensioned vs undimensioned restore (src->off and off->src)
  const docO = design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }],
  );
  for (const [tag, p1, p2] of [['src->off', { x: 30, y: 0 }, { x: 30, y: 15 }], ['off->src', { x: 30, y: 15 }, { x: 30, y: 0 }]]) {
    await openDesign(docO, { centre: { x: 30, y: 10 }, w: 200 });
    const st = theApp().state;
    await quiet(() => { const oc = offsetChainOf(st, 'L1'); applyOffset(st, oc.chain, 15, 1); });
    const offC = st.constraints.find((c) => c.type === 'offset');
    const offL = st.shapes.find((s) => s.id !== 'L1');
    const oa = J(offL.joints[0]), ob = J(offL.joints[1]);
    const offMid = { x: (oa.x + ob.x) / 2, y: (oa.y + ob.y) / 2 };
    undimensionOffset(offC);
    theApp().frames();
    const pts = tag === 'src->off' ? [{ x: 30, y: 0 }, offMid] : [offMid, { x: 30, y: 0 }];
    const r = await pickSeq(pts, { placeAt: { x: 80, y: offMid.y / 2 }, enterAfter: true });
    row(`P1.11.offsetRestore.${tag}`, `offDimensioned=${offC && offC.dimensioned} dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);
  }

  // Mirror: source line, mirrored copy, mirror line
  const docM = design(
    { m1: [0, -50, true], m2: [0, 50, true], a: [20, 10], b: [50, 30] },
    [{ id: 'ML', type: 'line', joints: ['m1', 'm2'], isConstruction: true }, { id: 'L1', type: 'line', joints: ['a', 'b'] }],
  );
  await openDesign(docM, { centre: { x: 0, y: 15 }, w: 240 });
  await quiet(() => { mirrorObjects(theApp().state, mirrorObjectsOf(['L1'], []), 'ML'); });
  theApp().frames();
  const copyL = theApp().state.shapes.find((s) => s.id !== 'ML' && s.id !== 'L1');
  const ca = J(copyL.joints[0]), cb = J(copyL.joints[1]);
  const copyMid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  const rMirCopy = await pickSeq([copyMid], { placeAt: { x: copyMid.x, y: copyMid.y + 20 }, enterAfter: true });
  row('P1.11.mirrorCopyLen', `dims=${JSON.stringify(rMirCopy.dims)} labels=${JSON.stringify(rMirCopy.labels)}`);

  // Mirror: dimension source copy <-> mirror line (both orders) — click (0, 30) on ML, away from origin!
  for (const [tag, p1, p2] of [['L1->ML', { x: 35, y: 20 }, { x: 0, y: 30 }], ['ML->L1', { x: 0, y: 30 }, { x: 35, y: 20 }]]) {
    await openDesign(docM, { centre: { x: 0, y: 15 }, w: 240 });
    await quiet(() => { mirrorObjects(theApp().state, mirrorObjectsOf(['L1'], []), 'ML'); });
    theApp().frames();
    const r = await pickSeq([p1, p2], { placeAt: { x: 15, y: 40 }, enterAfter: true });
    row(`P1.11.mirrorAngle.${tag}`, `dims=${JSON.stringify(r.dims)} labels=${JSON.stringify(r.labels)}`);
  }

  // Pattern: source line vs copy line
  const docP = design(
    { a: [0, 0, true], b: [20, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'horizontal', joints: ['a', 'b'] }],
  );
  await openDesign(docP, { centre: { x: 40, y: 10 }, w: 220 });
  await quiet(() => {
    applyPattern(theApp().state, CONSTRAINT_TYPES.RECTANGULAR_PATTERN, patternObjectsOf(['L1'], []), {
      ...patternDefaults(CONSTRAINT_TYPES.RECTANGULAR_PATTERN, 'mm'),
      quantity: [3, 1], distance: [35, 10], distanceType: 'spacing',
    });
  });
  theApp().frames();
  const patCopy = theApp().state.shapes.find((s) => s.id !== 'L1');
  const pa = J(patCopy.joints[0]), pb = J(patCopy.joints[1]);
  const rPatSrc = await pickSeq([{ x: 10, y: 0 }], { placeAt: { x: 10, y: -15 }, enterAfter: true });
  const rPatCopy = await pickSeq([{ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }], { placeAt: { x: (pa.x + pb.x) / 2, y: -15 }, enterAfter: true });
  row('P1.11.pattern', `srcDims=${JSON.stringify(rPatSrc.dims)} afterCopyDims=${JSON.stringify(rPatCopy.dims)} labels=${JSON.stringify(rPatCopy.labels)}`);
}

// ─── P1.12 PLACEMENT GESTURES: DRAG-RELEASE (>250ms) & LABEL DRAG ───────────
{
  // 1) Press-drag-release (>300ms hold AFTER move) on a diagonal line -> does it open edit box? update H/V?
  const doc = design({ a: [0, 0, true], b: [30, 40] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  await openDesign(doc, { centre: { x: 20, y: 20 }, w: 200 });
  const app = theApp();
  app.tool('dim');
  const pStart = app.toScreen(15, 20);
  const pEnd = app.toScreen(40, 65); // past top end -> horizontal (30)
  await quiet(async () => {
    app.move(pStart.x, pStart.y);
    app.down(pStart.x, pStart.y);
    app.move(pEnd.x, pEnd.y, { buttons: 1 }); // note: >6px move resets startTime in pendingPointer branch!
    await app.pause(300);
    app.move(pEnd.x + 2, pEnd.y, { buttons: 1 });
    app.up(pEnd.x + 2, pEnd.y);
  });
  app.frames();
  row('P1.12.dragRelease', `placing=${!!app.state.placingConstraint} boxOpen=${boxOpen()} dims=${JSON.stringify(allDims().map(dimSummary))} newlyPlaced=${allDims()[0] && allDims()[0].__newlyPlaced}`);

  // 2) Press-drag-release (>300ms) on FULLY FIXED endpoints -> does it mark driven?
  const docFix = design({ a: [0, 0, true], b: [50, 0, true] }, [{ id: 'L1', type: 'line', joints: ['a', 'b'] }]);
  await openDesign(docFix, { centre: { x: 25, y: 0 }, w: 200 });
  const appFix = theApp();
  appFix.tool('dim');
  const fStart = appFix.toScreen(25, 0);
  const fEnd = appFix.toScreen(25, -20);
  await quiet(async () => {
    appFix.move(fStart.x, fStart.y);
    appFix.down(fStart.x, fStart.y);
    appFix.move(fEnd.x, fEnd.y, { buttons: 1 });
    await appFix.pause(300);
    appFix.move(fEnd.x + 2, fEnd.y, { buttons: 1 });
    appFix.up(fEnd.x + 2, fEnd.y);
  });
  appFix.frames();
  row('P1.12.dragReleaseFixed', `placing=${!!appFix.state.placingConstraint} boxOpen=${boxOpen()} dims=${JSON.stringify(allDims().map(dimSummary))} labels=${JSON.stringify(allDims().map(labelTextOf))}`);

  // 3) Label drag after placement: Select tool vs Dimension tool!
  const docDrag = design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', joints: ['a', 'b'], value: 60, dimMode: 'horizontal', offset: -20, name: 'd1' }],
  );
  for (const toolName of ['select', 'dim']) {
    await openDesign(docDrag, { centre: { x: 30, y: 0 }, w: 200 });
    const appD = theApp();
    appD.tool(toolName);
    const c = allDims()[0];
    const g0 = { ...c.glyphPos };
    const view0 = { x: appD.state.view.x, y: appD.state.view.y };
    const h0 = appD.state.history.length;
    const p0 = appD.toScreen(g0.x, g0.y);
    const p1 = appD.toScreen(g0.x + 25, g0.y - 25);
    const el = () => labelEl(appD, 0);
    await quiet(() => {
      appD.move(p0.x, p0.y, { target: el });
      appD.down(p0.x, p0.y, { target: el });
      for (let k = 1; k <= 10; k++) {
        appD.move(p0.x + (p1.x - p0.x) * k / 10, p0.y + (p1.y - p0.y) * k / 10, { buttons: 1 });
      }
      appD.up(p1.x, p1.y);
    });
    appD.frames();
    const g1 = { ...c.glyphPos };
    const view1 = { x: appD.state.view.x, y: appD.state.view.y };
    row(`P1.12.labelDrag.${toolName}`, `g0=${pt(g0)} g1=${pt(g1)} off=${f(c.offset, 1)} slide=${f(c.labelSlide, 1)} viewDelta=(${f(view1.x - view0.x, 1)},${f(view1.y - view0.y, 1)}) undoDelta=${appD.state.history.length - h0}`);
  }
  // 4) Check consequences of state.active leak after P->P and P->C1rim
  const docLeak = design(
    { p1: [-40, 20], p2: [-10, 20], p3: [50, 30], cc: [20, -25] },
    [{ id: 'C1', type: 'circle', joints: ['cc'], radius: 15 }],
  );
  await openDesign(docLeak, { centre: { x: 10, y: 10 }, w: 240 });
  const appL = theApp();
  appL.tool('dim');
  await clickW({ x: -40, y: 20 }); // p1
  await clickW({ x: -10, y: 20 }); // p2 -> creates P->P dim
  await clickW({ x: -25, y: 35 }); // place
  if (boxOpen()) { await quiet(() => appL.enter()); appL.frames(); }
  const activeAfterPP = appL.state.active ? { mode: appL.state.active.mode, joints: appL.state.active.joints } : null;
  // Now hover near empty space — does rubber band stay?
  await moveW({ x: 30, y: 50 });
  const activeAfterHover = appL.state.active ? { mode: appL.state.active.mode, preview: appL.state.active.preview } : null;
  // Now test P -> Circle rim -> then click p3! Does leaked pendingDimension hijack the next click?!
  await openDesign(docLeak, { centre: { x: 10, y: 10 }, w: 240 });
  const appL2 = theApp();
  appL2.tool('dim');
  await clickW({ x: -40, y: 20 }); // p1 (starts pendingDimension)
  await clickW({ x: 35, y: -25 }); // C1 rim (falls through to startShapeDimension -> R 15!)
  await clickW({ x: 45, y: -40 }); // drop R 15
  if (boxOpen()) { await quiet(() => appL2.enter()); appL2.frames(); }
  const dimsAfterPC = allDims().map(dimSummary);
  await clickW({ x: 50, y: 30 }); // click p3 (user thinks they're starting a new dim!)
  const dimsAfterNextClick = allDims().map(dimSummary);
  row('P1.12.activeLeak', `afterPP=${JSON.stringify(activeAfterPP)} afterHover=${JSON.stringify(activeAfterHover)} || P->C1rim->p3: afterPC=${JSON.stringify(dimsAfterPC)} afterNextClickP3=${JSON.stringify(dimsAfterNextClick)}`);
}

await closeAll();
process.exit(0);

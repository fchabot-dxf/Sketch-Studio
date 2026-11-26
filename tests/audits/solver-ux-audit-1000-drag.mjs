// tests/audits/solver-ux-audit-1000-drag.mjs -- TASK 1000 (AUDIT, outside the gate; run: node tests/audits/solver-ux-audit-1000-drag.mjs)
// DRAG: under-/fully-/over-constrained sketches, branch/side flips, singular configs, sticking/lag, wrong fixed sets, and drag irregularities.
import { design, openDesign, closeAll, J, dist, snapshot, moved, movedText, residualText, statusText, dragWorld, dragJoint, row, f, pt, quiet, toasts, clearToasts, theApp } from './solver-ux-audit-1000-kit.js';
import { applyFillet, findCornerAtJoint } from '#core/fillet.js';
import { mirrorObjects } from '#core/mirror.js';

const D = (a, b, value, name, extra = {}) => ({ type: 'distance', joints: [a, b], value, name, ...extra });
const H = (a, b) => ({ type: 'horizontal', joints: [a, b] });
const V = (a, b) => ({ type: 'vertical', joints: [a, b] });

const RECT = (extra = []) => design(
  { a: [0, 0, true], b: [80, 0], c: [80, 40], d: [0, 40] },
  [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }],
  [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a'), D('a', 'b', 80, 'd1'), D('b', 'c', 40, 'd2'), ...extra]);

await (async () => {
  // ---- DR1: Under-constrained drags (line end/body, circle centre/rim, arc centre/end/rim, bezier end/body)
  let app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [D('a', 'b', 60, 'd1')]), { centre: { x: 30, y: 0 }, w: 240 });
  {
    const d1 = await dragJoint('b', { x: 30, y: 51.96 }, 20);
    row('DR1.1', `1-DOF line end b dragged (60,0)->(30,51.96): kind=${d1.kind}, b=${pt(J('b'))}, |ab|=${f(dist(J('a'), J('b')))}, constraints=${app.state.constraints.map((c) => c.type)}, ${residualText()}`);
    const d2 = await dragWorld({ x: (J('a').x + J('b').x) / 2, y: (J('a').y + J('b').y) / 2 }, { x: 45, y: 10 }, 20);
    row('DR1.2', `1-DOF line BODY dragged toward (45,10): kind=${d2.kind}, b=${pt(J('b'))}, |ab|=${f(dist(J('a'), J('b')))}, ${residualText()}`);
  }

  // Free circle: drag centre vs drag rim
  app = await openDesign(design(
    { c: [20, 20] },
    [{ id: 'C1', type: 'circle', joints: ['c'], radius: 25 }]), { centre: { x: 20, y: 20 }, w: 240 });
  {
    const c1 = () => app.state.shapes.find((s) => s.id === 'C1');
    const r0 = c1().radius;
    const d1 = await dragWorld({ x: 45, y: 20 }, { x: 65, y: 20 }, 20);
    row('DR1.3', `free circle RIM drag (45,20)->(65,20): kind=${d1.kind}, c=${pt(J('c'))}, r ${f(r0)}->${f(c1().radius)}`);
    const d2 = await dragJoint('c', { x: 50, y: 40 }, 20);
    row('DR1.4', `free circle CENTRE drag (20,20)->(50,40): kind=${d2.kind}, c=${pt(J('c'))}, r=${f(c1().radius)}`);
  }

  // Bezier: drag end joint vs drag body (control points follow?)
  app = await openDesign(design(
    { a: [0, 0], b: [80, 0] },
    [{ id: 'B1', type: 'bezier', joints: ['a', 'b'], c1: [20, 40], c2: [60, 40] }]), { centre: { x: 40, y: 20 }, w: 260 });
  {
    const bz = () => app.state.shapes.find((s) => s.id === 'B1');
    const c1_0 = [...bz().c1], c2_0 = [...bz().c2];
    const dEnd = await dragJoint('a', { x: 20, y: 20 }, 15);
    const c1_1 = [...bz().c1], c2_1 = [...bz().c2];
    row('DR1.5', `bezier END a dragged (+20,+20): kind=${dEnd.kind}, a=${pt(J('a'))}, c1 ${JSON.stringify(c1_0)}->${JSON.stringify(c1_1)} (delta ${f(c1_1[0]-c1_0[0])},${f(c1_1[1]-c1_0[1])}), c2 ${JSON.stringify(c2_0)}->${JSON.stringify(c2_1)}`);
    // Drag body at midpoint on curve (t=0.5: x=50, y=35 roughly)
    const a0 = J('a'), b0 = J('b');
    const midX = 0.125 * a0.x + 0.375 * c1_1[0] + 0.375 * c2_1[0] + 0.125 * b0.x;
    const midY = 0.125 * a0.y + 0.375 * c1_1[1] + 0.375 * c2_1[1] + 0.125 * b0.y;
    const dBody = await dragWorld({ x: midX, y: midY }, { x: midX + 30, y: midY + 10 }, 15);
    const c1_2 = [...bz().c1], c2_2 = [...bz().c2];
    row('DR1.6', `bezier BODY dragged (+30,+10): kind=${dBody.kind}, a=${pt(J('a'))}, b=${pt(J('b'))}, c1 delta (${f(c1_2[0]-c1_1[0])},${f(c1_2[1]-c1_1[1])}), c2 delta (${f(c2_2[0]-c2_1[0])},${f(c2_2[1]-c2_1[1])})`);
  }

  // ---- DR2: Fully-constrained drags — drift AND redoStack preservation!
  app = await openDesign(RECT(), { centre: { x: 40, y: 20 }, w: 240 });
  {
    // First make an undoable change so we can test redoStack survival!
    const before = snapshot();
    const d1 = await dragJoint('c', { x: 140, y: 90 }, 20);
    row('DR2.1', `0-DOF rect corner c dragged (80,40)->(140,90): kind=${d1.kind}, ${movedText(before)}, hist=${app.state.history.length}, ${residualText()}`);
    const before2 = snapshot();
    const d2 = await dragWorld({ x: 80, y: 20 }, { x: 140, y: 20 }, 20);
    row('DR2.2', `0-DOF rect edge L2 BODY dragged (80,20)->(140,20): kind=${d2.kind}, ${movedText(before2)}, hist=${app.state.history.length}, ${residualText()}`);
  }
  // Test redoStack survival when dragging a 0-DOF item!
  app = await openDesign(design(
    { a: [0, 0, true], b: [80, 0], c: [80, 40], d: [0, 40], free1: [120, 20], free2: [150, 20] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'd'] }, { id: 'L4', type: 'line', joints: ['d', 'a'] }, { id: 'L5', type: 'line', joints: ['free1', 'free2'] }],
    [H('a', 'b'), V('b', 'c'), H('c', 'd'), V('d', 'a'), D('a', 'b', 80, 'd1'), D('b', 'c', 40, 'd2')]), { centre: { x: 75, y: 20 }, w: 300 });
  {
    await dragJoint('free2', { x: 150, y: 50 }, 10);
    await quiet(async () => app.undo());
    const redoBefore = app.state.redoStack.length;
    const histBefore = app.state.history.length;
    const before = snapshot();
    await dragJoint('c', { x: 120, y: 80 }, 15); // drag fully-constrained corner c (0 DOF)
    const redoAfter = app.state.redoStack.length;
    const histAfter = app.state.history.length;
    row('DR2.3', `drag 0-DOF corner c while redoStack had ${redoBefore} item(s): ${movedText(before)}, hist ${histBefore}->${histAfter}, redoStack ${redoBefore}->${redoAfter}`);
  }

  // ---- DR3: Over-constrained / conflicted sketch loaded with contradictory distances, then dragged
  app = await openDesign(design(
    { a: [0, 0, true], b: [50, 0], c: [50, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }, { id: 'L3', type: 'line', joints: ['c', 'a'] }],
    [H('a', 'b'), D('a', 'b', 50, 'd1'), D('b', 'c', 40, 'd2'), D('c', 'a', 120, 'd3')]), { centre: { x: 25, y: 20 }, w: 220 });
  {
    const before = snapshot();
    row('DR3.0', `conflicted triangle (50,40,120) loaded: a=${pt(J('a'))} b=${pt(J('b'))} c=${pt(J('c'))}, ${residualText()}, ${statusText()}`);
    const d1 = await dragJoint('c', { x: 90, y: 60 }, 20);
    row('DR3.1', `conflicted triangle c dragged (50,40)->(90,60): kind=${d1.kind}, c=${pt(J('c'))}, ${movedText(before)}, ${residualText()}`);
  }

  // ---- DR4: Branch flips & side flips during drag
  // DR4.1: Arc dragged past 180 deg, near 0 deg, near 360 deg
  app = await openDesign(design(
    { c: [0, 0, true], s: [40, 0, true], e: [0, 40] },
    [{ id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true }],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }]), { centre: { x: 0, y: 0 }, w: 200 });
  {
    const arc = () => app.state.shapes.find((s) => s.id === 'A1');
    const angOf = () => { const e = J('e'); return Math.atan2(e.y, e.x) * 180 / Math.PI; };
    const sw0 = arc().sweep;
    await dragJoint('e', { x: -40, y: 0 }, 20);
    const at180 = { e: pt(J('e')), ang: f(angOf(), 1), sweep: arc().sweep, r: f(dist(J('c'), J('e'))) };
    await dragJoint('e', { x: 0, y: -40 }, 20);
    const at270 = { e: pt(J('e')), ang: f(angOf(), 1), sweep: arc().sweep, r: f(dist(J('c'), J('e'))) };
    await dragJoint('e', { x: 39.8, y: -3 }, 20);
    const at355 = { e: pt(J('e')), ang: f(angOf(), 1), sweep: arc().sweep, r: f(dist(J('c'), J('e'))) };
    await dragJoint('e', { x: 39.8, y: 3 }, 20);
    const cross0 = { e: pt(J('e')), ang: f(angOf(), 1), sweep: arc().sweep, r: f(dist(J('c'), J('e'))), constraints: app.state.constraints.map((c) => `${c.type}:${(c.joints || []).join(',')}`) };
    row('DR4.1', `arc drag sweep=${sw0}: at180=${JSON.stringify(at180)} at270=${JSON.stringify(at270)} at355=${JSON.stringify(at355)} cross0=${JSON.stringify(cross0)} ${residualText()}`);
  }

  // DR4.2: Fillet arc + drag corner open near 180 deg + arc midpoint on fillet near 180 deg (NEW-11)
  app = await openDesign(design(
    { a: [0, 0, true], b: [50, 0], c: [50, 50] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }],
    [H('a', 'b'), D('a', 'b', 50, 'd1'), D('b', 'c', 50, 'd2')]), { centre: { x: 35, y: 20 }, w: 220 });
  {
    const corner = findCornerAtJoint(app.state, 'b');
    const fr = applyFillet(app.state, corner, 10);
    const arc = app.state.shapes.find((s) => s.type === 'arc');
    row('DR4.2a', `fillet created: success=${fr && fr.success}, arc.sweep=${arc && arc.sweep}, constraints=${app.state.constraints.length}, ${residualText()}`);
    // Drag c down toward (100, 1) (corner opening toward 180 deg) and across y=-10!
    await dragJoint('c', { x: 99, y: 5 }, 25);
    const near180 = { c: pt(J('c')), arcC: pt(J(arc.joints[0])), arcS: pt(J(arc.joints[1])), arcE: pt(J(arc.joints[2])), res: residualText() };
    await dragJoint('c', { x: 95, y: -15 }, 25);
    const past180 = { c: pt(J('c')), arcC: pt(J(arc.joints[0])), arcS: pt(J(arc.joints[1])), arcE: pt(J(arc.joints[2])), res: residualText() };
    row('DR4.2b', `fillet leg dragged near/past 180: near180=${JSON.stringify(near180)}; past180=${JSON.stringify(past180)}`);
  }

  // DR4.3: Mirror / symmetric: drag original ACROSS the mirror line (fixed mirror line vs free mirror line)
  app = await openDesign(design(
    { m1: [0, -50, true], m2: [0, 50, true], a: [30, 10], b: [60, 30] },
    [{ id: 'ML', type: 'line', joints: ['m1', 'm2'], isConstruction: true }, { id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 0, y: 10 }, w: 260 });
  {
    const mr = mirrorObjects(app.state, { shapes: ['L1'], joints: [] }, 'ML');
    const copy = app.state.shapes.find((s) => s.id === mr.shapes[0]);
    const [ca, cb] = copy.joints;
    await dragJoint('a', { x: -30, y: 10 }, 20);
    row('DR4.3a', `mirror across FIXED line ML, drag a (30,10)->(-30,10): a=${pt(J('a'))}, copy a'=${pt(J(ca))} (expected (+30,10)), b=${pt(J('b'))}, b'=${pt(J(cb))}, ${residualText()}`);
  }
  // Free mirror line: drag original line end vs edit dimension on original
  app = await openDesign(design(
    { m1: [0, -50], m2: [0, 50], a: [30, 10], b: [60, 10] },
    [{ id: 'ML', type: 'line', joints: ['m1', 'm2'], isConstruction: true }, { id: 'L1', type: 'line', joints: ['a', 'b'] }]), { centre: { x: 0, y: 10 }, w: 260 });
  {
    const mr = mirrorObjects(app.state, { shapes: ['L1'], joints: [] }, 'ML');
    const m1_0 = J('m1'), m2_0 = J('m2');
    await dragJoint('a', { x: 40, y: 35 }, 20);
    row('DR4.3b', `mirror about FREE line ML, drag a (30,10)->(40,35): ML m1 ${pt(m1_0)}->${pt(J('m1'))}, m2 ${pt(m2_0)}->${pt(J('m2'))}, ${residualText()}`);
  }

  // DR4.4: Tangent circle-circle (internal & external) and line-circle dragged across
  app = await openDesign(design(
    { c1: [0, 0, true], c2: [50, 0] },
    [{ id: 'C1', type: 'circle', joints: ['c1'], radius: 30 }, { id: 'C2', type: 'circle', joints: ['c2'], radius: 20 }],
    [{ type: 'distance', shape: 'C1', value: 30, isRadius: true, name: 'd1' }, { type: 'distance', shape: 'C2', value: 20, isRadius: true, name: 'd2' }, { type: 'tangent', shapes: ['C1', 'C2'], branch: 'external' }]), { centre: { x: 25, y: 0 }, w: 240 });
  {
    await dragJoint('c2', { x: -50, y: 5 }, 25);
    const dExt = dist(J('c1'), J('c2'));
    row('DR4.4a', `external tangent C1(R30)-C2(R20), drag c2 across C1 to (-50,5): c2=${pt(J('c2'))}, |c1c2|=${f(dExt)} (expected 50), ${residualText()}`);
  }
  app = await openDesign(design(
    { c1: [0, 0, true], c2: [10, 0] },
    [{ id: 'C1', type: 'circle', joints: ['c1'], radius: 30 }, { id: 'C2', type: 'circle', joints: ['c2'], radius: 20 }],
    [{ type: 'distance', shape: 'C1', value: 30, isRadius: true, name: 'd1' }, { type: 'distance', shape: 'C2', value: 20, isRadius: true, name: 'd2' }, { type: 'tangent', shapes: ['C1', 'C2'], branch: 'internal' }]), { centre: { x: 0, y: 0 }, w: 240 });
  {
    await dragJoint('c2', { x: 60, y: 0 }, 25);
    const dInt = dist(J('c1'), J('c2'));
    row('DR4.4b', `internal tangent C1(R30)-C2(R20), pull c2 outside to (60,0): c2=${pt(J('c2'))}, |c1c2|=${f(dInt)} (expected 10), ${residualText()}`);
  }
  // Line tangent to fixed circle: drag line across centre
  app = await openDesign(design(
    { c1: [0, 0, true], a: [-40, 25], b: [40, 25] },
    [{ id: 'C1', type: 'circle', joints: ['c1'], radius: 25 }, { id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'distance', shape: 'C1', value: 25, isRadius: true, name: 'd1' }, H('a', 'b'), { type: 'tangent', line: 'L1', circle: 'C1' }]), { centre: { x: 0, y: 0 }, w: 220 });
  {
    await dragWorld({ x: 0, y: 25 }, { x: 0, y: -35 }, 25);
    row('DR4.4c', `H line tangent to fixed C1(R25) at y=+25, dragged to y=-35: a=${pt(J('a'))}, b=${pt(J('b'))} (flipped side?), ${residualText()}`);
  }

  // DR4.5: Perpendicular lines (handedness branch lock) dragged past 180
  app = await openDesign(design(
    { a: [0, 0, true], b: [50, 0, true], c: [0, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['a', 'c'] }],
    [D('a', 'c', 40, 'd1'), { type: 'perpendicular', shapes: ['L1', 'L2'], branch: 1 }]), { centre: { x: 20, y: 10 }, w: 220 });
  {
    await dragJoint('c', { x: 0, y: -40 }, 25);
    row('DR4.5', `perp L2 (branch +1, y=+40) dragged to y=-40: c=${pt(J('c'))} (expected stays y=+40 if locked), ${residualText()}`);
  }

  // ---- DR5: Singular configs (2-bar straight, tiny line, arc near 0/360)
  app = await openDesign(design(
    { a: [0, 0, true], b: [30, 0], c: [70, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }],
    [D('a', 'b', 30, 'd1'), D('b', 'c', 40, 'd2')]), { centre: { x: 35, y: 0 }, w: 220 });
  {
    const d1 = await dragJoint('c', { x: 50, y: 30 }, 25);
    row('DR5.1', `straight 2-bar linkage (30+40=70) c dragged to (50,30): kind=${d1.kind}, b=${pt(J('b'))}, c=${pt(J('c'))}, |ab|=${f(dist(J('a'), J('b')))}, |bc|=${f(dist(J('b'), J('c')))}, ${residualText()}`);
  }

  // ---- DR6: Sticking, lag, wrong fixed sets, and drag irregularities
  // DR6.1: Point on regular fixed line vs Point on built-in X axis (ref_axis_x)
  app = await openDesign(design(
    { a: [-50, 0, true], b: [100, 0, true], p: [10, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['p', 'q'] }],
    [{ type: 'pointOnLine', joint: 'p', shape: 'L1' }]), { centre: { x: 30, y: 0 }, w: 260 });
  // wait: q needs to exist!
  app = await openDesign(design(
    { a: [-50, 0, true], b: [100, 0, true], p: [10, 0], q: [10, 30] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['p', 'q'] }],
    [{ type: 'pointOnLine', joint: 'p', shape: 'L1' }]), { centre: { x: 30, y: 10 }, w: 260 });
  {
    await dragJoint('p', { x: 70, y: 40 }, 15);
    row('DR6.1a', `point p on fixed line L1 dragged (10,0)->(70,40): p=${pt(J('p'))} (expected (70,0)), ${residualText()}`);
  }
  app = await openDesign(design(
    { p: [10, 0], q: [10, 30] },
    [{ id: 'L2', type: 'line', joints: ['p', 'q'] }],
    [{ type: 'pointOnLine', joint: 'p', shape: 'ref_axis_x' }]), { centre: { x: 30, y: 10 }, w: 260 });
  {
    await dragJoint('p', { x: 70, y: 40 }, 15);
    row('DR6.1b', `point p on built-in ref_axis_x dragged (10,0)->(70,40): p=${pt(J('p'))} (expected (70,0)), ${residualText()}`);
  }

  // DR6.2: Fast 1-step flick (200 mm in 1 pointermove) — JOINT drag vs BODY drag (line, circle rim, arc rim)
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [D('a', 'b', 60, 'd1')]), { centre: { x: 30, y: 0 }, w: 300 });
  {
    await dragJoint('b', { x: -60, y: 10 }, 1); // 1 step fast flick!
    row('DR6.2a', `FAST 1-step flick JOINT b (60,0)->(-60,10): b=${pt(J('b'))}, |ab|=${f(dist(J('a'), J('b')))}, ${residualText()}`);
  }
  app = await openDesign(design(
    { a: [0, 0, true], b: [60, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [D('a', 'b', 60, 'd1')]), { centre: { x: 30, y: 0 }, w: 300 });
  {
    await dragWorld({ x: 30, y: 0 }, { x: -30, y: 10 }, 1); // 1 step fast flick on BODY!
    row('DR6.2b', `FAST 1-step flick BODY L1 (30,0)->(-30,10): b=${pt(J('b'))}, |ab|=${f(dist(J('a'), J('b')))}, ${residualText()}`);
  }
  // Constrained 2-bar linkage fast 1-step flick: joint vs body
  app = await openDesign(design(
    { a: [0, 0, true], b: [40, 0], c: [40, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }],
    [D('a', 'b', 40, 'd1'), D('b', 'c', 40, 'd2')]), { centre: { x: 20, y: 20 }, w: 320 });
  {
    await dragJoint('c', { x: -40, y: -40 }, 1);
    row('DR6.2c', `FAST 1-step flick 2-bar JOINT c (40,40)->(-40,-40): b=${pt(J('b'))}, c=${pt(J('c'))}, ${residualText()}`);
  }
  app = await openDesign(design(
    { a: [0, 0, true], b: [40, 0], c: [40, 40] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['b', 'c'] }],
    [D('a', 'b', 40, 'd1'), D('b', 'c', 40, 'd2')]), { centre: { x: 20, y: 20 }, w: 320 });
  {
    await dragWorld({ x: 40, y: 20 }, { x: -40, y: -20 }, 1);
    row('DR6.2d', `FAST 1-step flick 2-bar BODY L2 (40,20)->(-40,-20): b=${pt(J('b'))}, c=${pt(J('c'))}, ${residualText()}`);
  }

  // DR6.3: Multi-select group drag: ONE fixed shape + ONE free shape selected together!
  app = await openDesign(design(
    { a: [0, 0, true], b: [40, 0, true], p: [60, 20], q: [100, 20] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }, { id: 'L2', type: 'line', joints: ['p', 'q'] }]), { centre: { x: 50, y: 10 }, w: 260 });
  {
    app.state.selectedShapes.add('L1'); app.state.selectedShapes.add('L2');
    const before = snapshot();
    const d1 = await dragWorld({ x: 80, y: 20 }, { x: 80, y: 60 }, 15);
    row('DR6.3a', `multi-select (fixed L1 + free L2), drag free L2 (+0,+40): kind=${d1.kind}, p=${pt(J('p'))}, q=${pt(J('q'))}, ${movedText(before)}`);
    // Contrast: select only free L2 and drag
    app.state.selectedShapes.clear();
    const before2 = snapshot();
    const d2 = await dragWorld({ x: 80, y: 20 }, { x: 80, y: 60 }, 15);
    row('DR6.3b', `single free L2 dragged (+0,+40): kind=${d2.kind}, p=${pt(J('p'))}, q=${pt(J('q'))}, ${movedText(before2)}`);
  }

  // DR6.4: Arc centre coincident with a line end — drag the line end (coincident with arc centre) vs drag the arc centre itself!
  app = await openDesign(design(
    { c: [20, 20], s: [50, 20], e: [20, 50], p: [20, 20], q: [-10, 20] },
    [{ id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true }, { id: 'L1', type: 'line', joints: ['p', 'q'] }],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }, { type: 'coincident', joints: ['c', 'p'] }]), { centre: { x: 20, y: 20 }, w: 240 });
  {
    const r0 = dist(J('c'), J('s'));
    // Note: clicking at (20,20) hits whichever joint comes first in Map ('c') vs if 'p' comes first!
    const d1 = await dragJoint('c', { x: 40, y: 40 }, 15);
    const r1 = dist(J('c'), J('s'));
    row('DR6.4a', `arc centre 'c' first in map, coincident with line end 'p', drag (+20,+20): kind=${d1.kind}, c=${pt(J('c'))}, s=${pt(J('s'))}, e=${pt(J('e'))}, r ${f(r0)}->${f(r1)}`);
  }
  app = await openDesign(design(
    { p: [20, 20], q: [-10, 20], c: [20, 20], s: [50, 20], e: [20, 50] },
    [{ id: 'L1', type: 'line', joints: ['p', 'q'] }, { id: 'A1', type: 'arc', joints: ['c', 's', 'e'], sweep: true }],
    [{ type: 'equal', joints: ['c', 's', 'c', 'e'] }, { type: 'coincident', joints: ['p', 'c'] }]), { centre: { x: 20, y: 20 }, w: 240 });
  {
    const r0 = dist(J('c'), J('s'));
    const d2 = await dragJoint('p', { x: 40, y: 40 }, 15);
    const r2 = dist(J('c'), J('s'));
    row('DR6.4b', `line end 'p' first in map, coincident with arc centre 'c', drag (+20,+20): kind=${d2.kind}, c=${pt(J('c'))}, s=${pt(J('s'))}, e=${pt(J('e'))}, r ${f(r0)}->${f(r2)}`);
  }

  // DR6.5: Dragging a midpoint-constrained point vs dragging the line's endpoints
  app = await openDesign(design(
    { a: [0, 0, true], b: [80, 0], m: [40, 0] },
    [{ id: 'L1', type: 'line', joints: ['a', 'b'] }],
    [{ type: 'midpoint', joints: ['a', 'b', 'm'] }]), { centre: { x: 40, y: 0 }, w: 240 });
  {
    await dragJoint('m', { x: 60, y: 20 }, 15);
    row('DR6.5', `drag midpoint m (40,0)->(60,20) with a fixed: a=${pt(J('a'))}, m=${pt(J('m'))}, b=${pt(J('b'))} (expected (120,40)), ${residualText()}`);
  }

  await closeAll();
})();
console.log('solver-ux-audit-1000-drag.mjs: printed (exit 0 whatever the rows say)');

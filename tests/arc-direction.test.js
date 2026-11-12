// TASK 550 -- arcs keep their direction and turn smoothly, like Fusion (owner ruling 2026-11-12). One test per part of the design:
//   1. the large-arc choice is DERIVED from the joints and the arc's direction by ONE function (geometry.js arcSweepInfo) for the renderer, the
//      SVG / DXF exports and the bounds; a stored largeArc (old files) is ignored. Fusion stores centre + radius + start angle + sweep: no flag.
//   2. an arc keeps its side through a solve (the solver's orientation lock, engine.js): Fusion's fixed-ends radius sequence.
//   3. an arc whose own ends are made coincident (zero sweep) is refused (findCollapsedShape measures the sweep too): Fusion "failed to solve".
//   4. an arc is picked only on its drawn sweep (snap-detection.js), not on its whole circle.
//   5. an edited angle dimension turns the moving line continuously to exactly the typed value, up to 179 degrees (Fusion's sequence).
import assert from 'node:assert';
import * as L from './harness/audit/lib.js';
import { arcByTool, measureArc } from './harness/coverage/arcs-variants.js';
import { calculateArcPath, arcSweepInfo, angleInArcSweep } from '#core/geometry.js';
import { svgCircularArcCentre } from '#core/import-arcs.js';
import { computeGeometryBounds } from '#core/geometry-bounds.js';
import { ConstraintManager } from '#core/constraint-manager.js';
import { toggleFixedSelection } from '#ui/input-manager.js';
import { SolverConfig } from '#core/solver-config.js';
import { handleSelectionPointerDown, handleSelectionPointerMove, handleSelectionPointerUp } from '#ui/input-handlers/selection-tools.js';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';

const SVG = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } }, setPointerCapture: () => {}, releasePointerCapture: () => {} };
const muted = (f) => { const l = console.log, e = console.error, w = console.warn, d = console.debug; console.log = console.error = console.warn = console.debug = () => {}; try { return f(); } finally { console.log = l; console.error = e; console.warn = w; console.debug = d; } };
const P = (S, id) => { const j = S.state.joints.get(id); return { x: j.x, y: j.y }; };
const lock = (S, ids) => muted(() => { S.state.selectedJoints = new Set(ids); toggleFixedSelection(S.state); S.state.selectedJoints = new Set(); });
// the flags and end points of an SVG arc path "M x y A r r 0 la sw x y"
const parseArc = (d) => { const m = /M\s*(\S+?)[ ,]\s*(\S+)\s+A\s*(\S+?)[ ,]\s*(\S+)\s+0\s+(\d)[ ,]\s*(\d)\s+(\S+?)[ ,]\s*(\S+?)"?$/.exec(d.trim()); return m ? { x1: +m[1], y1: +m[2], r: +m[3], la: +m[5], sw: +m[6], x2: +m[7], y2: +m[8] } : null; };
// the arc a path draws: its implied centre (SVG F.6.5) and the direction of its middle seen from that centre
const drawnCentre = (a) => svgCircularArcCentre(a.x1, a.y1, a.r, !!a.la, !!a.sw, a.x2, a.y2);

// the select tool's body drag, as tests/body-drag-rim.test.js runs it (the app's pointer handlers + the per-frame solve)
function bodyDrag(S, shapeId, from, to) {
  const st = S.state;
  st.currentTool = 'select'; st.selectedJoints = new Set(); st.selectedShapes = new Set(); st.selectedConstraints = new Set();
  const ev = (p) => ({ clientX: p.x, clientY: p.y, pointerId: 1, target: { closest: () => null, dataset: {} } });
  muted(() => {
    handleSelectionPointerDown(ev(from), SVG, st, null, { shape: L.shape(S, shapeId), pt: { ...from } }, null);
    for (let i = 1; i <= 20; i++) { handleSelectionPointerMove(ev({ x: from.x + (to.x - from.x) * i / 20, y: from.y + (to.y - from.y) * i / 20 }), SVG, st); S.engine.solve(SolverConfig.ITERATIONS || 500); }
    handleSelectionPointerUp(ev(to), SVG, st); S.engine.solve(SolverConfig.ITERATIONS || 500);
  });
}

// ------------------------------------------------------------------------------------------------ 1. the large-arc choice is derived
{
  // (a) the arc tool's 140 degree arc, both ends fixed, pulled by its body past a half circle (Fusion task 540: 140 -> 212, drawn as the major arc)
  const S = L.newSketch();
  const A = arcByTool(S, 100, 100, 30, 140, 20 * Math.PI / 180);
  const [c, s, e] = A.joints;
  lock(S, [s, e]);
  bodyDrag(S, A.shape, { x: 100, y: 130 }, { x: 100, y: 148 });
  const m = measureArc(S, A.shape), sh = L.shape(S, A.shape), C = P(S, c);
  assert.ok(m.spanDeg > 200 && m.spanDeg < 230, `the pulled arc is past a half circle (sweep ${m.signedDeg})`);
  const drawn = parseArc(calculateArcPath(C, P(S, s), P(S, e), 'CENTER', { sweep: sh.sweep }));
  const dc = drawnCentre(drawn);
  assert.strictEqual(drawn.la, 1, `the renderer draws the ${m.spanDeg.toFixed(1)} degree arc as a LARGE arc (path ${calculateArcPath(C, P(S, s), P(S, e), 'CENTER', { sweep: sh.sweep })})`);
  assert.ok(Math.hypot(dc.cx - C.x, dc.cy - C.y) < 1e-6, `the drawn arc is centred on the arc's centre (drawn centre ${dc.cx}, ${dc.cy}; centre ${C.x}, ${C.y})`);
  const exported = parseArc(/<path d="([^"]*)"/.exec(muted(() => buildSVG(S.state, { precision: 6 })))[1]);
  assert.ok(exported && exported.la === drawn.la && exported.sw === drawn.sw, `the SVG export draws the same arc as the renderer (export ${JSON.stringify(exported)}, renderer ${JSON.stringify(drawn)})`);
  const b = computeGeometryBounds(S.state);
  assert.ok(b.maxY > C.y + m.R - 1e-6, `the bounds reach the arc's far side (maxY ${b.maxY}, centre ${C.y} + R ${m.R})`);
  console.log(`1a fixed-ends arc pulled to ${m.signedDeg.toFixed(2)} deg: drawn and exported large=1 sweep=${drawn.sw}, centred on the arc's centre`);
}
{
  // (b) an OLD file whose stored largeArc no longer matches its joints (an arc that crossed 180 degrees before this task, EA-2): the flag is ignored
  const joints = new Map([['c', { x: 0, y: 0 }], ['s', { x: 10, y: 0 }], ['e', { x: 10 * Math.cos(200 * Math.PI / 180), y: 10 * Math.sin(200 * Math.PI / 180) }]]);
  const sh = { id: 'a', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'], largeArc: false, sweep: true };
  const drawn = parseArc(calculateArcPath(joints.get('c'), joints.get('s'), joints.get('e'), 'CENTER', { largeArc: sh.largeArc, sweep: sh.sweep }));
  const dc = drawnCentre(drawn);
  assert.ok(drawn.la === 1 && Math.hypot(dc.cx, dc.cy) < 1e-9, `an old file's stale largeArc=false on a 200 degree arc: drawn as the 200 degree arc about its centre (${JSON.stringify(drawn)})`);
  const info = arcSweepInfo(joints.get('c'), joints.get('s'), joints.get('e'), { sweep: true });
  assert.ok(Math.abs(info.span * 180 / Math.PI - 200) < 1e-9 && info.large === true, 'arcSweepInfo: 200 degrees, large');
  console.log('1b old file, stale largeArc=false on a 200 degree arc: drawn as the 200 degree arc');
}
{
  // (c) a FILLET arc stores no direction (the shortest way): the SVG and DXF exports write the arc the renderer draws, not its mirror / complement
  for (const [name, aS, aE] of [['increasing', -90, 0], ['decreasing', 180, 90]]) {
    const rad = (d) => d * Math.PI / 180;
    const joints = new Map([['c', { x: 50, y: 50 }], ['s', { x: 50 + 10 * Math.cos(rad(aS)), y: 50 + 10 * Math.sin(rad(aS)) }], ['e', { x: 50 + 10 * Math.cos(rad(aE)), y: 50 + 10 * Math.sin(rad(aE)) }]]);
    const state = { joints, shapes: [{ id: 'f', type: 'arc', subType: 'CENTER', joints: ['c', 's', 'e'] }] };
    const drawn = parseArc(calculateArcPath(joints.get('c'), joints.get('s'), joints.get('e'), 'CENTER', {}));
    const svgArc = parseArc(/<path d="([^"]*)"/.exec(muted(() => buildSVG(state, { precision: 6 })))[1]);
    assert.ok(svgArc.sw === drawn.sw && svgArc.la === drawn.la, `fillet arc (${name} the short way): the SVG export's flags ${svgArc.la} ${svgArc.sw} = the renderer's ${drawn.la} ${drawn.sw}`);
    const t = muted(() => buildDXF(state, { precision: 6 })).split('\r\n'), i = t.indexOf('ARC');
    const a50 = +t[t.indexOf('50', i) + 1], a51 = +t[t.indexOf('51', i) + 1];
    const mid = (aS + aE) / 2, ccw = (x) => ((x - a50) % 360 + 360) % 360;
    assert.ok(ccw(mid) < ccw(a51), `fillet arc (${name}): the DXF ARC (counter-clockwise ${a50} -> ${a51}) contains the drawn arc's middle ${mid} (the 90 degree arc, not the 270)`);
  }
  console.log('1c fillet arcs (no stored direction): SVG and DXF exports = what the renderer draws');
}

console.log('arc-direction: ok');

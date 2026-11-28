// tests/export-roundtrip-1027-node.test.js — TASK 1027 (files audit 1024): BUG-300 (F-81 / F-81b) SVG and DXF exports write every circle and leave
// construction geometry out; BUG-301 (F-84) our own DXF re-imports the SAME way up (DXF is Y-up: the export negates Y, the import negates it back).
import assert from 'node:assert';
import { buildSVG, buildDXF } from '../apps/sketchstudio/ui/export-manager.js';
import { importDxf } from '#core/dxf-import.js';
import { arcSweepInfo } from '#core/geometry.js';

let n = 0; const genJ = () => 'j' + (++n);
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const r3 = (v) => Math.round(v * 1000) / 1000;

const J = (list) => new Map(list.map(([id, x, y]) => [id, { x, y }]));
const joints = J([
  ['a', 10, 20], ['b', 70, 20], ['c', 70, 50], ['d', 10, 50],                   // a line chain
  ['k0', 0, 60], ['k1', 80, 60],                                                  // a construction line
  ['o', 40, 90],                                                                  // a circle centre
  ['ac', 120, 30], ['as', 140, 30], ['ae', 120, 10],                             // an arc, sweep true (increasing angle in the Y-down world)
  ['bc', 120, 80], ['bs', 120, 60], ['be', 140, 80],                             // an arc, sweep false
]);
const shapes = [
  { id: 'l1', type: 'line', joints: ['a', 'b'] }, { id: 'l2', type: 'line', joints: ['b', 'c'] }, { id: 'l3', type: 'line', joints: ['c', 'd'] },
  { id: 'kl', type: 'line', joints: ['k0', 'k1'], isConstruction: true },
  { id: 'c1', type: 'circle', joints: ['o'], radius: 12 },
  { id: 'kc', type: 'circle', joints: ['o'], radius: 30, isConstruction: true },
  { id: 'a1', type: 'arc', subType: 'CENTER', joints: ['ac', 'as', 'ae'], sweep: true },
  { id: 'a2', type: 'arc', subType: 'CENTER', joints: ['bc', 'bs', 'be'], sweep: false },
];
const state = { joints, shapes };

// ---- BUG-300 SVG
{
  const svg = buildSVG(state, { precision: 3 });
  eq((svg.match(/<circle\b/g) || []).length, 1, 'F-81: the circle is written (one <circle>; the construction circle is not)');
  ok(/<circle cx="40.000" cy="90.000" r="12.000"/.test(svg), 'F-81: <circle> at the centre with the radius');
  ok(!/y1="60.000"/.test(svg), 'F-81b: the construction line (0,60)-(80,60) is not in the SVG');
  ok(!/r="30/.test(svg), 'F-81b: the construction circle is not in the SVG');
  const vb = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  ok(vb[0] < 28 && vb[1] < 78, 'the viewBox covers the circle (left 28, top 78)');
  const approx = buildSVG(state, { precision: 3, arcApprox: true, arcSeg: 16 });
  ok(/<polyline points="52.000,90.000 /.test(approx) && !/<circle/.test(approx), 'arcApprox: the circle is a closed sampled polyline');
  eq(buildSVG({ joints, shapes: [shapes[3], shapes[5]] }), null, 'only construction geometry: nothing to export (null, as an empty design)');
}

// ---- BUG-300 DXF + BUG-301 round trip
const canon = (st) => {
  const P = (id) => st.joints instanceof Map ? st.joints.get(id) : st.joints.find((j) => j.id === id);
  const q = (id) => { const p = P(id); return [r3(p.x), r3(p.y)]; };
  const out = [];
  for (const s of st.shapes) {
    if (s.isConstruction) continue;
    if (s.type === 'line') out.push(JSON.stringify(['line', ...[q(s.joints[0]), q(s.joints[1])].sort()]));
    else if (s.type === 'circle') out.push(JSON.stringify(['circle', q(s.joints[0]), r3(s.radius)]));
    else if (s.type === 'arc') { const dir = arcSweepInfo(P(s.joints[0]), P(s.joints[1]), P(s.joints[2]), { sweep: s.sweep }).dir; out.push(JSON.stringify(['arc', q(s.joints[0]), dir > 0 ? q(s.joints[1]) : q(s.joints[2]), dir > 0 ? q(s.joints[2]) : q(s.joints[1])])); }
  }
  return out.sort();
};
{
  const dxf = buildDXF(state, { precision: 6 });
  const ent = {}; const t = dxf.split('\r\n'); for (let i = 0; i < t.length - 1; i++) if (t[i] === '0' && /^(LINE|POLYLINE|LWPOLYLINE|CIRCLE|ARC|SPLINE)$/.test(t[i + 1])) ent[t[i + 1]] = (ent[t[i + 1]] || 0) + 1;
  // TASK 1043 (BUG-402): the 3-line chain is ONE open R12 POLYLINE now (tests/dxf-loops-1043-node.test.js); a lone arc stays an ARC
  eq(ent, { POLYLINE: 1, CIRCLE: 1, ARC: 2 }, 'F-81 / F-81b: the line chain (1 POLYLINE) + 1 CIRCLE + 2 ARC (no construction entity)');
  const i = t.indexOf('CIRCLE');
  eq([t[t.indexOf('20', i) + 1], t[t.indexOf('40', i) + 1]], ['-90.000000', '12.000000'], 'F-84: a DXF is Y-up: the circle centre y 90 is written -90');
  const re = importDxf(dxf, { genJ });
  ok(!re.error, 'our DXF imports');
  eq(canon(re), canon(state), 'F-84: export then import gives the same geometry, the same way up (lines, circle, both arc directions)');
  eq(buildDXF(state, { precision: 6, invertY: true }), dxf, 'the "Invert Y axis" box is SVG only: a DXF is identical with it on and off');
  ok(buildSVG(state, { precision: 3, invertY: true }) !== buildSVG(state, { precision: 3 }), 'and it still inverts an SVG');
  const ap = buildDXF(state, { precision: 6, arcApprox: true, arcSeg: 8 });
  const reAp = importDxf(ap, { genJ });
  const lines = reAp.shapes.filter((s) => s.type === 'line').length;
  eq(lines, 3 + 8 + 8 + 8, 'arcApprox: lines + the circle and both arcs as 8 LINEs each');
}
console.log(`export-roundtrip-1027: ${checks} checks ok`);

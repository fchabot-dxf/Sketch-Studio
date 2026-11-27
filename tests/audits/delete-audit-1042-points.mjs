// tests/audits/delete-audit-1042-points.mjs — TASK 1042 (AUDIT ONLY, outside the gate): the POINT rows D-01..D-25 of docs/DELETE-AUDIT-1042.md.
// SketchStudio in Node (tests/helpers/node-app.js): each scene drawn with the real tools, the point picked with a real click (Select tool), the
// Delete key. One `ROW D-xx | ...` line per case (see delete-audit-1042-kit.js runCase for the columns). Run: node tests/audits/delete-audit-1042-points.mjs
import * as K from './delete-audit-1042-kit.js';
const { line, rect2, circle, polygon, arc3, slotCC, fillet, offset, mirror, rectPattern, constrain, dimension, runCase, clickJoint, click, shapesOf, sharedJoint, jp, theApp, key, tool, esc2, quiet } = K;

const lines = () => shapesOf((s) => s.type === 'line' && !s.isConstruction);
const st = () => theApp().state;
const coincidentOf = (jid) => st().constraints.find((c) => c.type === 'coincident' && c.joints.includes(jid));

// D-01: no Point tool in ours. The nearest: the centre point of a Centre rectangle (orphanAllowed, the construction diagonals meet there)
await runCase('D-01', 'lone point (ours: no Point tool; the centre point of a centre rectangle)', {
  scene: async () => { await tool('rect'); st().rectMode = 'rect-center'; await click(10, 10); await click(40, 30); await esc2(); await tool('select'); },
  pick: () => click(10, 10),
});
await runCase('D-02', 'free end of a single line', { scene: () => line([-40, 10], [20, 10]), pick: () => click(-40, 10) });
const glued2 = async () => { await line([-40, 10], [10, 10]); await line([20, 30], [40, -20]); await constrain('coincident', [10, 10], [20, 30]); };
await runCase('D-03', 'GLUED end, 2 lines (Coincident tool)', { scene: glued2, pick: () => clickJoint(lines()[0].joints[1]) });
const glued3 = async () => { await glued2(); await line([30, 40], [60, 40]); const e = jp(lines()[0].joints[1]); await constrain('coincident', e, [30, 40]); };
await runCase('D-04', 'GLUED end, 3 lines', { scene: glued3, pick: () => clickJoint(lines()[0].joints[1]) });
await runCase('D-04b', 'GLUED end, 3 lines: the same stack picked, the LAST line\'s point', { scene: glued3, pick: async () => { const j = lines()[2].joints[0]; await clickJoint(j); } });
await runCase('D-05', 'chain corner (Line tool, one continuous chain: ours glues it)', { scene: () => line([-40, 10], [10, 10], [10, 40]), pick: () => click(10, 10) });
await runCase('D-05b', 'shared corner: a 3rd line started on a chain corner', { scene: async () => { await line([-40, 10], [10, 10], [10, 40]); await line([10, 10], [40, -20]); }, pick: () => click(10, 10) });
await runCase('D-06', '2-point rectangle corner', { scene: () => rect2([20, 10], [60, 40]), pick: () => click(60, 40) });
await runCase('D-07', '6-side polygon corner (shared)', { scene: () => polygon([-40, 20], 15), pick: () => clickJoint(lines()[0].joints[0]) });
await runCase('D-08', 'slot: a side meets a cap (shared)', { scene: () => slotCC([-30, 10], [20, 10], 16), pick: () => clickJoint(lines()[0].joints[0]) });
const filletScene = async () => { await rect2([-20, -10], [40, 30]); await fillet([40, 30], 6); };
const filletArc = () => shapesOf((s) => s.type === 'arc')[0];
await runCase('D-09', 'filleted corner: the fillet arc end (tangent point)', { scene: filletScene, pick: () => clickJoint(filletArc().joints[1]) });
const offsetScene = async () => { await rect2([-20, -10], [20, 20]); await offset([0, -10], [0, -20], 5); };
await runCase('D-10', 'offset COPY corner', { scene: offsetScene, pick: () => clickJoint(lines()[4].joints[0]) });
await runCase('D-10b', 'offset SOURCE corner', { scene: offsetScene, pick: () => click(-20, -10) });
const patScene = async () => { await rect2([-90, -10], [-70, 10]); await rectPattern([[-80, -10], [-90, 0], [-80, 10], [-70, 0]], 3); };
await runCase('D-11', 'pattern COPY corner (copy 2 of 3)', { scene: patScene, pick: () => clickJoint(lines()[4].joints[0]) });
await runCase('D-11b', 'pattern LAST copy corner (copy 3 of 3)', { scene: patScene, pick: () => clickJoint(lines()[8].joints[0]) });
await runCase('D-12', 'pattern SOURCE corner', { scene: patScene, pick: () => click(-90, -10) });
const mirScene = async () => { await line([-40, 30], [-40, -30]); await rect2([-30, -10], [-10, 10]); await mirror([[-20, -10], [-30, 0], [-20, 10], [-10, 0]], [-40, 0]); };
await runCase('D-13', 'mirror COPY corner', { scene: mirScene, pick: () => clickJoint(lines()[5].joints[0]) });
await runCase('D-13b', 'mirror SOURCE corner', { scene: mirScene, pick: () => click(-30, -10) });
await runCase('D-14', 'circle centre', { scene: () => circle([10, 10], 15), pick: () => click(10, 10) });
await runCase('D-15', 'centre-point arc: its centre', { scene: () => arc3([10, 10], [30, 10], [10, 30]), pick: () => click(10, 10) });
await runCase('D-16', 'free arc end', { scene: () => arc3([10, 10], [30, 10], [10, 30]), pick: () => click(30, 10) });
const midScene = async () => { await line([-40, -20], [40, -20]); await line([10, 30], [15, 5]); await constrain('midpoint', [15, 5], [-20, -20]); };
await runCase('D-17', 'midpoint-constrained point (line B end at the middle of A)', { scene: midScene, pick: () => clickJoint(lines()[1].joints[1]) });
const polScene = async () => { await line([-40, -20], [40, -20]); await line([15, -20], [25, 20]); };
await runCase('D-18', 'ON-CURVE point (line B starts on line A: pointOnLine)', { scene: polScene, pick: () => clickJoint(lines()[1].joints[0]) });
await runCase('D-19', 'fixed point (a free line end, F = Fix)', { scene: async () => { await line([-40, 10], [20, 10]); await click(20, 10); await key('f'); await esc2(); }, pick: () => click(20, 10) });
await runCase('D-20', 'the origin', { scene: () => line([-40, 10], [20, 10]), pick: () => click(0, 0) });
const vsScene = async () => { await rect2([-20, -10], [40, 30]); await dimension([[10, 30]], [10, 45], 60); await fillet([40, 30], 6); };
await runCase('D-21', 'fillet virtual sharp (corner dimensioned, then filleted)', { scene: vsScene, pick: () => { const v = [...st().joints].find(([, j]) => j.virtualSharp); return clickJoint(v[0]); } });
const bezScene = async () => { await tool('bezier'); await click(-40, 10); await click(5, 30); await click(40, 10); await quiet(() => theApp().enter()); await esc2(); await tool('select'); };
await runCase('D-22', 'bezier anchor (middle one)', { scene: bezScene, pick: () => click(5, 30) });
// D-23: a SMOOTH anchor (pressed and dragged: its handles come out) so the handles are away from it; the curve selected (its handles show), then a click ON a handle end
const smoothBez = async () => { await tool('bezier'); await click(-40, 10); await K.dragW([5, 30], [25, 30]); await click(40, 10); await quiet(() => theApp().enter()); await esc2(); await tool('select'); };
await runCase('D-23', 'bezier handle end (a smooth anchor dragged out; the curve selected, then a click on the handle end)', { scene: smoothBez,
  pick: async () => { const b = shapesOf((s) => s.type === 'bezier'); await K.clickShape(b[0].id, 0.5); await click(b[0].c2[0], b[0].c2[1]); },
  extra: ({ before }) => { const b = before.shapes.filter((s) => s.type === 'bezier'); const J = new Map(before.joints); const h = K.W(...b[0].c2); const d = Math.min(...b[0].joints.map((j) => { const q = K.W(J.get(j).x, J.get(j).y); return Math.hypot(q.x - h.x, q.y - h.y); })); return `segments ${b.length}; the clicked handle end is ${K.f(d, 1)} px from the nearest anchor`; } });
const textScene = async () => { await tool('text'); await click(-20, -15); const ta = theApp().document.querySelector('.sk-text-editor textarea'); if (ta) { await quiet(() => { ta.focus(); theApp().type('Hi'); }); await quiet(() => theApp().waitFor(() => theApp().state.shapes.some((s) => s.type === 'line' || s.type === 'bezier'), 'the letters (the font loads)', 4000)); await quiet(() => theApp().key('Enter', { ctrl: true })); } await esc2(); await tool('select'); };
await runCase('D-24', 'text anchor (baseline start)', { scene: textScene, pick: () => click(-20, -15) });
await runCase('D-25', 'a point with a dimension (line end dimensioned to the origin)', { scene: async () => { await line([-40, 10], [20, 10]); await dimension([[20, 10], [0, 0]], [30, -10], null); }, pick: () => click(20, 10) });
await K.closeAll();

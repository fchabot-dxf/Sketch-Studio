// tests/audits/delete-audit-1042-constraints.mjs — TASK 1042 (AUDIT ONLY, outside the gate): the CONSTRAINT / DIMENSION rows D-47..D-72.
// SketchStudio in Node: the scene drawn with the real tools, the glyph or the dimension label picked with a real click at the place the renderer drew it
// (its glyphPos; a label is the DOM element a browser's hit test finds), the Delete key. Run: node tests/audits/delete-audit-1042-constraints.mjs
import * as K from './delete-audit-1042-kit.js';
const { line, rect2, circle, polygon, arc3, slotCC, fillet, offset, mirror, rectPattern, constrain, dimension, runCase, click, clickShape, clickJoint, clickConstraint, shapesOf, jp, theApp, key, tool, esc2, quiet, rightClickDelete, glyphAt, labelOf } = K;

const st = () => theApp().state;
const lines = () => shapesOf((s) => s.type === 'line' && !s.isConstruction);
const con = (pred) => { const c = st().constraints.find((x) => x && x.type !== 'mouse_spring' && pred(x)); if (!c) throw new Error('no such constraint'); return c; };
const T = (type, extra = () => true) => (c) => c.type === type && extra(c);
// THE glyph pick as a user makes it: a Coincident / point-on-line glyph shows only while its point is hovered or selected (svg-renderer.js
// drawConstraintGlyph `visible`), so the point is clicked first; then a click on each drawn glyph of the constraint until it is the selection.
const pickC = (pred, o = {}) => async () => {
  await quiet(() => theApp().frames(2));
  const c = con(pred);
  if (c.type === 'coincident' || c.type === 'pointOnLine') await clickJoint(c.type === 'pointOnLine' ? c.joint : c.joints[c.joints.length - 1]);
  await quiet(() => theApp().frames(2));
  const n = Array.isArray(c.glyphPos) ? c.glyphPos.length : 1;
  for (let i = 0; i < n; i++) { await clickConstraint(c, { ...o, which: i }); if (st().selectedConstraints && st().selectedConstraints.has(c)) return; }
};
const rcGlyph = (pred) => async () => { await quiet(() => theApp().frames(2)); const c = con(pred); return rightClickDelete(0, 0, { screen: K.glyphInk(c) }); };
const extraSel = () => `glyph picked: ${[...st().selectedConstraints || []].length ? 'yes' : 'NO'}`;

const glued2 = async () => { await line([-40, 10], [10, 10]); await line([20, 30], [40, -20]); await constrain('coincident', [10, 10], [20, 30]); };
const glued3 = async () => { await glued2(); await line([30, 40], [60, 40]); const e = jp(lines()[0].joints[1]); await constrain('coincident', e, [30, 40]); };
await runCase('D-47', 'Coincident glyph of 2 GLUED ends', { scene: glued2, pick: pickC(T('coincident')) });
await runCase('D-48', 'one Coincident glyph of 3 GLUED ends (the second)', { scene: glued3, pick: async () => { await quiet(() => theApp().frames(2)); await clickConstraint(st().constraints.filter((c) => c.type === 'coincident')[1]); } });
await runCase('D-48b', 'one Coincident glyph of 3 GLUED ends (the second): its point clicked (the glyph shows), then RIGHT-click on the glyph > Delete constraint', { scene: glued3, pick: async () => { const c = st().constraints.filter((x) => x.type === 'coincident')[1]; await clickJoint(c.joints[1]); }, del: async () => { await quiet(() => theApp().frames(2)); const c = st().constraints.filter((x) => x.type === 'coincident')[1]; return rightClickDelete(0, 0, { screen: K.glyphInk(c) }); } });
await runCase('D-49', 'Coincident glyph at a Line-tool chain corner', { scene: () => line([-40, 10], [10, 10], [10, 40]), pick: pickC(T('coincident')) });
await runCase('D-50', 'a polygon corner (3 curves share ONE point): is there a glyph to pick? (a click beside the corner)', { scene: () => polygon([-40, 20], 15), pick: async () => { const p = jp(lines()[0].joints[0]); await click(p[0] + 1.5, p[1] + 1.5); }, extra: () => `coincident constraints in the polygon: ${st().constraints.filter((c) => c.type === 'coincident').length}` });
await runCase('D-51', 'point-on-curve (pointOnLine) glyph', { scene: async () => { await line([-40, -20], [40, -20]); await line([15, -20], [25, 20]); }, pick: pickC(T('pointOnLine')) });
await runCase('D-52', 'Horizontal glyph', { scene: () => line([-40, 10], [20, 10]), pick: pickC(T('horizontal')) });
await runCase('D-53', 'Vertical glyph', { scene: () => line([20, -30], [20, 30]), pick: pickC(T('vertical')) });
const two = async () => { await line([-40, -20], [20, -5]); await line([-40, 20], [20, 40]); };
await runCase('D-54', 'Parallel glyph', { scene: async () => { await two(); await constrain('parallel', [-10, -12.5], [-10, 30]); }, pick: pickC(T('parallel')) });
await runCase('D-55', 'Perpendicular glyph', { scene: async () => { await two(); await constrain('perp', [-10, -12.5], [-10, 30]); }, pick: pickC(T('perpendicular')) });
await runCase('D-56', 'Tangent glyph (line-arc, a slot side and cap)', { scene: () => slotCC([-30, 10], [20, 10], 16), pick: pickC(T('tangent')) });
await runCase('D-56b', 'Tangent glyph: RIGHT-click on it > Delete constraint', { scene: () => slotCC([-30, 10], [20, 10], 16), pick: async () => {}, del: rcGlyph(T('tangent')) });
await runCase('D-57', 'Equal glyph', { scene: async () => { await two(); await constrain('equal', [-10, -12.5], [-10, 30]); }, pick: pickC(T('equal')) });
await runCase('D-58', 'Collinear glyph', { scene: async () => { await line([-40, -20], [-10, -18]); await line([10, 10], [40, 20]); await constrain('collinear', [-25, -19], [25, 15]); }, pick: pickC(T('collinear')) });
await runCase('D-59', 'Midpoint glyph', { scene: async () => { await line([-40, -20], [40, -20]); await line([10, 30], [15, 5]); await constrain('midpoint', [15, 5], [-20, -20]); }, pick: pickC(T('midpoint')) });
await runCase('D-60', 'Symmetric glyph (2 line ends about a vertical line)', { scene: async () => { await line([0.5, 40], [0.5, -40]); await line([-30, 10], [-20, 30]); await line([30, 12], [20, -30]); await tool('symmetric'); await click(-30, 10); await click(30, 12); await click(0.5, 25); await esc2(); await tool('select'); }, pick: pickC(T('symmetric')) });
await runCase('D-60b', 'Symmetric glyph: RIGHT-click on it > Delete constraint', { scene: async () => { await line([0.5, 40], [0.5, -40]); await line([-30, 10], [-20, 30]); await line([30, 12], [20, -30]); await tool('symmetric'); await click(-30, 10); await click(30, 12); await click(0.5, 25); await esc2(); await tool('select'); }, pick: async () => {}, del: rcGlyph(T('symmetric')) });
await runCase('D-61', 'Fix: a fixed line end (no constraint: a point flag): its point picked, Delete', { scene: async () => { await line([-40, 10], [20, 10]); await click(20, 10); await key('f'); await esc2(); }, pick: () => click(20, 10), extra: ({ before }) => `fixed points before: ${before.joints.filter((j) => j[1].fixed && j[0] !== 'j_origin').length}` });
await runCase('D-62', 'Concentric (ours: a 2nd circle started on the 1st centre)', { scene: async () => { await circle([10, 10], 15); await circle([10, 10], 25); }, pick: () => click(35, 10), extra: ({ before }) => `circle centres ${before.shapes.filter((s) => s.type === 'circle').map((s) => s.joints[0]).join(' ')} (same id = shared)` });
const patScene = async () => { await rect2([-90, -10], [-70, 10]); await rectPattern([[-80, -10], [-90, 0], [-80, 10], [-70, 0]], 3); };
await runCase('D-63', 'the rectangular pattern\'s label', { scene: patScene, pick: pickC(T('rectangularPattern')) });
const mirScene = async () => { await line([-40, 30], [-40, -30]); await rect2([-30, -10], [-10, 10]); await mirror([[-20, -10], [-30, 0], [-20, 10], [-10, 0]], [-40, 0]); };
await runCase('D-64', 'one of the Mirror\'s symmetric glyphs', { scene: mirScene, pick: pickC(T('symmetric')) });
const offsetScene = async () => { await rect2([-20, -10], [20, 20]); await offset([0, -10], [0, -20], 5); };
await runCase('D-65', 'the Offset dimension label', { scene: offsetScene, pick: pickC(T('offset')), extra: () => { const o = st().constraints.find((c) => c.type === 'offset'); return o ? `offset relation after: dimensioned=${o.dimensioned} value=${o.value}` : 'offset relation after: gone'; } });
await runCase('D-66', 'driving linear dimension (line length)', { scene: async () => { await line([-40, -20], [20, -20]); await dimension([[-10, -20]], [-10, -32], 60); }, pick: pickC(T('distance')) });
await runCase('D-67', 'reference (driven) linear dimension (right-click > Reference dimension, then picked)', { scene: async () => { await line([-40, -20], [20, -20]); await dimension([[-10, -20]], [-10, -32], 60); const c = con(T('distance')); await quiet(() => theApp().frames(2)); const g = glyphAt(c); await quiet(async () => { const p = K.W(...g); theApp().rightClick(p.x, p.y, { target: labelOf(c) }); const r = [...theApp().document.querySelectorAll('.sk-context-menu .sk-context-item')].find((x) => x.dataset.id === 'dim-reference'); if (r) theApp().press(r); }); await esc2(); }, pick: pickC(T('distance')), extra: ({ before }) => `driven before: ${before.constraints.filter((c) => c.type === 'distance').map((c) => !!(c.isDriven || c.driven))}` });
await runCase('D-68', 'angle dimension', { scene: async () => { await two(); await dimension([[-10, -12.5], [-10, 30]], [30, 15], 30); }, pick: pickC(T('angle')) });
await runCase('D-69', 'radius dimension (arc)', { scene: async () => { await arc3([10, 10], [30, 10], [10, 30]); await dimension([K.onShape(shapesOf((s) => s.type === 'arc')[0].id, 0.5)], [35, 35], 25); }, pick: pickC((c) => c.type === 'distance' && c.isRadius) });
await runCase('D-70', 'diameter dimension (circle)', { scene: async () => { await circle([10, 10], 15); await dimension([[25, 10]], [40, 30], 40); }, pick: pickC((c) => c.type === 'distance' && c.isRadius) });
const formulaScene = async () => {
  await line([-40, -20], [20, -20]); await dimension([[-10, -20]], [-10, -32], 30);
  await line([-40, 20], [20, 20]); await dimension([[-10, 20]], [-10, 32], 'd1 * 2');
};
await runCase('D-71', 'd2 = d1 * 2, delete d1 (its label, Delete)', { scene: formulaScene, pick: pickC((c) => c.name === 'd1'), extra: ({ before }) => `before: ${before.constraints.filter((c) => c.type === 'distance').map((c) => `${c.name}=${c.value}{${c.expression || ''}}`)}; after: ${st().constraints.filter((c) => c.type === 'distance').map((c) => `${c.name}=${c.value}{${c.expression || ''}}`)}; parameters ${JSON.stringify((st().parameters || []).map((p) => [p.name, p.kind, p.expression, p.value]))}; toasts ${JSON.stringify([...theApp().document.querySelectorAll('#notification-container [data-level]')].map((e) => e.textContent.trim().slice(0, 120)))}; dialog ${!!theApp().document.querySelector('[role="dialog"], [role="alertdialog"]')}` });
// D-72: the right-click menu on a JOINED point: which rows does it offer (Fusion: Delete Coincident)? The probe reads the rows, then presses Delete if offered.
await runCase('D-72', 'right-click on a Line-tool chain corner: the menu rows, then its Delete', { scene: () => line([-40, 10], [10, 10], [10, 40]), pick: async () => { await click(10, 10); }, del: () => rightClickDelete(10, 10) });
await runCase('D-72b', 'right-click on a polygon (shared) corner: the menu rows, then its Delete', { scene: () => polygon([-40, 20], 15), pick: () => clickJoint(lines()[0].joints[0]), del: () => rightClickDelete(...jp(lines()[0].joints[0])) });
await K.closeAll();

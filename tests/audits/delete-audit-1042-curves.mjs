// tests/audits/delete-audit-1042-curves.mjs — TASK 1042 (AUDIT ONLY, outside the gate): the CURVE rows D-26..D-46 of docs/DELETE-AUDIT-1042.md.
// SketchStudio in Node: each scene drawn with the real tools, the curve picked with a real click (Select tool) on the curve, the Delete key.
// Run: node tests/audits/delete-audit-1042-curves.mjs
import * as K from './delete-audit-1042-kit.js';
const { line, rect2, circle, polygon, arc3, slotCC, fillet, offset, mirror, rectPattern, constrain, dimension, runCase, click, clickShape, shapesOf, theApp, key, tool, esc2, quiet } = K;

const st = () => theApp().state;
const lines = () => shapesOf((s) => s.type === 'line' && !s.isConstruction);
const constr = () => shapesOf((s) => s.type === 'line' && s.isConstruction);
const arcs = () => shapesOf((s) => s.type === 'arc');
const byId = (id) => st().shapes.find((s) => s.id === id);

await runCase('D-26', 'lone line', { scene: () => line([-40, 10], [20, 10]), pick: () => click(-10, 10) });
await runCase('D-27', 'one side of a 2-point rectangle (the top)', { scene: () => rect2([20, 10], [60, 40]), pick: () => click(40, 40) });
await runCase('D-28', 'one side of a 6-side polygon', { scene: () => polygon([-40, 20], 15), pick: () => clickShape(lines()[0].id, 0.5) });
await runCase('D-29', 'the polygon\'s construction radius line', { scene: () => polygon([-40, 20], 15), pick: () => clickShape(constr()[0].id, 0.5) });
const slot = () => slotCC([-30, 10], [20, 10], 16);
await runCase('D-30', 'slot straight side', { scene: slot, pick: () => clickShape(lines()[0].id, 0.5) });
await runCase('D-31', 'slot cap arc', { scene: slot, pick: () => clickShape(arcs()[0].id, 0.5) });
await runCase('D-32', 'slot construction centre line', { scene: slot, pick: () => clickShape(constr()[0].id, 0.3) });
const filletScene = async () => { await rect2([-20, -10], [40, 30]); await fillet([40, 30], 6); };
await runCase('D-33', 'fillet arc (rectangle corner, R6)', { scene: filletScene, pick: () => clickShape(arcs()[0].id, 0.5) });
await runCase('D-33b', 'fillet arc where the corner carried a dimension (virtual sharp kept by it)', { scene: async () => { await rect2([-20, -10], [40, 30]); await dimension([[10, 30]], [10, 45], 60); await fillet([40, 30], 6); }, pick: () => clickShape(arcs()[0].id, 0.5) });
await runCase('D-34', 'lone arc', { scene: () => arc3([10, 10], [30, 10], [10, 30]), pick: () => clickShape(arcs()[0].id, 0.5) });
await runCase('D-35', 'circle', { scene: () => circle([10, 10], 15), pick: () => click(25, 10) });
const bezScene = async () => { await tool('bezier'); await click(-40, 10); await click(5, 30); await click(40, 10); await quiet(() => theApp().enter()); await esc2(); await tool('select'); };
await runCase('D-36', 'bezier: one click on the first segment (ours: a path of 2 segments)', { scene: bezScene, pick: () => clickShape(shapesOf((s) => s.type === 'bezier')[0].id, 0.5) });
await runCase('D-36b', 'bezier: both segments (click, Shift+click)', { scene: bezScene, pick: async () => { const b = shapesOf((s) => s.type === 'bezier'); await clickShape(b[0].id, 0.5); await clickShape(b[1].id, 0.5, { shift: true }); } });
// a construction line: drawn, selected, X (the Construction shortcut: design-browser.js, mounted with the Sketches browser)
await runCase('D-37', 'construction line', { view: { centre: { x: 0, y: 0 }, w: 200, designBrowser: true }, scene: async () => { await line([-40, 10], [20, 10]); await click(-10, 10); await key('x'); await esc2(); }, pick: () => click(-10, 10), extra: () => `construction before pick ${shapesOf().map((s) => !!s.isConstruction)}` });
const offsetScene = async () => { await rect2([-20, -10], [20, 20]); await offset([0, -10], [0, -20], 5); };
await runCase('D-38', 'offset COPY curve (bottom side of the copy)', { scene: offsetScene, pick: () => click(0, -15) });
await runCase('D-39', 'offset SOURCE curve (bottom side)', { scene: offsetScene, pick: () => click(0, -10) });
const mirScene = async () => { await line([-40, 30], [-40, -30]); await rect2([-30, -10], [-10, 10]); await mirror([[-20, -10], [-30, 0], [-20, 10], [-10, 0]], [-40, 0]); };
await runCase('D-40', 'mirror COPY curve', { scene: mirScene, pick: () => clickShape(lines()[5].id, 0.5) });
await runCase('D-41', 'mirror SOURCE curve (bottom side)', { scene: mirScene, pick: () => click(-20, -10) });
await runCase('D-42', 'the mirror line', { scene: mirScene, pick: () => click(-40, 20) });
const patScene = async () => { await rect2([-90, -10], [-70, 10]); await rectPattern([[-80, -10], [-90, 0], [-80, 10], [-70, 0]], 3); };
await runCase('D-43', 'pattern COPY curve (one side of copy 2)', { scene: patScene, pick: () => clickShape(lines()[4].id, 0.5) });
await runCase('D-44', 'pattern SOURCE curve (bottom side)', { scene: patScene, pick: () => click(-80, -10) });
const richScene = async () => {
  await line([-40, -20], [20, -20]); await dimension([[-10, -20]], [-10, -32], 60);
  await line([-40, 0], [20, 8]); await constrain('parallel', [-10, -20], [-10, 4]);
  await line([-40, 25], [10, 35]); await constrain('equal', [-25, -20], [-15, 30]);
};
await runCase('D-45', 'line with a length dim, Horizontal, Parallel to line 2, Equal to line 3', { scene: richScene, pick: () => clickShape(lines()[0].id, 0.7) });
const textScene = async () => { await tool('text'); await click(-20, -15); const ta = theApp().document.querySelector('.sk-text-editor textarea'); if (ta) { await quiet(() => { ta.focus(); theApp().type('Hi'); }); await quiet(() => theApp().waitFor(() => theApp().state.shapes.some((s) => s.type === 'line' || s.type === 'bezier'), 'the letters (the font loads)', 4000)); await quiet(() => theApp().key('Enter', { ctrl: true })); } await esc2(); await tool('select'); };
await runCase('D-46', 'a text item (click on a letter stroke)', { scene: textScene, pick: async () => { const t = shapesOf((s) => s.type === 'text')[0]; const b = shapesOf((s) => s.groupId && t && s.groupId === t.groupId && s.type !== 'text')[0] || shapesOf((s) => s.type !== 'text')[0]; await clickShape(b ? b.id : t.id, 0.5); } });
await K.closeAll();

// tests/audits/delete-audit-1042-hosts.mjs — TASK 1042 (AUDIT ONLY, outside the gate): the spot check that Shaper and Pen Plotter delete the same way
// as SketchStudio (the shared Design tab). The same scenes, picks and keys as the SketchStudio rows, in each host's own Design tab (node kit).
// The rows are H-<host>-<row id>; compare each with the SketchStudio row of the same id. Run: node tests/audits/delete-audit-1042-hosts.mjs
import * as K from './delete-audit-1042-kit.js';
const { line, rect2, polygon, constrain, dimension, runCase, click, clickShape, clickJoint, clickConstraint, shapesOf, jp, theApp, key, rightClickDelete, footerDelete, dragW } = K;

const st = () => theApp().state;
const lines = () => shapesOf((s) => s.type === 'line' && !s.isConstruction);
const con = (pred) => st().constraints.find((x) => x && x.type !== 'mouse_spring' && pred(x));
const glyph = (pred) => async () => { await K.quiet(() => theApp().frames(2)); await clickConstraint(con(pred)); };
const originRow = () => { const o = st().joints.get('j_origin'); return `origin ${o ? 'kept' : 'GONE'}; constraints naming the origin ${st().constraints.filter((c) => K.asList(c.joints).includes('j_origin')).map((c) => c.type).join(',') || 'none'}`; };

for (const host of ['shaper', 'penplotter']) {
  const H = (id) => `H-${host}-${id}`;
  await runCase(H('D-02'), 'free end of a single line', { host, scene: () => line([-40, 10], [20, 10]), pick: () => click(-40, 10) });
  await runCase(H('D-06'), '2-point rectangle corner', { host, scene: () => rect2([20, 10], [60, 40]), pick: () => click(60, 40) });
  await runCase(H('D-07'), '6-side polygon corner (shared)', { host, scene: () => polygon([-40, 20], 15), pick: () => clickJoint(lines()[0].joints[0]) });
  await runCase(H('D-26'), 'lone line', { host, scene: () => line([-40, 10], [20, 10]), pick: () => click(-10, 10) });
  await runCase(H('D-27'), 'one side of a rectangle', { host, scene: () => rect2([20, 10], [60, 40]), pick: () => click(40, 40) });
  await runCase(H('D-52'), 'Horizontal glyph', { host, scene: () => line([-40, 10], [20, 10]), pick: glyph((c) => c.type === 'horizontal') });
  await runCase(H('D-66'), 'driving linear dimension', { host, scene: async () => { await line([-40, -20], [20, -20]); await dimension([[-10, -20]], [-10, -32], 60); }, pick: glyph((c) => c.type === 'distance') });
  await runCase(H('D-74'), 'WINDOW box around the rectangle left half', { host, scene: () => rect2([-40, -20], [40, 20]), pick: () => dragW([-50, 30], [-20, -30]) });
  await runCase(H('D-80'), 'PATH Backspace', { host, scene: () => line([-40, 10], [20, 10]), pick: () => click(-10, 10), del: () => key('Backspace') });
  await runCase(H('D-81'), 'PATH right-click > Delete', { host, scene: () => line([-40, 10], [20, 10]), pick: async () => {}, del: () => rightClickDelete(-10, 10) });
  await runCase(H('D-84'), 'PATH footer red X', { host, scene: () => line([-40, 10], [20, 10]), pick: () => click(-10, 10), del: () => footerDelete() });
  await runCase(H('O-01'), 'origin clicked, Delete', { host, scene: () => line([-40, 10], [20, 10]), pick: () => click(0, 0), extra: originRow });
  await runCase(H('O-08b'), 'TWO lines from the origin: the origin clicked, Delete', { host, scene: async () => { await line([0, 0], [30, 20]); await line([0, 0], [-30, 25]); }, pick: () => click(0, 0), extra: originRow });
  await runCase(H('O-09b'), 'line from the origin + another line dimensioned to the origin: the first line deleted', { host, scene: async () => { await line([0, 0], [30, 20]); await line([-40, 25], [-20, 30]); await dimension([[-20, 30], [0, 0]], [-40, -10], null); }, pick: () => click(15, 10), extra: originRow });
}
await K.closeAll();

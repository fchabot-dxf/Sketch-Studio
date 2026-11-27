// tests/audits/delete-audit-1042-selections.mjs — TASK 1042 (AUDIT ONLY, outside the gate): the SELECTION rows D-73..D-78, the PATH rows D-79..D-84
// and the ORIGIN rows O-01..O-12 (owner rule 2026-11-27: the origin is never deletable, by any path). SketchStudio in Node: real clicks, Shift / Ctrl
// clicks, box drags, the Delete key, Backspace, the right-click menu's Delete row, the footer's red X, the Parameters window's bin.
// Run: node tests/audits/delete-audit-1042-selections.mjs
import * as K from './delete-audit-1042-kit.js';
const { line, rect2, circle, polygon, slotCC, constrain, dimension, runCase, click, clickShape, clickJoint, shapesOf, jp, theApp, key, tool, esc2, quiet, rightClickDelete, footerDelete, dragW, W } = K;

const st = () => theApp().state;
const lines = () => shapesOf((s) => s.type === 'line' && !s.isConstruction);
const three = async () => { await line([-40, -20], [-10, -25]); await line([0, 10], [30, 15]); await line([40, -30], [60, 20]); };
const originRow = () => { const o = st().joints.get('j_origin'); return `origin ${o ? `kept at (${K.f(o.x)}, ${K.f(o.y)}) fixed=${!!o.fixed}` : 'GONE'}; constraints naming the origin ${st().constraints.filter((c) => K.asList(c.joints).includes('j_origin') || c.joint === 'j_origin').map((c) => c.type).join(',') || 'none'}`; };

// ---- SELECTIONS
await runCase('D-73', 'three separate lines: click, Shift+click, Shift+click', { scene: three, pick: async () => { await clickShape(lines()[0].id); await clickShape(lines()[1].id, 0.5, { shift: true }); await clickShape(lines()[2].id, 0.5, { shift: true }); } });
await runCase('D-73b', 'three separate lines: click, Ctrl+click, Ctrl+click', { scene: three, pick: async () => { await clickShape(lines()[0].id); await clickShape(lines()[1].id, 0.5, { ctrl: true }); await clickShape(lines()[2].id, 0.5, { ctrl: true }); } });
await runCase('D-74', 'WINDOW box (left to right) fully around the rectangle\'s left half: 1 side inside, 2 crossing, 2 corners inside', { scene: () => rect2([-40, -20], [40, 20]), pick: () => dragW([-50, 30], [-20, -30]) });
await runCase('D-74b', 'CROSSING box (right to left) over the same half', { scene: () => rect2([-40, -20], [40, 20]), pick: () => dragW([-20, -30], [-50, 30]) });
await runCase('D-74c', 'WINDOW box around the polygon leftmost corner only (no curve fully inside; the box starts on empty canvas left of it)', { scene: () => polygon([-20, 0], 25), pick: async () => { const ids = [...new Set(lines().flatMap((l) => l.joints))]; const p = ids.map(jp).sort((a, b) => a[0] - b[0])[0]; await dragW([p[0] - 5, p[1] + 8], [p[0] + 3, p[1] - 8]); }, extra: () => `history ${st().history.length}` });
await runCase('D-75', 'a line + a point (Shift+click the end of another line)', { scene: async () => { await line([-40, -20], [-10, -25]); await line([10, 10], [40, 15]); }, pick: async () => { await clickShape(lines()[0].id); await clickJoint(lines()[1].joints[1], { shift: true }); } });
await runCase('D-76', 'a whole rectangle (window box around it)', { scene: () => rect2([-40, -20], [40, 20]), pick: () => dragW([-50, 30], [50, -30]) });
await runCase('D-76b', 'a whole centre rectangle (window box around it): its diagonals and centre point', { scene: async () => { await tool('rect'); st().rectMode = 'rect-center'; await click(10, 10); await click(40, 30); await esc2(); await tool('select'); }, pick: () => dragW([-30, 40], [50, -20]) });
await runCase('D-76c', 'a whole rectangle: its 4 sides clicked (Shift)', { scene: () => rect2([-40, -20], [40, 20]), pick: async () => { await click(0, -20); await click(40, 0, { shift: true }); await click(0, 20, { shift: true }); await click(-40, 0, { shift: true }); } });
await runCase('D-76d', 'a whole slot: 2 sides + 2 caps clicked (Shift), the centre line not', { scene: () => slotCC([-30, 10], [20, 10], 16), pick: async () => { const ss = shapesOf((s) => !s.isConstruction); for (let i = 0; i < ss.length; i++) await clickShape(ss[i].id, 0.5, { shift: i > 0 }); } });
await runCase('D-77', 'Ctrl+A, then Delete', { scene: three, pick: () => key('a', { ctrl: true }) });
// D-78: a stored design: Sketch 1 LOCKED (a line), Sketch 2 HIDDEN (a line), Sketch 3 active (a line); a window box around everything, Delete
const layered = (() => {
  const J = (id, x, y, sk) => [id, { x, y, fixed: false, sketchId: sk }];
  return { version: 3, hosts: {}, geometry: {
    joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }], J('a', -40, -20, 'sketch-1'), J('b', -10, -20, 'sketch-1'), J('c', -40, 10, 'sketch-2'), J('d', -10, 10, 'sketch-2'), J('e', 10, 10, 'sketch-3'), J('f', 40, 15, 'sketch-3')],
    shapes: [{ id: 'L1', type: 'line', joints: ['a', 'b'], sketchId: 'sketch-1' }, { id: 'L2', type: 'line', joints: ['c', 'd'], sketchId: 'sketch-2' }, { id: 'L3', type: 'line', joints: ['e', 'f'], sketchId: 'sketch-3' }],
    constraints: [{ type: 'horizontal', joints: ['a', 'b'] }, { type: 'distance', joints: ['a', 'b'], value: 30, name: 'd1', offset: -10 }],
    parameters: [],
    sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true, locked: true }, { id: 'sketch-2', name: 'Sketch 2', visible: false }, { id: 'sketch-3', name: 'Sketch 3', visible: true }],
    activeSketchId: 'sketch-3', groups: [], profiles: [] } };
})();
await runCase('D-78', 'window box around everything with a LOCKED sketch and a HIDDEN sketch in the box', { view: { centre: { x: 0, y: 0 }, w: 200, doc: layered }, scene: async () => {}, pick: () => dragW([-60, 40], [60, -40]) });
await runCase('D-78b', 'a click on the LOCKED sketch\'s line, Delete', { view: { centre: { x: 0, y: 0 }, w: 200, doc: layered }, scene: async () => {}, pick: () => click(-25, -20) });

// ---- PATHS (a lone line selected; the scene and the pick are the same, only the delete differs)
const lone = () => line([-40, 10], [20, 10]);
const pickLone = () => click(-10, 10);
await runCase('D-79', 'PATH Delete key', { scene: lone, pick: pickLone });
await runCase('D-80', 'PATH Backspace', { scene: lone, pick: pickLone, del: () => key('Backspace') });
await runCase('D-81', 'PATH right-click on the line > Delete', { scene: lone, pick: async () => {}, del: () => rightClickDelete(-10, 10) });
await runCase('D-84', 'PATH the footer\'s red X', { scene: lone, pick: pickLone, del: () => footerDelete() });
await runCase('D-81b', 'PATH right-click on a dimension label > Delete dimension', { scene: async () => { await lone(); await dimension([[-10, 10]], [-10, 22], 60); }, pick: async () => {}, del: async () => { await quiet(() => theApp().frames(2)); const c = st().constraints.find((x) => x.type === 'distance'); const g = c.glyphPos; return rightClickDelete(g.x, g.y, { target: K.labelOf(c) }); } });
await runCase('D-81c', 'PATH right-click on an end point > Delete', { scene: lone, pick: async () => {}, del: () => rightClickDelete(20, 10) });
// D-83: the Parameters window: its bin on the dimension's row
await runCase('D-83', 'PATH the Parameters window\'s bin on a sketch dimension\'s row (d1, used by nothing)', { scene: async () => { await lone(); await dimension([[-10, 10]], [-10, 22], 60); }, pick: async () => {},
  del: async () => quiet(async () => {
    const a = theApp(); const doc = a.document;
    const fx = doc.querySelector('#btn-parameters, [aria-label="Parameters"], [data-footer="parameters"]');
    if (fx) a.press(fx); else a.key('P', { shift: true });
    a.frames(2);
    const all = [...doc.querySelectorAll('tr.sk-ptable-row')];
    const rows = all.filter((tr) => /d1/.test(tr.textContent) || tr.dataset.name === 'd1' || [...tr.querySelectorAll('input')].some((i) => i.value === 'd1'));
    const bin = rows.map((tr) => tr.querySelector('button.pt-del')).find(Boolean);
    const info = { open: fx ? fx.getAttribute('aria-expanded') : null, tableRows: all.map((tr) => tr.className.replace('sk-ptable-row', '').trim() + ':' + (tr.dataset.name || tr.textContent.trim().slice(0, 12))), d1Rows: rows.length, bin: !!bin, binTitle: bin ? bin.title : null, binAriaDisabled: bin ? bin.getAttribute('aria-disabled') : null };
    if (bin && !bin.disabled) a.press(bin);
    a.frames(2);
    return info;
  }) });

// ---- ORIGIN (owner rule: never deletable, by any path)
const orx = { extra: () => originRow() };
await runCase('O-01', 'origin clicked, Delete key (nothing else drawn)', { scene: async () => {}, pick: () => click(0, 0), ...orx });
await runCase('O-01b', 'origin clicked, Delete key (a lone line elsewhere)', { scene: lone, pick: () => click(0, 0), ...orx });
await runCase('O-02', 'origin clicked, Backspace', { scene: lone, pick: () => click(0, 0), del: () => key('Backspace'), ...orx });
await runCase('O-03', 'origin: right-click on it > Delete (if offered)', { scene: lone, pick: async () => {}, del: () => rightClickDelete(0, 0), ...orx });
await runCase('O-04', 'origin clicked, footer red X', { scene: lone, pick: () => click(0, 0), del: () => footerDelete(), ...orx });
await runCase('O-05', 'Ctrl+A then Delete (a line from the origin drawn)', { scene: () => line([0, 0], [30, 20]), pick: () => key('a', { ctrl: true }), ...orx });
await runCase('O-06', 'window box including the origin and a lone line, Delete', { scene: lone, pick: () => dragW([-50, 30], [30, -10]), ...orx });
await runCase('O-06b', 'crossing box including the origin only, Delete', { scene: lone, pick: () => dragW([5, -5], [-5, 5]), ...orx });
await runCase('O-07', 'a line drawn FROM the origin: the line clicked, Delete', { scene: () => line([0, 0], [30, 20]), pick: () => click(15, 10), ...orx, extra: ({ before }) => `line joints before ${JSON.stringify(before.shapes.map((s) => s.joints))}; coincidents ${JSON.stringify(before.constraints.filter((c) => c.type === 'coincident').map((c) => c.joints))}; ${originRow()}` });
await runCase('O-08', 'a line drawn FROM the origin: its origin end clicked, Delete', { scene: () => line([0, 0], [30, 20]), pick: () => click(0, 0), ...orx });
await runCase('O-08b', 'TWO lines from the origin: the origin clicked, Delete', { scene: async () => { await line([0, 0], [30, 20]); await line([0, 0], [-30, 25]); }, pick: () => click(0, 0), ...orx });
await runCase('O-08c', 'TWO lines from the origin: the origin clicked, footer red X', { scene: async () => { await line([0, 0], [30, 20]); await line([0, 0], [-30, 25]); }, pick: () => click(0, 0), del: () => footerDelete(), ...orx });
await runCase('O-08d', 'TWO lines from the origin: right-click the origin', { scene: async () => { await line([0, 0], [30, 20]); await line([0, 0], [-30, 25]); }, pick: async () => {}, del: () => rightClickDelete(0, 0), ...orx });
await runCase('O-09b', 'a line FROM the origin + a SEPARATE line whose end is dimensioned to the origin: the first line clicked, Delete (does the other line dimension to the origin survive?)', {
  scene: async () => { await line([0, 0], [30, 20]); await line([-40, 25], [-20, 30]); await dimension([[-20, 30], [0, 0]], [-40, -10], null); },
  pick: () => click(15, 10), ...orx, extra: ({ before }) => `before: cons ${JSON.stringify(before.constraints.map((c) => [c.type, c.joints && c.joints.map((j) => (j === 'j_origin' ? 'ORIGIN' : 'p')), c.name]))}; ${originRow()}` });
await runCase('O-09c', 'a line FROM the origin + a SEPARATE line glued to the origin (Coincident): the first line clicked, Delete', {
  scene: async () => { await line([0, 0], [30, 20]); await line([-40, 25], [-20, 30]); await constrain('coincident', [-20, 30], [0, 0]); },
  pick: () => click(15, 10), ...orx, extra: ({ before }) => `before: cons ${JSON.stringify(before.constraints.map((c) => [c.type, c.joints && c.joints.map((j) => (j === 'j_origin' ? 'ORIGIN' : 'p'))]))}; ${originRow()}` });
await runCase('O-09', 'TWO lines from the origin + a dimension origin-to-point on the 2nd: the 1st line clicked, Delete (do the 2nd line\'s origin ties survive?)', {
  scene: async () => { await line([0, 0], [30, 20]); await line([0, 0], [-30, 25]); await dimension([[-30, 25], [0, 0]], [-40, -10], null); },
  pick: () => click(15, 10), ...orx, extra: ({ before }) => `before: shapes ${JSON.stringify(before.shapes.map((s) => s.joints))} cons ${JSON.stringify(before.constraints.map((c) => [c.type, c.joints, c.name]))}; ${originRow()}` });
await runCase('O-10', 'a rectangle with a corner ON the origin: one side through it clicked, Delete', { scene: () => rect2([0, 0], [40, 25]), pick: () => click(20, 0), ...orx, extra: ({ before }) => `origin ties before ${before.constraints.filter((c) => K.asList(c.joints).includes('j_origin')).map((c) => c.type)}; ${originRow()}` });
await runCase('O-11', 'X axis clicked with the Select tool, Delete', { scene: lone, pick: () => click(60, 0), ...orx });
await runCase('O-12', 'Y axis clicked with the Select tool, Delete', { scene: lone, pick: () => click(0, 35), ...orx });
await K.closeAll();

// tests/audits/files-audit-1024-import.mjs — TASK 1024 (AUDIT ONLY): SVG and DXF import through the real "Import SVG / DXF…" menu entry (file chooser answered over CDP).
// Fixtures: tests/fixtures/files-1024/*.svg|*.dxf (written for this audit). Run: node tests/audits/files-audit-1024-import.mjs      Rows F-40 ..
import path from 'node:path';
import { startKit, row, sleep, FIX_DIR } from './files-audit-1024-kit.js';
import { importViaMenu } from '../helpers/import-via-menu.js';

const k = await startKit({ tag: '1024-imp' });
const fx = (n) => path.join(FIX_DIR, n);
const r2 = (v) => Math.round(v * 1000) / 1000;
const read = () => k.evalJs(`(() => {
  const svg = document.getElementById('svgCanvas');
  const out = [];
  svg.querySelectorAll('.shape-elem[data-shape-id]').forEach((el) => {
    const t = el.tagName.toLowerCase(); const o = { t, dash: !!(el.getAttribute('stroke-dasharray') && el.getAttribute('stroke-dasharray') !== 'none') };
    const g = (n) => +el.getAttribute(n);
    if (t === 'line') Object.assign(o, { x1: g('x1'), y1: g('y1'), x2: g('x2'), y2: g('y2') });
    else if (t === 'circle') Object.assign(o, { cx: g('cx'), cy: g('cy'), r: g('r') });
    else if (t === 'path') o.d = el.getAttribute('d');
    out.push(o);
  });
  return out;
})()`);
const fmtShape = (s) => s.t === 'line' ? `L(${r2(s.x1)},${r2(s.y1)}->${r2(s.x2)},${r2(s.y2)})${s.dash ? 'c' : ''}` : s.t === 'circle' ? `C(${r2(s.cx)},${r2(s.cy)} r${r2(s.r)})${s.dash ? 'c' : ''}` : `P[${(s.d || '').replace(/(\d+\.\d{2})\d+/g, '$1').slice(0, 90)}]${s.dash ? 'c' : ''}`;
const bbox = (list) => { let a = [Infinity, Infinity, -Infinity, -Infinity]; for (const s of list) { const pts = s.t === 'line' ? [[s.x1, s.y1], [s.x2, s.y2]] : s.t === 'circle' ? [[s.cx - s.r, s.cy - s.r], [s.cx + s.r, s.cy + s.r]] : ((s.d || '').match(/-?\d+(\.\d+)?(e-?\d+)?/g) || []).reduce((acc, v, i, arr) => (i % 2 ? acc : (arr[i + 1] !== undefined ? [...acc, [+v, +arr[i + 1]]] : acc)), []); for (const [x, y] of pts) { a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)]; } } return a.map(r2); };
const undoState = () => k.undoState();

async function importOne(id, file, expect) {
  await k.open('sketchstudio');
  await k.clearToasts();
  const before = (await read()).length;
  let res;
  try { res = await importViaMenu(k.cdp, fx(file)); } catch (e) { row(id, `${file}: chooser failed: ${e.message}`); return null; }
  await sleep(1600);
  const toasts = await k.toasts();
  const shapes = await read();
  const dialogErr = await k.evalJs(`(() => { const e = document.querySelector('.sk-sidebar .sk-sidebar-error, .sk-sidebar-msg[data-level="error"]'); return e ? e.textContent.trim() : null; })()`);
  const kinds = {}; shapes.forEach((s) => { kinds[s.t] = (kinds[s.t] || 0) + 1; });
  row(id, `${file} (${res.label}): shapes ${before}->${shapes.length} ${JSON.stringify(kinds)} bbox(mm)=${JSON.stringify(bbox(shapes))} toasts=${JSON.stringify(toasts)} drawerError=${JSON.stringify(dialogErr)} undo=${JSON.stringify(await undoState())} | expected: ${expect}`);
  return { shapes, toasts };
}
try {
  // ---- SVG
  let r = await importOne('F-40', 'shapes-mm.svg', 'scale 1 mm/unit (100mm / viewBox 100); line (0,0)-(30,0); rect 10,10-30,20; circle (60,30) r8; arc r10 (10,50)-(30,50); text skipped and said');
  if (r) { row('F-40a', 'shapes: ' + r.shapes.map(fmtShape).join(' ')); await k.shotFull('F40-svg-shapes.png').then((e) => row('F-40e', 'evidence ' + e)); }
  r = await importOne('F-41', 'nested-transform.svg', 'translate(10,20) scale(2) rotate(90): line (10,20)-(10,40); circle centre (20,30) r6; flip matrix: line (50,90)-(80,90)');
  if (r) row('F-41a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));
  r = await importOne('F-42', 'units-in.svg', '2in x 1in: scale 0.254 mm/unit; circle centre (25.4,12.7) r2.54; line (0,0)-(50.8,0)');
  if (r) row('F-42a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));
  r = await importOne('F-43', 'units-px.svg', 'no viewBox, px at 96 dpi: circle r 24px = 6.35mm; line 96px = 25.4mm');
  if (r) row('F-43a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));
  r = await importOne('F-44', 'units-viewbox-only.svg', 'viewBox only: 1 mm/unit assumed and said: circle r5, line 40');
  if (r) row('F-44a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));
  r = await importOne('F-45', 'units-percent.svg', 'width 100%: no usable size: px at 96 dpi assumed: line 25.4mm');
  if (r) row('F-45a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));
  r = await importOne('F-46', 'many-groups.svg', 'two squares, nested <g id=A><g id=B>: groups named from ids');
  r = await importOne('F-47', 'huge-coords.svg', 'a 1e9 line (far off), a NaN line, a negative-radius circle, a zero-radius circle: each handled and said');
  if (r) row('F-47a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));
  r = await importOne('F-48', 'malformed.svg', 'a plain refusal naming the file as broken, nothing imported');
  r = await importOne('F-49', 'not-svg.svg', 'a plain refusal: root is not <svg>');
  r = await importOne('F-50', 'no-geometry.svg', '"Nothing imported" with the skipped count');
  r = await importOne('F-58', 'nonuniform.svg', 'scale(2,1): a circle becomes a 10 x 5 ellipse (or is refused), the r5 arc an elliptical arc; relative path m/l/h/v/z: two closed shapes');
  if (r) row('F-58a', 'shapes: ' + r.shapes.slice(0, 60).map(fmtShape).join(' '));
  // ---- DXF
  r = await importOne('F-51', 'shapes-mm.dxf', 'INSUNITS 4 mm; DXF Y is up so world y = -y: line (0,0)-(40,0); dashed line y=-5 construction; circle (60,-20) r8; arc centre (20,-40) r10 90 deg (30,-40)->(20,-50); lwpolyline 3 pts; spline; text skipped');
  if (r) { row('F-51a', 'shapes: ' + r.shapes.map(fmtShape).join(' ')); await k.shotFull('F51-dxf-shapes.png').then((e) => row('F-51e', 'evidence ' + e)); }
  r = await importOne('F-52', 'units-inch.dxf', 'INSUNITS 1 (inch): line 2 in = 50.8 mm; circle (25.4,-25.4) r12.7');
  if (r) row('F-52a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));
  r = await importOne('F-53', 'units-none.dxf', 'no $INSUNITS: unit assumed and said (line 25 -> 25 mm?)');
  if (r) row('F-53a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));
  r = await importOne('F-54', 'malformed.dxf', 'a plain refusal, nothing imported');
  r = await importOne('F-55', 'garbage-numbers.dxf', 'non-numeric coordinates: refused or skipped and said');
  if (r) row('F-55a', 'shapes: ' + r.shapes.map(fmtShape).join(' '));

  // ---- undo of an import, and a second import into a design that has content
  await k.open('sketchstudio');
  await k.drawLine('svgCanvas', 0.3);
  const n0 = await k.shapes();
  await importViaMenu(k.cdp, fx('shapes-mm.svg')); await sleep(1500);
  const n1 = await k.shapes();
  await k.ctrlZ(); await sleep(400);
  const n2 = await k.shapes();
  await k.ctrlShiftZ(); await sleep(400);
  const n3 = await k.shapes();
  row('F-56', `import into a design holding a line: shapes ${n0} -> ${n1} (import) -> ${n2} (Ctrl+Z: one step?) -> ${n3} (redo); sketches in the tab=${await k.evalJs(`document.querySelectorAll('.sk-sketch-row, [data-sketch-id]').length`)}`);
  // drop of an svg on the canvas
  await k.evalJs(`(() => { const text = '<svg xmlns="http://www.w3.org/2000/svg" width="20mm" height="20mm" viewBox="0 0 20 20"><circle cx="10" cy="10" r="5"/></svg>'; const dt = new DataTransfer(); dt.items.add(new File([text], 'dropped.svg', { type: 'image/svg+xml' })); const svg = document.getElementById('svgCanvas'); for (const type of ['dragover', 'drop']) svg.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
  await sleep(1200);
  row('F-57', `drop a .svg on the drawing: shapes ${n3} -> ${await k.shapes()} toasts=${JSON.stringify(await k.toasts())}`);
} finally {
  console.log(`BLOCKED non-local requests: ${k.net.blocked().length}`);
  await k.close();
}

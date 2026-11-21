// tests/bezier-loops-761-dxf-tabs-live.test.js — TASK 761: a DXF whose outline holds a SPLINE (3 lines + a cubic, as Fusion writes it) dropped on Shaper's
// Design canvas (desktop 1280 x 800, real mouse; the page tools of tests/helpers/pocket-live.js):
//  1. the import makes 3 lines + 1 bezier, and the page's findLoops ONE loop of them;
//  2. Prepare: a click inside picks the region, Outside is offered and taken (TASK S3: the operations toolbar's button), 18 mm deep; Hold part -> Tabs: the tab marks and gap strips are drawn, one tab
//     on the curve (the bezier is one segment of the hold part's walk) (screenshot, zoomed on the curve);
//  3. the download: the pass writes the outline with its cubic `C`; the gap strips are closed paths.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

process.env.EVIDENCE_DIR = path.resolve('.evidence/761');
const { openPocketPage } = await import('./helpers/pocket-live.js');
// the spline outline: (0,0) -> (100,0) -> (100,50), the cubic (100,50) (70,90) (30,90) (0,50), back to (0,0); the import turns y up (-y on the canvas)
const DXF = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '100', '21', '0', '0', 'LINE', '8', '0', '10', '100', '20', '0', '11', '100', '21', '50',
  '0', 'SPLINE', '8', '0', '70', '8', '71', '3', '72', '8', '73', '4', ...[0, 0, 0, 0, 1, 1, 1, 1].flatMap((k) => ['40', String(k)]),
  '10', '100', '20', '50', '10', '70', '20', '90', '10', '30', '20', '90', '10', '0', '20', '50',
  '0', 'LINE', '8', '0', '10', '0', '20', '50', '11', '0', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');

const t = await openPocketPage({ tag: '761-dxf' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { evalJs, waitFor, openMode, clickWorld, clickEl, typeField, download, shotWorld, EVIDENCE_DIR } = t;
const ST = 'window.__designController.state';
const out = {};
try {
  await openMode('design');
  await waitFor(`document.getElementById('design-canvas').getBoundingClientRect().width > 0 && !!window.__designController`, 'Design shown');
  await evalJs(`(() => { const st = ${ST}; for (const k of [...st.joints.keys()]) if (k !== 'j_origin') st.joints.delete(k); st.shapes.length = 0; st.constraints.length = 0; st.saveState('clear'); })()`);
  await evalJs(`(() => { const dt = new DataTransfer(); dt.items.add(new File([${JSON.stringify(DXF)}], 'spline-outline-761.dxf', { type: 'application/dxf' })); const c = document.getElementById('design-canvas');
    c.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); c.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
  await waitFor(`${ST}.shapes.some((s) => s.type === 'bezier')`, '1: the DXF imported');
  out.kinds = await evalJs(`${ST}.shapes.map((s) => s.type)`);
  assert.deepStrictEqual(out.kinds.slice().sort(), ['bezier', 'line', 'line', 'line'], '1: 3 lines + 1 bezier');
  const L = await evalJs(`Promise.all([import('/packages/core/loop-finder.js'), import('/packages/core/loop-geometry.js')]).then(([F, G]) => { const st = ${ST}, by = new Map(st.shapes.map((s) => [s.id, s]));
    return F.findLoops(st).map((l) => { const p = G.loopPolygon(l, st, by); return { kinds: l.edges.map((e) => by.get(e).type).sort(), box: p.reduce((b, q) => [Math.min(b[0], q.x), Math.min(b[1], q.y), Math.max(b[2], q.x), Math.max(b[3], q.y)], [Infinity, Infinity, -Infinity, -Infinity]) }; }); })`);
  out.loops = L.map((l) => l.kinds);
  assert.deepStrictEqual(out.loops, [['bezier', 'line', 'line', 'line']], '1: the page\'s findLoops: ONE loop of the 4 curves');
  const box = L[0].box;
  out.box = box.map((v) => Math.round(v * 1000) / 1000);
  // ── 2. Prepare: Outside with tabs ──
  await openMode('prepare');
  await waitFor(`document.querySelectorAll('#prepare-world-group [data-shape-id]').length === 4`, 'Prepare draws the 4 edges');
  await clickWorld((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
  await waitFor(`window.__prepareView.selectedTargets().length === 1`, '2: a click inside picks the region'); // TASK S3: a click shows no card; the toolbar makes the operation
  out.menu = await evalJs(`Object.fromEntries([...document.querySelectorAll('#prepare-ribbon [id^="op-type-"]')].map((o) => [o.id.slice(8), !o.disabled]))`);
  assert.deepStrictEqual([out.menu.interior, out.menu.exterior, out.menu.pocket], [true, true, true], '2: Inside / Outside / Pocket offered (the toolbar)');
  await clickEl('#op-type-exterior');
  await waitFor(`document.querySelector('.cut-type-cur').textContent === 'Outside'`, 'Outside picked');
  await typeField('.cut-depth', '18');
  await clickEl('.cut-row[data-row="holdPart"] .cut-preset[data-value="tabs"]');
  await waitFor(`[...document.querySelectorAll('.cut-note div')].some((d) => /tabs?,/.test(d.textContent))`, '2: the tabs note');
  out.note = await evalJs(`[...document.querySelectorAll('.cut-note div')].map((d) => d.textContent)`);
  out.marks = await evalJs(`({ tabs: document.querySelectorAll('#prepare-canvas .sk-tab-mark').length, strips: document.querySelectorAll('#prepare-canvas .sk-strip').length })`);
  assert.ok(out.marks.tabs >= 3 && out.marks.strips === out.marks.tabs, '2: the tab marks and their gap strips are drawn: ' + JSON.stringify(out.marks));
  const chordY = -50; // the spline's chord (y up: -50 on the canvas), the curve beyond it
  out.tabOnCurve = await evalJs(`[...document.querySelectorAll('#prepare-canvas .sk-tab-mark')].map((e) => (e.getAttribute('d').match(/-?[\\d.]+/g) || []).map(Number)).some((n) => n.length >= 2 && n[1] < ${chordY} - 0.5)`);
  assert.ok(out.tabOnCurve, '2: a tab sits on the curve');
  await shotWorld('dxf-spline-outside-tabs.png', [box[0] - 8, box[1] - 8, box[2] + 8, box[3] + 8], 2); // the outline and its gap strips (the bit + 1 mm wide)
  // ── 3. the download ──
  const file = await download();
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'dxf-spline-outside-tabs-download.svg'), file);
  const els = [...file.matchAll(/<path ([^>]*)\/>/g)].map((m) => ({ d: (/ d="([^"]*)"/.exec(' ' + m[1]) || [])[1] || '' }));
  out.withCubic = els.filter((e) => /C /.test(e.d)).length;
  assert.ok(out.withCubic >= 1, '3: the outline is written with its cubic C');
  assert.ok(els.every((e) => /Z\s*$/.test(e.d)), '3: every path of the file is closed (the pass and the gap strips)');
  out.paths = els.length;
  console.log(`bezier-loops-761-dxf-tabs-live: ALL CHECKS PASSED ${JSON.stringify(out)}`);
} finally { await t.close(); }

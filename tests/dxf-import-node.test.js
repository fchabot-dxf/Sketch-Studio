// tests/dxf-import-node.test.js — TASK 610 (node port of tests/dxf-import-live.test.js, TASK 478): the ONE 'Import SVG / DXF' entry in Shaper (the sidebar's File menu + the file
// chooser, kit override 15, into Shaper's own import module cut-import.js createShaperImporter): a Fusion sketch DXF lands as true lines + arcs with construction lines and
// counted skips, its closed profiles are selectable loops in Prepare, a malformed DXF is a readable status (no throw), and the Fusion add-in SVG imports with its cut types and
// the compound pocket as a profile. Same asserts, same steps, same fixtures; the status line is the app's own #group-status (apps/shaper/src/group-status.js). Dropped: the
// two screenshots (EVIDENCE_DIR evidence, no asserts).
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { open } from './helpers/node-app.js';
import { worldToScreen } from '#ui/coords.js';
import { findLoops } from '#core/loop-finder.js';
import { CUT_PLAN } from '../apps/shaper/src/cut-plan.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await open({ host: 'shaper', sidebar: true });
try {
  const doc = app.document;
  const q = (sel) => doc.querySelector(sel);
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  const openMode = (mode) => { pressEl(`[data-mode="${mode}"]`); assert.strictEqual(q('.mode-btn.active').dataset.mode, mode, 'the ' + mode + ' tab opens'); };
  const importFile = async (file) => { // clear the status line, import through the sidebar's entry + the file chooser, wait for the app to write the import's result into it
    const el = doc.getElementById('group-status'); if (el) el.textContent = '';
    pressEl('.sk-sidebar-btn'); await app.pause(50);
    const label = q('[data-action="import-file"]').textContent.trim();
    assert.strictEqual(label, 'Import SVG / DXF…', 'the ONE entry is in the file menu (TASK 566)');
    pressEl('[data-action="import-file"]');
    await app.waitFor(() => app.hasFileChooser(), 'the file chooser to open');
    app.chooseFile({ name: path.basename(file), text: fs.readFileSync(file, 'utf8') });
    await app.waitFor(() => !!doc.getElementById('group-status') && doc.getElementById('group-status').textContent !== '', 'the import result in #group-status');
    return doc.getElementById('group-status').textContent;
  };
  openMode('design');
  // the ONE entry is the file menu's "Import SVG / DXF…" (TASK 566; the old hand-built button is gone)
  assert.strictEqual(!!doc.getElementById('svg-import-btn'), false, 'the hand-built button is gone');

  // a malformed DXF: a readable status, no exception
  const bad = path.join(os.tmpdir(), 'sk-478-bad.dxf'); fs.writeFileSync(bad, 'hello world\nthis is not a dxf\n');
  const badStatus = await importFile(bad);
  console.log('malformed:', badStatus);
  assert.match(badStatus, /^Import failed: /, 'a malformed DXF is reported, not thrown');
  assert.strictEqual(app.state.shapes.length, 0, 'and imports nothing');

  // the owner's real Fusion sketch DXF
  const st1 = await importFile(path.join(REPO_ROOT, 'tests', 'fixtures', 'dxf', 'fusion-sketch4.dxf'));
  console.log('dxf status:', st1);
  assert.match(st1, /Imported 26 shapes .* @ inches/); assert.match(st1, /4 construction/); assert.match(st1, /POINT .* x5|POINT .*\u00d75/);
  const t = {}; for (const s of app.state.shapes) { const k = s.type + (s.isConstruction ? '*' : ''); t[k] = (t[k] || 0) + 1; }
  assert.deepStrictEqual(t, { line: 20, 'line*': 4, arc: 2 });
  openMode('prepare');
  const loops = findLoops(app.state).map((l) => l.edges.length).join(',');
  assert.strictEqual(loops, '4,6,6,4', 'four closed loops through shared joints (construction lines do not split them): ' + loops);
  // a closed profile is SELECTABLE in Prepare: click inside the filleted rectangle (DXF -0.99..1.04 in x, 1.21..2.33 in y) -> the cut card appears
  const pc = doc.getElementById('prepare-canvas');
  const pt = worldToScreen(pc, { x: 0.02 * 25.4, y: -1.85 * 25.4 });
  app.click(Math.round(pt.x), Math.round(pt.y), { target: pc });
  const trig = q('.cut-type-trigger');
  assert.strictEqual(!!(trig && !trig.closest('[hidden]')), true, 'selecting the imported loop shows the cut card');

  // the Shaper Fusion add-in SVG (arcs): cut types from the grey fills, depths in cm, the compound path = a profile with a hole, real arcs
  openMode('design');
  const st2 = await importFile(path.join(REPO_ROOT, 'tests', 'fixtures', 'svg', 'fusion-shaper-addin-arcs.svg'));
  console.log('svg status:', st2);
  assert.match(st2, /Imported 39 shapes .* 6 cuts kept/);
  const plan = [...CUT_PLAN.entries()].map(([k, r]) => [k.split(':')[0], r.cutType, Math.round(r.cutDepth * 100) / 100]).sort();
  assert.deepStrictEqual(plan, [['loop', 'exterior', 81.28], ['loop', 'pocket', 17.78], ['loop', 'pocket', 17.78], ['loop', 'pocket', 27.94], ['loop', 'pocket', 17.78], ['profile', 'pocket', 5.08]].sort());
  console.log('dxf-import-node: ok');
} finally { await app.close(); }

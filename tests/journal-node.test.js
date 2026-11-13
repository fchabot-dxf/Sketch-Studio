// tests/journal-node.test.js — TASK 580 (node port of tests/journal-live.test.js, TASK 507), SketchStudio through tests/helpers/node-app.js: script a
// session (line, rect, a dimension, edit it 23.6 -> 17, undo, redo, delete), take the Diagnostic Log's report (app.report(): what Copy Report puts on the
// clipboard), then:
//   - replayReport(report) rebuilds EXACTLY the document the app reported (deep-equal),
//   - the step labels appear in the order the gestures were made (incl. 'edit dimension 23.6 -> 17'),
//   - a report taken right after Undo carries the undone step in journal.redo,
//   - the key ring records the key presses (Enter, Delete, ...) but NEVER the characters typed into the number input.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';
import { replayReport } from './harness/sketch.js';
import { boxOpen, findLabel, labelEl } from './helpers/node-dom-read.js';

const app = await open({ host: 'sketchstudio' });
try {
  const r = app.svg.getBoundingClientRect();
  const cv = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  const takeReport = () => { const text = JSON.stringify(app.report()); return { text, report: JSON.parse(text) }; }; // the clipboard holds the minified JSON text
  const labels = (rep) => rep.journal.steps.map((s) => s.label);
  const typeInBox = async (text) => { await app.waitFor(() => boxOpen(app), 'the dimension value input'); const i = app.document.getElementById('dimInput'); i.focus(); i.select(); app.type(text); app.enter(); };

  app.tool('line'); app.drag({ x: cv.x - 200, y: cv.y }, { x: cv.x, y: cv.y }, 2);
  app.tool('rect'); app.drag({ x: cv.x + 100, y: cv.y - 150 }, { x: cv.x + 250, y: cv.y - 50 }, 2);
  const g0 = takeReport().report.document.geometry;
  const L = g0.shapes.find((s) => s.type === 'line');
  const jpos = (id) => g0.joints.find((e) => e[0] === id)[1];
  const pa = app.toScreen(jpos(L.joints[0]).x, jpos(L.joints[0]).y), pb = app.toScreen(jpos(L.joints[1]).x, jpos(L.joints[1]).y);
  app.tool('dim');
  app.click(pa.x, pa.y); app.click(pb.x, pb.y);
  const mid = { x: Math.round((pa.x + pb.x) / 2), y: pa.y - 40 };
  app.move(mid.x, mid.y); app.click(mid.x, mid.y);
  await typeInBox('23.6');
  // edit it: double-click the label, type 17, Enter
  app.tool('select');
  const lab = findLabel(app, () => true);
  assert(lab, 'the dimension label is on screen');
  app.click(lab.x, lab.y, { target: () => labelEl(app, lab.idx) }); app.dblclick(lab.x, lab.y, { target: () => labelEl(app, lab.idx) });
  await typeInBox('17');
  // undo / redo through the ribbon buttons
  app.document.getElementById('btn-undo').click(); app.frames();
  const afterUndo = takeReport();
  assert.deepStrictEqual(afterUndo.report.journal.redo.map((s) => s.label), ['edit dimension 23.6 -> 17'], 'a report right after Undo carries the undone step');
  assert.deepStrictEqual(replayReport(afterUndo.report), afterUndo.report.document, 'replay after Undo = the document the app reported');
  app.document.getElementById('btn-redo').click(); app.frames();
  // delete the line: select it, the Delete key
  const a = jpos(L.joints[0]), b = jpos(L.joints[1]);
  const lp = app.toScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
  app.click(lp.x, lp.y);
  app.key("Delete");

  const { text, report } = takeReport();
  const doc = replayReport(report);
  assert.deepStrictEqual(doc, report.document, 'replayReport(report) deep-equals the live document the app serialized');
  const want = ['line', 'rect', 'dimension', 'edit dimension 23.6 -> 17'];
  const got = labels(report);
  let at = 0; for (const l of got) if (l === want[at]) at++;
  assert.strictEqual(at, want.length, `step labels appear in the order of the gestures: wanted ${JSON.stringify(want)} in ${JSON.stringify(got)}`);
  assert.ok(/^delete/.test(got[got.length - 1]), 'the last step is the delete: ' + JSON.stringify(got));
  assert.ok(report.journal.steps.every((s) => typeof s.t === 'number'), 'every step is timestamped');
  // the key ring: key presses in order, never the typed characters
  const keys = report.touchTrace.filter((e) => e.type === 'keydown');
  assert.ok(keys.some((k) => k.key === 'Enter') && keys.some((k) => k.key === 'Delete'), 'Enter and Delete are in the key ring');
  assert.ok(keys.some((k) => k.key === 'char' && k.inInput), 'characters typed into the number input are recorded only as "char"');
  assert.ok(!keys.some((k) => /^[0-9.]$/.test(k.key)), 'the digits typed into the input are NOT in the report');
  for (const f of ['app', 'url', 'ua', 't', 'viewport', 'touchTrace', 'log', 'document', 'journal']) assert.ok(f in report, 'report field ' + f);
  console.log('journal-node.test.js: ok', JSON.stringify({ steps: got, reportBytes: Buffer.byteLength(text) }));
} finally { await app.close(); }

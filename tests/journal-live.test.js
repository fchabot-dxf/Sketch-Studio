// tests/journal-live.test.js — TASK 507 (live headless, REAL pointer + key events): script a SketchStudio session (line, rect, a
// dimension, edit it 23.6 -> 17, undo, redo, delete), open the Diagnostic Log panel, press Copy Report, then in Node:
//   - replayReport(report) rebuilds EXACTLY the document the app reported (deep-equal),
//   - the step labels appear in the order the gestures were made (incl. 'edit dimension 23.6 -> 17'),
//   - a report taken right after Undo carries the undone step in journal.redo,
//   - the key ring records the key presses (Enter, Delete, ...) but NEVER the characters typed into the number input.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { replayReport } from './harness/sketch.js';

const cdp = await launchBrowser({ tag: '507', width: 1600, height: 900 });
if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { port, send, evalJs, navigate, waitForApp } = cdp;
try {
  await send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'] });
  await navigate(`http://127.0.0.1:${port}/apps/sketchstudio/index.html`, 8000);
  await waitForApp('svgCanvas');
  const mouse = (type, x, y, buttons, clickCount) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : (clickCount || 1) });
  const click = async (x, y, clickCount = 1) => { await mouse('mouseMoved', x, y, 0); await sleep(30); await mouse('mousePressed', x, y, 1, clickCount); await sleep(30); await mouse('mouseReleased', x, y, 0, clickCount); await sleep(250); };
  const centerOf = (sel) => evalJs(`(() => { const e = document.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const clickEl = async (sel) => { const c = await centerOf(sel); assert(c, sel + ' not found'); await click(c.x, c.y); };
  const drag = async (pts) => { await mouse('mouseMoved', pts[0][0], pts[0][1], 0); await sleep(30); await mouse('mousePressed', pts[0][0], pts[0][1], 1); for (const p of pts.slice(1)) { await mouse('mouseMoved', p[0], p[1], 1); await sleep(20); } const l = pts[pts.length - 1]; await mouse('mouseReleased', l[0], l[1], 0); await sleep(300); };
  const typeText = async (str) => { for (const ch of str) await sendRealKey(send, ch, ch === '.' ? 'Period' : 'Digit' + ch, ch === '.' ? 190 : 48 + Number(ch), 0, ch); };
  const W2S = (x, y) => evalJs(`(() => { const s = document.getElementById('svgCanvas'); const p = s.createSVGPoint(); p.x = ${x}; p.y = ${y}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
  // the REAL Diagnostic Log panel: open it, press Copy Report, read what landed on the clipboard, close it again
  const takeReport = async () => {
    await evalJs(`document.querySelector('.sk-diag-toggle').click()`); await sleep(200);
    await clickEl('.sk-diag-btn-primary'); await sleep(500);
    assert.strictEqual(await evalJs(`document.querySelector('.sk-diag-btn-primary').textContent`), 'Copied!', 'Copy Report reached the clipboard');
    const text = await evalJs(`navigator.clipboard.readText()`);
    await evalJs(`document.querySelector('.sk-diag-close').click()`); await sleep(100);
    return { text, report: JSON.parse(text) };
  };
  const labels = (r) => r.journal.steps.map((s) => s.label);

  const cv = await centerOf('#svgCanvas');
  await clickEl('#tool-line');
  await drag([[cv.x - 200, cv.y], [cv.x - 100, cv.y], [cv.x, cv.y]]);
  await clickEl('#tool-rect');
  await drag([[cv.x + 100, cv.y - 150], [cv.x + 150, cv.y - 100], [cv.x + 250, cv.y - 50]]);
  const g0 = (await takeReport()).report.document.geometry;
  const L = g0.shapes.find((s) => s.type === 'line');
  const jpos = (id) => g0.joints.find((e) => e[0] === id)[1];
  const pa = await W2S(jpos(L.joints[0]).x, jpos(L.joints[0]).y), pb = await W2S(jpos(L.joints[1]).x, jpos(L.joints[1]).y);
  await clickEl('#tool-dim');
  await click(pa.x, pa.y); await click(pb.x, pb.y);
  const mid = { x: Math.round((pa.x + pb.x) / 2), y: pa.y - 40 };
  await mouse('mouseMoved', mid.x, mid.y, 0); await sleep(200); await click(mid.x, mid.y);
  await typeText('23.6'); await sendRealKey(send, 'Enter', 'Enter', 13); await sleep(400);
  // edit it: double-click the label, type 17, Enter
  await clickEl('#tool-select');
  const lab = await centerOf('#svgCanvas .dim-label');
  assert(lab, 'the dimension label is on screen');
  await click(lab.x, lab.y); await sleep(80); await click(lab.x, lab.y, 2); await sleep(400);
  await typeText('17'); await sendRealKey(send, 'Enter', 'Enter', 13); await sleep(400);
  // undo / redo through the real ribbon buttons
  await clickEl('#btn-undo');
  const afterUndo = await takeReport();
  assert.deepStrictEqual(afterUndo.report.journal.redo.map((s) => s.label), ['edit dimension 23.6 -> 17'], 'a report right after Undo carries the undone step');
  assert.deepStrictEqual(replayReport(afterUndo.report), afterUndo.report.document, 'replay after Undo = the document the app reported');
  await clickEl('#btn-redo');
  // delete the line: select it, real Delete key
  const a = jpos(L.joints[0]), b = jpos(L.joints[1]);
  const lp = await W2S((a.x + b.x) / 2, (a.y + b.y) / 2);
  await click(lp.x, lp.y);
  await sendRealKey(send, 'Delete', 'Delete', 46); await sleep(400);

  const { text, report } = await takeReport();
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
  if (process.env.EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.EVIDENCE_DIR, 'session-report.json'), text);
  console.log('journal-live.test.js: ok', JSON.stringify({ steps: got, reportBytes: Buffer.byteLength(text) }));
} finally {
  await cdp.close();
}
process.exit(0);

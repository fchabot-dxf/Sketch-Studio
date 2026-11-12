// tests/diagnostic-log-copy.test.js — TASK 544 (unit): the text "Copy Report" puts on the clipboard is the WHOLE report as MINIFIED JSON.
//  (a) JSON.parse(reportToText(report)) deep-equals the report (every field, incl. a real document + journal)
//  (b) it is one line (no pretty-print whitespace), so pasting it into a chat is one paste
//  (c) formatBytes names KB / MB for the status line
import assert from 'node:assert';

const listeners = [];
globalThis.window = { addEventListener: (t, f) => listeners.push([t, f]), innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 };
globalThis.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
globalThis.location = { href: 'http://test/' };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });

const { dbg } = await import('#core/debug.js');
const { createSketch } = await import('./harness/sketch.js');
const diag = await import('#ui/diagnostic-log.js');

dbg.log('t-copy', 'a log line', { n: 1, s: 'multi\nline "quoted"' });
const sk = createSketch();
const report = diag.buildReport({ appId: 'test', getState: sk.state });
assert.ok(report.document && report.journal, 'the report carries the document and the journal');
const text = diag.reportToText(report);
assert.deepStrictEqual(JSON.parse(text), JSON.parse(JSON.stringify(report)), '(a) the copied text parses back to the report');
assert.deepStrictEqual(Object.keys(JSON.parse(text)), Object.keys(report), '(a) every top-level field is present, same order');
assert.ok(!/\n/.test(text), '(b) minified: no newline in the copied text');
assert.ok(text.length < JSON.stringify(report, null, 1).length, '(b) smaller than the pretty form');
assert.strictEqual(diag.formatBytes(512), '512 B');
assert.strictEqual(diag.formatBytes(2048), '2.0 KB');
assert.strictEqual(diag.formatBytes(1258291), '1.2 MB');
console.log('diagnostic-log-copy: OK');

// ── TASK 544 (content trim): a synthetic session with 500 pointerMoves, renderer spam, 3 constraint adds, 1 error and an old warning
const { REPORT_LOG_KEEP, REPORT_TOUCH_KEEP, trimTouchTrace } = diag;
dbg.warn('app', 'OLD-WARNING from long ago');
for (let i = 0; i < 70; i++) dbg.log('t-old-action', 'old meaningful action', { i }); // evicted by age, but counted
for (let i = 0; i < 400; i++) dbg.log('selection', '[selection-tools] pointerMove', { x: -1 }); // 400 identical moves: the ring collapses them into one entry with count 400
dbg.log('t-sep', 'separator');
for (let i = 0; i < 80; i++) { dbg.log('selection', '[selection-tools] pointerMove', { x: i }); if (i % 3 === 0) dbg.log('renderer', 'constraints', { total: i, visible: i }); }
dbg.log('selection', '[selection-tools] pointerUp performedDrag', { n: 1 });
for (let k = 0; k < 3; k++) dbg.log('constraints', '[addConstraint] added', { k });
for (let i = 0; i < 50; i++) dbg.log('selection', '[selection-tools] pointerMove', { x: 1000 + i });
dbg.error('app', 'BOOM the error');
dbg.log('line-tool', '[line-tool] created end joint');
const full = diag.buildReport({ appId: 'test', getState: sk.state, full: true });
const trim = diag.buildReport({ appId: 'test', getState: sk.state });
const msg = (e) => String(e.args[0]);
assert.ok(trim.log.some((e) => msg(e) === 'OLD-WARNING from long ago' && e.level === 'warn'), 'the old warning is kept');
assert.ok(trim.log.some((e) => msg(e) === 'BOOM the error' && e.level === 'error'), 'the error is kept');
assert.strictEqual(trim.log.filter((e) => msg(e) === '[addConstraint] added').length, 3, 'the 3 constraint adds are kept');
assert.ok(trim.log.some((e) => msg(e) === '[line-tool] created end joint'), 'the newest action is kept');
assert.ok(!trim.log.some((e) => msg(e) === '[selection-tools] pointerMove'), 'no raw pointerMove entry survives');
const summaries = trim.log.filter((e) => e.kind === 'noise-summary');
assert.ok(summaries.length >= 2 && summaries.every((e) => e.count > 1 && e.tLast >= e.t && /^\d+ × /.test(e.args[0])), 'noise runs became summaries');
assert.ok(summaries.some((e) => /50 × \[selection\] \[selection-tools\] pointerMove/.test(e.args[0])), 'a run of 50 pointerMoves is one summary: ' + summaries.map((e) => e.args[0]).join(' | '));
const real = trim.log.filter((e) => e.kind !== 'noise-summary' && e.level !== 'warn' && e.level !== 'error');
assert.ok(real.length <= REPORT_LOG_KEEP, `at most ${REPORT_LOG_KEEP} meaningful entries, got ${real.length}`);
assert.ok(trim.trimmed.log.droppedOld['t-old-action'] > 10, 'the dropped old actions are counted: ' + JSON.stringify(trim.trimmed.log.droppedOld));
assert.ok(trim.trimmed.log.noiseCollapsed.selection >= 130 && trim.trimmed.log.noiseCollapsed.renderer >= 20, 'collapsed noise is counted: ' + JSON.stringify(trim.trimmed.log.noiseCollapsed));
assert.strictEqual(full.trimmed, null, 'the full report is untrimmed');
assert.ok(full.log.length > trim.log.length * 2, 'the full report keeps the raw entries');
for (const k of ['app', 'url', 'ua', 'viewport', 'document', 'journal']) assert.deepStrictEqual(JSON.parse(JSON.stringify(trim[k])), JSON.parse(JSON.stringify(full[k])), `${k} kept whole`);
assert.deepStrictEqual(JSON.parse(diag.reportToText(trim)), JSON.parse(JSON.stringify(trim)), 'the trimmed report parses back');
const fb = diag.reportToText(full).length, tb = diag.reportToText(trim).length;
assert.ok(tb < fb, 'smaller');
console.log(`synthetic session report bytes: full ${fb} -> trimmed ${tb}`);

// touchTrace: 500 pointermoves between a down and an up, then 40 more events
const tr = [{ t: 0, type: 'pointerdown', x: 1, y: 1 }];
for (let i = 0; i < 500; i++) tr.push({ t: 1 + i, type: 'pointermove', x: i, y: i });
tr.push({ t: 600, type: 'pointerup', x: 500, y: 500 });
for (let i = 0; i < 40; i++) tr.push({ t: 700 + i, type: 'keydown', key: 'a' + i });
let t1 = trimTouchTrace(tr);
assert.strictEqual(t1.touchTrace.length, REPORT_TOUCH_KEEP, 'the last 30 items');
assert.ok(t1.trimmed.droppedOld.pointermove >= 500 || t1.trimmed.droppedOld.pointermove > 0, 'older moves counted');
const tr2 = tr.slice(0, 502).concat(tr.slice(-5));
t1 = trimTouchTrace(tr2);
const runStart = t1.touchTrace.find((e) => e.count === 500), runEnd = t1.touchTrace.find((e) => e.runEnd);
assert.ok(runStart && runEnd && runStart.x === 0 && runEnd.x === 499, 'a run keeps its first and last point with the count');
assert.strictEqual(t1.touchTrace.length, 1 + 2 + 1 + 5, 'down + (first,last of run) + up + 5 keys');
console.log('diagnostic-log-report-text: OK');

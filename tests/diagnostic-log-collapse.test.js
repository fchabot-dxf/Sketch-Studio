// tests/diagnostic-log-collapse.test.js — TASK 429: the Diagnostic Log must not flood.
//  (a) 1000 identical dbg.log calls -> ONE entry with count 1000; older distinct entries are not evicted
//  (b) A,A,B,A -> 3 entries (A x2, B, A): a different entry breaks the run
//  (c) svg-renderer's draw() logs the constraint summary once across 50 renders, and again when a constraint is added
//  (d) the copied report is pure JSON and "count" is a number
import assert from 'node:assert';

// minimal browser globals so diagnostic-log.js can install its capture + build a report in Node
const listeners = [];
globalThis.window = { addEventListener: (t, f) => listeners.push([t, f]), innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 };
globalThis.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
globalThis.location = { href: 'http://test/' };

const { dbg, setDebugSink } = await import('#core/debug.js');
const diag = await import('#ui/diagnostic-log.js'); // installs the sink on import
const report = () => diag.buildReport({ appId: 'test', getState: null });
const dbgEntries = () => report().log.filter((e) => e.kind === 'dbg');

// (a) 1000 identical calls collapse; earlier distinct entries survive
dbg.log('t-old', 'first distinct');
dbg.log('t-old', 'second distinct');
for (let i = 0; i < 1000; i++) dbg.log('t-flood', 'same line', { n: 1 });
let log = dbgEntries();
assert.strictEqual(log.length, 3, `expected 3 entries (2 distinct + 1 collapsed), got ${log.length}`);
assert.deepStrictEqual(log.map((e) => e.category), ['t-old', 't-old', 't-flood'], 'older distinct entries are not evicted');
assert.strictEqual(log[2].count, 1000, 'collapsed entry counts all 1000');
assert.ok(log[2].tLast >= log[2].t, 'tLast >= t');
assert.strictEqual(log[0].count, 1, 'a single entry has count 1');

// (b) A,A,B,A -> 3 entries
dbg.log('t-b', 'B-marker'); // separate the previous run
const before = dbgEntries().length;
dbg.log('t-run', 'A'); dbg.log('t-run', 'A'); dbg.log('t-run', 'B'); dbg.log('t-run', 'A');
log = dbgEntries().slice(before);
assert.deepStrictEqual(log.map((e) => [e.args[0], e.count]), [['A', 2], ['B', 1], ['A', 1]], 'A,A,B,A -> A x2, B, A');
// the same message with a DIFFERENT payload is not a repeat
dbg.log('t-pl', 'p', { v: 1 }); dbg.log('t-pl', 'p', { v: 2 });
assert.strictEqual(dbgEntries().filter((e) => e.category === 't-pl').length, 2, 'different payloads are different entries');

// (c) the renderer logs once across 50 renders of an unchanged constraint set, again when one is added
const { draw } = await import('#ui/svg-renderer.js');
const { CONSTRAINT_TYPES } = await import('#core/constants.js');
const joints = new Map([['a', { x: 0, y: 0, fixed: true }], ['b', { x: 100, y: 0 }]]);
const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ width: 800, height: 600 }), innerHTML: '' };
const constraints = [{ id: 'C1', type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'b'], value: 100 }];
let rendererLogs = 0;
const reportSink = (ev) => { if (ev.category === 'renderer' && ev.args[0] === 'constraints') rendererLogs++; };
setDebugSink(reportSink);
const render = () => draw(joints, [], svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);
for (let i = 0; i < 50; i++) render();
assert.strictEqual(rendererLogs, 1, `50 renders of an unchanged set log once, got ${rendererLogs}`);
constraints.push({ id: 'C2', type: CONSTRAINT_TYPES.DISTANCE, joints: ['a', 'b'], value: 100 });
for (let i = 0; i < 50; i++) render();
assert.strictEqual(rendererLogs, 2, `adding a constraint logs again (once), got ${rendererLogs}`);

// (d) the copied report is pure JSON and "count" is a number
const text = JSON.stringify(report(), null, 1);
const parsed = JSON.parse(text);
const collapsed = parsed.log.find((e) => e.category === 't-flood');
assert.strictEqual(typeof collapsed.count, 'number', '"count" is a number in the report');
assert.strictEqual(collapsed.count, 1000);
assert.ok(parsed.log.every((e) => typeof e.count === 'number' && typeof e.t === 'number' && typeof e.tLast === 'number'), 'every entry has numeric t/tLast/count');
assert.ok(!text.includes('×'), 'no display "×N" baked into the data');
console.log('diagnostic-log-collapse: ok');

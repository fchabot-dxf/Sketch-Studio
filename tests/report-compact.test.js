// tests/report-compact.test.js — TASK 591 (node): the COMPACT report ("Copy Report", packages/ui/report-compact.js).
//  (a) rounding: 6 decimals, |x| < 1e-9 -> 0, no -0
//  (b) the owner's three reports (tests/fixtures/report/*.json, each the real report compacted): the compact journal replayed onto its base
//      reproduces the reported document within 1e-6 (constraint label / glyph positions are the one thing a journal does not carry),
//      and each still holds the fact the advisor needed in that case
//  (c) a synthetic session through the REAL report builder (edits, undo): replay == the live document, label-only steps are folded and
//      counted, the header carries tool / selection / counts / undo line / last error with its stack
//  (d) the event log keeps clicks / tool / drag / constraint / warn / error and drops pointer-move + redraw spam, counted; the touch trace
//      appears only on a touch device or with non-move events
import assert from 'node:assert';
import fs from 'node:fs';

globalThis.window = { addEventListener() {}, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 };
globalThis.document = { addEventListener() {}, querySelector: () => null, getElementById: () => null };
globalThis.location = { href: 'http://test/' };
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });

const { roundNum, roundDeep, replayCompactJournal, buildCompactReport, constraintKey, PRESENTATION_KEYS, compactLog, compactTouchTrace } = await import('#ui/report-compact.js');
const { createEngine } = await import('#core/constraint-solver.js');
const { createSketchState } = await import('#ui/sketch-state.js');
const { addConstraintObject } = await import('#core/constraints.js');
const { dbg } = await import('#core/debug.js');
const diag = await import('#ui/diagnostic-log.js');

// (a) rounding
assert.strictEqual(roundNum(1.23456789), 1.234568);
assert.strictEqual(roundNum(3.2137880220277056e-34), 0);
assert.strictEqual(roundNum(-4e-10), 0);
assert.ok(!Object.is(roundNum(-4e-10), -0), 'no negative zero');
assert.strictEqual(roundNum(-123.03124999999935), -123.03125);
assert.strictEqual(roundNum(1e-8), 0, '1e-8 is above the 1e-9 floor but rounds to 0 at 6 decimals');
assert.deepStrictEqual(roundDeep({ a: [1.0000004, { b: 2.9999996, s: 'x', n: null }] }), { a: [1, { b: 3, s: 'x', n: null }] });

// (b) the owner's three reports
const fix = (n) => JSON.parse(fs.readFileSync(new URL(`./fixtures/report/${n}.json`, import.meta.url), 'utf8'));
function near(a, b, path) {
  if (typeof a === 'number' && typeof b === 'number') return assert.ok(Math.abs(a - b) <= 1e-6, `${path}: ${a} vs ${b}`);
  if (Array.isArray(a)) { assert.ok(Array.isArray(b) && a.length === b.length, `${path}: length`); return a.forEach((x, i) => near(x, b[i], `${path}[${i}]`)); }
  if (a && typeof a === 'object') { assert.deepStrictEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${path}: keys`); return Object.keys(a).forEach((k) => near(a[k], b[k], `${path}.${k}`)); }
  assert.strictEqual(a, b, path);
}
function assertSameDocument(replayed, reported, label) {
  const rj = new Map(replayed.geometry.joints), dj = new Map(reported.geometry.joints);
  assert.deepStrictEqual([...rj.keys()].sort(), [...dj.keys()].sort(), `${label}: same joints`);
  for (const [id, j] of dj) near(rj.get(id), j, `${label} joint ${id}`);
  for (const part of ['shapes', 'sketches', 'groups', 'profiles', 'parameters', 'vcarves']) near(replayed.geometry[part], reported.geometry[part], `${label} ${part}`);
  assert.strictEqual(replayed.geometry.activeSketchId, reported.geometry.activeSketchId, `${label}: active sketch`);
  const keys = (d) => d.geometry.constraints.map((c) => constraintKey(c)).sort();
  assert.deepStrictEqual(keys(replayed), keys(reported), `${label}: the same constraints (label / glyph positions aside)`);
}
for (const n of ['midpoint-move', 'line-line-driven', 'drag-frozen']) {
  const f = fix(n);
  assert.ok(Buffer.byteLength(JSON.stringify(f)) < 65000, `${n}: the fixture is reduced (about 60 KB at most)`);
  assert.ok(f.journal.steps.length > 30, `${n}: a real journal`);
  assertSameDocument(replayCompactJournal(f.journal), f.document, n);
  for (const s of f.journal.steps) for (const c of [...(s.addedConstraints || []), ...(s.removedConstraints || [])]) for (const k of PRESENTATION_KEYS) assert.ok(!(k in c), `${n} step ${s.n}: no label / glyph position in a journal constraint`);
}
// the fact each case needed
{
  const f = fix('midpoint-move');
  const adds = f.journal.steps.filter((s) => (s.addedConstraints || []).some((c) => c.type === 'midpoint'));
  assert.ok(adds.length >= 1 && adds.every((s) => /drag/.test(s.label)), 'case 1: the journal names the drag step(s) that added a midpoint constraint: ' + adds.map((s) => `${s.n} ${s.label}`));
  assert.strictEqual(adds[0].addedConstraints.find((c) => c.type === 'midpoint').joints.length, 3, 'case 1: the midpoint constraint is there whole, with its joints');
}
{
  const f = fix('line-line-driven');
  assert.ok(f.log.some((e) => /rank-redundant distance -> reference/.test(e.msg)), 'case 2: the log says the dimension became a reference (driven)');
  assert.ok(f.log.some((e) => /Added distance constraint/.test(e.msg)), 'case 2: the log shows the dimension adds');
  assert.ok(f.summary.lastError && /Cannot read properties of undefined/.test(f.summary.lastError.message) && /getDist/.test(f.summary.lastError.stack), 'case 2: the last error with its stack');
}
{
  const f = fix('drag-frozen');
  const temp = f.document.geometry.constraints.filter((c) => c.__temp);
  assert.strictEqual(temp.length, 1, 'case 3: the leftover temp constraint is in the document');
  assert.strictEqual(temp[0].type, 'distance'); assert.strictEqual(temp[0].joints[0], null);
  assert.ok(f.summary.lastError && /getDist/.test(f.summary.lastError.stack), 'case 3: the crash and its stack');
  assert.ok(f.log.some((e) => e.lvl === 'warn'), 'case 3: the warning is in the log');
}

// (c) a synthetic session through the real builder
function newState() { const engine = createEngine(null); engine.init(); const s = createSketchState(engine, {}); s.currentTool = 'select'; return s; }
const st = newState();
let n = 0;
const addLine = (label) => {
  st.saveState(label);
  const a = 'J' + (++n), b = 'J' + (++n);
  st.joints.set(a, { x: 0.1234567891 * n, y: 3.2137880220277056e-34, fixed: false }); st.joints.set(b, { x: 10 + n * 1.0000004, y: 5, fixed: false });
  st.shapes.push({ id: 'S' + n, type: 'line', joints: [a, b] });
  return [a, b];
};
const [a1, b1] = addLine('line');
const [a2, b2] = addLine('line');
st.saveState('dimension'); addConstraintObject(st, { type: 'distance', joints: [a1, b1], value: 12.00000049, glyphPos: { x: 1, y: 2 }, offset: 5 });
st.saveState('move label'); st.constraints[0].glyphPos = { x: 40, y: 50 }; st.constraints[0].offset = 9; // label only: must fold
st.saveState('drag points'); st.joints.get(a2).x += 1.5; st.joints.get(b2).x += 1.5; st.joints.get(a2).y -= 0.5; st.joints.get(b2).y -= 0.5;
st.saveState('drag points'); st.joints.get(a1).x -= 2.25;
st.saveState('delete'); st.shapes.pop();
st.undo(); st.undo(); // the report is taken after two undos: the redo stack is not empty
st.currentTool = 'line'; st.selectedJoints.add(a1); st.selectedShapes.add('S1');
dbg.log('selection', '[selection-tools] pointerMove', { x: 1 });
for (let i = 0; i < 30; i++) dbg.log('renderer', 'constraints', { total: i, visible: i });
dbg.log('selection', '[selection-tools] drag LOCKED to snap', { draggedId: a1 });
dbg.log('app', 'Setting tool to:', 'line');
dbg.log('constraints', '[ConstraintManager] Added distance constraint from dimension:', { type: 'distance', value: 12, glyphPos: { x: 9, y: 9 } });
dbg.warn('constraints', '[ConstraintManager] pointOnLine sandbox-rejected', { residual: 5.8827314701 });
dbg.error('app', 'BOOM', new Error('the failure'));
const { default: Settings } = await import('#core/settings-manager.js');
Settings.set('GLYPH_STYLE', 'fusion', { persist: 'none' }); Settings.set('DOC_UNIT', 'in', { persist: 'none' }); Settings.set('SHOW_GRID', true, { persist: 'none' }); // SHOW_GRID is at its default
const full = diag.buildReport({ appId: 'test', getState: st, full: true });
const c = diag.buildCompactReportFor({ appId: 'test', getState: st });
assert.ok(full.session && full.session.tool === 'line', 'the full report carries the session');
assertSameDocument(replayCompactJournal(c.journal), c.document, 'synthetic');
near(JSON.parse(JSON.stringify(c.document)), roundDeep(JSON.parse(JSON.stringify(full.document))), 'document is the full document, rounded');
assert.ok(c.journal.folded >= 1, 'the label-only step is folded: ' + c.journal.folded);
assert.ok(!c.journal.steps.some((s) => s.label === 'move label'), 'the label-only step is not listed');
const dragStep = c.journal.steps.find((s) => s.label === 'drag points');
assert.ok(dragStep && (dragStep.moved || dragStep.shifted), 'a drag step lists the joints that moved');
assert.deepStrictEqual(c.summary.settings, { GLYPH_STYLE: 'fusion', DOC_UNIT: 'in' }, 'the header lists the settings that differ from their defaults');
assert.strictEqual(c.summary.tool, 'line');
assert.deepStrictEqual(c.summary.selection.joints, [a1]); assert.deepStrictEqual(c.summary.selection.shapes, ['S1']);
assert.strictEqual(c.summary.counts.shapes, c.document.geometry.shapes.length);
assert.strictEqual(c.summary.counts.joints, c.document.geometry.joints.length);
assert.strictEqual(c.summary.counts.constraints, c.document.geometry.constraints.length);
assert.strictEqual(c.summary.counts.journalSteps, full.journal.steps.length);
assert.ok(/^undo \d+ \/ redo 2; last \d+: /.test(c.summary.undoRedo) && !/\n/.test(c.summary.undoRedo), 'one-line undo/redo summary: ' + c.summary.undoRedo);
assert.ok(c.summary.lastError && c.summary.lastError.category === 'app' && /the failure/.test(c.summary.lastError.message) && /report-compact\.test\.js/.test(c.summary.lastError.stack), 'last error with its stack: ' + JSON.stringify(c.summary.lastError).slice(0, 200));
assert.strictEqual(c.summary.build, null, 'the build exposes no sha / version');
assert.ok(JSON.stringify(c).length < JSON.stringify(full).length, 'smaller than the full report');
assert.ok(!/glyphPos/.test(JSON.stringify(c.log)), 'log data carries no label positions');

// (d) log + touch trace
{
  const now = 1_000_000;
  const e = (category, msg, extra = {}) => ({ t: now - 5000, tLast: now - 5000, count: 1, kind: 'dbg', category, level: 'log', args: [msg, { v: 1.00000049 }], ...extra });
  const lg = compactLog([
    e('selection', '[selection-tools] pointerMove', { count: 800 }), e('renderer', 'constraints', { count: 40 }),
    e('selection', '[selection-tools] pointerDown'), e('app', 'Setting tool to:'), e('selection', '[selection-tools] drag LOCKED to snap'),
    e('selection', '[selection-tools] pointerUp performedDrag'), e('constraints', '[ConstraintManager] Added midpoint constraint from snap:'),
    e('constraints', '[addConstraint] Adding constraint:', { count: 3 }),
    e('app', 'warned', { level: 'warn' }), e('window.onerror', 'boom', { level: 'error', kind: 'error', args: ['boom', 'x.js:1:2', 'Error: boom\n    at f (x.js:1:2)'] }),
  ], { now });
  const msgs = lg.log.map((l) => l.msg);
  assert.deepStrictEqual(msgs, ['[selection-tools] pointerDown', 'Setting tool to:', '[selection-tools] drag LOCKED to snap', '[selection-tools] pointerUp performedDrag', '[ConstraintManager] Added midpoint constraint from snap:', 'warned', 'boom'], 'what the log keeps');
  assert.deepStrictEqual(lg.dropped, { selection: 800, renderer: 40, constraints: 3 }, 'what it dropped is counted');
  assert.strictEqual(lg.log[0].t, -5, 'times are seconds before the report');
  assert.deepStrictEqual(lg.log[0].data, [{ v: 1 }], 'log numbers are rounded');
  const mv = (t) => ({ t, type: 'pointermove', x: 1, y: 2, pointerType: 'mouse', target: 'svg' });
  assert.strictEqual(compactTouchTrace([mv(1), mv(2)], { now }), null, 'only pointer-moves from a mouse: no touch trace');
  const t1 = compactTouchTrace([mv(1), { t: 2, type: 'pointerdown', x: 1, y: 2, pointerType: 'mouse', target: 'svg' }, mv(3)], { now });
  assert.strictEqual(t1.pointerMovesDropped, 2); assert.strictEqual(t1.events.length, 1, 'a click is kept, the moves are counted');
  const t2 = compactTouchTrace([{ ...mv(1), pointerType: 'touch' }], { now });
  assert.ok(t2 && t2.pointerMovesDropped === 1 && t2.events.length === 0, 'a touch device keeps its trace entry');
  const rep = buildCompactReport({ app: 'x', t: new Date(now).toISOString(), log: [], touchTrace: [mv(1)], document: null, journal: null }, { now });
  assert.ok(!('touchTrace' in rep), 'no touchTrace key without touch or non-move events');
  assert.strictEqual(rep.summary.lastError, null);
}
console.log('report-compact: OK');

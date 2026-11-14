// tests/diagnostic-log-compact-buttons.test.js — TASK 591 (node, happy-dom): the Diagnostic Log panel's buttons.
//   "Copy Report"       puts the COMPACT report (summary / document / journal / log) on the clipboard, one line of JSON, with the size in the status
//   "Save full report"  writes today's full report (buildReport({ full: true }): touchTrace, log, journal untouched) through the file-save seam
//   a rejected clipboard write still offers "Download report (.json)" (the compact text)
// The panel is the shared packages/ui/diagnostic-log.js every host mounts (SketchStudio, Shaper, Pen Plotter, Trace): one code path.
import assert from 'node:assert';
import { Window } from 'happy-dom';

const win = new Window({ url: 'http://test/' });
globalThis.window = win; globalThis.document = win.document; globalThis.location = win.location;
Object.defineProperty(globalThis, 'navigator', { value: win.navigator, configurable: true });
let clip = null, clipFail = false;
Object.defineProperty(win.navigator, 'clipboard', { value: { writeText: async (t) => { if (clipFail) throw new Error('NotAllowedError: denied'); clip = t; } }, configurable: true });

const { createEngine } = await import('#core/constraint-solver.js');
const { createSketchState } = await import('#ui/sketch-state.js');
const { dbg } = await import('#core/debug.js');
const { browserFileSeam } = await import('#ui/project-file.js');
const diag = await import('#ui/diagnostic-log.js');

const engine = createEngine(null); engine.init();
const state = createSketchState(engine, {});
state.saveState('line'); state.joints.set('J1', { x: 1.0000004, y: 2, fixed: false }); state.joints.set('J2', { x: 5, y: 2, fixed: false });
dbg.log('selection', '[selection-tools] pointerMove', { x: 1 });
dbg.log('app', 'Setting tool to:', 'line');
for (const type of ['pointerdown', 'pointermove', 'pointermove', 'pointerup']) win.document.dispatchEvent(new win.PointerEvent(type, { clientX: 5, clientY: 6, pointerType: 'mouse', bubbles: true }));

const saves = [];
browserFileSeam.save = async (text, name) => { saves.push({ text, name }); return { name }; };

const log = diag.createDiagnosticLog({ appId: 'btn-test', state });
const byText = (label) => [...win.document.querySelectorAll('.sk-diag-panel button')].find((b) => b.textContent === label);
const btn = (label) => (label === 'Copy Report' ? win.document.querySelector('.sk-diag-btn-primary') : label === 'Download report (.json)' ? win.document.querySelector('.sk-diag-download') : byText(label)); // the copy button reads "Copied!" for a moment
const settle = () => new Promise((r) => setTimeout(r, 20));
const status = () => win.document.querySelector('.sk-diag-status').textContent;
log.open();

assert.ok(btn('Copy Report').textContent === 'Copy Report' && btn('Save full report'), 'both buttons exist');
assert.ok(!byText('Copy full report'), 'the old "Copy full report" is gone');

btn('Copy Report').click(); await settle();
assert.ok(clip !== null, 'Copy Report wrote to the clipboard');
assert.ok(!clip.includes('\n'), 'one line');
const compact = JSON.parse(clip);
assert.deepStrictEqual(Object.keys(compact).slice(0, 4), ['summary', 'document', 'journal', 'log'], 'summary header first');
assert.strictEqual(compact.summary.app, 'btn-test');
assert.ok(compact.summary.counts.joints >= 2 && /^undo 1 \/ redo 0/.test(compact.summary.undoRedo));
assert.ok(!compact.log.some((l) => /pointerMove/.test(l.msg)), 'pointer-move spam is not in the copied log');
assert.ok(compact.log.some((l) => l.msg === 'Setting tool to:'), 'the tool change is');
assert.strictEqual(compact.touchTrace.pointerMovesDropped >= 1, true, 'moves are counted in the trace');
assert.ok(/^Copied .+ report$/.test(status()), 'status: ' + status());

btn('Save full report').click(); await settle();
assert.strictEqual(saves.length, 1, 'Save full report saved one file');
assert.ok(/^sketch-studio-full-report-btn-test-.+\.json$/.test(saves[0].name), saves[0].name);
const savedFull = JSON.parse(saves[0].text);
assert.ok('trimmed' in savedFull && savedFull.trimmed === null, 'the full report: untrimmed');
for (const k of ['app', 'url', 'ua', 'viewport', 'touchTrace', 'log', 'document', 'journal']) assert.ok(k in savedFull, `full report keeps ${k}`);
assert.ok(savedFull.log.some((l) => l.args[0] === '[selection-tools] pointerMove'), 'nothing lost: the pointerMove entry is still in the full report');
assert.ok(savedFull.touchTrace.some((e) => e.type === 'pointermove'), 'nothing lost: the pointer-moves are in the full touch trace');
assert.ok(saves[0].text.length > clip.length * 0 && JSON.stringify(savedFull).length === saves[0].text.length, 'the file is the minified full JSON');
assert.ok(/^Saved sketch-studio-full-report/.test(status()), status());

clipFail = true;
btn('Copy Report').click(); await settle();
assert.ok(!btn('Download report (.json)').classList.contains('sk-hidden'), 'a rejected clipboard offers the download');
btn('Download report (.json)').click(); await settle();
assert.strictEqual(saves.length, 2);
assert.ok(JSON.parse(saves[1].text).summary, 'the download is the compact text');
assert.ok(/^sketch-studio-report-btn-test-/.test(saves[1].name));
log.destroy();
console.log('diagnostic-log-compact-buttons: OK');

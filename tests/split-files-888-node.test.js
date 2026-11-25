// tests/split-files-888-node.test.js — TASK 888 (owner turns 3627-3628): a Roughing's / Contour's "Split into files" (By depth / By levels), in Node (no browser).
//  1. THE CHUNKS (apps/shaper/src/split-files.js chunksOf): By depth every N = bands ((k-1)N, kN], a level exactly on a boundary in the SHALLOWER band, a band
//     with no level makes no file, the last band partial; By levels N = the first N levels, the next N ..., the last chunk what is left; an element with no
//     depth in the first chunk. THE FILES (fileSpecs): per split operation, top down; the Stock in every file, the unsplit operations in the FIRST file only.
//  2. #core exportShaperSVG options.keep: without it (and with a keep that keeps everything) the file is BYTE-IDENTICAL, on every Shaper document fixture
//     of the operation-first corpus (tests/fixtures/opfirst, whose files tests/opfirst-corpus-<n>-node.test.js hold to their frozen baseline; the count is printed);
//     with it the page is the whole file's and a plan with no Stock gets the frame guide (row 3).
//  3. ON THE SHAPER NODE PAGE (tests/helpers/node-app.js), an inserted STL relief (tests/fixtures/relief-terrain-889.js, 23.5 mm deep): its Roughing + a Contour.
//     The card's Passes tab has the row (Off by default); By depth 10 mm on the Contour -> exportFileOf gives 3 files; their NAMES (export-payload.js
//     chunkFileName, the 884 rule + the chunk); every file has the whole file's page (the same header) and the same frame guide (no Stock: a partial file);
//     each chunk's Contour elements are elements of the whole file, in its band, and their union is the whole file's Contour elements (nothing lost, nothing
//     doubled); the Roughing is in the first file only; the Origin rules (#core/origin-rules.js) are checked on every file. By levels 30 -> "(levels 1-30)" ...
//     Off again -> one file, byte-identical to before, the 884 name. The paths do not go out of date when the split changes (the export's only).
//  4. AUTOSEND PER CHUNK (fake Shaper API, tests/shaperhub-fake-api.js): each chunk file sent once is the target of its own key (chunkSetKey); a Generate then
//     replaces each chunk's own file, never another's; a chunk whose range changed has no target (stays local until a Send).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { open } from './helpers/node-app.js';
import { loadCase } from './helpers/opfirst-measure.js';
import SettingsManager, { docUnit } from '#core/settings-manager.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { checkOriginRules } from '#core/origin-rules.js';
import { binaryStl } from './helpers/stl-mesh.js';
import { reliefTerrain } from './fixtures/relief-terrain-889.js';
import { chunksOf, fileSpecs, keepOf, inChunk, splitOf, SPLIT_FILES } from '../apps/shaper/src/split-files.js';
import { storeOps } from '../apps/shaper/src/operations-store.js';
import { getSelections } from '../apps/shaper/src/selection-list.js';
import { exportFileOf, exportFileInBackground, exportFileName, namedFiles, chunkSetKey, zipFileName, tickedSetKey } from '../apps/shaper/src/export-payload.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { applyShaperDoc } from '../apps/shaper/src/shaper-doc.js';
import { planEntries } from '../apps/shaper/src/cut-plan.js';
import { describeOperations } from '../apps/shaper/src/operations.js';
import { createFakeShaperApi, FAKE_LOGIN } from './shaperhub-fake-api.js';
import { handleShaperUpload } from '../packages/core/shaper-cloud.js';
import { setHubTargets, setHubTarget, getHubTarget, targetOfSend, autoSendDecision, createReplaceQueue } from '../apps/shaper/src/shaperhub-target.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
const eq = (a, b, m) => { assert.deepEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });

// ── 1. the chunks and the files ──
const D = (mode, every) => ({ mode, every });
const byDepth = chunksOf([0, 2.5, 5, 10, 10.25, 20, 23.5, NaN], D('depth', 10));
eq(byDepth.map((c) => [c.index, c.count, c.lo, c.hi, c.first, c.last, c.from, c.to]), [[1, 3, null, 10, 1, 4, 0, 10], [2, 3, 10, 20, 5, 6, 10, 20], [3, 3, 20, null, 7, 7, 20, 30]],
  '1: By depth 10: (0, 10] (with the surface level), (10, 20], (20, 30] the last band partial; a level exactly at 10 or 20 is in the band above it');
ok(inChunk(10, byDepth[0]) && !inChunk(10, byDepth[1]) && inChunk(10.25, byDepth[1]) && inChunk(20, byDepth[1]) && inChunk(23.5, byDepth[2]), '1: the boundary rule: lo exclusive, hi inclusive');
ok(inChunk(NaN, byDepth[0]) && !inChunk(NaN, byDepth[1]), '1: an element with no depth is in the first chunk');
eq(chunksOf([1, 2, 25, 26], D('depth', 10)).map((c) => [c.from, c.to, c.first, c.last]), [[0, 10, 1, 2], [20, 30, 3, 4]], '1: a band with no level (10-20) makes no file');
const byLevels = chunksOf([0.25, 0.5, 0.5, 0.75, 1, 1.25, 1.5], D('levels', 4));
eq(byLevels.map((c) => [c.first, c.last, c.lo, c.hi]), [[1, 4, null, 1], [5, 6, 1, null]], '1: By levels 4: levels 1-4, then 5-6 (the last chunk holds what is left); two elements at one depth are one level');
eq(chunksOf([3, 6, 9], D('levels', 30)).length, 1, '1: fewer levels than N: one chunk');
eq(chunksOf([1, 2], null), [], '1: Off: no chunks');
eq([splitOf({}), splitOf({ splitFiles: 'depth' }), splitOf({ splitFiles: 'depth' }, 'in'), splitOf({ splitFiles: 'levels' }), splitOf({ splitFiles: 'levels', splitLevels: 7.9 }), splitOf({ splitFiles: 'off', splitDepth: 3 })],
  [null, D('depth', 10), D('depth', 12.7), D('levels', SPLIT_FILES.defaultLevels), D('levels', 7), null], '1: the setting: Off by default; each mode\'s number, its default by the unit');
const plan = { ops: [{ id: 'a', split: null }, { id: 'b', split: D('levels', 2) }, { id: 'c', split: null }, { id: 'd', split: D('depth', 10) }], stock: ['s'] };
const specs = fileSpecs(plan, (id) => ({ b: [1, 2, 3], d: [4, 14] })[id] || []);
eq(specs.map((f) => [f.whole, f.chunk.opId, f.chunk.index]), [[['s', 'a', 'c'], 'b', 1], [['s'], 'b', 2], [['s'], 'd', 1], [['s'], 'd', 2]], '1: the files: per split operation top down; the Stock in every file, the unsplit operations in the first only');
eq(fileSpecs({ ops: [{ id: 'a', split: null }], stock: [] }, () => []), null, '1: nothing split: no chunk files');
const k1 = keepOf(specs[0]), k2 = keepOf(specs[1]);
const meta = (opId, depth) => ({ entry: { opId }, cut: { rec: { cutDepth: depth } } });
eq([k1(meta('s', 19)), k1(meta('a', 5)), k1(meta('b', 2)), k1(meta('b', 3)), k1(meta('d', 4)), k2(meta('a', 5)), k2(meta('b', 3)), k2(meta('s', 19))], [true, true, true, false, false, false, true, true], '1: keepOf: what each file writes');

// ── 2. the exporter's keep: the ORACLE over the export fixtures (the operation-first corpus, tests/fixtures/opfirst: every case's file is frozen in its baseline and
// checked by tests/opfirst-corpus-<n>-node.test.js): with no operation split, the Export step's file has no chunk files and is the plain export, and a keep that
// keeps everything writes the same bytes as no keep (#core exportShaperSVG options.keep default off) ──
const enc = exportEncoding();
const DIR = new URL('./fixtures/opfirst/', import.meta.url);
const cases = JSON.parse(fs.readFileSync(new URL('cases.json', DIR), 'utf8'));
const pool = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('pool.json.gz', DIR))));
const expand = (c) => { // as tests/helpers/opfirst-corpus.js expands a case
  const sidecar = JSON.parse(JSON.stringify(c.sidecar));
  for (const e of sidecar.cutPlan || []) if (e && e[1] && e[1].levels && e[1].levels.$levels) e[1].levels = pool.levels[e[1].levels.$levels];
  if (sidecar.stl && sidecar.stl.$stl) sidecar.stl = pool.stl[sidecar.stl.$stl];
  return { geometry: pool.geometry[c.geometry], sidecar, settings: c.settings };
};
let oracle = 0;
for (const c of cases) {
  const x = expand(c), state = loadCase(x);
  applyShaperDoc(x.sidecar, state);
  const entries = planEntries();
  if (!entries.length) continue;
  const frame = planEntries();
  const plain = exportShaperSVG({ state, entries, encoding: enc, docUnit: docUnit() });
  const kept = exportShaperSVG({ state, entries, encoding: enc, docUnit: docUnit(), options: { keep: () => true } });
  if (kept !== plain) assert.fail(`2: ${c.name}: a keep that keeps everything writes other bytes`);
  const file = exportFileOf(state);
  if (file.files !== null || file.svg !== exportShaperSVG({ state, entries: planEntries({ ticked: true }), encoding: enc, docUnit: docUnit(), options: frame.length > planEntries({ ticked: true }).length ? { frame: { entries: frame } } : {} })) assert.fail(`2: ${c.name}: the Export step's file is not the plain export`);
  oracle++;
}
checks += oracle;
applyShaperDoc(undefined, null); // a new design: the corpus's last plan goes
SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
console.log(`ROW 2 oracle: ${oracle} corpus cases (of ${cases.length}): no chunk files, the plain export, keep-all byte-identical`);

// ── 3. on the page: an STL relief, its Roughing and a Contour ──
const app2 = await open({ host: 'shaper' });
const realFetch = globalThis.fetch;
try {
  const doc = app2.document, st = app2.state;
  app2.modes.showMode('prepare');
  const res = app2.stl.insertFile(binaryStl(reliefTerrain()), 'relief.stl');
  ok(res.ok, '3: the relief is inserted: ' + res.message);
  const part = getSelections().find((x) => x.kind === 'stl'), key = part.cutKeys[0];
  app2.prepare.ok();
  app2.prepare.view().setSelection([{ kind: key.slice(0, key.indexOf(':')), id: key.slice(key.indexOf(':') + 1) }]);
  app2.prepare.addOperation('contour');
  app2.prepare.ok();
  eq(storeOps().map((o) => o.type), ['roughing', 'contour'], '3: Roughing 1, Contour 2');
  const before = exportFileOf(st);
  eq(before.files, null, '3: Off (the default): one file');
  const NAME = 'bromont';
  eq(exportFileName(NAME), 'bromont.svg', '3: Off: the 884 name');

  // the card: open the Contour, its Passes tab, the row
  const contour = storeOps()[1];
  app2.prepare.edit(contour.id);
  const card = doc.querySelector('#prepare-panel .cut-card');
  app2.press(card.querySelector('.cut-tab[data-tab="passes"]'));
  const row = card.querySelector('.cut-row[data-row="splitFiles"]'), every = card.querySelector('.cut-row[data-row="splitEvery"]');
  eq([row.style.display, row.hasAttribute('data-off-tab'), row.querySelector('.cut-field-label').textContent], ['', false, 'Split into files'], '3: the row is on the Contour card\'s Passes tab');
  eq([...row.querySelectorAll('.cut-preset')].map((b) => [b.textContent, b.classList.contains('is-active')]), [['Off', true], ['By depth', false], ['By levels', false]], '3: Off | By depth | By levels, Off by default');
  ok(every.hasAttribute('data-off'), '3: its number row is greyed while Off');
  const sigBefore = describeOperations(st).map((o) => o.outOfDate);
  app2.press([...row.querySelectorAll('.cut-preset')].find((b) => b.textContent === 'By depth'));
  const input = every.querySelector('.cut-split-every');
  eq([every.querySelector('.cut-field-label').textContent, input.value, every.querySelector('.cut-split-unit').textContent, every.hasAttribute('data-off')], ['Depth per file', '10', 'mm', false], '3: By depth: Depth per file, 10 mm by default');
  input.value = '10'; input.dispatchEvent(new app2.window.Event('change'));
  ok(!card.querySelector('.cut-tab[data-tab="passes"] .cut-tab-dot').hidden, '3: the Passes tab shows its dot (a setting off its default)');
  app2.prepare.ok();
  eq(storeOps()[1].settings.splitFiles, 'depth', '3: stored on the operation');
  eq(describeOperations(st).map((o) => o.outOfDate), sigBefore, '3: the paths do not go out of date (the split is the export\'s only)');

  const whole = before.svg, wholeLines = whole.split('\n');
  const file = exportFileOf(st);
  eq(file.svg, whole, '3: the whole file is unchanged (the views show the whole operation)');
  ok(Array.isArray(file.files) && file.files.length === 3, `3: By depth 10 mm on a 23.5 mm relief: 3 files (${file.files && file.files.length})`);
  const named = namedFiles(file.files, exportFileName(NAME));
  eq(named.map((f) => f.name), ['bromont - Contour 2 (0-10 mm).svg', 'bromont - Contour 2 (10-20 mm).svg', 'bromont - Contour 2 (20-30 mm).svg'], '3: the names: the 884 name + the operation + its band');
  eq(zipFileName(exportFileName(NAME)), 'bromont.zip', '3: the zip');
  const els = (svg) => svg.split('\n').slice(1, -1);
  const depthOf = (line) => Number((/shaper:cutDepth="([\d.]+) ?mm"/.exec(line) || [])[1]);
  console.log('ROW 3 an element: ' + els(whole).find((l) => /cutType="outside"/.test(l)).replace(/d="[^"]{60,}"/, 'd="..."'));
  // the whole file's elements by operation: the export writes them in plan order (Roughing's, then the Contour's)
  const wholeEls = els(whole);
  const isContourEl = (line) => /shaper:cutType="(outside|inside)"/.test(line);
  const contourEls = wholeEls.filter(isContourEl), roughEls = wholeEls.filter((l) => !isContourEl(l));
  ok(contourEls.length > 50 && roughEls.length > 0, `3: the whole file: ${roughEls.length} Roughing + ${contourEls.length} Contour elements`);
  const headers = named.map((f) => f.svg.split('\n')[0]);
  eq(new Set(headers).size, 1, '3: every file has the same page');
  eq(headers[0], wholeLines[0], '3: the whole file\'s page (width / height / viewBox)');
  const guides = named.map((f) => els(f.svg)[0]);
  ok(guides.every((g) => g === guides[0] && /shaper:cutType="guide"/.test(g)), '3: no Stock: every chunk file starts with the same frame guide (a partial file, task 798)');
  const union = [];
  named.forEach((f, i) => {
    const body = els(f.svg).slice(1); // the frame guide off
    const mine = body.filter(isContourEl), rest = body.filter((l) => !isContourEl(l));
    ok(mine.every((l) => wholeEls.includes(l)), `3: file ${i + 1}: its Contour elements are elements of the whole file, byte for byte`);
    const c = file.files[i].chunk;
    const out = mine.map(depthOf).filter((d) => !((d > c.from + 1e-6 || i === 0) && d <= c.to + 1e-6));
    eq(out, [], `3: file ${i + 1}: every Contour element in its band (${c.from}, ${c.to}]`);
    eq(rest, i === 0 ? roughEls : [], `3: file ${i + 1}: the Roughing (not split) ${i === 0 ? 'is in the first file, whole' : 'is not here'}`);
    union.push(...mine);
    const rules = checkOriginRules(f.svg, { targets: ['origin', 'studio'], encoding: enc });
    eq(rules.errors, [], `3: file ${i + 1}: the Origin rules: no error`);
    console.log(`ROW 3 ${f.name}: ${mine.length} Contour elements, depths ${Math.min(...mine.map(depthOf))}-${Math.max(...mine.map(depthOf))} mm, ${rest.length} others, rules ${rules.errors.length} errors / ${rules.warnings.length} warnings`);
  });
  eq([...union].sort(), [...contourEls].sort(), '3: the union of the chunks\' Contour elements = the whole file\'s (nothing lost, nothing doubled)');

  // By levels 30
  app2.prepare.edit(contour.id);
  app2.press([...card.querySelectorAll('.cut-row[data-row="splitFiles"] .cut-preset')].find((b) => b.textContent === 'By levels'));
  eq([every.querySelector('.cut-field-label').textContent, input.value, every.querySelector('.cut-split-unit').textContent], ['Levels per file', '20', 'levels'], '3: By levels: Levels per file, 20 by default');
  input.value = '30'; input.dispatchEvent(new app2.window.Event('change'));
  app2.prepare.ok();
  const byL = exportFileOf(st), levelCount = new Set(contourEls.map(depthOf)).size;
  const nL = namedFiles(byL.files, exportFileName(NAME));
  eq(nL.length, Math.ceil(levelCount / 30), `3: By levels 30: ${levelCount} levels in ${nL.length} files`);
  eq(nL[0].name, 'bromont - Contour 2 (levels 1-30).svg', '3: the first file\'s name');
  eq(nL[nL.length - 1].name, `bromont - Contour 2 (${levelCount - (nL.length - 1) * 30 === 1 ? `level ${levelCount}` : `levels ${(nL.length - 1) * 30 + 1}-${levelCount}`}).svg`, '3: the last file holds what is left');
  eq(nL.flatMap((f) => els(f.svg).filter(isContourEl)).sort(), [...contourEls].sort(), '3: By levels: the union is the whole Contour');
  eq(nL.map((f) => new Set(els(f.svg).filter(isContourEl).map(depthOf)).size), nL.map((f, i) => (i < nL.length - 1 ? 30 : levelCount - 30 * (nL.length - 1))), '3: 30 levels per file');

  // only the Contour ticked: the 884 name of that set + the chunk
  storeOps()[0].on = false;
  eq(namedFiles(exportFileOf(st).files, exportFileName(NAME))[0].name, 'bromont - Contour 2 - Contour 2 (levels 1-30).svg', '3: a partial set: its 884 name + the chunk (another file than the all-ticked one)');
  storeOps()[0].on = true;

  // the background export (op-paths.js exportJob -> the paths server, op-derive.js exportFilesOf: what the page's worker runs) makes the same files
  const bg = await exportFileInBackground(st), fg = exportFileOf(st);
  eq([bg.svg, bg.files.map((f) => [f.svg, f.chunk])], [fg.svg, fg.files.map((f) => [f.svg, f.chunk])], '3: the background export makes the same files');

  // Off again: one file, byte-identical, the 884 name
  app2.prepare.edit(contour.id);
  app2.press([...card.querySelectorAll('.cut-row[data-row="splitFiles"] .cut-preset')].find((b) => b.textContent === 'Off'));
  app2.prepare.ok();
  const off = exportFileOf(st);
  eq([off.svg, off.files, exportFileName(NAME)], [whole, null, 'bromont.svg'], '3: Off again: the one file of before, byte for byte, the 884 name');
  ok(every.hasAttribute('data-off'), '3: Off: the number row greyed again');

  // ── 4. Autosend per chunk (fake upload) ──
  app2.prepare.edit(contour.id);
  app2.press([...card.querySelectorAll('.cut-row[data-row="splitFiles"] .cut-preset')].find((b) => b.textContent === 'By depth'));
  app2.prepare.ok();
  const files = namedFiles(exportFileOf(st).files, exportFileName(NAME)), setKey = tickedSetKey();
  const api = createFakeShaperApi({ folders: ['Relief'] });
  globalThis.fetch = api.fetch;
  const upload = async (extra) => (await handleShaperUpload(JSON.stringify({ ...FAKE_LOGIN, ...extra }))).body;
  setHubTargets(null);
  for (const f of files.slice(0, 2)) setHubTarget(chunkSetKey(setKey, f.chunk), targetOfSend(await upload({ filename: f.name, svg: f.svg, mode: 'new', remotePath: '/Relief/' }), '/Relief/')); // the dialog's Send of two of them
  eq(files.map((f) => getHubTarget(chunkSetKey(setKey, f.chunk))), [{ filename: files[0].name, remotePath: '/Relief/' }, { filename: files[1].name, remotePath: '/Relief/' }, null], '4: each chunk sent is the target of its own key');
  eq(getHubTarget(setKey), null, '4: the set\'s own key (the unsplit file) is not touched');
  const decisions = files.map((f) => autoSendDecision({ on: true, target: getHubTarget(chunkSetKey(setKey, f.chunk)), signedIn: true }));
  eq(decisions, ['send', 'send', 'no-target'], '4: a Generate replaces the two sent chunks; the third stays local until a Send');
  const replaced = [];
  const queue = createReplaceQueue(async ({ svg, target }) => { const r = await upload({ filename: target.filename, svg, mode: 'replace', remotePath: target.remotePath }); replaced.push([r.status, r.filename, svg]); });
  files.forEach((f, i) => { if (decisions[i] === 'send') queue.push(chunkSetKey(setKey, f.chunk), { svg: f.svg + '<!-- v2 -->', target: getHubTarget(chunkSetKey(setKey, f.chunk)) }); });
  await queue.settled();
  eq(replaced.map(([s, n, svg]) => [s, n, svg === files.find((f) => f.name === n).svg + '<!-- v2 -->']), [['replaced', files[0].name, true], ['replaced', files[1].name, true]], '4: each chunk\'s own file is replaced by its own svg, never another chunk\'s');
  eq(api.blocked, [], '4: no request left the fake');
  const k10 = chunkSetKey(setKey, files[0].chunk), k5 = chunkSetKey(setKey, { ...files[0].chunk, to: 5 });
  ok(k10 !== k5 && getHubTarget(k5) === null, '4: a chunk whose range changed has another key: no target');
  ok(k10 !== chunkSetKey(setKey, files[1].chunk), '4: two chunks never share a key');
} finally {
  globalThis.fetch = realFetch;
  setHubTargets(null);
  app2.close();
}
console.log(`split-files-888-node: ${checks} checks passed`);
process.exit(0);

// TASK 512 -- coverage audit, part 1: (1) the inventory (SketchStudio solver scope) must still match the code, (2) every inventory item is covered by
// the constraint x geometry MATRIX (or explicitly deferred), (3) the matrix runs through the real tool handlers and every cell is PASS, N/A (the tool refuses
// the selection: checked), tolerated round-1 (F1-F6, docs/CONSTRAINT-AUDIT.md) or a pinned NEW finding. Report: docs/COVERAGE-AUDIT.md.
// Pinned NEW findings are KNOWN: their cells / repro are expected to FAIL and the test fails loudly when one starts passing (delete the entry then).
// A new tool / constraint type / shape kind / dimension mode / edit feature changes the derived inventory and FAILS here until it is added
// to the expected lists below AND covered by the matrix (tests/harness/coverage/matrix-*.js).
import { inventory as I } from './harness/coverage/inventory.js';
import { CONSTRAINT_TYPES, TOOL_MODES } from '#core/constants.js';
import { ROWS, runMatrix, classify, columnsFor } from './harness/coverage/matrix-run.js';
import { KINDS, VARIANTS } from './harness/coverage/matrix-build.js';
import { NEW_FINDINGS } from './harness/coverage/matrix-findings.js';

let failures = 0;
const fail = (m) => { failures++; console.log('FAIL  ' + m); };
const ok = (name, cond, detail = '') => { if (cond) console.log('ok    ' + name); else fail(name + '  ' + detail); };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const diff = (a, b) => `got ${JSON.stringify([...a].sort())} expected ${JSON.stringify([...b].sort())}`;

const EXPECTED = {
  tools: ['select', 'line', 'rect', 'circle', 'polygon', 'arc', 'bezier', 'trim', 'break', 'fillet', 'dim', 'coincident', 'hv', 'parallel', 'perp', 'collinear', 'tangent', 'equal', 'midpoint'],
  notInRibbon: ['pan'],
  constraintTypes: ['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'tangent', 'pointOnLine', 'distance', 'equal', 'angle', 'midpoint'],
  definitions: ['distance', 'point_on_line', 'coincident', 'horizontal', 'vertical', 'midpoint', 'collinear', 'parallel', 'perpendicular', 'tangent', 'equal', 'angle', 'mouse_spring'],
  shapeKinds: ['line', 'construction line', 'circle', 'arc (centre, start, end)', 'fillet arc', 'polygon side', 'rect side', 'bezier', 'point / joint'],
  shapeTypeLiterals: ['arc', 'bezier', 'circle', 'line'],
  dimensionModes: ['aligned', 'horizontal', 'vertical', 'line length', 'point-line', 'line-line', 'angle', 'radius'],
  editFeatures: ['fillet', 'fillet radius edit', 'trim', 'break', 'polygon', 'rect rect-2pt', 'rect rect-center', 'rect rect-3pt', 'construction toggle', 'lock / fix',
    'delete constraints', 'delete shapes', 'delete joints', 'delete selection', 'undo', 'redo', 'driving / reference (context menu)', 'driving / reference (toggleDriving)',
    'delete dimension (context menu)', 'lock / delete (geometry context menu)', 'drag (mouse_spring)'],
};
const check = (name, got, want) => ok(`inventory matches the code: ${name}`, same(got, want), diff(got, want));

check('ribbon tools (SketchStudio)', I.tools.map(t => t.tool), EXPECTED.tools);
check('SketchStudio app tools = ribbon tools', I.apps.sketchstudio, EXPECTED.tools);
check('TOOL_MODES values outside the ribbon', I.notInRibbon, EXPECTED.notInRibbon);
ok('every TOOL_MODES value is a ribbon tool or a declared non-ribbon tool', Object.values(TOOL_MODES).every(v => I.tools.some(t => t.tool === v) || EXPECTED.notInRibbon.includes(v)));
ok('every ribbon tool has a declared solver role', I.tools.every(t => t.solverRole), I.tools.filter(t => !t.solverRole).map(t => t.tool).join());
check('CONSTRAINT_TYPES', I.constraintTypes.map(c => c.type), EXPECTED.constraintTypes);
check('CONSTRAINT_TYPES (imported constant)', Object.values(CONSTRAINT_TYPES), EXPECTED.constraintTypes);
check('solver Definitions keys', I.definitions.map(d => d.key), EXPECTED.definitions);
ok('every constraint type has a solver Definition', I.constraintTypes.every(c => c.definition), I.constraintTypes.filter(c => !c.definition).map(c => c.type).join());
ok('every Definition other than mouse_spring is a constraint type', I.definitions.every(d => d.key === 'mouse_spring' || I.constraintTypes.some(c => c.definition && c.definition.line === d.line)));
ok('every constraint type has a creation site in the code', I.constraintTypes.every(c => c.createdAt.length > 0), I.constraintTypes.filter(c => !c.createdAt.length).map(c => c.type).join());
check('shape kinds', I.shapeKinds.map(k => k.kind), EXPECTED.shapeKinds);
check('shape type literals the tools create', I.shapeTypeLiterals, EXPECTED.shapeTypeLiterals);
check('dimension modes', I.dimensionModes.map(d => d.mode), EXPECTED.dimensionModes);
check('edit features', I.editFeatures.map(e => e.feature), EXPECTED.editFeatures);
ok('mirror / offset / copy-paste are absent from SketchStudio (scan finds no code)', I.absent.hits.length === 0, JSON.stringify(I.absent.hits));
ok('diameter has a label branch but no creator', I.diameter.line > 0);
ok('every inventory item carries a file:line', [...I.tools, ...I.constraintTypes, ...I.dimensionModes, ...I.editFeatures.map(e => ({ ...e.where })), ...I.shapeKinds.map(k => ({ ...k.where }))].every(x => x.file && x.line > 0));


// ---------------------------------------------------------------------------------------------------------------- coverage: inventory -> matrix
const rowIds = ROWS.map(r => r.id), kindLetters = KINDS.map(k => k.k);
const COVER = {
  tools: { select: ['deferred', 'drag + pick: not a constraint x geometry cell'], line: ['kinds', 'L', 'C'], rect: ['kinds', 'R'], circle: ['kinds', 'O'], polygon: ['kinds', 'S'], arc: ['kinds', 'A'], bezier: ['kinds', 'B'],
    trim: ['deferred', 'rewrites shapes/joints: a part 2/3 edit audit'], break: ['deferred', 'splits a line: a part 2/3 edit audit'], fillet: ['kinds', 'F'],
    dim: ['rows', 'dim-aligned', 'dim-horizontal', 'dim-vertical', 'dim-length', 'dim-point-line', 'dim-line-line', 'dim-angle-xy', 'dim-radius'],
    coincident: ['rows', 'coincident'], hv: ['rows', 'horizontal-2pt', 'vertical-2pt', 'horizontal-line', 'vertical-line'], parallel: ['rows', 'parallel'], perp: ['rows', 'perpendicular'],
    collinear: ['rows', 'collinear'], tangent: ['rows', 'tangent'], equal: ['rows', 'equal'], midpoint: ['rows', 'midpoint-line', 'midpoint-3pt'] },
  constraintTypes: { coincident: 'coincident', horizontal: 'horizontal-2pt', vertical: 'vertical-2pt', parallel: 'parallel', perpendicular: 'perpendicular', collinear: 'collinear', tangent: 'tangent',
    pointOnLine: 'dim-point-line', distance: 'dim-aligned', equal: 'equal', angle: 'dim-angle-xy', midpoint: 'midpoint-line' },
  definitionsDeferred: { mouse_spring: 'drag spring, not a user constraint' },
  dimensionModes: { aligned: 'dim-aligned', horizontal: 'dim-horizontal', vertical: 'dim-vertical', 'line length': 'dim-length', 'point-line': 'dim-point-line', 'line-line': 'dim-line-line', angle: 'dim-angle-xy', radius: 'dim-radius' },
  shapeKinds: { line: 'L', 'construction line': 'C', circle: 'O', 'arc (centre, start, end)': 'A', 'fillet arc': 'F', 'polygon side': 'S', 'rect side': 'R', bezier: 'B', 'point / joint': 'P' },
  // edit features: the matrix exercises these on every cell; the rest are deferred to the edit audit (parts 2/3) and listed so a NEW feature cannot slip through
  editCovered: ['fillet', 'fillet radius edit', 'polygon', 'rect rect-2pt', 'lock / fix', 'delete constraints', 'undo'],
  editDeferred: ['trim', 'break', 'rect rect-center', 'rect rect-3pt', 'construction toggle', 'delete shapes', 'delete joints', 'delete selection', 'redo', 'driving / reference (context menu)',
    'driving / reference (toggleDriving)', 'delete dimension (context menu)', 'lock / delete (geometry context menu)', 'drag (mouse_spring)'],
};
for (const t of I.tools) {
  const c = COVER.tools[t.tool];
  ok(`tool '${t.tool}' is covered or deferred by the matrix`, !!c && (c[0] === 'deferred' || (c[0] === 'rows' ? c.slice(1).every(r => rowIds.includes(r)) : c.slice(1).every(k => kindLetters.includes(k)))), JSON.stringify(c));
}
for (const c of I.constraintTypes) ok(`constraint type '${c.type}' has a matrix row`, rowIds.includes(COVER.constraintTypes[c.type]), c.type);
for (const d of I.definitions) ok(`solver Definition '${d.key}' is reached through a constraint type`, d.key === 'mouse_spring' ? !!COVER.definitionsDeferred.mouse_spring : I.constraintTypes.some(c => c.definition && c.definition.line === d.line && COVER.constraintTypes[c.type]));
for (const d of I.dimensionModes) ok(`dimension mode '${d.mode}' has a matrix row`, rowIds.includes(COVER.dimensionModes[d.mode]), d.mode);
for (const k of I.shapeKinds) ok(`shape kind '${k.kind}' is a matrix column`, kindLetters.includes(COVER.shapeKinds[k.kind]), k.kind);
const editOk = (e) => COVER.editCovered.includes(e.feature) !== COVER.editDeferred.includes(e.feature);
ok('every edit feature is covered by the matrix or explicitly deferred', I.editFeatures.every(editOk), I.editFeatures.filter(e => !editOk(e)).map(e => e.feature).join());
ok('a diameter dimension has no creation path (not a matrix row)', !ROWS.some(r => /diameter/.test(r.id)) && I.diameter.line > 0);

// ---------------------------------------------------------------------------------------------------------------- the matrix
// NEW findings (docs/COVERAGE-AUDIT.md). Each is required to have failing cells; its repro (matrix-findings.js) is expected to FAIL.
const KNOWN = {
  'NEW-1': 'point-to-line dimension throws ReferenceError (dimension-tool.js:619)',
  'NEW-2': 'point-to-line dimension is not a perpendicular distance (the helper slides)',
  'NEW-3': 'perpendicular refused between exactly parallel lines',
  'NEW-5': 'line-to-line dimension has a negative value in one click order (dimension-tool.js:437)',
  'NEW-6': 'feasible tangent circle/arc refused when the arc radius must change a lot',
  'NEW-8': 'parallel polygon side vs locked rect top: slow convergence after a jitter',
};
// round-1 findings are TOLERATED, not required: a fix task for F1..F6 must not have to edit this file (their cells simply turn PASS).
const ROUND1 = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6']);
const t0 = Date.now();
const cells = await runMatrix();
const secs = (Date.now() - t0) / 1000;
const verdicts = new Map();
for (const c of cells) { const v = classify(c); c.verdict = v.v; c.also = v.also || []; verdicts.set(v.v, (verdicts.get(v.v) || 0) + 1); }
console.log('matrix: ' + cells.length + ' cells in ' + secs.toFixed(1) + 's: ' + [...verdicts].sort().map(([k, n]) => k + '=' + n).join(' '));
ok('every row has cells in every variant', ROWS.every(r => VARIANTS.every(v => cells.some(c => c.row === r.id && c.variant === v))));
ok('the grid is complete: rows x column pairs x variants', cells.length === ROWS.reduce((n, r) => n + columnsFor(r).length * VARIANTS.length, 0), String(cells.length));
const badNA = cells.filter(c => c.verdict === 'N/A' && (c.accepted || !c.refusedCleanly));
ok('every refused-by-UI (N/A) cell really was refused with the document untouched', badNA.length === 0, badNA.slice(0, 3).map(c => c.row + ' ' + c.cols + ' ' + c.variant).join('; '));
ok('there are N/A (UI refuses) cells to check', (verdicts.get('N/A') || 0) > 100);
const unclassified = cells.filter(c => c.verdict === 'UNCLASSIFIED');
ok('no cell fails for a reason no finding explains', unclassified.length === 0, unclassified.slice(0, 5).map(c => c.row + ' ' + c.cols + '/' + c.variant + ' ' + c.issues.join('+')).join('; '));
for (const id of Object.keys(KNOWN)) {
  const n = cells.filter(c => c.verdict === id || c.also.includes(id)).length;
  if (n > 0) console.log(`known ${id}  [${KNOWN[id]}]  ${n} cell(s)`);
  else fail(`KNOWN entry ${id} now has NO failing cell, delete it (${KNOWN[id]})`);
}
for (const v of verdicts.keys()) if (/^NEW-/.test(v) && !(v in KNOWN)) fail(`cells classified ${v} but it is not a KNOWN entry`);
for (const v of verdicts.keys()) if (/^F\d$/.test(v) && !ROUND1.has(v)) fail('unknown round-1 id ' + v);
console.log('round-1 cells tolerated: ' + [...verdicts].filter(([k]) => /^F\d$/.test(k)).sort().map(([k, n]) => k + '=' + n).join(' '));

// repros: ok === true means the app is right; every NEW-1..7 is expected to FAIL today
for (const f of NEW_FINDINGS) {
  const r = await f.run();
  if (!(f.id in KNOWN)) fail(f.id + ' has a repro but no KNOWN entry');
  else if (r.ok) fail(`KNOWN repro ${f.id} now PASSES, delete it from KNOWN and matrix-findings.js (${KNOWN[f.id]})`);
  else console.log(`known ${f.id}  [${f.severity}] ${f.title}  -- ${r.observed}`);
}
const total = (Date.now() - t0) / 1000;
ok('matrix + repros run in under 30 s', total < 30, total.toFixed(1) + ' s');

console.log(`coverage-matrix: ${failures === 0 ? 'passed' : failures + ' failure(s)'} in ${total.toFixed(1)}s`);
process.exit(failures === 0 ? 0 : 1);

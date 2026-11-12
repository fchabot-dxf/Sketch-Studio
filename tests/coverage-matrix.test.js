// TASK 512 -- coverage audit, part 1: the inventory (SketchStudio solver scope) must still match the code. Report: docs/COVERAGE-AUDIT.md.
// A new tool / constraint type / shape kind / dimension mode / edit feature changes the derived inventory and FAILS here until it is added
// to the expected lists below AND covered by the matrix (tests/harness/coverage/matrix-*.js).
import { inventory as I } from './harness/coverage/inventory.js';
import { CONSTRAINT_TYPES, TOOL_MODES } from '#core/constants.js';

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

console.log(`coverage-matrix (inventory): ${failures === 0 ? 'passed' : failures + ' failure(s)'}`);
process.exit(failures === 0 ? 0 : 1);

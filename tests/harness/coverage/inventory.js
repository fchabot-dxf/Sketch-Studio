// TASK 512 -- coverage inventory (SketchStudio SOLVER scope). Every item is DERIVED FROM THE CODE: either imported (CONSTRAINT_TYPES,
// TOOL_MODES, Definitions, RECT_MODES) or located by a source scan that records the file:line it came from. tests/coverage-inventory.test.js
// asserts the inventory still matches the code, so a new tool / constraint / shape without coverage fails the gate.
// Scope (owner ruling): what reaches the solver in SketchStudio. Shaper, Pen Plotter, Trace, import/export and non-solver UI are out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONSTRAINT_TYPES, TOOL_MODES, RECT_MODES } from '#core/constants.js';
import { Definitions } from '#core/solver/definitions.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cache = new Map();
export function source(rel) {
  if (!cache.has(rel)) cache.set(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8').split(/\r?\n/));
  return cache.get(rel);
}
// first line (1-based) at or after `from` matching `re`; null when absent
export function findLine(rel, re, from = 1) {
  const L = source(rel);
  for (let i = from - 1; i < L.length; i++) if (re.test(L[i])) return i + 1;
  return null;
}
const at = (file, line) => ({ file, line });
function must(file, re, from) {
  const line = findLine(file, re, from);
  if (!line) throw new Error(`inventory: '${re}' not found in ${file}`);
  return at(file, line);
}
function listFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'tests' && e.name !== 'vendor') out.push(...listFiles(rel)); }
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

const RIBBON = 'packages/ui/tool-ribbon.js';
const TOOL_BY_VALUE = Object.fromEntries(Object.entries(TOOL_MODES).map(([k, v]) => [k, v]));

// ---- tools: the ribbon button arrays (CREATE / EDIT / INSPECT / CONSTRAIN), scanned entry by entry -------------------------------
function ribbonGroup(name) {
  const L = source(RIBBON);
  const start = L.findIndex(l => new RegExp(`^const ${name} = \\[`).test(l));
  if (start < 0) throw new Error('inventory: ribbon group ' + name + ' not found');
  const items = [];
  for (let i = start + 1; i < L.length && !/^\];/.test(L[i]); i++) {
    const m = L[i].match(/tool:\s*TOOL_MODES\.(\w+)/);
    if (m) items.push({ tool: TOOL_BY_VALUE[m[1]], key: m[1], label: (L[i].match(/label:\s*'([^']+)'/) || [])[1], group: name, ...at(RIBBON, i + 1) });
  }
  return items;
}
// what each tool does to the solver: declared here once (the tool names come from the code, this says why they are in scope)
const TOOL_SOLVER_ROLE = {
  select: 'drag (mouse_spring) and pick; the delete / lock / driving actions work on its selection',
  line: 'creates line shapes + joints + coincident joins', rect: 'creates 4 lines + H/V (+ construction diagonals for centre mode)',
  circle: 'creates a circle shape (1 joint, radius is shape data)', polygon: 'creates N sides + N radii + equal constraints',
  arc: 'creates an arc (3 joints + equal radius)', bezier: 'creates bezier shapes (2 joints, control points are data)',
  trim: 'splits / removes segments: rewrites shapes, joints and constraints', break: 'splits a line: new joint, constraints migrate',
  fillet: 'creates an arc + virtual sharp + tangents + radius dim',
  dim: 'creates distance / angle / radius constraints (a point-to-line dimension is one 3-joint distance)',
  coincident: 'coincident', hv: 'horizontal | vertical', parallel: 'parallel', perp: 'perpendicular', collinear: 'collinear',
  tangent: 'tangent', equal: 'equal', midpoint: 'midpoint', symmetric: 'symmetric (two points, two lines or two circles / arcs about a line)',
  mirror: 'creates mirrored copies (shapes + joints) linked to the originals by symmetric constraints only (task 585, #core/mirror.js)',
};
function buildTools() {
  const groups = ['CREATE', 'EDIT', 'INSPECT', 'CONSTRAIN'].flatMap(ribbonGroup);
  return groups.map(g => ({ ...g, solverRole: TOOL_SOLVER_ROLE[g.tool] || null }));
}

// ---- constraint types: CONSTRAINT_TYPES, STRUCTURAL_TYPES, the solver Definitions, and every creation site ------------------------
function structuralTypes() {
  const f = 'packages/core/constraint-manager.js';
  const L = source(f);
  const s = L.findIndex(l => /const STRUCTURAL_TYPES = new Set\(\[/.test(l));
  const out = new Set();
  for (let i = s; i < L.length && !/\]\);/.test(L[i - 0 === s ? i : i - 1] || ''); i++) {
    for (const m of L[i].matchAll(/CONSTRAINT_TYPES\.(\w+)/g)) out.add(CONSTRAINT_TYPES[m[1]]);
    if (/\]\);/.test(L[i])) break;
  }
  return out;
}
function creationSites() {
  // createConstraint / addConstraint calls and `type: 'x'` constraint literals in the builders, over core + ui (tests excluded)
  const byType = new Map();
  const add = (t, file, line) => { if (!byType.has(t)) byType.set(t, []); byType.get(t).push(at(file, line)); };
  const valueOfKey = (k) => CONSTRAINT_TYPES[k];
  for (const file of [...listFiles('packages/core'), ...listFiles('packages/ui'), ...listFiles('apps/sketchstudio')]) {
    if (file.endsWith('constants.js') || file.endsWith('constraint-manager.js') || file.includes('/solver/')) continue;
    source(file).forEach((l, i) => {
      if (file.endsWith('/constraint-tools.js')) { for (const mm of l.matchAll(/CONSTRAINT_TYPES\.(\w+)/g)) add(valueOfKey(mm[1]), file, i + 1); return; }
      let m = l.match(/(?:createConstraint|addConstraint)\(\s*[\w.]+,\s*CONSTRAINT_TYPES\.(\w+)/);
      if (m) return add(valueOfKey(m[1]), file, i + 1);
      m = l.match(/(?:createConstraint|addConstraint)\(\s*[\w.]+,\s*'(\w+)'/);
      if (m) return add(m[1], file, i + 1);
      m = l.match(/addViaManager\(\s*CONSTRAINT_TYPES\.(\w+)/);   // snap-constraints.js: a snapped joint-on-line (the only site of pointOnLine once the Dimension tool stopped making a helper joint)
      if (m) return add(valueOfKey(m[1]), file, i + 1);
      if (file.endsWith('/shapes.js') || file.endsWith('/fillet.js')) {
        m = l.match(/\{\s*type:\s*'(\w+)'.*(?:joints|shapes|line|circle|joint)/);
        if (m && Object.values(CONSTRAINT_TYPES).includes(m[1])) add(m[1], file, i + 1);
      }
    });
  }
  return byType;
}
function buildConstraintTypes() {
  const structural = structuralTypes();
  const sites = creationSites();
  const defLines = {};
  for (const k of Object.keys(Definitions)) { const ln = findLine('packages/core/solver/definitions.js', new RegExp(`^  ${k}:`)); if (ln) defLines[k] = ln; }
  return Object.entries(CONSTRAINT_TYPES).map(([key, type]) => ({
    key, type, ...at('packages/core/constants.js', findLine('packages/core/constants.js', new RegExp(`^  ${key}:`))),
    structural: structural.has(type),
    definition: Definitions[type] ? at('packages/core/solver/definitions.js', defLines[type] || defLines[type.replace(/[A-Z]/g, c => '_' + c.toLowerCase())]) : null,
    rows: Definitions[type] ? Definitions[type].rows : null,
    createdAt: sites.get(type) || [],
  }));
}
// solver Definitions keys (aliases pointOnLine / mouseSpring point at the same object and are folded into the snake_case key)
function buildDefinitions() {
  const seen = new Set(), out = [];
  for (const [k, def] of Object.entries(Definitions)) {
    if (seen.has(def)) continue; seen.add(def);
    const aliases = Object.entries(Definitions).filter(([k2, d2]) => d2 === def && k2 !== k).map(([k2]) => k2);
    out.push({ key: k, aliases, rows: def.rows, ...at('packages/core/solver/definitions.js', findLine('packages/core/solver/definitions.js', new RegExp(`^  ${k}:`))) });
  }
  return out;
}

// ---- shape kinds -------------------------------------------------------------------------------------------------------------------
// Each kind: where the code makes it. `drift` below asserts no OTHER `type: '<x>'` literal shape is created by the SketchStudio tools.
function buildShapeKinds() {
  return [
    { kind: 'line', where: must('packages/ui/input-handlers/line-tool.js', /type: 'line'/) },
    { kind: 'construction line', where: must('packages/ui/input-handlers/line-tool.js', /isConstruction: !!state\.isConstructionMode/) },
    { kind: 'circle', where: must('packages/ui/input-handlers/circle-tool.js', /type: 'circle'/) },
    { kind: 'arc (centre, start, end)', where: must('packages/core/shapes.js', /type: 'arc'/), note: 'makeArc(subType CENTER); ARC_MODES has only arc-cse: there is no 3-point arc' },
    { kind: 'fillet arc', where: must('packages/core/fillet.js', /filletSharp/) },
    { kind: 'polygon side', where: must('packages/core/shapes.js', /type: 'line', joints: \[corners\[i\]/) },
    { kind: 'rect side', where: must('packages/core/shapes.js', /type: 'line', joints: \[j1A, j2A\]/) },
    { kind: 'bezier', where: must('packages/core/shapes.js', /type: 'bezier'/), note: 'joints = the two endpoints only; control points are shape data' },
    { kind: 'point / joint', where: must('packages/ui/input-handlers/line-tool.js', /genJ\(\)/) },
  ];
}
// every `type: '<kind>'` shape literal the SketchStudio tools / builders push (drift check)
function shapeTypeLiterals() {
  const out = new Set();
  const files = ['packages/core/shapes.js', 'packages/core/fillet.js', 'packages/core/trim.js', 'packages/core/break.js',
    ...['line', 'circle', 'arc', 'bezier', 'rect', 'polygon', 'fillet', 'trim', 'break'].map(t => `packages/ui/input-handlers/${t}-tool.js`)];
  for (const f of files) source(f).forEach(l => { const m = l.match(/\btype:\s*'(\w+)'/); if (m && !Object.values(CONSTRAINT_TYPES).includes(m[1])) out.add(m[1]); });
  return [...out].sort();
}

// ---- dimension modes (what the Dimension tool can create) ----------------------------------------------------------------------------
const DT = 'packages/ui/input-handlers/dimension-tool.js';
function buildDimensionModes() {
  const modes = [];
  const dm = findLine(DT, /^function detectDimMode/);
  const L = source(DT);
  const found = new Set();
  for (let i = dm; i < dm + 32; i++) { const m = L[i - 1].match(/return '(aligned|horizontal|vertical)'/); if (m && !found.has(m[1])) { found.add(m[1]); modes.push({ mode: m[1], kind: 'distance point-point', ...at(DT, i) }); } }
  modes.push({ mode: 'line length', kind: 'distance on one line (dimMode auto)', ...must(DT, /create-line-dim/) });
  modes.push({ mode: 'point-line', kind: 'distance point to line (one 3-joint distance: perpendicular distance)', ...must(DT, /create-point-to-line/) });
  modes.push({ mode: 'line-line', kind: 'distance between two parallel lines (shapes)', ...must(DT, /create-line-line-distance/) });
  modes.push({ mode: 'angle', kind: 'angle between two lines (shapes), either pick order', ...must(DT, /create-angle'/) });
  modes.push({ mode: 'radius', kind: 'distance isRadius on a circle or an arc', ...must(DT, /isRadius: true,/) });
  return modes;
}
// declared label-only branch (no tool creates it)
function diameterBranch() { return at('packages/ui/svg-renderer.js', findLine('packages/ui/svg-renderer.js', /c\.isDiameter/)); }

// ---- edit features that create or change constraints / joints ------------------------------------------------------------------------
function buildEditFeatures() {
  const F = [];
  const f = (feature, where, note) => F.push({ feature, where, note: note || '' });
  f('fillet', must('packages/core/fillet.js', /^export function applyFillet/));
  f('fillet radius edit', must('packages/ui/dimension-seams.js', /^export function commitDimensionEdit/));
  f('trim', must('packages/core/trim.js', /^export function trimShape/));
  f('break', must('packages/core/break.js', /^export function breakShape/));
  f('polygon', must('packages/core/shapes.js', /^export function makePolygon/));
  for (const [k, v] of Object.entries(RECT_MODES)) f('rect ' + v, must('packages/core/constants.js', new RegExp(`^  ${k}:`)));
  f('construction toggle', must('packages/ui/design-browser.js', /s\.isConstruction = !s\.isConstruction/));
  f('lock / fix', must('packages/ui/input-manager.js', /^export function toggleFixedSelection/));
  f('delete constraints', must('packages/core/delete-manager.js', /^export function deleteConstraints/));
  f('delete shapes', must('packages/core/delete-manager.js', /^export function deleteShapes/));
  f('delete joints', must('packages/core/delete-manager.js', /^export function deleteJoints/));
  f('delete selection', must('packages/core/delete-manager.js', /^export function deleteSelection/));
  f('undo', must('packages/ui/sketch-state.js', /^    undo: function/));
  f('redo', must('packages/ui/sketch-state.js', /^    redo: function/));
  f('driving / reference (context menu)', must('packages/ui/context-menu.js', /id: 'dim-driving'/));
  f('driving / reference (toggleDriving)', must('packages/ui/dimension-seams.js', /^export function toggleDriving/));
  f('delete dimension (context menu)', must('packages/ui/context-menu.js', /id: 'dim-delete'/));
  f('lock / delete (geometry context menu)', must('packages/ui/context-menu.js', /id: 'geo-lock'/));
  f('drag (mouse_spring)', must('packages/core/solver/definitions.js', /^  mouse_spring:/));
  return F;
}

// features the task listed that have NO code in SketchStudio (searched: paste / offset / duplicate). Proven absent by scan. (Mirror exists since
// task 585: the `mirror` ribbon tool above, #core/mirror.js.)
export function absentFeatures() {
  const re = /\b(pasteSelection|copySelection|offsetShape|duplicateShape)\b/;
  const hits = [];
  for (const file of [...listFiles('packages/core'), ...listFiles('packages/ui'), ...listFiles('apps/sketchstudio')]) source(file).forEach((l, i) => { if (re.test(l)) hits.push(at(file, i + 1)); });
  return { names: ['offset', 'copy / paste'], hits };
}

function sketchStudioTools(tools) {
  // SketchStudio mounts createToolRibbon with no `profiles` option (apps/sketchstudio/ui/ui-manager.js), so it shows CREATE + EDIT(trim/break/fillet) + INSPECT + CONSTRAIN
  const mount = must('apps/sketchstudio/ui/ui-manager.js', /createToolRibbon\(\{/);
  const L = source('apps/sketchstudio/ui/ui-manager.js');
  const body = L.slice(mount.line - 1, mount.line + 6).join('\n');
  if (/profiles:\s*true/.test(body)) throw new Error('inventory: SketchStudio ribbon now mounts profile actions; update the inventory');
  return { mount, tools: tools.map(t => t.tool) };
}

export function buildInventory() {
  const tools = buildTools();
  const ss = sketchStudioTools(tools);
  return {
    scope: 'SketchStudio solver',
    tools,
    constraintTypes: buildConstraintTypes(),
    definitions: buildDefinitions(),
    shapeKinds: buildShapeKinds(),
    shapeTypeLiterals: shapeTypeLiterals(),
    dimensionModes: buildDimensionModes(),
    diameter: { ...diameterBranch(), note: 'label branch only; no tool creates a diameter dimension (no createConstraint with isDiameter)' },
    editFeatures: buildEditFeatures(),
    absent: absentFeatures(),
    structuralTypes: [...structuralTypes()],
    apps: { sketchstudio: ss.tools },
    sketchstudioRibbonMount: ss.mount,
    notInRibbon: Object.values(TOOL_MODES).filter(v => !tools.some(t => t.tool === v)),
  };
}
export const inventory = buildInventory();
export default inventory;

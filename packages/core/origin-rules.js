// packages/core/origin-rules.js — TASK 803: THE SHAPER ORIGIN & STUDIO RULES, kept ONCE as data and read by the exporter, the app and the
// validator. PURE (no DOM, no app imports).
//
// Built the way DDCS-Studio builds its G-code rules (wizards/dialects/: index.js registry + ddcs-*.js dialect objects + emitLintRules.js rule table):
//   1. ORIGIN_TARGETS  — the TARGET REGISTRY (= the dialect registry). 'origin' = the Shaper Origin machine, 'studio' = Shaper Studio (the app the
//                        file is imported into and whose exports are the ground truth for the file's encoding). Each target is a data object with its
//                        `caps` and its `forms` (= a dialect's forms), every form carrying its own `status` + `evidence`. The EXPORTER reads the forms to
//                        write the file (see EXPORT_FORMS_FROM / exportForm); a target without evidence for a form has no such form = silence.
//   2. ORIGIN_RULES    — the DECLARED RULE TABLE (= emitLintRules' TOKEN_RULES): plain rows { id, name, targets, sev, status, statement, check, message,
//                        evidence, usedBy }. `targets` lists ONLY the targets the evidence covers: a finding measured in Studio is never assumed for
//                        the Origin (and vice versa). A row with a declarative `check` is run by the ONE generic validator; adding a hazard = adding a
//                        row (or a new check kind), never editing the validator's flow. A row with `check: null` is a rule the app follows, not a
//                        property of one file (workflow / machine behaviour); it is still declared once, with its evidence and the code that applies it.
//                        Severity as in emitLintRules: 'error' = never legitimate; 'warn' = sometimes legitimate; 'info' = visibility; null = no static check.
//   3. checkOriginRules(svgText, { targets, encoding }) — the generic guard (= scanEmitForLintHits): pure (text in, hits out).
//
// A value that already lives in ONE declaration elsewhere is POINTED to, never copied: the cut-type colours are apps/shaper/src/shaper.js CUT_TYPES
// (injected into the validator like the exporter: `encoding`), the pocket's automatic offset is CUT_TYPES.pocket.autoOffsetFraction, and so on.
//
// docs/ORIGIN-RULES.md is a GENERATED INDEX of this file (scripts/gen-origin-rules-index.mjs): one line per rule (id, short name, links to the entry here, its
// evidence and its code). The rule's statement lives ONLY here.
import { pathSubpaths, pathSignedArea, pathBounds } from './path-d.js';

const freeze = Object.freeze;
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

// ── 1. THE TARGET REGISTRY ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Evidence entries: { log: 'TURN 802' } (a WORK-LOG heading: the index links its line) | { file: 'path' } | { url } | { note: 'what was seen' }.
const NS = { svg: 'http://www.w3.org/2000/svg', shaper: 'http://www.shapertools.com/namespaces/shaper' };

const origin = deepFreeze({
  id: 'origin',
  name: 'Shaper Origin',
  verified: true,
  // what the machine is known to do (a missing flag = unmeasured = false: DEFAULT_TARGET_CAPS)
  caps: {
    readsGroupAttrs: false,   // measured 2026-11-19 (TURN 802)
    autoPass: true,           // measured (TURN 775 / 778)
    openOnlineReverses: true, // measured 2026-11-17 (TURN 775)
    placedFileIsOneObject: true, // measured 2026-11-19 (owner screenshot)
    autoPocketOffset: true,   // documented (TURN 452)
  },
  forms: {
    namespaces: { ...NS, status: 'documented', evidence: [{ log: 'SP1j-2' }, { file: 'apps/shaper/samples/Untitled-2.svg' }], note: 'without xmlns:shaper the on-tool Origin ignores every shaper:* attribute' },
    attrPrefix: { value: 'shaper:', status: 'documented', evidence: [{ file: 'apps/shaper/samples/Untitled-2.svg' }] },
    attrPlacement: { groupAttrsAllowed: false, status: 'measured', evidence: [{ log: 'TURN 802' }, { note: 'owner, Origin, 2026-11-19 (turns 2560-2567): a Spiral pocket\'s grouped on-line paths came up "unset"' }] },
    // the cut-type colours: POINTED to, not copied
    cutTypes: { pointsTo: 'apps/shaper/src/shaper.js CUT_TYPES (exportEncoding())', status: 'documented', evidence: [{ log: 'SP1j' }, { file: 'apps/shaper/src/shaper.js' }] },
    guide: { markFill: 'none', status: 'measured', evidence: [{ log: 'TURN 786' }] }, // a start mark is a guide drawn as its outline
    compoundPath: { winding: 'opposite', status: 'measured', evidence: [{ log: 'TURN 456' }, { log: 'TURN 786' }] }, // the Origin fills by nonzero: a hole is wound opposite
    page: { unit: 'mm', status: 'measured', evidence: [{ log: 'TURN 786' }, { log: 'TURN 798' }] },
    datum: { tag: 'polygon', fill: '#FF0000', stroke: 'none', legX: 20, legY: 10, status: 'documented', evidence: [{ log: 'SP1j-3a' }] },
    geomDecimals: { value: 4, status: 'assumed', evidence: [{ note: 'the exporter\'s own choice: 0.0001 mm, far below the machine\'s resolution' }] },
  },
});

const studio = deepFreeze({
  id: 'studio',
  name: 'Shaper Studio',
  verified: true,
  caps: {
    readsGroupAttrs: false,       // the Studio exports carry every attribute on each path
    splitsOverlappingSubpaths: true, // measured (owner Studio tests)
    areaComputedInsideOutside: true, // measured (owner Studio tests)
    onlineOffsetMovesCut: false,  // measured (TURN 456: the band stays centred)
  },
  forms: {
    namespaces: { ...NS, status: 'measured', evidence: [{ file: 'apps/shaper/samples/Untitled-2.svg' }] },
    attrPrefix: { value: 'shaper:', status: 'measured', evidence: [{ file: 'apps/shaper/samples/Untitled-2.svg' }] },
    attrPlacement: { groupAttrsAllowed: false, status: 'measured', evidence: [{ log: 'TURN 456' }, { file: 'apps/shaper/samples/Untitled-2 (1).svg' }] },
    // THE ORDER AND PRESENCE of the shaper:* attributes on an element, as Studio writes them. `from`: 'encoding' = the cut type's own cutType;
    // 'record' = the cut record's field. omit: when the attribute is left out ('unset' = the string 'unset', 'missing' = null / not a number);
    // `missing`: the value written when the record has none; zeroBare: a zero is written bare ("0in").
    attrOrder: { value: ['cutType', 'cutDepth', 'cutOffset', 'toolDia'], status: 'measured', evidence: [{ log: 'TURN 456' }] },
    attrSpec: {
      value: {
        cutType: { from: 'encoding' },
        cutDepth: { from: 'record', omit: ['missing', 'unset'] },
        cutOffset: { from: 'record', missing: 0, zeroBare: true },
        toolDia: { from: 'record', omit: ['missing'] },
      },
      status: 'measured',
      evidence: [{ log: 'TURN 456' }],
    },
    paint: { fillAlways: true, strokeOmit: 'none', status: 'measured', evidence: [{ log: 'TURN 456' }, { file: 'apps/shaper/samples/Untitled-2.svg' }] },
    // the shaper:cutDepth / cutOffset / toolDia value: 3 decimals + a SPACE + the unit, a zero offset bare ("0in")
    paramFormat: { decimals: 3, separator: ' ', zeroBare: true, units: ['mm', 'cm', 'in'], status: 'measured', evidence: [{ log: 'TURN 456' }, { note: 'inch exports measured; mm / cm mirror the pattern (assumed: no Studio mm export seen)' }] },
    cutTypes: { pointsTo: 'apps/shaper/src/shaper.js CUT_TYPES (exportEncoding())', status: 'measured', evidence: [{ log: 'TURN 456' }, { file: 'apps/shaper/samples/Untitled-2.svg' }] },
    guide: { markFill: 'none', status: 'assumed', evidence: [{ note: 'not seen in a Studio export: a start mark is this app\'s own guide' }] },
    compoundPath: { winding: 'opposite', status: 'measured', evidence: [{ log: 'TURN 456' }, { file: 'apps/shaper/samples/Untitled-2 (2).svg' }] },
    page: { unit: 'mm', status: 'measured', evidence: [{ file: 'apps/shaper/samples/Untitled-2.svg' }] },
  },
});

export const ORIGIN_TARGETS = freeze({ origin, studio });
export const DEFAULT_TARGET_ID = 'origin';
/** Capability flags a target does not declare are FALSE: no measurement, no assumption (DDCS getCaps' safe floor). */
export const DEFAULT_TARGET_CAPS = freeze({ readsGroupAttrs: false, autoPass: false, openOnlineReverses: false, placedFileIsOneObject: false, autoPocketOffset: false, splitsOverlappingSubpaths: false, areaComputedInsideOutside: false, onlineOffsetMovesCut: false });

export const getTarget = (id) => ORIGIN_TARGETS[id] || ORIGIN_TARGETS[DEFAULT_TARGET_ID];
export const getTargetCaps = (id) => ({ ...DEFAULT_TARGET_CAPS, ...(getTarget(id).caps || {}) });
export const listTargets = () => Object.values(ORIGIN_TARGETS).map((t) => ({ id: t.id, name: t.name, verified: Boolean(t.verified) }));

/**
 * WHICH TARGET'S EVIDENCE each form the EXPORTER writes follows. The downloaded file is written in Shaper Studio's encoding (its attribute list, order,
 * paint and number format are Studio's, measured on Studio exports), and what the machine does with it (per-element attributes, the page, the datum, the
 * guide's outline, the compound path's winding) is the Origin's. One declaration, so the exporter never reads a form from a target with no evidence for it.
 */
export const EXPORT_FORMS_FROM = freeze({
  namespaces: 'origin', attrPrefix: 'origin', attrPlacement: 'origin', guide: 'origin', compoundPath: 'origin', page: 'origin', datum: 'origin', geomDecimals: 'origin',
  attrOrder: 'studio', attrSpec: 'studio', paint: 'studio', paramFormat: 'studio',
});

/** The form `name` the exporter follows (EXPORT_FORMS_FROM), its payload: `value` when the form is a { value, status, evidence } wrapper, else the form itself. */
export function exportForm(name) {
  const from = EXPORT_FORMS_FROM[name];
  if (!from) throw new Error(`origin-rules: no export form "${name}"`);
  const f = ORIGIN_TARGETS[from].forms[name];
  if (!f) throw new Error(`origin-rules: target ${from} declares no form "${name}"`);
  return 'value' in f ? f.value : f;
}

// ── 2. THE DECLARED RULE TABLE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `usedBy`: 'file#symbol' = the code that applies the rule; the symbol must appear in that file (tests/origin-rules-803-node.test.js).
const CUTTING = ['outside', 'inside', 'pocket', 'online'];
const AREA = ['outside', 'inside', 'pocket'];
const PARAM_ATTRS = ['shaper:cutDepth', 'shaper:cutOffset', 'shaper:toolDia'];
const HELP_PLACE = 'Shaper help articles 4402970652827 and 4403004593051 (Position / Anchor), as cited in WORK-LOG TURN 798';

export const ORIGIN_RULES = deepFreeze([
  {
    id: 'shaper-namespace', name: 'Shaper XML namespace', targets: ['origin', 'studio'], sev: 'error', status: 'documented',
    statement: 'The root <svg> declares xmlns="http://www.w3.org/2000/svg" and xmlns:shaper="http://www.shapertools.com/namespaces/shaper"; without xmlns:shaper the on-tool Origin ignores every shaper:* attribute.',
    check: { kind: 'root-namespaces' },
    message: 'the root <svg> must declare xmlns and xmlns:shaper (the Origin ignores every shaper:* attribute without it)',
    evidence: [{ log: 'SP1j-2' }, { file: 'apps/shaper/samples/Untitled-2.svg' }],
    usedBy: ['packages/core/shaper-export.js#exportForm', 'apps/shaper/src/shaper.js#exportForm'],
  },
  {
    id: 'per-element-attributes', name: 'Every element carries its own cut attributes', targets: ['origin', 'studio'], sev: 'error', status: 'measured',
    statement: 'Every <path> / <circle> carries its own shaper:cutType, cutDepth, cutOffset and toolDia and its own fill / stroke; the Origin ignores the attributes of a parent <g> (a grouped on-line path came up "unset"). Shaper Studio writes every attribute on every path.',
    check: { kind: 'per-element-attrs', shapeTags: ['path', 'circle'], required: 'shaper:cutType' },
    message: 'every path / circle must carry its own shaper:* attributes (the Origin ignores a parent <g>\'s)',
    evidence: [{ log: 'TURN 802' }, { note: 'owner, Origin, 2026-11-19 (turns 2560-2567)' }, { file: 'tests/export-own-attrs-802-node.test.js' }],
    usedBy: ['packages/core/shaper-export.js#shaperAttrs', 'apps/shaper/src/export-preview.js#cutAttr'],
  },
  {
    id: 'cut-type-encoding', name: 'Cut type = fill + stroke colours', targets: ['origin', 'studio'], sev: 'error', status: 'measured',
    statement: 'An element\'s shaper:cutType and its fill / stroke colours are one of the declared cut-type encodings (the app\'s CUT_TYPES, the ONE declaration of the colours: apps/shaper/src/shaper.js); a start mark is the guide drawn as its outline (fill="none").',
    check: { kind: 'cut-type-encoding' },
    message: 'shaper:cutType and the fill / stroke do not match a declared cut-type encoding',
    evidence: [{ log: 'TURN 456' }, { log: 'TURN 786' }, { file: 'apps/shaper/samples/Untitled-2.svg' }],
    usedBy: ['packages/core/shaper-export.js#colorAttrs', 'apps/shaper/src/shaper.js#CUT_TYPES'],
  },
  {
    id: 'tool-dia-present', name: 'Cutter diameter on every cut', targets: ['origin', 'studio'], sev: 'warn', status: 'measured',
    statement: 'Every cutting element (outside, inside, pocket, on-line) carries shaper:toolDia: the cutter the cut was planned for travels with it (a guide, e.g. the frame guide of a partial file, needs none).',
    check: { kind: 'required-cut-attr', cutTypes: CUTTING, attr: 'shaper:toolDia' },
    message: 'a cutting element has no shaper:toolDia',
    evidence: [{ log: 'TURN 456' }, { log: 'TURN 802' }, { file: 'apps/shaper/samples/Untitled-2.svg' }],
    usedBy: ['packages/core/shaper-export.js#shaperAttrs'],
  },
  {
    id: 'param-unit-suffix', name: 'Lengths carry a unit', targets: ['origin', 'studio'], sev: 'error', status: 'measured',
    statement: 'shaper:cutDepth, cutOffset and toolDia are a number followed by a length unit (mm, cm or in), e.g. "0.125 in", "3.175 mm", "0in".',
    check: { kind: 'attr-format', attrs: PARAM_ATTRS, pattern: '^-?\\d+(?:\\.\\d+)?\\s*(?:mm|cm|in)$' },
    message: 'a shaper:cutDepth / cutOffset / toolDia value is not a number with a length unit',
    evidence: [{ log: 'TURN 456' }, { file: 'tests/studio-encoding-node.test.js' }],
    usedBy: ['packages/core/units.js#formatShaperParam'],
  },
  {
    id: 'studio-param-format', name: 'Studio\'s length format', targets: ['studio'], sev: 'info', status: 'measured',
    statement: 'Shaper Studio writes a non-zero shaper:* length with 3 decimals, a space and the unit ("0.100 in", "-2.000 in") and a zero offset as "0in" (its own preset bit sizes are written bare, "0.125in"); mm / cm mirror the pattern (assumed).',
    check: { kind: 'attr-format', attrs: PARAM_ATTRS, pattern: '^(?:0(?:mm|cm|in)|-?\\d+\\.\\d{3} (?:mm|cm|in))$' },
    message: 'a shaper:* length is not in Studio\'s 3-decimal, spaced format',
    evidence: [{ log: 'TURN 456' }, { file: 'tests/studio-encoding-node.test.js' }],
    usedBy: ['packages/core/units.js#formatShaperParam'],
  },
  {
    id: 'shaper-attr-order', name: 'Studio\'s shaper:* attribute order', targets: ['studio'], sev: 'warn', status: 'measured',
    statement: 'Shaper Studio writes the shaper:* attributes of an element in the order cutType, cutDepth (only when set), cutOffset (always), toolDia.',
    check: { kind: 'attr-order' },
    message: 'the shaper:* attributes are not in Studio\'s order (cutType, cutDepth, cutOffset, toolDia)',
    evidence: [{ log: 'TURN 456' }, { file: 'apps/shaper/samples/Untitled-2.svg' }],
    usedBy: ['packages/core/shaper-export.js#shaperAttrs'],
  },
  {
    id: 'compound-path-winding', name: 'Holes wound opposite their outer', targets: ['origin', 'studio'], sev: 'error', status: 'measured',
    statement: 'A hole or island of a compound <path> is wound the OPPOSITE way to the sub-path that encloses it (by signed area) and no fill-rule is written: the Origin fills by nonzero, so a hole wound the same way is filled solid. Studio writes its compound paths this way.',
    check: { kind: 'compound-winding', cutTypes: AREA, forbidFillRule: 'evenodd' },
    message: 'a nested sub-path of a compound path is wound the same way as its enclosing one (or the path asks for evenodd): the Origin fills it solid',
    evidence: [{ log: 'TURN 456' }, { log: 'TURN 786' }, { file: 'tests/cam-export-786-node.test.js' }],
    usedBy: ['packages/core/loop-geometry.js#compoundPathD'],
  },
  {
    id: 'page-viewbox-mm', name: 'Page in mm holding every element', targets: ['origin', 'studio'], sev: 'error', status: 'measured',
    statement: 'The root <svg> has its width and height in mm equal to its viewBox size, and the viewBox holds the drawing, the datum triangle and the TRUE extent of every written element (an arc or a cubic by its extremes, a tab\'s gap strip, a start mark).',
    check: { kind: 'page-viewbox', tolMm: 0.05 },
    message: 'the page is not in mm, or an element lies outside the viewBox',
    evidence: [{ log: 'TURN 786' }, { file: 'tests/cam-export-786-node.test.js' }],
    usedBy: ['packages/core/shaper-export.js#boundsOf'],
  },
  {
    id: 'partial-export-page', name: 'A partial file keeps the whole page', targets: ['origin'], sev: null, status: 'documented',
    statement: 'A file of only some operations has the SAME page (width, height, viewBox) and hole ownership as the file of the whole design, so every element is byte-identical to its element in the full file and the files line up when placed with the same anchor.',
    check: null, message: null,
    evidence: [{ log: 'TURN 798' }, { file: 'tests/op-ticks-798-node.test.js' }, { note: HELP_PLACE }],
    usedBy: ['packages/core/shaper-export.js#options.frame', 'apps/shaper/src/export-payload.js#exportFileOf'],
  },
  {
    id: 'partial-export-frame-guide', name: 'A partial file keeps the Stock guide or a frame guide', targets: ['origin'], sev: null, status: 'assumed',
    statement: 'A partial file keeps the Stock guide (the Stock is always ticked). With no Stock, a partial file starts with a guide rectangle on the drawn extent of the whole file (the Stock guide\'s encoding, no cut parameters), so the full file and every partial one have the same 9-anchor box on the Origin whether it anchors on the page or on the drawn extent (the help pages do not say which).',
    check: null, message: null,
    evidence: [{ log: 'TURN 798' }, { note: 'advisor turn 2705, option b; the Origin\'s anchor box (page or drawn extent) is NOT measured' }],
    usedBy: ['packages/core/shaper-export.js#guideEnc', 'apps/shaper/src/export-payload.js#bitCentrePaths'],
  },
  {
    id: 'online-open-vs-closed', name: 'On-line paths: open reverses, closed repeats', targets: ['origin'], sev: null, status: 'measured',
    statement: 'The Origin reads shaper:cutDepth of an on-line path; with AutoPass an OPEN on-line path is cut forward and back, pass after pass, to the depth; a CLOSED one (no start point) is cut the same direction every pass.',
    check: null, message: null,
    evidence: [{ log: 'TURN 775' }, { log: 'TURN 778' }, { note: 'owner, Origin, 2026-11-17: leg-loop and retract tests' }],
    usedBy: ['apps/shaper/src/cut-plan.js#OPEN_PATH_AUTOPASS_NOTE', 'packages/core/pocket-clearing.js#planClearing'],
  },
  {
    id: 'lead-in-opens-path', name: 'A lead-in makes the on-line path open', targets: ['origin'], sev: null, status: 'measured',
    statement: 'HISTORY (the app has no lead-in since TASK 836). A closed outline with a lead-in attached, written as ONE path with no Z, is ONE open object on the Origin (end dots at the tip and the junction), so AutoPass reverses each pass; measured 2026-11-20: the plunge at the tip worked, but the junction end reversed ON the part and could dent it. Owner ruling 2026-11-20: lead-ins removed from the app (On line only, not worth it); turning an Outside / Inside cut into an On line loop to get one was rejected as too hacky (the bit and the offset would be baked into the file).',
    check: null, message: null,
    evidence: [{ log: 'TURN 775' }, { log: 'TURN 778' }, { log: 'TURN 836' }, { note: 'owner, Origin, 2026-11-20: the open lead-in reversed at the junction on the part' }],
    usedBy: ['apps/shaper/src/cut-plan.js#OPEN_PATH_AUTOPASS_NOTE'],
  },
  {
    id: 'tangent-circle-closed-loop', name: 'A tangent circle in a closed on-line loop cuts clean', targets: ['origin'], sev: null, status: 'measured',
    statement: 'HISTORY (TASK 836, not in the app: lead-ins were removed). A small circle in the waste tangent to an outline at a junction, written with the outline as ONE CLOSED on-line path (M junction, the circle as two arcs, the outline back to the junction, Z), is cut in one direction every pass with no turnaround anywhere; the operator plunges on the circle and the join is clean. Tested file (1 in square, 1/8 in bit, circle radius = the bit radius, outside, the top edge middle): M 12.7 0 A 1.5875 1.5875 0 0 0 12.7 -3.175 A 1.5875 1.5875 0 0 0 12.7 0 L 25.4 0 L 25.4 25.4 L 0 25.4 L 0 0 Z.',
    check: null, message: null,
    evidence: [{ log: 'TURN 836' }, { note: 'owner, Origin, 2026-11-20: the tangent-circle loop test, "worked perf"' }],
    usedBy: ['packages/core/pocket-clearing.js#planClearing'],
  },
  {
    id: 'online-no-machine-offset', name: 'An On line cut has no offset at the machine', targets: ['origin'], sev: null, status: 'measured',
    statement: 'The Origin cannot change the offset of an On line cut ("not possible to offset"): the bit centre follows the line as written.',
    check: null, message: null,
    evidence: [{ log: 'TURN 836' }, { note: 'owner, Origin, 2026-11-20, on the tangent-circle loop test: "not possible to offset"' }],
    usedBy: ['apps/shaper/src/shaper.js#offsetMovesCut'],
  },
  {
    id: 'placed-file-one-object', name: 'A placed file is ONE object', targets: ['origin'], sev: null, status: 'measured',
    statement: 'A placed file is ONE object on the Origin: the place screen offers Position (needs a Grid), Scale, Rotate, Anchor (9 points) and Snap, then Place / Cancel; there is no explode and no per-group remove.',
    check: null, message: null,
    evidence: [{ note: 'owner screenshot of the Origin\'s place screen, 2026-11-19' }, { note: HELP_PLACE }],
    usedBy: ['apps/shaper/src/export-payload.js#exportTickLine'],
  },
  {
    id: 'remove-whole-design', name: 'Remove takes the whole placed design', targets: ['origin'], sev: null, status: 'documented',
    statement: 'Remove on the Origin takes the whole placed design (every connected part of the file), not one group of it.',
    check: null, message: null,
    evidence: [{ note: 'Shaper help "Removing a Design" (support.shapertools.com, Design Mode)' }],
    usedBy: ['apps/shaper/src/export-payload.js#exportFileOf'],
  },
  {
    id: 'crossing-paths-one-object', name: 'Crossing paths are one object, a nested sub-path a hole', targets: ['studio'], sev: null, status: 'measured',
    statement: 'In Shaper Studio crossing paths are ONE object, overlapping sub-paths are split, and a nested sub-path stays a hole.',
    check: null, message: null,
    evidence: [{ note: 'owner Studio tests (memory: shaper-cam-ideas-list)' }, { log: 'TURN 804' }],
    usedBy: ['packages/core/path-crossings.js#pathCrossings', 'packages/core/pocket-clearing.js#planClearing'],
  },
  {
    id: 'inside-outside-from-area', name: 'Inside / Outside cuts are computed from the area', targets: ['studio'], sev: null, status: 'measured',
    statement: 'Studio computes an Inside / Outside cut from the shape\'s AREA: a line outside the area makes a bump, a line inside it or a zero-width spur is swallowed. So a lead-in could exist only as an on-line path (TASK 775; the app has none since TASK 836).',
    check: null, message: null,
    evidence: [{ note: 'owner Studio tests' }, { log: 'TURN 775' }, { log: 'TURN 778' }],
    usedBy: ['packages/core/profile-model.js#deriveProfileCuts'],
  },
  {
    id: 'guide-never-cut', name: 'Guides are shown, never cut; the Stock goes first', targets: ['origin', 'studio'], sev: null, status: 'documented',
    statement: 'A guide (shaper:cutType="guide", blue in Studio: CUT_TYPES.guide) is shown and never cut; the Stock outline is exported as a guide, written FIRST so what paints the file in order draws the board behind the cuts; a pocket\'s start mark is a stroke-only guide (fill="none") written right after its pocket.',
    check: null, message: null,
    evidence: [{ log: 'TURN 472' }, { log: 'TURN 774' }, { log: 'TURN 786' }],
    usedBy: ['packages/core/shaper-export.js#exportFirst', 'apps/shaper/src/shaper.js#drawnOnly', 'apps/shaper/src/export-preview.js#GUIDE_FILL'],
  },
  {
    id: 'studio-object-encoding', name: 'Studio\'s object encoding', targets: ['studio'], sev: null, status: 'measured',
    statement: 'Studio writes an object as <g id="sg-UUID" transform="matrix(...)"> holding <path id="basePath-sg-UUID-pg-UUID" ... d = "..."> with fill, stroke, fill-rule and every shaper:* attribute on the path.',
    check: null, message: null,
    evidence: [{ file: 'apps/shaper/samples/Untitled-2.svg' }, { note: 'owner\'s Studio export studio-group-sample.svg (advisor scratchpad origin-test/)' }],
    usedBy: ['apps/shaper/src/cut-import.js#inheritedCutAttributes'],
  },
  {
    id: 'pocket-auto-offset', name: 'The Origin keeps a pocket back by a quarter bit', targets: ['origin'], sev: null, status: 'documented',
    statement: 'The Origin keeps a pocket\'s cutter 1/4 of the cutter diameter back from the wall (so the edge can be finished with an Inside cut); the user\'s offset adds to it; the automatic offset is never written to the file. The factor lives in CUT_TYPES.pocket.autoOffsetFraction.',
    check: null, message: null,
    evidence: [{ log: 'TURN 452' }, { note: 'Shaper help "Pocketing procedure"' }],
    usedBy: ['apps/shaper/src/shaper.js#autoOffsetFraction', 'packages/core/stepped-cut.js#pocketKeepBackBits'],
  },
  {
    id: 'online-offset-centred', name: 'An On-line cut stays centred whatever the offset', targets: ['origin', 'studio'], sev: null, status: 'measured',
    statement: 'Studio shows and writes shaper:cutOffset on an On-line path but still draws its band centred on the line (Shaper: offsets are not an option for On line); the Origin does not offset an on-line path.',
    check: null, message: null,
    evidence: [{ log: 'TURN 450b' }, { log: 'TURN 456' }, { file: 'tests/studio-encoding-node.test.js' }],
    usedBy: ['apps/shaper/src/shaper.js#offsetMovesCut'],
  },
  {
    id: 'datum-triangle', name: 'The red registration triangle', targets: ['origin'], sev: null, status: 'documented',
    statement: 'An optional red right triangle at the 0,0 origin (legs on X and Y, fill #FF0000, no stroke) is the Origin\'s registration anchor: it snaps (0,0) to the 90 degree vertex. Written first.',
    check: null, message: null,
    evidence: [{ log: 'SP1j-3a' }],
    usedBy: ['packages/core/shaper-export.js#datumPolygon'],
  },
]);

export const originRuleById = (id) => ORIGIN_RULES.find((r) => r.id === id) || null;

// ── 3. THE GENERIC VALIDATOR ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const SHAPE_TAGS = new Set(['path', 'circle', 'polygon', 'polyline', 'rect', 'ellipse', 'line']);

// attributes in source order; optional spaces round '=' (Studio writes `d = "..."`), ' or " quotes
function parseTagAttrs(raw) {
  const list = [], map = Object.create(null);
  for (const m of raw.matchAll(/([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const value = m[2] !== undefined ? m[2] : m[3];
    list.push({ name: m[1], value }); map[m[1]] = value;
  }
  return { list, map };
}

// a light pure scanner (no DOM): the root <svg>, every <g> (with its attributes) and every shape with its ancestors
function parseSvgDoc(text) {
  const src = String(text || '').replace(/<!--[\s\S]*?-->/g, '');
  const doc = { root: null, groups: [], elements: [] };
  const stack = [];
  for (const m of src.matchAll(/<\s*(\/?)\s*([A-Za-z_][\w:.-]*)((?:\s+[^<>]*?)?)\s*(\/?)\s*>/g)) {
    const tag = m[2].toLowerCase();
    if (m[1] === '/') { if (tag === 'g') stack.pop(); continue; }
    const { list, map } = parseTagAttrs(m[3] || '');
    const node = { tag, attrs: map, attrList: list };
    if (tag === 'svg' && !doc.root) { doc.root = node; continue; }
    if (tag === 'g') { doc.groups.push(node); if (m[4] !== '/') stack.push(node); continue; }
    if (SHAPE_TAGS.has(tag)) { node.ancestors = stack.slice(); node.index = doc.elements.length; doc.elements.push(node); }
  }
  return doc;
}

const normColor = (c) => {
  const s = c == null ? '' : String(c).trim().toLowerCase();
  if (s === '' || s === 'none' || s === 'transparent') return 'none';
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : s;
};
const isDatum = (el, forms) => forms.datum && el.tag === forms.datum.tag && !el.attrs['shaper:cutType'] && normColor(el.attrs.fill) === normColor(forms.datum.fill);
const hasTransform = (el) => Boolean(el.attrs.transform) || (el.ancestors || []).some((g) => g.attrs.transform);

function summarize(el) {
  const bits = [`<${el.tag}`];
  if (el.attrs.id) bits.push(`id="${el.attrs.id}"`);
  for (const k of ['shaper:cutType', 'shaper:cutDepth']) if (el.attrs[k]) bits.push(`${k}="${el.attrs[k]}"`);
  if (el.tag === 'path' && el.attrs.d) bits.push(`d="${el.attrs.d.length > 40 ? el.attrs.d.slice(0, 40) + '...' : el.attrs.d}"`);
  if (el.tag === 'circle') bits.push(`cx="${el.attrs.cx}" cy="${el.attrs.cy}" r="${el.attrs.r}"`);
  return bits.join(' ') + '>';
}

// d -> subpaths, or null when it holds a command #core does not write (an elliptical arc of a Studio file, a relative command)
const subpathsOf = (d) => { try { return pathSubpaths(d); } catch (_) { return null; } };
const reencode = (sp) => {
  let d = `M ${sp.start.x} ${sp.start.y}`;
  for (const s of sp.segs) d += s.c === 'L' ? ` L ${s.to.x} ${s.to.y}` : s.c === 'A' ? ` A ${s.r} ${s.r} 0 ${s.large ? 1 : 0} ${s.sweep ? 1 : 0} ${s.to.x} ${s.to.y}` : ` C ${s.c1.x} ${s.c1.y} ${s.c2.x} ${s.c2.y} ${s.to.x} ${s.to.y}`;
  return sp.closed ? d + ' Z' : d;
};
function polyOf(sp) { // the sub-path sampled, for the nesting test
  const pts = [sp.start];
  for (const s of sp.segs) {
    if (s.c === 'A') {
      const dx = (s.from.x - s.to.x) / 2, dy = (s.from.y - s.to.y) / 2, h2 = dx * dx + dy * dy;
      if (h2 > 0) {
        const r = Math.max(Math.abs(s.r), Math.sqrt(h2)), co = (s.large === s.sweep ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - h2) / h2));
        const cx = co * dy + (s.from.x + s.to.x) / 2, cy = -co * dx + (s.from.y + s.to.y) / 2, a0 = Math.atan2(s.from.y - cy, s.from.x - cx);
        let da = Math.atan2(s.to.y - cy, s.to.x - cx) - a0;
        if (s.sweep && da < 0) da += 2 * Math.PI;
        if (!s.sweep && da > 0) da -= 2 * Math.PI;
        const n = Math.max(8, Math.ceil(Math.abs(da) / (Math.PI / 12)));
        for (let k = 1; k <= n; k++) pts.push({ x: cx + r * Math.cos(a0 + (da * k) / n), y: cy + r * Math.sin(a0 + (da * k) / n) });
        continue;
      }
    } else if (s.c === 'C') {
      for (let k = 1; k <= 12; k++) { const u = k / 12, v = 1 - u; pts.push({ x: v * v * v * s.from.x + 3 * v * v * u * s.c1.x + 3 * v * u * u * s.c2.x + u * u * u * s.to.x, y: v * v * v * s.from.y + 3 * v * v * u * s.c1.y + 3 * v * u * u * s.c2.y + u * u * u * s.to.y }); }
      continue;
    }
    pts.push(s.to);
  }
  return pts;
}
const inPoly = (poly, p) => { let inside = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside; } return inside; };
const insidePoint = (poly) => { const c = { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length }; return inPoly(poly, c) ? c : poly[0]; };

function boxOf(el) {
  if (el.tag === 'circle') { const cx = Number(el.attrs.cx), cy = Number(el.attrs.cy), r = Number(el.attrs.r); return [cx, cy, r].every(Number.isFinite) ? { minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r } : null; }
  if (el.tag === 'path') return subpathsOf(el.attrs.d) ? pathBounds(el.attrs.d) : null;
  if (el.tag === 'polygon') {
    const n = String(el.attrs.points || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (n.length < 2 || n.some((v) => !Number.isFinite(v))) return null;
    const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }
  return null;
}

// the check kinds: (doc, rule, ctx { forms: the target's forms, encoding }, hit(element, detail)); adding a rule row never edits checkOriginRules
const CHECKS = {
  'root-namespaces'(doc, rule, { forms }, hit) {
    if (!doc.root) return hit(null, 'no <svg> root');
    if (doc.root.attrs.xmlns !== forms.namespaces.svg) hit(null, `xmlns="${doc.root.attrs.xmlns || ''}"`);
    if (doc.root.attrs['xmlns:shaper'] !== forms.namespaces.shaper) hit(null, `xmlns:shaper="${doc.root.attrs['xmlns:shaper'] || ''}"`);
  },
  'per-element-attrs'(doc, rule, { forms }, hit) {
    const prefix = forms.attrPrefix.value;
    if (!forms.attrPlacement.groupAttrsAllowed) for (const g of doc.groups) { const bad = g.attrList.filter((a) => a.name.startsWith(prefix)).map((a) => a.name); if (bad.length) hit(g, `a <g> carries ${bad.join(', ')}`); }
    for (const el of doc.elements) if (rule.check.shapeTags.includes(el.tag) && !isDatum(el, forms) && !el.attrs[rule.check.required]) hit(el, `no own ${rule.check.required}`);
  },
  'cut-type-encoding'(doc, rule, { forms, encoding }, hit) {
    if (!Array.isArray(encoding)) return 'needs-encoding'; // the colours are the app's CUT_TYPES: injected, like the exporter's
    for (const el of doc.elements) {
      const ct = el.attrs['shaper:cutType'];
      if (!ct) continue;
      const decls = encoding.filter((t) => t.cutType === ct);
      if (!decls.length) { hit(el, `unknown shaper:cutType "${ct}"`); continue; }
      const fill = normColor(el.attrs.fill), stroke = normColor(el.attrs.stroke);
      const ok = decls.some((t) => stroke === normColor(t.stroke) && (fill === normColor(t.fill) || (ct === 'guide' && fill === normColor(forms.guide.markFill))));
      if (!ok) hit(el, `fill="${el.attrs.fill ?? 'none'}" stroke="${el.attrs.stroke ?? 'none'}" is none of the ${ct} encodings`);
    }
  },
  'required-cut-attr'(doc, rule, ctx, hit) {
    for (const el of doc.elements) if (rule.check.cutTypes.includes(el.attrs['shaper:cutType']) && !String(el.attrs[rule.check.attr] || '').trim()) hit(el, `no ${rule.check.attr}`);
  },
  'attr-format'(doc, rule, ctx, hit) {
    const re = new RegExp(rule.check.pattern);
    for (const el of doc.elements) for (const a of rule.check.attrs) if (a in el.attrs && !re.test(String(el.attrs[a]).trim())) hit(el, `${a}="${el.attrs[a]}"`);
  },
  'attr-order'(doc, rule, { forms }, hit) {
    const order = forms.attrOrder.value, prefix = forms.attrPrefix.value;
    for (const el of doc.elements) {
      const seen = el.attrList.filter((a) => a.name.startsWith(prefix)).map((a) => a.name.slice(prefix.length)).filter((k) => order.includes(k));
      if (seen.some((k, i) => i && order.indexOf(k) < order.indexOf(seen[i - 1]))) hit(el, `order ${seen.join(', ')}`);
    }
  },
  'compound-winding'(doc, rule, { forms }, hit) {
    const want = forms.compoundPath.winding; // 'opposite': a nested sub-path's signed area has the other sign
    for (const el of doc.elements) {
      if (el.tag !== 'path') continue;
      const fr = (el.attrs['fill-rule'] || '').trim().toLowerCase();
      if (fr && fr === rule.check.forbidFillRule) hit(el, `fill-rule="${fr}"`);
      if (el.attrs['shaper:cutType'] && !rule.check.cutTypes.includes(el.attrs['shaper:cutType'])) continue;
      const subs = subpathsOf(el.attrs.d);
      if (!subs) continue;
      const info = subs.filter((s) => s.closed).map((s) => { const d = reencode(s), a = pathSignedArea(d), poly = polyOf(s); return { sign: Math.sign(a), abs: Math.abs(a), box: pathBounds(d), poly, pt: insidePoint(poly) }; }).filter((x) => x.abs > 1e-6 && x.box);
      const e = 1e-4;
      for (let i = 0; i < info.length; i++) {
        const c = info[i];
        let parent = null;
        for (const p of info) if (p !== c && p.abs > c.abs && c.box.minX >= p.box.minX - e && c.box.maxX <= p.box.maxX + e && c.box.minY >= p.box.minY - e && c.box.maxY <= p.box.maxY + e && inPoly(p.poly, c.pt) && (!parent || p.abs < parent.abs)) parent = p;
        if (parent && (want === 'opposite' ? c.sign === parent.sign : c.sign !== parent.sign)) { hit(el, `sub-path ${i} is wound the ${want === 'opposite' ? 'same' : 'other'} way as the one enclosing it`); break; }
      }
    }
  },
  'page-viewbox'(doc, rule, { forms }, hit) {
    if (!doc.root) return;
    const unit = forms.page.unit, a = doc.root.attrs, num = new RegExp(`^(-?\\d+(?:\\.\\d+)?)${unit}$`);
    const w = num.exec(String(a.width || '').trim()), h = num.exec(String(a.height || '').trim());
    const vb = String(a.viewBox || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (!w || !h || vb.length !== 4 || vb.some((v) => !Number.isFinite(v))) return hit(null, `width="${a.width || ''}" height="${a.height || ''}" viewBox="${a.viewBox || ''}"`);
    const tol = rule.check.tolMm;
    if (Math.abs(Number(w[1]) - vb[2]) > tol || Math.abs(Number(h[1]) - vb[3]) > tol) hit(null, `${w[1]} x ${h[1]} ${unit} against a viewBox of ${vb[2]} x ${vb[3]}`);
    for (const el of doc.elements) {
      if (hasTransform(el)) continue; // placed by a matrix: its box is not in the page's frame
      const b = boxOf(el);
      if (b && (b.minX < vb[0] - tol || b.maxX > vb[0] + vb[2] + tol || b.minY < vb[1] - tol || b.maxY > vb[1] + vb[3] + tol)) hit(el, `box ${b.minX.toFixed(2)},${b.minY.toFixed(2)}..${b.maxX.toFixed(2)},${b.maxY.toFixed(2)} is outside the viewBox`);
    }
  },
};
/** The check kinds the validator knows (tests assert every rule's `check.kind` is one of them). */
export const CHECK_KINDS = freeze(Object.keys(CHECKS));

/**
 * Check a Shaper SVG against every declared rule that has a `check` and lists one of `targets` (default ['origin']; the Export step checks both: the file goes
 * to the Origin and is opened in Studio). A rule lists its own targets: its forms are read from the first requested target it lists, and a finding measured on
 * one target is never reported for the other. `encoding` = the app's CUT_TYPES (exportEncoding()), injected like the exporter's; without it the cut-type colours
 * are not checked (the rule is named in `skipped`).
 * Returns { ok (no error), clean (no error, no warn), targets, hits: [{ ruleId, name, sev, status, element, elementIndex, message, detail }], errors, warnings, info, skipped }.
 */
export function checkOriginRules(svgText, { target, targets, encoding } = {}) {
  const want = [...new Set(targets || (target ? [target] : [DEFAULT_TARGET_ID]))].map((id) => getTarget(id).id);
  const doc = parseSvgDoc(svgText), hits = [], skipped = [];
  for (const rule of ORIGIN_RULES) {
    if (!rule.check) continue;
    const t = want.find((id) => rule.targets.includes(id));
    if (!t) continue;
    const run = CHECKS[rule.check.kind];
    if (!run) throw new Error(`origin-rules: rule "${rule.id}" has an unknown check kind "${rule.check.kind}"`);
    const hit = (el, detail) => hits.push({ ruleId: rule.id, name: rule.name, sev: rule.sev, status: rule.status, element: el ? summarize(el) : '<svg>', elementIndex: el && el.index != null ? el.index : null, message: rule.message, detail: detail || null });
    if (run(doc, rule, { forms: getTarget(t).forms, encoding }, hit) === 'needs-encoding') skipped.push(rule.id);
  }
  const by = (s) => hits.filter((h) => h.sev === s);
  return { ok: !by('error').length, clean: !by('error').length && !by('warn').length, targets: want, hits, errors: by('error'), warnings: by('warn'), info: by('info'), skipped };
}

/** The Export step's short warning for a check result ('' when no error or warning; info stays quiet): which rules, the file is still exported. */
export function formatOriginRuleWarning(result) {
  const flagged = result ? [...result.errors, ...result.warnings] : [];
  if (!flagged.length) return '';
  const ids = [...new Set(flagged.map((h) => h.ruleId))];
  const names = ids.slice(0, 3).map((id) => originRuleById(id).name).join('; ');
  return `The file breaks ${ids.length} Origin rule${ids.length === 1 ? '' : 's'}: ${names}${ids.length > 3 ? ` (+${ids.length - 3} more)` : ''}. It is still exported.`;
}

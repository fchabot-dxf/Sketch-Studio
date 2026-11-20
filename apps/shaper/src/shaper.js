// Shaper Origin cut-type encoding — the single source of truth.
//
// Shaper encodes the cut operation in an element's fill/stroke COLOR, and
// (optionally) in explicit shaper:* attributes. Shaper's own docs show the
// colors as swatches rather than hex; the hex values below are the de-facto
// community encoding used by Shaper Studio and the common converters.
// If a value is ever wrong for your Origin, fix it HERE — everything reads
// from this table.

import { parse as parseUnit } from '#core/units.js';
import { POCKET_CLEARING } from '#core/pocket-clearing.js'; // TASK 745: the Clearing choices of the Pocket card
import { levelsCutAs, hasLevels } from '#core/stepped-cut.js'; // TASK 792: the plain type a Roughing / Contour level is cut as

const SHAPER_NS = 'http://www.shapertools.com/namespaces/shaper';

// Hex is UPPERCASE to round-trip byte-for-byte with Shaper's own exporter.
// Match is case-insensitive (see classify), so lowercase input still works.
//
// fill/stroke = the EXPORT encoding (black/white/gray/blue — never change these here; the SVG export reads them).
// SP1f adds three DECLARED-but-additive fields used only by Shaper's Prepare tab (they never touch export):
//   targetKind  — 'region' (acts on a closed area) | 'path' (acts on a single vector). Drives the gating rule:
//                 a LOOP target accepts all 5; an EDGE target accepts only the 'path' types (online/guide).
//   menuLabel   — the cut-menu label (matches Shaper's wording).
//   autoOffsetFraction — TASK 452: the Origin keeps a pocket's cutter this fraction of the cutter diameter BACK from the wall
//                 automatically ("Pocketing procedure": "Origin automatically adds a small offset when performing a pocket cut,
//                 allowing you finish up the edge with an Inside cut", "equal to 1/4th of the specified cutter diameter" since the
//                 Napa software). The user's own cutOffset ADDS to it. Declared ONCE here; effectiveCutRecord() turns it into
//                 rec.autoOffset (mm) for the preview. The Origin's own offset is never written to the export.
//   params      — TASK 450/450b/456: WHICH cut params the type has, ONE declaration (of cutDepth, cutOffset, toolDia: the shaper:* attributes). Today every type has
//                 all three (cutDepth, cutOffset, toolDia): Shaper Studio shows and writes an offset on On Line too (owner's
//                 screenshot + a real Studio export with shaper:cutOffset="0in" on an On Line path), and a Guide keeps them (its
//                 type can be changed ON THE TOOL later and the params travel with the path). The declaration stays so a type
//                 that really lacks a param is a one-line change: the cut card shows only those rows, the export writes only
//                 those attributes, the preview ignores the rest (a value stored for a missing param is never migrated).
//   offsetMovesCut — TASK 456: `false` = a stored offset does NOT move the cut: Studio still draws an On Line band CENTRED on the
//                 line with an offset typed in (Shaper: "offsets are not an option" for On Line). The card still shows the field and
//                 the export still writes it (Studio parity); only the PREVIEW (effectiveCutRecord) ignores it.
//   icon        — TASK 455: the inline SVG inner markup (16x16, currentColor) shown in the cut card dropdown. The Prepare preview colours
//                 are CSS tokens in apps/shaper/index.html (--sk-prep-*), not hex fields on the record (the export fill/stroke stay).
// TASK 742: HOLD PART (#core/hold-part.js): the plain Outside / Inside cuts declare its card rows: `holdPart` (Off | Tabs | Onion skin), and for
// Tabs `tabCount` (Auto | a number) and `tabWidth`, for both `holdThickness` (the tab / skin thickness). Never written to the export as attributes
// (shaperAttrs writes only cutDepth / cutOffset / toolDia); the exporter cuts the record through the one derivation (deriveCuts).
const HOLD_PARAMS = ['holdPart', 'tabCount', 'tabWidth', 'holdThickness'];
// TASK 745: the PROGRAMMED POCKET (#core/pocket-clearing.js): the plain Pocket declares its card rows: `clearing` (Freehand | Spiral | Raster | Morphed
// spiral; TASK 749: Spiral replaced Concentric) and for a computed pattern `stepover` (% of the bit), `finishAllowance`, `loop` (TASK 750: the whole pocket as closed loops,
// the finish turn in them; the step-downs are the Origin's Pass Depth / AutoPass) and, for Raster, `rasterAngle`.
// Never written to the export as attributes (shaperAttrs writes only cutDepth / cutOffset / toolDia); the exporter cuts the record through the one
// derivation (deriveCuts), which writes a programmed pocket as on-line paths + the finish pass (an inside cut, islands as outside cuts).
const CLEARING_PARAMS = ['clearing', 'stepover', 'finishAllowance', 'loop', 'rasterAngle']; // TASK 750: `loop` = true | false (default off), any programmed pattern; TASK 778: pockets get a start mark, no lead-in row
// TASK 775 / 778: the TANGENTIAL ARC LEAD-IN (#core/lead-in.js, On line outlines only): `leadIn` (Off | On: true | false), `leadInRadius` (base mm | null = calculated),
// `leadInSweep` (degrees 15-180 | null = calculated), `leadInLength` (optional straight part before arc, base mm | null = calculated 0),
// `leadInSide` (Outside | Inside: the waste side the arc sits on), `leadInAt` (junction position 0..1 | null = calculated). On line also takes the HOLD PART rows (742's declaration:
// its tabs are gaps left uncut, #core/hold-part tabsHaveThickness). Never written to the export as attributes; the exporter cuts the record through the one derivation (deriveCuts).
const LEAD_IN_PARAMS = ['leadIn', 'leadInRadius', 'leadInSweep', 'leadInLength', 'leadInSide', 'leadInAt'];
// TASK 812 (docs/OPERATIONS-MODEL.md 1.5): `fields` = the SETTINGS an operation of this type is made of, in the operation key's order: the ONE declaration of which settings
// belong to which type (operations.js settingsOf reads it: each field's value is computed there, once; the cut card asks cutTypeHasField). [] = none (the Stock: one per
// document). TASK S1 (advisor ruling 1): the Guide declares its Depth / Offset / Bit (its card rows, written to the file per element): Guides with different values
// are different operations.
// TASK 743: `opRank` = where an OPERATION of this type goes in the DEFAULT operation order (apps/shaper/src/operations.js), lowest first: what is not cut
// (Guide, Stock: 0), then on line (1), pockets (2), inside cuts = the holes (3), and last the outside cuts that free the part (4). A stepped type ranks as
// its plain type (it is cut as terraces of it). Prepare only: never written to the export.
export const CUT_TYPES = [
  { id: 'exterior', label: 'Exterior', cutType: 'outside', fill: '#000000', stroke: 'none',    desc: 'Cut out a positive shape (closed paths)',  targetKind: 'region', menuLabel: 'Outside', icon: "<rect x='1.5' y='1.5' width='15' height='15' fill='none' stroke='currentColor' stroke-width='1.3' stroke-dasharray='1.8 1.6'/><rect x='5' y='5' width='8' height='8' fill='none' stroke='currentColor' stroke-width='1.5'/><circle cx='16.5' cy='11' r='1.5' fill='currentColor'/>", opRank: 4, contourOn: 'sloped', fields: ['depth', 'offset', 'hold'], params: ['cutDepth', 'cutOffset', 'toolDia', ...HOLD_PARAMS] },
  { id: 'interior', label: 'Interior', cutType: 'inside',  fill: '#FFFFFF', stroke: '#000000', desc: 'Cut a through-hole (closed paths)',         targetKind: 'region', menuLabel: 'Inside', icon: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><rect x='5.5' y='5.5' width='7' height='7' fill='none' stroke='currentColor' stroke-width='1.3' stroke-dasharray='1.6 1.4'/><circle cx='12.5' cy='9' r='1.4' fill='currentColor'/>", opRank: 3, contourOn: 'sloped', fields: ['depth', 'offset', 'hold'], params: ['cutDepth', 'cutOffset', 'toolDia', ...HOLD_PARAMS] },
  { id: 'pocket',   label: 'Pocket',   cutType: 'pocket',  fill: '#7F7F7F', stroke: 'none',    desc: 'Remove material inside to a depth (closed paths)', targetKind: 'region', menuLabel: 'Pocket', icon: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M4.5 4.5l9 9M13.5 4.5l-9 9' fill='none' stroke='currentColor' stroke-width='1.2' stroke-dasharray='1.5 1.5'/>", opRank: 2, contourOn: 'sloped', fields: ['depth', 'offset', 'clearing'], params: ['cutDepth', 'cutOffset', 'toolDia', ...CLEARING_PARAMS], autoOffsetFraction: 0.25 },
  { id: 'online',   label: 'On-line',  cutType: 'online',  fill: 'none',    stroke: '#7F7F7F', desc: 'Center the cut on the path',               targetKind: 'path',   menuLabel: 'On line', icon: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.4' stroke-dasharray='1.8 1.6'/><circle cx='16' cy='11' r='1.6' fill='currentColor'/>", opRank: 1, fields: ['depth', 'offset', 'hold', 'leadIn'], params: ['cutDepth', 'cutOffset', 'toolDia', ...HOLD_PARAMS, ...LEAD_IN_PARAMS], offsetMovesCut: false },
  { id: 'guide',    label: 'Guide',    cutType: 'guide',   fill: '#0068FF', stroke: '#0068FF', desc: 'Reference mark, not cut',                  targetKind: 'path',   menuLabel: 'Guide', icon: "<path d='M8 2h8v8M2 8v8h8' fill='none' stroke='currentColor' stroke-width='1.6'/>", opRank: 0, drawnOnly: true, fields: ['depth', 'offset', 'bit'], params: ['cutDepth', 'cutOffset', 'toolDia'] }, // TASK 814: `drawnOnly` = the Guide is drawn on the Origin's screen, never cut, so it does not own its loop (#core ownedLoopIds)
  // TASK 472: STOCK = the board itself, drawn as a closed profile in Design and marked here. NOT a cut: the Review extrudes it to its
  // thickness (the one depth row, relabelled: `depthParam` = its entry in param-hints.js, TASK 770). The EXPORT writes it as a GUIDE (owner: "ok guide then": Shaper's docs call a guide
  // "uncuttable", so the stock line can never be cut by accident): the guide's colour and cutType, its thickness in cutDepth, in
  // the same format as every other cut (TASK 774, owner turn 2356: `exportFirst`: written FIRST in the file, before every cut, so what paints the file in order
  // draws the board behind the cuts); `exportParams` = the attributes the exported element carries (a guide keeps all
  // three), `params` = the rows the Prepare card shows. Declared AFTER the guide so classify() (import) reads blue as a GUIDE:
  // re-importing gives a Guide the owner can re-mark Stock.
  { id: 'stock',    label: 'Stock',    cutType: 'guide',   fill: '#0068FF', stroke: '#0068FF', desc: 'The board: this closed profile, extruded to its thickness (shown in Review; exported as a guide)', targetKind: 'region', menuLabel: 'Stock', depthParam: 'stockDepth', exportFirst: true, icon: "<path d='M2 6l6-3.2L14 6 8 9.2z' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linejoin='round'/><path d='M2 6v4l6 3.2L14 10V6' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linejoin='round'/>", opRank: 0, fields: [], params: ['cutDepth'], exportParams: ['cutDepth', 'cutOffset', 'toolDia'] },
  // TASK 792 (owner turns 2474-2512): ROUGHING and CONTOUR, two OPERATIONS for any part with depth information (an STL's sections, a Fusion region's
  // slope rings, a drawn region: #core/stepped-cut.js, its TASK 792 header). Generated in the app as PLAIN cuts at fixed depths (the Origin sees plain
  // pockets / inside / outside cuts); `levelsOp` = which one (#core deriveCuts; injected into the record by effectiveCutRecord and the exporter).
  //  * Roughing REPLACES the stepped types of TASK 714 (Stepped pocket / inside / outside; owner turn 2512): a stepped record opens as Roughing with
  //    allowance 0 (shaper-doc.js applyShaperDoc), which IS the stepped cut. Offered on every closed region (a drawn pocket = one level); its rows: the
  //    depth, `stepDepth` (#core STEP_DEPTH) or ADAPTIVE stepping (TASK 717: `adaptiveSteps` + `stepDeviation`, a sloped region only), `finishAllowance`
  //    (the allowance left on every wall: 0 while the part has no Contour), `contour` (Off | On: adds / removes the part's Contour record), the bit;
  //    `roughLayout` (owner turn 2604: Terraces | Nested, #core ROUGH_LAYOUT; a part with levels only).
//  * TASK 809: both declare `smoothing` (a part with levels only): the operation's paths fitted with curves within that tolerance (#core/level-smooth.js).
//  * TASK 810: Roughing declares its MACHINING BOUNDARY (a part with levels only; #core ROUGH_BOUNDARY): `boundary` (+ the picked `boundaryShape`), `boundaryTool`, `boundaryOffset`;
//    both declare their HEIGHTS (#core levelsBand): `topDepth`, `bottomDepth`, `floorAllowance`; Contour its WHICH WALLS (#core CONTOUR_WALLS): `walls`.
  //  * Contour is never picked from the menu of a region: the Contour row of the part's card adds it as its OWN record (cut-plan.js `contour:<key>`, its
  //    own operation and bit group); its card has the fine step (`stepDepth`, #core LEVELS.contourStepMm by default), the bit and the cutter shape.
  // fill / stroke = the pocket's / the outside cut's and declared AFTER them, so classify() (import) never reads them. `opRank`: Roughing ranks as a
  // pocket, Contour after (operations.js ranks a levels operation by the cuts it makes, its finish after).
  { id: 'roughing', label: 'Roughing', cutType: 'pocket', fill: '#7F7F7F', stroke: 'none', desc: 'Clear the part level by level, leaving an allowance on the walls', targetKind: 'region', menuLabel: 'Roughing', levelsOp: 'roughing', contourOn: 'always', icon: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M4.5 13.5V10.5h3v-3h3v-3h3' fill='none' stroke='currentColor' stroke-width='1.4' stroke-linejoin='round'/>", opRank: 2, fields: ['depth', 'offset', 'steps', 'allowance', 'layout', 'minWidth', 'smoothing', 'boundary', 'heights'], params: ['cutDepth', 'cutOffset', 'toolDia', 'stepDepth', 'adaptiveSteps', 'stepDeviation', 'finishAllowance', 'contour', 'roughLayout', 'minTerraceWidth', 'smoothing', 'boundary', 'boundaryTool', 'boundaryOffset', 'topDepth', 'bottomDepth', 'floorAllowance'] },
  { id: 'contour', label: 'Contour', cutType: 'outside', fill: '#000000', stroke: 'none', desc: 'Finish the sloped walls at a fine step, along the walls', targetKind: 'finish', menuLabel: 'Contour', levelsOp: 'contour', icon: "<path d='M2.5 15.5h3.2c1.2-3.6 2.4-6.2 3.3-8.2c0.9-2 2.1-4 3.4-4.8h3.1' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round'/><path d='M5.2 12.5h1.6M6.4 9.5h1.6M7.9 6.5h1.6' fill='none' stroke='currentColor' stroke-width='1.2'/>", opRank: 3, fields: ['steps', 'smoothing', 'heights', 'walls'], params: ['toolDia', 'stepDepth', 'smoothing', 'topDepth', 'bottomDepth', 'floorAllowance', 'walls'] },
];

// TASK 745: the Clearing choices of the Pocket card (#core POCKET_CLEARING.patterns, in its order) with the icon of each pattern (18x18 inner markup in
// currentColor, as CUT_TYPES.icon): Freehand = a hand-drawn stroke, Spiral (TASK 749) = a squared spiral of square rings joined by short straight links,
// Raster = parallel passes, Morphed spiral = a square spiral whose turns grow.
const CLEARING_ICONS = {
  freehand: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M4.5 12.5c1.6-4.5 2.6 1.5 4.2-2.6s2.6 1.2 4.8-4.4' fill='none' stroke='currentColor' stroke-width='1.3' stroke-linecap='round'/>",
  linked: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M7.6 9V7.6h2.8v2.8H7.6V9H4.8V4.8h8.4v8.4H4.8V9' fill='none' stroke='currentColor' stroke-width='1.2' stroke-linejoin='round'/>",
  raster: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M4.5 5h9M4.5 7.7h9M4.5 10.3h9M4.5 13h9' fill='none' stroke='currentColor' stroke-width='1.2'/>",
  morphed: "<rect x='2' y='2' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M9 9h1.6v-2.2H7v4.6h6V4.6H4.6v9h8.6' fill='none' stroke='currentColor' stroke-width='1.2' stroke-linejoin='round'/>",
};
export const CLEARING_CHOICES = POCKET_CLEARING.patterns.map((p) => ({ ...p, icon: CLEARING_ICONS[p.id] }));

// TASK 472: the id of the Stock type, and the encoding the EXPORT gets: CUT_TYPES with each entry's `exportParams` (if any) as its
// `params`, so a Stock loop exports exactly like a Guide while its Prepare card shows only the thickness row.
export const STOCK_TYPE_ID = 'stock';
export const exportEncoding = () => CUT_TYPES.map((t) => (t.exportParams ? { ...t, params: t.exportParams } : t));


// DECLARED V-bit presets — the INCLUDED angle (°), the cut card's V-bit cutter shape angles (`cutterAngle`). halfAngleTan = tan(angle/2)
// (#core/cutter-profile.js vbitHalfAngleTan): 90° → 1; 60° → tan30 ≈ 0.577 (a groove ~1.73× deeper for the same width).
export const VBIT_PRESETS = [{ angle: 90 }, { angle: 60 }, { angle: 45 }, { angle: 30 }, { angle: 20 }];

// --- Prepare cut-plan helpers (SP1f) -------------------------------------
// The Prepare tab assigns a cut to a topological TARGET (a loop or an edge), not to an SVG element. These helpers
// declare the per-target cut RECORD shape + the type gating; the live assignments (keyed by targetKey) live in
// prepare-view.js so they persist across Prepare re-mounts.

export function cutTypeById(id) {
  return CUT_TYPES.find((t) => t.id === id) || null;
}

// TASK 450b: does this cut type have this param ('cutDepth' | 'cutOffset' | 'toolDia')? Declared on the CUT_TYPES record
// (`params`); an unknown / unset type = yes (nothing to hide before a type is chosen).
export function cutTypeHasParam(id, param) {
  const t = id ? cutTypeById(id) : null;
  return !(t && Array.isArray(t.params) && !t.params.includes(param));
}
// TASK 812: does this cut type declare this operation-settings field (`fields`)? An unknown / unset type = no.
export function cutTypeHasField(id, field) {
  const t = id ? cutTypeById(id) : null;
  return Boolean(t && Array.isArray(t.fields) && t.fields.includes(field));
}
// The record the PREVIEW should use: params the type does not have are ignored (never migrated or deleted from the plan).
export function effectiveCutRecord(rec) {
  if (!rec || !rec.cutType) return rec;
  const out = { ...rec };
  if (!cutTypeHasParam(rec.cutType, 'cutDepth')) out.cutDepth = 'unset';
  if (!cutTypeHasParam(rec.cutType, 'cutOffset')) out.cutOffset = 0;
  if (cutTypeById(rec.cutType) && cutTypeById(rec.cutType).offsetMovesCut === false) out.cutOffset = 0; // preview only: the cut stays centred
  if (!cutTypeHasParam(rec.cutType, 'toolDia')) out.toolDia = 0;
  const t = cutTypeById(rec.cutType);
  if (t && t.levelsOp) { // TASK 792: Roughing / Contour: the derivation cuts every level as a plain type (#core levelsCutAs); a sloped region's as its terraces (TASK 714)
    out.levelsOp = t.levelsOp;
    if (rec.slope && !hasLevels(rec)) out.terraceAs = levelsCutAs(out);
  }
  const own = t && t.levelsOp ? cutTypeById(levelsCutAs(out)) : t; // a Roughing's pockets take the pocket's automatic offset (a stepped pocket's terraces did)
  out.autoOffset = (own && own.autoOffsetFraction) ? (Number(out.toolDia) || 0) * own.autoOffsetFraction : 0; // TASK 452: the Origin's automatic pocket offset
  return out;
}

// A fresh per-target cut record. Numeric fields are in BASE mm (U3a; 1 world unit = 1 mm) — the cut panel
// displays/parses them through the document unit. toolDia default 3.175 mm = 1/8 in.
export function defaultCutRecord() {
  return { cutType: null, cutDepth: 'unset', cutOffset: 0, toolDia: 3.175, cutterShape: 'endmill', cutterAngle: 90 };
}

// TASK 455: the CUTTER SHAPE (a cut-record field, NEVER exported: the Shaper SVG has no attribute for it; the 3D Review of task
// 457 will read it): 'endmill' (flat, default) | 'ballnose' | 'vbit'. A V-bit's angle (`cutterAngle`) comes from the EXISTING
// VBIT_PRESETS above (vbitHalfAngleTan stays the one V-bit helper). `icon` = 16x16 inner markup in currentColor.
export const CUTTER_SHAPES = [
  { id: 'endmill', label: 'end mill', icon: "<path d='M6 1v12h6V1' fill='none' stroke='currentColor' stroke-width='1.5'/><path d='M5 13h8' fill='none' stroke='currentColor' stroke-width='1.8'/>" },
  { id: 'ballnose', label: 'ball nose', icon: "<path d='M6 1v10a3 3 0 0 0 6 0V1' fill='none' stroke='currentColor' stroke-width='1.5'/>" },
  { id: 'vbit', label: 'V-bit', icon: "<path d='M5 1v8l4 7 4-7V1' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linejoin='round'/>" },
];
// DECLARED data: the quick bit-diameter presets of the cut card (VALUES are BASE mm; LABELS stay the imperial bit sizes, x 25.4 mm/in). TASK 743: also how
// an operation names its bit ("¼″ end mill", apps/shaper/src/operations.js): moved here from cut-panel.js, unchanged.
export const BIT_PRESETS = [
  { label: '.02', value: 0.508 },   // .02 in
  { label: '⅛', value: 3.175 },   // 1/8 in
  { label: '¼', value: 6.35 },    // 1/4 in
  { label: '½', value: 12.7 },    // 1/2 in
];
// TASK 455: the offset field's preset popover (3x2): .001 .005 .01 / 1/32 1/16 1/8 inch, in BASE mm. The mm values are the exact
// conversions of those inch presets — UNVERIFIED against Studio's own mm presets.
export const OFFSET_PRESETS = [
  { label: '.001', mm: 0.001 * 25.4 }, { label: '.005', mm: 0.005 * 25.4 }, { label: '.01', mm: 0.01 * 25.4 },
  { label: '1/32', mm: 25.4 / 32 }, { label: '1/16', mm: 25.4 / 16 }, { label: '1/8', mm: 25.4 / 8 },
];

// Gating: which cut types may be assigned to a target of this selection kind ('loop' | 'profile' | 'chain').
// A LOOP or PROFILE is both a closed region AND a closed path → all 5. A CHAIN is an open path → only the 'path' types.
// TASK 792: Roughing (a region type) on every closed region; the stepped types of TASK 714 (offered only with a slope) are gone. A CONTOUR target
// (kind 'contour': a part's Contour record, cut-plan.js) takes the 'finish' type only, and no other target ever does.
export function availableTypes(selectedKind, record = null) {
  if (selectedKind === 'contour') return CUT_TYPES.filter((t) => t.targetKind === 'finish');
  return CUT_TYPES.filter((t) => t.targetKind !== 'finish' && (t.targetKind === 'path' || selectedKind === 'loop' || selectedKind === 'profile'));
}
// TASK 792: where a part's card offers a CONTOUR (the finish): a type's `contourOn`: 'always' (Roughing) | 'sloped' (a plain Pocket / Inside / Outside cut,
// only when its record has sloped walls: a Fusion `slope` or an STL's `levels`; a vertical wall needs none).
export function contourAllowed(rec) {
  const t = rec && cutTypeById(rec.cutType);
  if (!t || !t.contourOn) return false;
  return t.contourOn === 'always' || Boolean(rec.slope || hasLevels(rec));
}

const NAMED = {
  black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080',
  blue: '#0000ff', red: '#ff0000', none: 'none', transparent: 'none',
};

// Normalize a CSS color to a lowercase #rrrggbb string (or 'none').
function norm(c) {
  if (c == null) return 'none';
  c = String(c).trim().toLowerCase();
  if (c === '') return 'none';
  if (NAMED[c]) return NAMED[c];
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return c;
}

function colorOf(el, attr) {
  return norm(el.getAttribute(attr));
}

// TASK 478: colours are matched with a TOLERANCE, declared ONCE here beside CUT_TYPES: the Fusion add-in writes
// fill="rgb(121,121,121)" / rgb(134,134,134) / rgb(106,106,106) for pockets (three different greys, one per depth), not Studio's exact
// #7F7F7F. A GREY (r, g, b within `grey.spread` of each other, level between `grey.min` and `grey.max`) matches a declared grey; black,
// white and the guide blue match within `channel` per channel. rgb(), #rgb, #rrggbb and the names all parse.
export const COLOR_TOLERANCE = { channel: 12, grey: { spread: 12, min: 40, max: 215 } };

// A CSS colour -> [r, g, b] (0-255), or null ('none', transparent, an unknown form).
function rgbOf(c) {
  if (c == null) return null;
  const t = String(c).trim().toLowerCase();
  if (t === '' || t === 'none' || t === 'transparent') return null;
  const m = /^rgba?\(\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)\s*[, ]\s*([\d.]+)(%?)/.exec(t);
  if (m) return [[m[1], m[2]], [m[3], m[4]], [m[5], m[6]]].map(([v, pct]) => Math.round(pct ? parseFloat(v) * 2.55 : parseFloat(v)));
  const hex = norm(t);
  const h = /^#([0-9a-f]{6})$/.exec(hex);
  return h ? [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)) : null;
}
const isGrey = (rgb) => { const sp = Math.max(...rgb) - Math.min(...rgb), lv = (rgb[0] + rgb[1] + rgb[2]) / 3; return sp <= COLOR_TOLERANCE.grey.spread && lv >= COLOR_TOLERANCE.grey.min && lv <= COLOR_TOLERANCE.grey.max; };
// Does an element colour (`actual`) match a DECLARED encoding colour (`declared`)? 'none' only matches 'none'.
function colorMatches(declared, actual) {
  const d = rgbOf(declared), a = rgbOf(actual);
  if (!d || !a) return !d && !a;
  if (isGrey(d)) return isGrey(a);
  return d.every((v, i) => Math.abs(v - a[i]) <= COLOR_TOLERANCE.channel);
}

// Which cut type (if any) does this element's current fill/stroke encode?
export function classify(el) {
  const f = colorOf(el, 'fill');
  const s = colorOf(el, 'stroke');
  for (const t of CUT_TYPES) {
    if (colorMatches(t.fill, f) && colorMatches(t.stroke, s)) return t.id;
  }
  return null;
}

// --- the shaper:* namespaced attribute reader (import) ---------------------

function getShaperAttr(el, name) {
  if (!el) return null;
  if (el.getAttributeNS) {
    const nsVal = el.getAttributeNS(SHAPER_NS, name);
    if (nsVal != null) return nsVal;
  }
  if (el.getAttribute) {
    return el.getAttribute(`shaper:${name}`) || el.getAttribute(name);
  }
  return null;
}

const CUT_TYPE_ALIASES = {
  outside: 'exterior',
  exterior: 'exterior',
  inside: 'interior',
  interior: 'interior',
  pocket: 'pocket',
  online: 'online',
  'on-line': 'online',
  guide: 'guide',
};

// Extract a cut record from an incoming SVG element (e.g. from Fusion 360 Shaper utility).
// Numeric fields are parsed to BASE mm per docUnit; unstated toolDia defaults to 1/8" (3.175 mm).
export function extractCutRecord(el, docUnit = 'mm') {
  if (!el) return null;
  const rawType = getShaperAttr(el, 'cutType');
  let cutType = null;
  if (rawType) {
    const normalized = String(rawType).trim().toLowerCase();
    cutType = CUT_TYPE_ALIASES[normalized] || null;
  }
  if (!cutType) {
    cutType = classify(el);
  }

  const rawDepth = getShaperAttr(el, 'cutDepth');
  let cutDepth = 'unset';
  if (rawDepth != null && String(rawDepth).trim() !== '' && String(rawDepth).trim().toLowerCase() !== 'unset') {
    const parsed = parseUnit(rawDepth, docUnit);
    if (parsed != null && Number.isFinite(parsed)) cutDepth = parsed;
  }

  const rawOffset = getShaperAttr(el, 'cutOffset');
  let cutOffset = 0;
  if (rawOffset != null && String(rawOffset).trim() !== '') {
    const parsed = parseUnit(rawOffset, docUnit);
    if (parsed != null && Number.isFinite(parsed)) cutOffset = parsed;
  }

  const rawDia = getShaperAttr(el, 'toolDia');
  let toolDia = 3.175; // Shaper standard default 1/8" = 3.175 mm
  if (rawDia != null && String(rawDia).trim() !== '') {
    const parsed = parseUnit(rawDia, docUnit);
    if (parsed != null && Number.isFinite(parsed) && parsed > 0) toolDia = parsed;
  }

  if (!cutType && cutDepth === 'unset' && cutOffset === 0 && !rawDia) return null;
  return { cutType, cutDepth, cutOffset, toolDia };
}

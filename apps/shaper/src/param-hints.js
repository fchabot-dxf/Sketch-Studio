// apps/shaper/src/param-hints.js — TASK 770 (owner turns 2320-2321: "Add tool tip / hint for all param"): THE table of the Shaper Prepare cut card's and the
// Export step's parameters: id -> { label, hint, items? }. ONE declaration: the cut card (cut-panel.js) and the Export side cards (main.js through hint.js
// mountHint) read every label AND every hint from here; no label text that this table has is left in the markup.
//   label  the name shown on the card (a parameter) or in the menu row (a choice)
//   hint   one or two short sentences in plain words: what it does and, where it matters, what the Origin does with it. A string, or a function of the
//          card's context ({ loop, pocket, online }) when the sentence depends on another setting (Finish allowance follows the Loop box; TASK 775: Lead-in
//          says where its leg goes, a pocket's or a line's; Tab width on an On line cut is a gap in the line). Never a length or a unit: the
//          document may be inches or mm.
//   items  the ids of the entries whose hints are listed under this one, one line each (the Hold part modes, the Export buttons)
// CHOICES (a cut type, a clearing pattern, a cutter shape, a hold-part mode) take their LABEL from their own declaration (CUT_TYPES.menuLabel,
// POCKET_CLEARING.patterns, CUTTER_SHAPES, HOLD_PART.modes: the one source those labels already have, read by the notes and the Operations list too);
// this table adds their hint. Their id here is `<parameter>:<choice id>` (choiceId below).
import { CUT_TYPES, CLEARING_CHOICES, CUTTER_SHAPES } from './shaper.js';
import { HOLD_PART } from '#core/hold-part.js';
import { LEAD_IN } from '#core/lead-in.js'; // TASK 775: the Lead-in choices (Off | On) and sides (Outside | Inside)

const STEPPED = 'For a sloped wall from Fusion: cut as several depths that follow the slope.';

/** The parameters: the cut card's rows (Prepare) and the Export step's cards. */
const PARAMS = {
  // ── the cut card (Prepare) ──
  cutType: { label: 'Cut type', hint: 'How the Origin cuts this shape.' },
  cutDepth: { label: 'Depth', hint: 'How deep the cut goes from the surface. Leave it empty to set the depth on the Origin.' },
  stockDepth: { label: 'Thickness', hint: 'The thickness of your board, shown in the 3D preview. Not cut.' }, // the depth row of a Stock loop (CUT_TYPES stock.depthParam)
  clearing: { label: 'Clearing', hint: 'How the inside of the pocket is removed.' },
  stepover: { label: 'Stepover', hint: 'How far the bit moves sideways between passes, as a share of its diameter. Smaller is smoother and slower.' },
  // TASK 766: the last pass that takes the allowance off is the Origin's own inside cut with Loop off, the loop's turn along the wall with Loop on (pocket-clearing.js)
  finishAllowance: { label: 'Finish allowance', hint: ({ loop } = {}) => `Left on the walls by the clearing passes; ${loop ? 'the loop’s turn along the wall' : 'the Origin’s inside cut'} takes it off for a clean edge. 0 = none.` },
  // TASK 775 (owner ruling: a closed loop has no start point on the Origin): the 770 / owner wording
  loop: { label: 'Loop', hint: 'Joins the clearing and the last wall pass into one closed path. Every depth pass then cuts in the same direction; with Loop off, AutoPass runs back along the path, so the direction alternates. The wall is then exact only for the bit size set here.' },
  // TASK 775: the LEAD-IN rows (an On line outline; a programmed pocket with Loop on: ctx.pocket)
  leadIn: { label: 'Lead-in', hint: ({ pocket } = {}) => `Starts the ${pocket ? 'loop at the end of a short leg inside the pocket' : 'closed line at the end of a short straight leg in the waste'}, so you plunge there. The path is then open: AutoPass runs back along it, so the cutting direction alternates.`, items: LEAD_IN.modes.map((m) => `leadIn:${m.id}`) },
  leadInLength: { label: 'Length', hint: 'How long the leg is: one bit diameter unless you set it, and at least the bit radius.' },
  leadInSide: { label: 'Side', hint: 'Which side of the line the leg goes to: pick the waste side. It meets the line at the middle of its longest straight edge.', items: LEAD_IN.sides.map((m) => `leadInSide:${m.id}`) },
  rasterAngle: { label: 'Raster angle', hint: 'The direction of the back-and-forth passes: 0° runs left to right, 90° up and down.' },
  adaptiveSteps: { label: 'Adaptive stepping', hint: 'Places the steps by how far they may stray from the slope: more steps where it is nearly flat, fewer where it is steep.' },
  stepDepth: { label: 'Step depth', hint: 'How much deeper each step goes. Smaller steps follow the slope more closely but take more cuts.' },
  stepDeviation: { label: 'Resolution', hint: 'The most the steps may stray from the true slope. Finer gives more steps.' },
  holdPart: { label: 'Hold part', hint: 'Keeps a cut-out part (or the waste of a hole) from coming loose when the cut goes through.', items: HOLD_PART.modes.map((m) => `holdPart:${m.id}`) },
  tabCount: { label: 'Tab count', hint: 'How many tabs. Auto spaces them along the outline by its length.' },
  tabWidth: { label: 'Tab width', hint: ({ online } = {}) => (online ? 'How long each gap left uncut in the line is; the wood it keeps is this minus the bit diameter.' : 'How long each tab is, along the outline.') }, // TASK 775: an On line cut's tabs are gaps in the line
  holdThickness: { label: 'Tab thickness', hint: 'How much wood each tab keeps, up from the bottom of the cut.' },
  skinThickness: { label: 'Skin thickness', hint: 'How thick the layer left at the bottom is.' }, // the holdThickness row with Onion skin
  cutOffset: { label: 'Offset', hint: 'Moves the cut this far from the line, toward its waste side: a part comes out bigger, a hole or pocket smaller. The arrows button switches the side. On line cuts ignore it.' },
  toolDia: { label: 'Bit diameter', hint: 'The bit you plan to use. It is written to the file, and the previews and programmed paths are drawn for it.' },
  cutterShape: { label: 'Cutter shape', hint: 'For the 3D preview and the operations list only: the Origin is not told the shape, so load the matching bit.' },
  // ── the Export step's side cards ──
  stockThickness: { label: 'Thickness', hint: 'The thickness of your board, for the 3D preview only. It is not written to the file.' },
  material: { label: 'Material', hint: 'The look of the board in the 3D preview only.' },
  export: { label: 'Export', hint: 'Three ways to get your cuts to the Origin:', items: ['generateSvg', 'syncShaperHub', 'openShaperHub'] },
  generateSvg: { label: 'Generate Shaper SVG', hint: 'Saves the Shaper SVG of your cuts to this computer, to put on the Origin by USB stick or ShaperHub.' },
  syncShaperHub: { label: 'Sync to ShaperHub', hint: 'Sends the file to your ShaperHub My Files with your Shaper login, so the Origin gets it over Wi-Fi.' },
  openShaperHub: { label: 'Open ShaperHub (My Files)', hint: 'Opens your ShaperHub files in a new browser tab.' },
  download: { label: 'Download', hint: 'Saves the Shaper SVG of your cuts to this computer (the same file as Generate Shaper SVG).' }, // the drawer's entry (a sidebar action: its tooltip)
  // ── TASK 772: Prepare Operations, Direction legend, Export toolbar/Cuts, and Sync to ShaperHub ──
  operations: { label: 'Operations', hint: 'Cut order sent to the Origin: drag a grip (or hold a row on touch) to reorder, tap to select, or tap the bin to clear.' },
  dirLegend: { label: 'direction: conventional (Shaper Origin)', hint: 'Arrows mark conventional cutting direction along closed shapes so the Origin keeps a clean wall finish.' },
  reviewCuts: { label: 'Cuts', hint: 'Assigned operations in job order: click one to highlight it and focus its cut depth details.' },
  reviewThreeD: { label: '3D', hint: 'Show the finished workpiece relief in interactive 3D.' },
  reviewTwoD: { label: '2D', hint: 'Inspect the flat exported Shaper SVG paths and colour coding.' },
  reviewReset: { label: 'Reset', hint: 'Return the 3D camera to the default angled overview.' },
  reviewTop: { label: 'Top', hint: 'Look straight down from above at the workpiece and paths.' },
  reviewFit: { label: 'Fit', hint: 'Frame the entire board and all cuts inside the view.' },
  syncFolder: { label: 'Destination Folder', hint: 'Sign in once to browse My Files folders, pick where the file uploads, or add a subfolder. Session stays in tab memory only.' },
  syncNewFolder: { label: 'New folder', hint: 'Create a subfolder inside the ShaperHub folder currently open.' },
  syncFilename: { label: 'File Name (on Origin)', hint: 'Name shown on your Origin screen: defaults to your design name and ends with .svg.' },
};

/** The hints of the choices, by parameter then choice id (their labels are their own declarations': CHOICE_SOURCES). */
const CHOICE_HINTS = {
  cutType: {
    online: 'The centre of the bit follows the line. For grooves and engraving, on open lines too.',
    guide: 'Not cut. Shown on the Origin as a reference.',
    interior: 'Cuts just inside a closed shape, for holes and openings. The Origin keeps the bit inside the line.',
    'stepped-inside': STEPPED,
    pocket: 'Clears the whole inside of a closed shape down to the depth.',
    'stepped-pocket': STEPPED,
    exterior: 'Cuts just outside a closed shape, for parts you keep. The Origin keeps the bit outside the line.',
    'stepped-outside': STEPPED,
    stock: 'The outline of your board. Not cut: it sets the board in the 3D preview and goes in the file as a guide.',
  },
  clearing: {
    freehand: 'You clear it by hand on the Origin, inside the outline.',
    linked: 'Rings from the middle outward, joined into one path (more if the pocket narrows or has islands).',
    raster: 'Straight back-and-forth passes, then one pass around the edge to clean up their ends.',
    morphed: 'One smooth spiral that grows into the shape of the pocket. Not for pockets with islands or narrow necks.',
  },
  cutterShape: {
    endmill: 'Flat tip: flat floors and square walls.',
    ballnose: 'Rounded tip: rounded grooves and soft floor edges.',
    vbit: 'Pointed tip, for V-grooves and chamfers. Pick its angle under it.',
  },
  leadIn: { // TASK 775
    off: 'A closed path: it has no start point, plunge anywhere on it.',
    on: 'The path starts at the leg’s end, in the waste.',
  },
  leadInSide: {
    outside: 'The leg goes out, away from the shape.',
    inside: 'The leg goes into the shape.',
  },
  holdPart: {
    off: 'Nothing holds it: the part comes free when the cut goes through.',
    tabs: 'Leaves small bridges of wood; cut them by hand afterwards.',
    skin: 'Leaves a thin layer at the bottom all the way round; free the part with a knife or a flush-trim bit.',
  },
};
/** Where each choice's label is declared (the one source of those labels). */
const CHOICE_SOURCES = {
  cutType: CUT_TYPES.map((t) => ({ id: t.id, label: t.menuLabel })),
  clearing: CLEARING_CHOICES.map((c) => ({ id: c.id, label: c.label })),
  cutterShape: CUTTER_SHAPES.map((s) => ({ id: s.id, label: s.label })),
  holdPart: HOLD_PART.modes.map((m) => ({ id: m.id, label: m.label })),
  leadIn: LEAD_IN.modes.map((m) => ({ id: m.id, label: m.label })), // TASK 775
  leadInSide: LEAD_IN.sides.map((m) => ({ id: m.id, label: m.label })),
};

/** The id of a choice's entry: `<parameter>:<choice id>`. */
export const choiceId = (param, id) => `${param}:${id}`;

/** THE table: every parameter, then every choice of a parameter (label from its declaration, hint from CHOICE_HINTS). */
export const PARAM_HINTS = Object.freeze(Object.fromEntries([
  ...Object.entries(PARAMS),
  ...Object.entries(CHOICE_SOURCES).flatMap(([param, list]) => list.map((c) => [choiceId(param, c.id), { label: c.label, hint: CHOICE_HINTS[param][c.id] }])),
].map(([id, e]) => [id, Object.freeze({ ...e })])));

/** An entry's label. Throws on an unknown id (a row with no entry is a bug, never a blank). */
export function hintLabel(id) {
  const e = PARAM_HINTS[id];
  if (!e) throw new Error('param-hints: no entry ' + id);
  return e.label;
}
/** An entry's hint text in a context ({ loop }: the card's record). */
export function hintText(id, ctx = {}) {
  const e = PARAM_HINTS[id];
  if (!e) throw new Error('param-hints: no entry ' + id);
  return typeof e.hint === 'function' ? e.hint(ctx) : e.hint;
}

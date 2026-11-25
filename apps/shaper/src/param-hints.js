// apps/shaper/src/param-hints.js — TASK 770 (owner turns 2320-2321: "Add tool tip / hint for all param"): THE table of the Shaper Prepare cut card's and the
// Export step's parameters: id -> { label, hint, items? }. ONE declaration: the cut card (cut-panel.js) and the Export side cards (main.js through
// bindHint in hint.js) read every label AND every hint from here (TASK 805: a hint shows as a tooltip at the cursor, never as text in the card); no label text that this table has is left in the markup.
//   label  the name shown on the card (a parameter) or in the menu row (a choice)
//   hint   one or two short sentences in plain words: what it does and, where it matters, what the Origin does with it. A string, or a function of the
//          card's context ({ loop, pocket, online }) when the sentence depends on another setting (Finish allowance follows the Loop box; Tab width on an On line cut is a gap in the line). Never a length or a unit: the
//          document may be inches or mm.
//   items  the ids of the entries whose hints are listed under this one, one line each (the Hold part modes, the Export buttons)
// CHOICES (a cut type, a clearing pattern, a cutter shape, a hold-part mode) take their LABEL from their own declaration (CUT_TYPES.menuLabel,
// POCKET_CLEARING.patterns, CUTTER_SHAPES, HOLD_PART.modes: the one source those labels already have, read by the notes and the Operations list too);
// this table adds their hint. Their id here is `<parameter>:<choice id>` (choiceId below).
import { CUT_TYPES, CLEARING_CHOICES, CUTTER_SHAPES } from './shaper.js';
import { HOLD_PART } from '#core/hold-part.js';
import { SPLIT_FILES } from './split-files.js'; // TASK 888
import { ROUGH_LAYOUT, ROUGH_BOUNDARY, CONTOUR_WALLS, CONTOUR_WALL_SIDES } from '#core/stepped-cut.js'; // TASK 792: Roughing's layouts; TASK 810: its boundary and tool rule, a Contour's walls


/** The parameters: the cut card's rows (Prepare) and the Export step's cards. */
const PARAMS = {
  // ── the cut card (Prepare) ──
  cutType: { label: 'Cut type', hint: 'How the Origin cuts this shape.' },
  cutDepth: { label: 'Depth', hint: 'One flat depth for every shape. From model: each shape’s own model depth (the deepest point of a sloped shape).' }, // TASK S2 (owner turn 2733): a flat type's Depth
  // TASK S2 (owner turn 2740): a Roughing's / Contour's Depth row (CUT_TYPES depthParam): its ONE depth (810's Bottom row is gone)
  levelsDepth: { label: 'Depth', hint: 'From model: each shape to its own model depth. A typed depth: the cut follows the model’s slope and stops flat at that depth.' },
  stockDepth: { label: 'Thickness', hint: 'The thickness of your board, shown in the 3D preview. Not cut.' }, // the depth row of a Stock loop (CUT_TYPES stock.depthParam)
  clearing: { label: 'Clearing', hint: 'How the inside of the pocket is removed.' },
  stepover: { label: 'Stepover', hint: 'How far the bit moves sideways between passes, as a share of its diameter. Smaller is smoother and slower.' },
  // TASK 766: the last pass that takes the allowance off is the Origin's own inside cut with Loop off, the loop's turn along the wall with Loop on (pocket-clearing.js)
  finishAllowance: { label: 'Finish allowance', hint: ({ loop, roughing } = {}) => (roughing ? 'Left on every wall by the roughing levels, for a finishing pass (a Contour) to take off. 0 = none.' : `Left on the walls by the clearing passes; ${loop ? 'the loop’s turn along the wall' : 'the Origin’s inside cut'} takes it off for a clean edge. 0 = none.`) }, // TASK 792: Roughing's allowance
  // TASK S2 (docs/OPERATIONS-MODEL.md 4.3, owner rulings turns 2710-2716): the OPEN operation's card: its Shapes (an X each), Duplicate, OK, Cancel. TASK 792's
  // Contour row and Edit contour are gone: the Contour is an operation type of its own (the type menu).
  opShapes: { label: 'Shapes', hint: 'The shapes this operation cuts. Click a shape on the drawing to add it, or click it again to take it out.', items: ['opRemoveShape'] },
  opRemoveShape: { label: 'Take out', hint: 'Takes this shape out of the operation. It stays in its other operations.' },
  opDuplicate: { label: 'Duplicate', hint: 'A copy of this operation, with the same type, settings and shapes, to change separately.' },
  opOk: { label: 'OK', hint: 'Keeps the changes: one step of Undo.' },
  opCancel: { label: 'Cancel', hint: 'Puts the operation back as it was when you opened it (Esc does the same).' },
  // TASK 817 (owner turns 2745-2748): toolpaths are made on OK, in the background; Preview makes them for the card's settings now, on request
  opPreview: { label: 'Preview', hint: 'Shows this operation’s paths with the settings in the card now (they are made in the background; the app stays usable). A later change fades them: press again to see the new ones. A preview is not saved, not exported and not a step of Undo; OK makes the paths.' },
  // TASK S3 addition (owner turns 3046-3047, Fusion style): an operation whose inputs changed since its paths were made is OUT OF DATE (its row's mark) until Recalculate
  opOutOfDate: { label: 'Out of date', hint: 'Out of date: press Recalculate.' },
  opRecalculate: { label: 'Recalculate', hint: 'Makes the paths of the out-of-date operations again: the selected ones, or every one when none is selected. They are made in the background; the app stays usable.' },
  // TASK 792 (owner turn 2604): Roughing's layout, a part with levels (an STL)
  minTerraceWidth: { label: 'Min terrace width', hint: 'Bands of the terrace map thinner than this are left uncut by Roughing (for example to finish them with a Contour). 0 = rough every band.' }, // TASK 792 (owner turns 2605-2607)
  // TASK 809 (owner turns 2655, 2660-2661): Smoothing, a toolpath setting of Roughing and Contour (a part with levels); TASK 810: in the Passes tab
  // TASK 888 (owner turns 3627-3628): a Roughing's / Contour's Split into files (split-files.js: the chunks and which file holds what)
  splitFiles: { label: 'Split into files', hint: 'Writes this operation’s levels in several files, top down, to cut one after the other. Every file has the same page: place each with the same anchor. The other operations go in the first file.', items: SPLIT_FILES.modes.map((m) => `splitFiles:${m.id}`) },
  splitDepth: { label: 'Depth per file', hint: 'How deep each file goes. A level exactly on a boundary is in the file above it.' },
  splitLevels: { label: 'Levels per file', hint: 'How many levels each file holds, top down; the last file holds what is left.' },
  smoothing: { label: 'Smoothing', hint: 'Fits smooth curves to this operation’s paths, never farther than this from the sliced levels (on either side), so the file is lighter and the bit runs smoothly. Details smaller than it may be smoothed away. 0 = off: the straight segments of the levels. The levels themselves are not changed.' },
  // TASK 810 (owner turns 2657-2658): the tabs of the Roughing and Contour cards (cut-panel.js CARD_TABS); a dot on a tab = one of its settings is not the default
  tabTool: { label: 'Tool', hint: 'The bit: its diameter and its shape. A dot means a setting here is not the default.' },
  tabGeometry: { label: 'Geometry', hint: 'Where the operation cuts: the area it works in and how close to the walls. A dot means a setting here is not the default.' },
  tabHeights: { label: 'Heights', hint: 'How deep it goes: where the cutting starts and stops. A dot means a setting here is not the default.' },
  tabPasses: { label: 'Passes', hint: 'How the material comes off: the levels, the step down, what is left on the walls and the smoothing. A dot means a setting here is not the default.' },
  // TASK 810 (owner turn 2656): Roughing's MACHINING BOUNDARY (a part with levels): where the roughing may cut is the user's choice, no longer fixed
  boundary: { label: 'Boundary', hint: 'The outline Roughing works inside. The tool rule and the offset below say how close the bit may come to it.', items: [...ROUGH_BOUNDARY.kinds.map((k) => `boundary:${k.id}`), 'boundaryShape'] },
  boundaryNoStock: { label: 'Stock', hint: 'Not available: this design has no Stock. Mark a closed shape as Stock (its cut type) to work inside the board.' },
  boundaryShape: { label: 'Boundary shape', hint: 'The closed shape Roughing works inside. Press Pick, then click a closed shape in Prepare. It follows the shape when you edit it.' },
  boundaryPick: { label: 'Pick', hint: 'Then click a closed shape in Prepare: it becomes the boundary. A click on empty space cancels.' },
  boundaryPickCancel: { label: 'Cancel pick', hint: 'Stops picking: the boundary stays as it was.' },
  boundaryTool: { label: 'Tool', hint: 'Where the bit may go at the boundary: kept inside it, its centre on it, or out past it.', items: ROUGH_BOUNDARY.tools.map((t) => `boundaryTool:${t.id}`) },
  boundaryOffset: { label: 'Boundary offset', hint: 'Moves the boundary out (positive) or in (negative) before the tool rule. Empty = calculated: the wall allowance plus three quarters of the bit, which with Outside clears a band two bits wide round the part.' },
  // TASK 810: the HEIGHTS of a Roughing / Contour: only a band of depths is cut
  topDepth: { label: 'Top', hint: 'Where the cutting starts, as a depth below the surface: the levels at or above it are not cut (for example, already cleared by another operation). Empty = the surface.' },
  floorAllowance: { label: 'Floor allowance', hint: 'Left above the Depth: the deepest level stops this much higher, for a later pass to finish. Separate from the wall allowance. 0 = none.' },
  wallSide: { label: 'Wall side', hint: 'Which side of the shape the walls are cut on, for a shape whose model does not say it (a drawn shape). Inside: the walls of a hollow; Outside: the outline of a part.', items: ['wallSide:inside', 'wallSide:outside'] }, // TASK S2
  walls: { label: 'Walls', hint: 'Which walls the Contour finishes. Sloped only skips the pass whose outline is the shape’s own outline (the straight wall an Outside or Inside cut already makes). Until you pick, it is All.', items: CONTOUR_WALLS.choices.map((w) => `walls:${w.id}`) }, // TASK 810
  roughLayout: { label: 'Layout', hint: 'How the levels are cut. The Origin cuts every path from the surface down.', items: ['roughLayout:terraces', 'roughLayout:nested'] },
  // TASK 775 (owner ruling: a closed loop has no start point on the Origin): the 770 / owner wording
  loop: { label: 'Loop', hint: 'Joins the clearing and the last wall pass into one closed path. Every depth pass then cuts in the same direction; with Loop off, AutoPass runs back along the path, so the direction alternates. The wall is then exact only for the bit size set here.' },
  rasterAngle: { label: 'Raster angle', hint: 'The direction of the back-and-forth passes: 0° runs left to right, 90° up and down. Auto aligns the passes along each pocket’s long side.' },
  adaptiveSteps: { label: 'Adaptive stepping', hint: 'Places the steps by how far they may stray from the slope: more steps where it is nearly flat, fewer where it is steep.' },
  stepDepth: { label: 'Step depth', hint: ({ contour } = {}) => (contour ? 'How much deeper each contour pass goes. Smaller passes follow the slope more closely but take more cuts.' : 'How much deeper each step goes. Smaller steps follow the slope more closely but take more cuts.') }, // TASK 792: a Contour's fine step
  stepDeviation: { label: 'Resolution', hint: 'The most the steps may stray from the true slope. Finer gives more steps.' },
  holdPart: { label: 'Hold part', hint: 'Keeps a cut-out part (or the waste of a hole) from coming loose when the cut goes through.', items: HOLD_PART.modes.map((m) => `holdPart:${m.id}`) },
  tabCount: { label: 'Tab count', hint: 'How many tabs. Auto spaces them along the outline by its length. Drag a tab on the outline to move it (the operation open): its shape then keeps its tabs where they are, and the count stays fixed until you pick Auto or type a count.' },
  tabWidth: { label: 'Tab width', hint: ({ online } = {}) => (online ? 'How long each gap left uncut in the line is; the wood it keeps is this minus the bit diameter.' : 'How long each tab is, along the outline.') }, // TASK 775: an On line cut's tabs are gaps in the line
  holdThickness: { label: 'Tab thickness', hint: 'How much wood each tab keeps, up from the bottom of the cut.' },
  skinThickness: { label: 'Skin thickness', hint: 'How thick the layer left at the bottom is.' }, // the holdThickness row with Onion skin
  cutOffset: { label: 'Offset', hint: 'Moves the cut this far from the line, toward its waste side: a part comes out bigger, a hole or pocket smaller. The arrows button switches the side. On line cuts ignore it.' },
  toolBit: { label: 'Bit', hint: 'A bit from My bits, or Custom to type its diameter and shape. The operation keeps its own copy of the bit, so changing or deleting the bit in My bits later does not change this design.' }, // TASK 842
  bitCustom: { label: 'Custom', hint: 'Type the bit diameter and pick the cutter shape yourself.' },
  toolTableEdit: { label: 'Edit my bits…', hint: 'Add, change, duplicate or delete your bits. They are saved for all your designs.' },
  // ── TASK 842 / 852: the My bits window ──
  toolTable: { label: 'My bits', hint: 'Your bits, for all your designs. Pick one in an operation’s Bit row; the operation keeps its own copy of it.' },
  ttAdd: { label: 'Add bit', hint: 'A new bit: pick its type, then its sizes and its name.' },
  ttName: { label: 'Name', hint: 'What the operations and the tool changes call it, e.g. “1/8 upcut”.' },
  ttType: { label: 'Type', hint: 'The shape of its tip. Each type has only the sizes it needs.' },
  ttUnit: { label: 'Unit', hint: 'The unit its sizes are typed and shown in, whatever the document uses. Fractions such as 1/8 or 1 1/2 work too.' },
  ttDiameter: { label: 'Diameter', hint: 'The cutting diameter. It is written to the file as the bit diameter.' },
  ttAngle: { label: 'Angle', hint: 'The V-bit’s included angle: the whole V, tip to both sides.' },
  ttTipWidth: { label: 'Tip width', hint: 'The flat at the V\u2019s point (engraving bits have a tiny flat tip). Used to plan pocket clearing if you cut a pocket with it.' },
  ttTipDiameter: { label: 'Tip diameter', hint: 'The diameter of the tip (twice the ball’s radius on a ball tip). It is written to the file as the bit diameter: the tip is what cuts on the line at the bottom of a cut.' },
  ttTaperAngle: { label: 'Taper angle (per side)', hint: 'How much each side of the cone leans from the bit’s axis.' },
  ttCornerRadius: { label: 'Corner radius', hint: 'How round the bit’s lower corners are, up to half the diameter (half the diameter is a ball nose). The flat floor is the diameter minus two corner radii.' },
  ttPickType: { label: 'Pick the bit’s type', hint: 'Each type is a template for a kind of bit: pick the one that matches yours, then fill in its sizes.' },
  ttShankDiameter: { label: 'Shank diameter', hint: 'Where the cone stops widening: the bit is never wider than its shank.' },
  ttCutLength: { label: 'Cutting length', hint: 'How deep the flutes reach. An operation deeper than this shows a note. Leave it empty if you do not know it.' },
  ttNotes: { label: 'Notes', hint: 'Anything you want to remember about this bit.' },
  ttCancel: { label: 'Cancel', hint: 'Back to the list without saving.' },
  ttSave: { label: 'Save', hint: 'Saves the bit to My bits.' },
  toolDia: { label: 'Bit diameter', hint: 'The bit you plan to use. It is written to the file, and the previews and programmed paths are drawn for it.' },
  cutterShape: { label: 'Cutter shape', hint: 'For the 3D preview and the operations list only: the Origin is not told the shape, so load the matching bit.' },
  vbitPocketNote: { label: 'V-bit pocket', hint: ({ passes, tip } = {}) => (passes != null && tip ? `V-bit pocket: ${passes} ${passes === 1 ? 'pass' : 'passes'} per depth with a ${tip} tip` : 'V-bit pocket: clearing passes per depth planned with the tip width.') },
  pocketScallopNote: { label: 'Pocket floor', hint: ({ flat, scallop } = {}) => (flat != null && scallop != null ? `Flat width ${flat} per pass; scallop ${scallop} between passes` : 'Flat width each pass leaves and scallop height between passes at the current stepover.') },
  // ── the Export step's side cards ──
  // TASK 880: + what the board is (stock-card.js boardOf), the note that was laid out under the field
  stockThickness: { label: 'Thickness', hint: ({ board } = {}) => `The thickness of your board, for the 3D preview only. It is not written to the file. ${STOCK_BOARD_NOTES[board] || STOCK_BOARD_NOTES.bounds}` },
  material: { label: 'Material', hint: 'The look of the board in the 3D preview only.' },
  generateSvg: { label: 'Generate Shaper SVG', hint: 'Saves the Shaper SVG of your cuts to this computer, to put on the Origin by USB stick or ShaperHub.' },
  syncShaperHub: { label: 'Sync to ShaperHub', hint: 'Sends the file to your ShaperHub My Files with your Shaper login, so the Origin gets it over Wi-Fi.' },
  openShaperHub: { label: 'Open ShaperHub (My Files)', hint: 'Opens your ShaperHub files in a new browser tab.' },
  download: { label: 'Download', hint: 'Saves the Shaper SVG of your cuts to this computer (the same file as Generate Shaper SVG).' }, // the drawer's entry (a sidebar action: its tooltip)
  // ── TASK 772: Prepare Operations, Direction legend, Export toolbar/Cuts, and Sync to ShaperHub ──
  operations: { label: 'Operations', hint: 'Cut order sent to the Origin: drag a grip (or hold a row on touch) to reorder, tap to select, or tap the bin to clear.' },
  dirLegend: { label: 'direction: conventional (Shaper Origin)', hint: 'The moving dashes show the conventional cutting direction along closed shapes so the Origin keeps a clean wall finish.' },
  reviewCuts: { label: 'Cuts', hint: 'Assigned operations in job order: click one to highlight it and focus its cut depth details.' },
  reviewThreeD: { label: '3D', hint: 'Show the finished workpiece relief in interactive 3D.' },
  reviewTwoD: { label: '2D', hint: 'Inspect the flat exported Shaper SVG paths and colour coding.' },
  reviewPaths: { label: 'Paths', hint: 'Show every path written to the exported SVG as a stroke with each cut’s dashed bit-centre path and cutting direction marks.' },
  reviewReset: { label: 'Reset', hint: 'Return the 3D camera to the default angled overview.' },
  reviewTop: { label: 'Top', hint: 'Look straight down from above at the workpiece and paths.' },
  reviewFit: { label: 'Fit', hint: 'Frame the entire board and all cuts inside the view.' },
  // ── TASK 801 (owner turns 2555, 2608, 2667-2668): the Export step's Simulate panel (export-sim.js, over the view), VCarve's Preview toolpaths panel ──
  simulate: { label: 'Simulate', hint: 'Plays the cuts in order on a virtual board, in the view shown (3D, 2D or Paths). The board keeps what each preview cut until Reset preview.' },
  simOperation: { label: 'Operation', hint: 'The operation Preview selected cuts.' },
  simPreviewSelected: { label: 'Preview selected', hint: 'Cuts the chosen operation into the board as it is now (after the earlier previews).' },
  simPreviewAll: { label: 'Preview all', hint: 'Cuts every ticked operation into the board, in the Operations list order.' },
  simReset: { label: 'Reset preview', hint: 'Back to the uncut board. After a reorder of the Operations list, Reset then Preview all shows the new order.' },
  simPlay: { label: 'Play / Pause', hint: 'Plays or pauses the preview.' },
  simPrev: { label: 'Previous operation', hint: 'Goes back to the start of this operation, or of the one before.' },
  simNext: { label: 'Next operation', hint: 'Goes to the start of the next operation.' },
  simSpeed: { label: 'Speed', hint: 'How fast the preview plays. At 1× every ticked operation together takes about 40 seconds.' },
  simAnimate: { label: 'Animate', hint: 'Off: a preview shows its result at once, without playing.' },
  simMore: { label: 'More', hint: 'The operation Preview selected cuts, Animate, Show passes and what the preview shows. Folded on a phone so the drawing stays in sight.' }, // TASK 801c
  simPasses: { label: 'Show passes', hint: 'Shows each path the bit has cut as a see-through volume in its operation’s colour, from the board’s top to the path’s depth: where passes overlap, the colour is darker.' },
  syncFolder: { label: 'Destination Folder', hint: 'Sign in once to browse My Files folders, pick where the file uploads, or add a subfolder. Session stays in tab memory only.' },
  syncNewFolder: { label: 'New folder', hint: 'Create a subfolder inside the ShaperHub folder currently open.' },
  syncFilename: { label: 'File Name (on Origin)', hint: 'Name shown on your Origin screen: defaults to your design name and ends with .svg.' },
  // TASK 884: the Sync dialog's switch; its hint is the line under it (what it does now: the file and folder it replaces, or what it needs)
  // TASK 886 (owner turns 3647-3648): the switch's label is "Autosend" (was "Keep ShaperHub up to date")
  keepHubUpToDate: { label: 'Autosend', hint: ({ signedIn = true, name = '', place = '' } = {}) => (!signedIn ? 'Needs a sign-in for this session.'
    : name ? `Each Generate replaces ${name} in ${place} on ShaperHub.` : 'Each Generate replaces the file last sent with the operations ticked now: send it once first.') },
  rememberLogin: { label: 'Remember login on this computer', hint: 'Saved as plain text in this app’s storage on this computer. Untick to delete it.' }, // TASK 886: the sign-in's checkbox; its hint is the line under it
  keepHubSignIn: { label: 'ShaperHub not updated', hint: 'ShaperHub not updated: sign in with Sync to ShaperHub to keep it up to date.' }, // TASK 884: a Generate with the switch on and no sign-in this session
  // ── TASK 790: Open STL (the drawer) and the STL card (Prepare) ──
  insertStlTool: { label: 'STL', hint: 'Insert STL: adds a 3D part (an STL file) as one more relief, its own Roughing, placed clear of the other shapes. Nothing else changes.' }, // TASK 841: the Prepare toolbar's INSERT section
  openStl: { label: 'Open STL…', hint: 'Opens a 3D part (an STL file) as a relief to carve from the top: one part, roughed level by level, and the board thickness. It replaces the design.' }, // TASK 807
  insertStl: { label: 'Insert STL…', hint: 'Adds a 3D part (an STL file) to the design as one more relief: its own Roughing, level by level, placed in the view clear of the other shapes. Nothing else changes, the board thickness included.' }, // TASK 841
  stlCard: { label: 'STL', hint: 'The 3D part this relief was sliced from (the selected relief). Changing Up or Units slices it again and replaces that part where it is; Undo brings the previous one back.' }, // TASK 841: one per relief
  stlUp: { label: 'Up', hint: 'Which side of the part faces up, toward the bit. Only what can be reached from that side is cut.' },
  stlOrient: { label: 'Orient…', hint: 'Shows the part in 3D: click the face that sits on the bed (any face, any angle) and the part turns to rest on it. Done slices it again; Cancel leaves it as it was.' }, // TASK 808
  stlUnits: { label: 'Units', hint: 'What one unit in the STL file is: STL files do not say.' },
  stlSize: { label: 'Size', hint: 'The part as sliced: width × length × height. An opened STL’s height is the board thickness too; an inserted one leaves the board as it is.' }, // TASK 841
  fusionSwitchDesign: { label: 'Switch design', hint: ({ doc } = {}) => `Switch back to ${doc || 'that design'} in Fusion to edit this operation.` },
};

/** The hints of the choices, by parameter then choice id (their labels are their own declarations': CHOICE_SOURCES). */
const CHOICE_HINTS = {
  cutType: {
    online: 'The centre of the bit follows the line. For grooves and engraving, on open lines too.',
    guide: 'Not cut. Shown on the Origin as a reference.',
    interior: 'Cuts just inside a closed shape, for holes and openings. The Origin keeps the bit inside the line.',
    pocket: 'Clears the whole inside of a closed shape down to the depth.',
    roughing: 'Clears the part level by level, leaving an allowance on the walls for a Contour.', // TASK 792: replaced the stepped types
    exterior: 'Cuts just outside a closed shape, for parts you keep. The Origin keeps the bit outside the line.',
    stock: 'The outline of your board. Not cut: it sets the board in the 3D preview and goes in the file as a guide. There is one Stock per document: a new one replaces it.', // TASK 878: was the Stock moved notice
    contour: 'Finishes the sloped walls: a pass along them at every fine step, no clearing.', // TASK 792
  },
  boundary: { // TASK 810
    silhouette: 'The outline of the part seen from above.',
    box: 'The rectangle round the part seen from above.',
    stock: 'The outline of the Stock (your board).',
    shape: 'A closed shape you pick in Prepare.',
  },
  boundaryTool: { // TASK 810
    inside: 'The bit stays inside the boundary: its edge reaches the line.',
    on: 'The centre of the bit reaches the line: half the bit goes past it.',
    outside: 'The bit may go out past the boundary until its edge just touches the line from outside.',
  },
  walls: { // TASK 810
    all: 'A pass at every level, the straight walls too.',
    sloped: 'Skips the pass along the shape’s own outline: the sloped walls only.',
  },
  wallSide: { // TASK S2
    inside: 'The walls inside the shape: a hollow, a pocket.',
    outside: 'The walls outside the shape: the outline of a part.',
  },
  splitFiles: { // TASK 888
    off: 'One file: this operation is written with the others.',
    depth: 'A new file every so deep: each file holds the levels of one band of depth.',
    levels: 'A new file every so many levels.',
  },
  roughLayout: { // TASK 792 (owner turn 2604)
    terraces: 'Each spot cut once, to its own depth: no passes through air. Best on deep or gentle reliefs.',
    nested: 'One pocket per level over everything that goes at least that deep: fewer, bigger paths. Best on steep or blocky parts.',
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
    taperball: 'A small rounded tip on a cone: fine 3D detail with a strong shank. Comes from My bits.', // TASK 842
    taperflat: 'A small flat tip on a cone: fine detail with a strong shank. Comes from My bits.',
    bowl: 'Flat bottom with rounded corners (a corner radius): a flat floor and a softly rounded edge. Comes from My bits.', // TASK 852
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
  roughLayout: ROUGH_LAYOUT.layouts.map((l) => ({ id: l.id, label: l.label })), // TASK 792: Roughing's layout
  splitFiles: SPLIT_FILES.modes.map((m) => ({ id: m.id, label: m.label })), // TASK 888: Split into files
  boundary: ROUGH_BOUNDARY.kinds.map((k) => ({ id: k.id, label: k.label })), // TASK 810: Roughing's boundary
  boundaryTool: ROUGH_BOUNDARY.tools.map((t) => ({ id: t.id, label: t.label })), // TASK 810: its tool rule
  walls: CONTOUR_WALLS.choices.map((w) => ({ id: w.id, label: w.label })), // TASK 810: a Contour's which walls
  wallSide: CONTOUR_WALL_SIDES.map((w) => ({ id: w.id, label: w.label })), // TASK S2: a Contour's own wall side
};

/** The id of a choice's entry: `<parameter>:<choice id>`. */
export const choiceId = (param, id) => `${param}:${id}`;

// TASK 880: what the 3D board is (stock-card.js boardOf), said in the Thickness label's tooltip
const STOCK_BOARD_NOTES = {
  bounds: 'No Stock loop: the board is the design bounds + margin.',
  'loop-set': 'The board is your Stock loop; set its thickness in Prepare.',
  'loop-unset': 'The board is your Stock loop; no thickness set on it, so the default applies. Set it in Prepare.',
};
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

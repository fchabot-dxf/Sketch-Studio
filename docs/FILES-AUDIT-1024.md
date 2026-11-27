# FILES AND DOCUMENTS AUDIT (task 1024)

AUDIT ONLY: no product code changed. Everything below was read from a live headless browser (Edge, 1280x800; phone 390x844 for the dialogs) driving SketchStudio through its real UI: the sidebar menu, the Save as / Open dialog, the file chooser (answered over CDP), the document-tab strip, the template picker, the Import entry, the Download entries. Probes print `ROW <id> | ...` lines; their full output is in `.evidence/1024/out-*.txt` (local, not committed).

SAFETY kept: the FAKE Google session only (`tests/helpers/fake-drive-session.js`), every non-local request blocked and counted (`tests/helpers/block-remote.js`; only `cdn.tailwindcss.com`, `fonts.googleapis.com`, and the fake session's `example.invalid` avatar were ever attempted). No credential file read, `scripts/test-shaper-live.js` not run, no `*.pages.dev` page opened, Fusion not run, `D:/APPS/shaper-addin` read only. The browser has no File System Access API (as Firefox, Safari, phones): a save is a download, Open is an `<input type=file>`. The File System Access path (handles, write-back, overwrite warnings by the OS picker) is NOT covered here (`tests/save-as-drive-759-live.test.js` covers the picker).

Probes (outside the gate): `tests/audits/files-audit-1024-kit.js` (driver), `-fixture.js` (builds the rich design with the app's own tool operations), `-roundtrip.mjs`, `-tabs.mjs`, `-dialog.mjs`, `-import.mjs`, `-templates.mjs`, `-export.mjs`. Fixtures written for this audit: `tests/fixtures/files-1024/` (`rich.sketch.json`, 11 SVG/DXF files, 7 broken project files).

Prior-finding check: `docs/BUG-ARCHIVE.md` and `docs/*AUDIT*.md` were grepped for each family below (export, circle, construction, DXF, reload/tab, NaN, focus trap, non-uniform). No FIXED bug is seen again, so there is **no REGRESSION**. One related open item: `DESIGN-RUN-AUDIT-1016.md` R1-07 (a constraint left dangling in memory is dropped by a reload); F-105 below is the same load path (a dangling reference in a FILE), cited, not re-filed.

## Summary table

Verdict counts (each row id counted once; F-83 is a note under F-81, not counted): **BUG 10, DIVERGENCE 5, FRICTION 15, OK 90** (the 90 include the 24 template rows F-70.1..24 and the 4 phone-dialog rows F-112/F-113). Total 120.

| Verdict | Rows |
|---|---|
| **BUG (10)** | F-03 (clean opened file tab lost on reload), F-32 (same, across apps), F-47a (NaN coordinate becomes 0), F-47b (radius <= 0 circle imported as radius 0), F-58 (non-uniform scaled circle imported as the wrong circle), F-81 (SVG export drops every circle), F-81b (SVG/DXF export writes the construction line as real geometry), F-84 (DXF out then in is mirrored top to bottom), F-94 (Tab leaves the modal dialog), F-105 (shape naming a missing joint vanishes, no word) |
| **DIVERGENCE (5)** | F-08 (inch unit not in the file), F-40b (SVG curves flattened, DXF curves kept), F-82 (SVG bezier out then in = 16 lines), F-85 (exports carry no unit: SVG has no width/height, DXF has no $INSUNITS; the document unit is ignored), F-83b (DXF construction/linetype lost) |
| **FRICTION (15)** | F-02c, F-02f, F-04e, F-05, F-30d, F-47c, F-48, F-50, F-96.3, F-96.5, F-96.6, F-96.9, F-97, F-98, F-106 |
| **OK (90)** | everything else in the tables |

Severities of the BUG rows: lost work: none (no design data is destroyed: F-03/F-32 lose the TAB, the file on disk is intact); **wrong geometry**: F-47a, F-47b, F-58, F-81, F-81b, F-84; **misleading UI**: F-03, F-32, F-94, F-105.

## 1. Save / Open / Save As / New / Close (`files-audit-1024-roundtrip.mjs`)

The design (`tests/fixtures/files-1024/rich.sketch.json`) is built in node with the app's tool operations: 16 lines (one construction), 9 circles, 2 arcs, 1 bezier, constraints horizontal, vertical, coincident, distance (driving, a formula `plate_w`, `plate_h = plate_w / 2`, a radius, a reference/driven one), equal, parallel, perpendicular, collinear, pointOnLine, midpoint, angle, tangent (fillet), symmetric (mirror), offset, rectangularPattern, circularPattern; 2 user parameters; a group with a size/angle lock; a fixed joint; a second hidden sketch "Layer two". It is opened through Open > Local > Choose a file, then saved with Save as > Local, and the two files are diffed field by field.

| Row | Did | Expected | Happened (read from state) | Verdict / severity |
|---|---|---|---|---|
| F-01 | build the fixture | every constraint type present | all 16 kinds built, 0 refused by the tools | OK |
| F-02 | Open > Local > Choose a file `rich.sketch.json` | file opens as a new tab, drawing complete | tab `rich`, home `file`, 28 shapes on canvas (file has 28), no toast, no dirty dot (F-02b) | OK |
| F-02c | read the tab name | the design's name (file `name` "Rich 1024") (unverified) | tab shows `rich`, the FILE NAME; the envelope's `name` is ignored on open (`designNameOfFile`) | FRICTION (misleading UI, low) |
| F-02f | look at the view after Open | the drawing framed (`.evidence/1024/F02-after-open.png`, md5 b11c6e0de3583244492532baa3352366) | the drawing (about 450 mm across) sits small in a viewport about 4000 mm wide | FRICTION (low; cause not investigated: the fixture has pattern copies and a hidden sketch) |
| F-04 | Save as > Local "RT one" (download), diff against the original | geometry unchanged | `geometry.joints` / `shapes` / constraint counts 0 diffs (28 shapes, 16 constraint kinds, same counts, params, groups, sketches, locks); only the constraints differ (see F-04e). Saved file `.evidence/1024/F04-saved-RT-one.sketch.json` | OK |
| F-04e | the 52 diffs of F-04 | state only | every diff is a RENDER CACHE written into the file: `geometry.constraints[n].glyphPos` (20) and `__visible` (18) added, `__placing` / `__newlyPlaced` (4 each) dropped. The file holds screen state | FRICTION (misleading UI, low; `docChangeSig` knows these fields are not content, BUG-015) |
| F-05 | open our own saved file, Save as again, compare bytes | open then save gives the same bytes (`project-file.js` header) | same values, but `name` and `glyphPos` change order in 4 constraints (first difference at character 10481 of 15028) | FRICTION (byte stability claim does not hold) |
| F-06 | draw one more line, Ctrl+S on a file-home tab | writes back, dot clears, no dialog | download `RT two.sketch.json` holds 29 shapes (= canvas), no dialog, dot cleared | OK |
| F-07 | reload with 2 file tabs (saved earlier) | both tabs back | both back with home `file`, no dots, buffer doc matches | OK |
| F-08 | device unit set to inches, Save as, set back to mm | the unit travels with the document (Fusion keeps units in the document) (unverified) | the file has no unit field (`hosts` is `{}`: SketchStudio has no sidecar); dimension labels read `3.15` in, then `80` mm on the same file: the unit is a per-device setting | DIVERGENCE (misleading UI) |
| F-03 | open a file, edit nothing, reload the page (`out-roundtrip.txt` last rows) | the tab is still there | tab list after reload is one empty `Untitled`, 0 shapes (file had 28); the shared buffer was null after the pagehide flush. A saved-to-file tab (F-07) does survive | **BUG** (misleading UI: the design silently vanishes from the app; the file on disk is intact) |

## 2. Document tabs (`files-audit-1024-tabs.mjs`)

| Row | Did | Expected | Happened | Verdict |
|---|---|---|---|---|
| F-20 | fresh start | one Untitled tab | `[["Untitled","A"]]` | OK |
| F-21 | close the only untouched tab | closes (no question) | no question; a fresh Untitled replaces it (key changed) | OK |
| F-22 | draw 2 lines, "+" > Blank design | new empty tab, own history | tab 2 active, 0 shapes, undo disabled | OK |
| F-23 / F-24 | switch tabs; Ctrl+Z in A; switch; Ctrl+Z in B; switch; Ctrl+Shift+Z | each tab keeps its own history | A 2 -> 1 shapes, B 1 -> 0, back in A undo/redo both enabled, redo gives 2 | OK |
| F-25 | close a tab with 2 unsaved lines | the one question | modal "This design is not saved." Save… / Don't save / Cancel (`.evidence/1024/F25-close-unsaved.png` md5 cd18ae0a9a1a808733cc09d093687547); Cancel keeps the tab; Esc = Cancel (F-25c) | OK |
| F-26 | Save… then name | tab saved and closed | Save as dialog on Local, name entered, download made, tab closed | OK |
| F-27 | "Don't save" | tab closes, work discarded | question asked, tab closed | OK |
| F-28 | open "+" tabs until the limit | limit said | 10 tabs; strip note "Close a tab first: at most 10 designs are open at once." (`.evidence/1024/F28-many-tabs.png`) | OK |
| F-29 | keyboard on the strip | arrows, Enter, Delete | ArrowLeft + Enter activates, Delete closes an untouched tab | OK |
| F-30 | SketchStudio file tab with edits, then Shaper | the same tab and drawing | Shaper shows `Shared doc`, 2 shapes; a third line drawn in Shaper shows in SketchStudio (3) | OK |
| F-30d | undo after switching app | history survives (a Fusion document keeps undo) (unverified) | undo disabled in the other app (history stays with the page; documented in `document-buffer-core.js`) | FRICTION (low) |
| F-31 | reload with 3 tabs (file, Untitled with a line, empty) | all back | all 3 tabs back, the Untitled keeps its line | OK |
| F-32 | open a file, edit nothing, go to Shaper | the tab follows | Shaper shows only an empty `Untitled`, 0 shapes (same cause as F-03) | **BUG** (misleading UI) |

## 3. Import (`files-audit-1024-import.mjs`, fixtures `tests/fixtures/files-1024/*.svg|*.dxf`)

Positions are read from the canvas elements in mm (world units; Y down, like SVG).

| Row | File | Expected | Happened | Verdict |
|---|---|---|---|---|
| F-40 | `shapes-mm.svg` (100mm, viewBox 100) | scale 1, line (0,0)-(30,0), rect, circle (60,30) r8, arc r10, text skipped and said | exact: `L(0,0->30,0)`, rect lines, `C(60,30 r8)`, `P[M 10 50 A 10 10 0 0 1 30 50]` (a real arc), toast "Imported 92 shapes → shapes-mm @ 1 mm/unit · 1 skipped/degraded: <text> not imported ×1" | OK |
| F-40b | same file: the cubic and the ellipse | a curve stays a curve (the DXF spline of F-51 does) | the cubic became 16 lines, the ellipse 32 lines (`svg-import.js` header says "flatten") | DIVERGENCE (wrong geometry: a curve edited as a polyline) |
| F-41 | `nested-transform.svg` translate+scale+rotate(90), flip matrix | line (10,20)-(10,40), circle (20,30) r6, line (50,90)-(80,90) | exactly those | OK |
| F-42 | `units-in.svg` 2in, viewBox 200 | 0.254 mm/unit, circle (25.4,12.7) r2.54, line to 50.8 | exact, toast "@ 0.254 mm/unit" | OK |
| F-43 | `units-px.svg` no viewBox | 96 dpi, r6.35, line 25.4 | exact, "(96 dpi) (assumed)" said | OK |
| F-44 | `units-viewbox-only.svg` | 1 mm/unit assumed | circle r5, line 40, "(assumed)" said | OK |
| F-45 | `units-percent.svg` width 100% | px assumed | line 25.4, "(assumed)" said | OK |
| F-46 | `many-groups.svg` nested `<g>` | 2 squares | 8 lines imported (grouping is covered by import-groups-751) | OK |
| F-47a | `huge-coords.svg` `x1="NaN"` | refused or skipped and said | imported as a line (0,0)->(5,5): the bad number became 0, nothing said | **BUG** (wrong geometry) |
| F-47b | circle `r="-5"` and `r="0"` | refused or skipped and said | two circles of radius 0 imported, nothing said | **BUG** (wrong geometry) |
| F-47c | a line to (1e9,1e9) | said or kept in bounds | imported, bbox 1e9, nothing said | FRICTION |
| F-48 | `malformed.svg` | plain refusal | toast "Import failed: This page contains the following errors:error on line 1 at column 97: Unexpected closing tag: {http://www.w3.org/2000/svg}svg != {...}g Below is a rendering of the page up to the" (the browser's parser text, cut mid-sentence); nothing imported | FRICTION (misleading UI) |
| F-49 | `not-svg.svg` | plain refusal | "Import failed: Root element is not <svg>" | OK |
| F-50 | `no-geometry.svg` (text only) | refusal saying what was skipped | "Nothing imported · 1 skipped" (not which) | FRICTION |
| F-51 | `shapes-mm.dxf` ($INSUNITS 4) | Y flipped (world y = -y), dashed = construction, arc, lwpolyline, spline, TEXT skipped | line (0,0)-(40,0); dashed line `(0,-5)-(40,-5)c`; circle (60,-20) r8; arc `M 30 -40 A 10 10 0 0 0 20 -50`; polyline lines; spline as ONE bezier `M 0 -70 C 10 -90 30 -90 40 -70`; "1 construction · 1 skipped/degraded: TEXT text not imported ×1" (`.evidence/1024/F51-dxf-shapes.png`) | OK |
| F-52 | `units-inch.dxf` ($INSUNITS 1) | 2 in = 50.8 mm | line 50.8, circle r12.7, "@ inches" | OK |
| F-53 | `units-none.dxf` | assumed mm, said | "@ mm (assumed)" | OK |
| F-54 | `malformed.dxf` | plain refusal | "Import failed: Not a DXF file (no SECTION / EOF markers — truncated?)" | OK |
| F-55 | `garbage-numbers.dxf` | refusal | `Import failed: Bad number "abc" for group 10 at line 8` | OK |
| F-56 | import into a design with a line, Ctrl+Z, redo | one undo step | 1 -> 93 -> 1 -> 93 | OK |
| F-57 | drop a .svg on the drawing | imports | +1 shape, toast | OK |
| F-58 | `nonuniform.svg` `scale(2,1)` on a circle r5 and an arc | an ellipse 10 x 5, or refused and said | imported as ONE circle at (20,10) of radius 7.071 (r5 x sqrt(2)), no notice; the arc is flattened and said ("non-circular or skewed arc flattened to lines ×1"); relative path `m l h v z` came in right | **BUG** (wrong geometry, silent) |

## 4. Templates (`files-audit-1024-templates.mjs`)

Each of the 24 templates: "+" > its card > Open, default values, one fresh page each. Read: new tab, joint DOF from `window.ug.debug.dof`, blue (unconstrained) shapes, dimension labels, Ctrl+Z and redo right after opening. `.evidence/1024/F70-slot.png`, `F70-spur-gear.png`, `F70-box-frame.png`.

| Rows | Result | Verdict |
|---|---|---|
| F-70.1 .. F-70.24 slot, rounded-rectangle, keyhole, hexagon, star, arrow, l-bracket, bolt-circle, spur-gear (221 shapes), finger-edge, dog-bone-pocket, t-slot, butterfly-key, cup-hinge-bore, shelf-pin-row, box-frame, right-angle-corner, stair-stringer, curved-bench-seat, right-angle-brace, polygon-frame, trapezoid-frame, parallelogram-frame, triangle-frame | each opens as a new active tab named after the template, picker closed, no error; `freeJoints=0 totalDOF=0 blueShapes=0` (fully constrained) | OK x24 |
| F-71 | 24 of 24 fully constrained | OK |
| F-72 | L-bracket stored: 4 user parameters (`width`, `height`, `thickness`, `hole_diameter`), 9 driving dimensions, all 9 formulas reading them | OK (editable through the parameters) |
| F-73 | Save as Local with the default name | file `L-bracket.sketch.json`, tab `L-bracket` home `file` | OK |
| F-74 | Ctrl+Z right after a template opens | its first state cannot be undone (tab stays, shapes unchanged, undo disabled in all 24); the new tab shows the unsaved dot | OK |

## 5. Export (`files-audit-1024-export.mjs`)

SketchStudio's sidebar "Download SVG" / "Download DXF" (`apps/sketchstudio/ui/export-manager.js`), on the rich design (28 shapes: 16 lines (1 construction), 9 circles, 3 curves). Exported files are kept in `.evidence/1024/exports/`.

| Row | Did | Expected | Happened | Verdict |
|---|---|---|---|---|
| F-80 | open the design | 28 shapes | `{"line":16,"circle":9,"path":3}`, 1 construction | OK |
| F-81 | Download SVG `sketch.svg` | every drawn shape | 16 `<line>`, 0 `<circle>`, 3 `<path>`: **the 9 circles are missing**. Cause: `buildSVG` and `buildDXF` filter `s.type === 'line' | 'arc' | 'bezier'` only (`export-manager.js` lines 46 and 211) | **BUG** (wrong geometry, silent) |
| F-81b | the construction line `(0,60)-(80,60)` | construction geometry not exported, or marked | written as a solid black `<line y1="60" ...>` (no dash, no note); in the DXF too (no linetype). Re-import shows it as a plain line (construction 0, was 1) | **BUG** (wrong geometry) |
| F-81a | what else the SVG holds | | no ids, no groups beyond one `<g>`, no parameters; stroke-width 1.000000 fixed | OK |
| F-82 | import our own SVG back | same drawing | `{"line":32,"path":2}`: the bezier came back as 16 lines (flattened, F-40b); no circles (F-81); bbox differs `[-30,0,200,200]` vs `[-202,-202,202,202]`; toast "Imported 34 shapes → own @ 1 mm/unit (assumed)" (`.evidence/1024/F82-svg-reimport.png`) | DIVERGENCE (bezier degraded; the missing circles are F-81) |
| F-83 | Download DXF `sketch.dxf` | all shapes | 16 LINE, 2 ARC, 1 SPLINE (the bezier is kept as a spline: good), 0 CIRCLE (the same cause as F-81; not counted again) | note |
| F-83b | DXF header and linetype | `$INSUNITS` set, construction dashed (our own DXF import reads both) | no `$INSUNITS`, no DASHED linetype | DIVERGENCE |
| F-84 | import our own DXF back | the same drawing | first lines `(80,4)-(80,40)` come back `(80,-4)-(80,-40)`: **mirrored top to bottom**. The import flips Y (DXF is Y up) but the Download DXF entry writes world Y unchanged (`invertY:false` in `apps/sketchstudio/main.js` sidebarExport) (`.evidence/1024/F84-dxf-reimport.png` md5 6e3dd99228ec4d59031ac85a63f76410) | **BUG** (wrong geometry) |
| F-85 | export with the device unit set to inches | the file reflects the unit, or states mm | SVG byte-identical to the mm one; the root is `<svg viewBox="-41.5 -11.5 253 223">`, no `width`/`height`: another app reads user units as px (96 dpi), 3.78 times too small (unverified in a CAD) | DIVERGENCE (wrong size elsewhere) |
| F-86 | "Export…" entry | export view | form shown with file name, type, precision, scale, invert Y, DXF version | OK |
| F-87 | the Fusion side, read only (`apps/shaper/src/fusion-import.js`, `shaper-addin/selection_extract.py`) | | the add-in sends `selection_data` in mm: segments `line` / `arc` / `circle` (splines sampled to line segments in the add-in); `importFusionSelection` reads that and flips Y. The add-in never reads SketchStudio's SVG/DXF export; nothing here checks that direction live (the advisor checks Fusion) | OK (information) |

Note (environment): the app styles `#export-panel` hidden with the Tailwind `hidden` class from `cdn.tailwindcss.com`; with that host blocked (as required here) the unstyled Export form shows under the drawing in every screenshot (`F02`, `F84`). Not counted as a bug: not verified with the CDN reachable.

## 6. File dialog (`files-audit-1024-dialog.mjs`)

| Row | Did | Expected | Happened | Verdict |
|---|---|---|---|---|
| F-90 | Save as | name focused and selected, two tabs, Save / Cancel | tab `local` (signed out), name `Untitled`, focus in the name field (`.evidence/1024/F90-save-as.png`) | OK |
| F-91 / F-92 / F-93 | Esc, a press outside, Cancel | closes, nothing saved | all three close it, 0 downloads | OK |
| F-94 | Tab x9 from the name field | focus stays in an `aria-modal` dialog | name -> Save -> Cancel -> the page BEHIND the dialog (sidebar button, header tabs, document tabs, "+", ribbon): the keyboard reaches the covered page | **BUG** (misleading UI, friction) |
| F-94b | Esc with the focus outside | closes | closes | OK |
| F-95 | ArrowLeft / ArrowRight on the tab buttons | switch tab and remember it | Drive tab selected, setting `FILE_DIALOG_TAB=drive` | OK |
| F-96.1, .2 | empty name, spaces only | refused plainly | "A design needs a name.", dialog stays | OK |
| F-96.3 | 200 characters | accepted or limited | accepted: file name of 212 characters, tab name 200 characters (the tab shows `L…`, status line shows the whole name, `.evidence/1024/F96-long-name-tab.png`) | FRICTION (low; an OS path limit would refuse a longer one) |
| F-96.4 | `a/b\c:d*e?f"g<h>i|j` | safe file name | file `a_b_c_d_e_f_g_h_i_j.sketch.json`, tab named the same | OK |
| F-96.5 | `...` | refused or named | file `sketch.json` (the browser dropped the dots), tab `...` | FRICTION (file name and tab name differ) |
| F-96.6 | ` .hidden name ` | | file `hidden name.sketch.json`, tab `.hidden name` | FRICTION (the name changes when the file is opened again) |
| F-96.7 / .8 | `Sketch ☃ café 😀`, `CON` | | kept; `_CON.sketch.json` for the reserved name | OK |
| F-96.9 | `plate.sketch.json` | extension not doubled | file `plate.sketch.json.sketch.json` | FRICTION |
| F-97 | two different designs saved as "Same name" (Local) | an overwrite warning (ordinary desktop apps) (unverified) | no warning; 2 downloads of one name, 2 tabs `Same name` (with no File System Access API the app cannot know) | FRICTION |
| F-98 | Open the same file twice | focus the open one (unverified) | two independent tabs `rich` of one file | FRICTION |
| F-99 .. F-104 | Open: not JSON, other JSON, newer envelope, newer document, no version, empty file | plain refusal, dialog stays, nothing opened | each in the dialog's error line: "This is not a Sketch Studio project file (it is not valid JSON).", "...is not a Sketch Studio project file.", "This file was made by a newer version of Sketch Studio (file format 9; this app understands 1).", "This project was made by a newer version ... Update the app to open it.", "This project file is damaged (missing version field)."; tab count unchanged (screenshots `F-99-dialog.png` ... `F-104-dialog.png`) | OK x6 |
| F-105 | `dangling-refs.sketch.json`: a line on a joint `ghost`, a constraint on it | refused, or opened with a word | opens as a tab, 0 shapes drawn, no toast; the dropped parts are only logged (`deserializeDocument` `dbg.warn`). Related: 1016 R1-07 | **BUG** (misleading UI) |
| F-106 | Open given a `.svg` | says to use Import | "This is not a Sketch Studio project file (it is not valid JSON)." | FRICTION |
| F-107 | signed out, Drive tab | sign-in inside the tab, no dead Save | only "Sign in with Google" + Cancel, no name field | OK |
| F-108 / F-109 | fake session signed in: Save as, "Drive dup" | opens on Drive, saves | Drive tab first, "Saving into Sketch Studio / My Designs", tab `Drive dup` home drive (`F108-drive-save.png`) | OK |
| F-110 | another design saved under the same Drive name | overwrite question, safe default | "'Drive dup' already exists in 'My Designs' (it is open in another tab; that tab will close). Are you sure you want to overwrite it?", focus on Cancel (`F110-overwrite.png` md5 c07c55272aabb82a85a23665968da2c4); Esc closes the dialog (F-110b) | OK |
| F-111 | Open, signed in | lists | folder row and the recent design (`F111-drive-open.png`) | OK |
| F-112 / F-113 | phone 390: Save as (Drive, Local), Open | fits, 44 px targets | left 12, right 378, no sideways scroll, min height 44 px in every state (`F112-phone-save.png`, `F113-phone-open.png`) | OK x4 |
| F-114 | phone 390: a 60-character name | no page overflow | the tab strip scrolls inside itself (1502 vs 374), the page does not (390); tab shows `W…` (`F114-phone-long-name.png`) | OK |

## What is not covered

Fusion live; the File System Access picker path; real Google Drive; Shaper's and Pen Plotter's own export/import files (only the shared tab buffer was crossed into Shaper); Trace; the Drawing stage; paste/clipboard; `Open recent` and the project manager.

## Reproduce

`node tests/audits/files-audit-1024-fixture.js` (rewrites the rich fixture), then each `node tests/audits/files-audit-1024-<name>.mjs` on its own (needs the shared CPU lock slot like any live test; each prints `ROW` lines and the blocked-request count).

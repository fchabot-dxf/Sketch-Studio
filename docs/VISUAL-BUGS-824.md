# Visual-only bugs: audit of task 824

The app does the right thing, but what it shows makes the user think it does not, or makes them act on a wrong reading. This is an audit only: no app or
test code was changed. Code base: origin/main `ac46fa5` (probes), then `27c2987` (task 823 merged, which changes only orbit / review-view files; none of the
causes below are in those files). Each probe is a throwaway script in `.evidence/824/` (local, not committed): `pN-*.mjs` scripts, their screenshots and
their console output. md5 values are from `Get-FileHash -Algorithm MD5`.

Areas other tasks are changing now: S2 (the Prepare screen's operation-first UI: `op-list.js`, `cut-panel.js`, `prepare-view.js`), 804b (Raster loop), 819
(sidebar chevron + footer corner), 820 (constraint highlight, being merged), 821 (arrows removal), 822 (tabs fit + drag). An entry in one of those areas
says which task touches it.

Severity: **M** = misleads into a wrong action, **C** = confuses, **K** = cosmetic.

## Proven bugs, ranked by severity

### V1 (M): the cut card's 3-line note area hides the warnings at the end of a note (class d, advisor sniff 1)
- **App / stage / device:** Shaper, Prepare, desktop 1280 x 800 and phone 390 x 844 (inches).
- **User sees:** "Outside: 5 tabs, 0.394 in wide, 0.118 in thick: 1 pass at 0.354 in + 5 gaps at 0.472" and nothing more. For a programmed pocket: "Pocket:
  spiral, 4 turns in 1 line + wall, stepover 0.1 in, 3.1 ft of path, about 1 min" and nothing more.
- **True:** 8 tabs were asked for and only 5 fit; the warning " (only 5 of 8 tabs fit)" is below the fold. The pocket note's 5th line, the orange warning
  "Leftover: 0.017 in² not reached by a 0.25 in bit (sharp inside corners, ...)", is 123 px below the fold.
- **Repro:** a 40 x 40 mm square, Outside 12 mm, 1/4 in bit, Hold part Tabs, count 8, width 10 mm; an L-shaped pocket (80 x 60, 20 wide arms), Clearing
  Spiral, stepover 40 %. Click each in Prepare and read the note under the card.
- **Measured** (`p1-note.mjs`, `.cut-note` clientHeight / scrollHeight, the warning span's top in the area):
  - desktop, tabs: `"clientH": 46, "scrollH": 108`, warn `" (only 5 of 8 tabs fit)"` at `"warnTop": 46` (it starts exactly where the area ends: 0 px of it
    shown);
  - desktop, pocket: `"clientH": 46, "scrollH": 231`, Leftover warn at `"warnTop": 169`;
  - phone, tabs: `"clientH": 46, "scrollH": 77`, warn at `"warnTop": 31` (cut through the middle of the 3rd line); phone, pocket: Leftover at `"warnTop": 139`.
- **How a user could see the rest:** only by scrolling the 46 px box. The scrollbar is thin (`scrollbar-width: thin`). On touch phones the browser's
  overlay scrollbars normally show only while scrolling, so the user gets no hint that more lines exist (headless Edge draws it; see "unproven" U3).
- **Cause:** `apps/shaper/index.html:606` `.cut-note { height: 4.2em; overflow-y: auto }` (task 813's fixed area), filled in order by `apps/shaper/src/cut-panel.js:817-825`.
  Warnings are added at the END: `apps/shaper/src/cut-plan.js:310` appends " (only n of m tabs fit)" to the end of the long first line, and
  `cut-plan.js:481` pushes "Leftover" as the last line. Task 822's refused-tabs line is the same case, so this is the general form of the owner's 822 complaint.
- **Evidence:** `.evidence/824/p1-note-desk-tabs.png` (5880b73281deafd8011b69aa6e4c0e25), `p1-note-desk-pocket.png` (b9a137338e66a9463ff19dd21cc079e3),
  `p1-note-phone-tabs.png` (351640eadacfbabb13e909a7b8292b50), `p1-note-phone-pocket.png` (171268bf6c4be3acc1257b19f34a866d); raw numbers in `p1-phone.txt`.
- **Fix direction (one place):** the note renderer in `cut-panel.js:817` shows every `warn` item first, in full, above the fixed area that holds the plain
  lines. Area: cut-panel.js is rewritten by S2; task 822 changes the tabs note text but not the area.

### V2 (M): the Export step's "unticked" line names an operation the user cannot tell from a ticked one (class e)
- **App / stage / device:** Shaper, Export, desktop 1280 x 800.
- **User sees:** the Operations list shows "Pocket · 6 mm" (ticked) and "Pocket (spiral) · 6 mm" (unticked). The Export step then says "Exporting 2 of 4
  operations (unticked: Guide, Pocket 6 mm (¼″ end mill))".
- **True:** the unticked operation is the **spiral** pocket. "Pocket 6 mm" is the name of the plain pocket, which IS in the file. With two Guides (V4),
  "Guide" does not say which one is left out either. The counts also differ: the list header says "Operations 5"; the line says "of 4" (the Stock is not
  counted).
- **Repro:** a Stock, two Guides (depth 0, and depth 1.5 + offset 1), a Freehand pocket and a Spiral pocket, both 6 mm with a 1/4 in bit. In Prepare,
  untick the second Guide and the spiral pocket; open Export.
- **Measured** (`p2-ops.mjs`): `TICKLINE Exporting 2 of 4 operations (unticked: Guide, Pocket 6 mm (¼″ end mill)). Place it with the same anchor as the earlier file.`
  The list at the same moment: `"Pocket · 6 mm | 1 region"`, `"Pocket (spiral) · 6 mm | 1 region · spiral, 7 turns in 1 line + wall"`.
- **Cause:** `apps/shaper/src/export-payload.js:85` builds its own name `[op.typeLabel, op.depthText] + tool` and does not use the row's words
  (`op.rowText` / `op.label`, `operations.js describe`). So the clearing pattern, the hold and the lead-in are dropped, and so are a Guide's values.
- **Evidence:** `p2-tickline-desk.png` (9499b9e58880f3ae3eab485b8abe06c0), `p2-ops-unticked-desk.png` (959d8761f24c13e3687b86e77fcbd8a3).
- **Fix direction (one place):** exportTickLine names each operation by its list words (`op.rowText`, plus its number in the list).

### V3 (C): Prepare's depth chips keep the old unit after Settings > Reset (class c)
- **App / stage / device:** Shaper, Prepare, desktop 1280 x 800.
- **User sees:** the chip on the canvas says "↓ 0.25 in"; the card next to it says "6.35 mm" and the Operations row says "Pocket · 6.35 mm".
- **True:** the document unit is now mm. The chip is the only text still in inches (the same depth, in the old unit), until something else redraws it.
- **Repro:** set inches; draw a 100 x 60 rectangle, Pocket 0.25 in deep; click it in Prepare; footer gear > Settings > **Reset** (factory defaults:
  DOC_UNIT back to mm); close the panel.
- **Measured** (`p4-reset.mjs`): `BEFORE {"DOC_UNIT":"in","chips":["↓ 0.25 in"],"cardDepthUnit":"in","cardDepth":"0.25","rows":["Pocket · 0.25 in"]}`, then
  `AFTER {"DOC_UNIT":"mm","chips":["↓ 0.25 in"],"cardDepthUnit":"mm","cardDepth":"6.35","rows":["Pocket · 6.35 mm"]}`.
- **Cause:** `apps/shaper/src/prepare-view.js:823` redraws the look (chips, lead-in labels) only for `key === 'DOC_UNIT' || isPrecisionKey(key)`. A reset
  (and a settings load) sends `key === null` (`packages/core/settings-manager.js:438` reset, `:299` load: `_emitChange(null, ...)`). The card and the list do listen for null
  (`prepare-stage.js:45`, `cut-panel.js:871`), which is why they disagree with the chip.
- **Evidence:** `p4-before.png` (bf16a36c5deb40e386c5109c2c428057), `p4-after.png` (1e2708ccd7b605905047a6bae8d3fb0f): chip "↓ 0.25 in" beside the card's "6.35 mm".
- **Fix direction (one place):** prepare-view.js:823 also reacts to `key === null` (the rule prepare-stage.js:45 already uses). Area: prepare-view.js is
  rewritten by S2.

### V4 (C): two Guide operations show as two identical "Guide · 1 region" rows; their values are hidden (class a / g, advisor sniff 5)
- **App / stage / device:** Shaper, Prepare (and Export), desktop 1280 x 800.
- **User sees:** in Prepare, rows 2 and 3 are both "Guide / 1 region", with no difference between them. The Export step's 2D list shows them as
  "Guide · 1 region / 0 mm" and "Guide · 1 region / 1.5 mm": it shows the depth, but not the offset (0 vs 1 mm).
- **True:** they are two operations because their written values differ (S1 ruling: a Guide's depth / offset / bit are written per element). The store
  holds `{"cutDepth":0,"cutOffset":0}` and `{"cutDepth":1.5,"cutOffset":1}`.
- **Repro:** two closed rectangles set to Guide, one with depth 0, the other with depth 1.5 and offset 1.
- **Measured** (`p2-ops.mjs`): `"Guide | 1 region | id=op-2"`, `"Guide | 1 region | id=op-3"`; 2D list (`p2c-stock.mjs`): `"rv2d-op: Guide · 1 region | 1"`,
  `"rv2d-row: 0 mm | 1"`, `"rv2d-op: Guide · 1 region | 1"`, `"rv2d-row: 1.5 mm | 1"`.
- **Cause:** `apps/shaper/src/operations.js:181` `const s = type && type.opRank === 0 ? {} : op.settings`: a Guide's words never show the settings that
  make it its own operation (this was right before S1 gave Guides settings; it is the same branch for the Stock).
- **Evidence:** `p2-ops-desk.png` (1b1a0a320467462cc9f0cbf79ce0f52a), `p2c-2dlist.png` (556a486f049b6cb579f66ac40321a3f2).
- **Fix direction (one place):** describe() in operations.js writes a Guide's declared settings (depth, and offset / bit when not 0 / default) as
  it does for cut types. The Stock keeps its plain row. Area: the list is S2's; describe() is not rewritten by S2's brief.

### V5 (C): Pen Plotter has a second document unit: the Document dialog / readout say mm while the shared Units setting is inches (class g)
- **App / stage / device:** Pen Plotter, Design + Prepare, desktop 1280 x 800.
- **User sees:** the Design canvas dimension "3.937" (inches); the Design panel's "Document · 200 × 200 mm"; the Document dialog "UNITS mm, WIDTH MM 200";
  Prepare's readout "200 × 200 mm · 0.89× display".
- **True:** the document unit (Settings > Units, the shared DOC_UNIT that every other app and every dimension follows) is inches. Pen Plotter keeps its
  own paper unit, `penplotter.docUnit` in localStorage, default mm, changed only in its own dialog. A user who sets inches once in Settings still has to
  type the paper size in mm.
- **Repro:** Pen Plotter, footer gear > Settings > Units > inches; draw a 100 mm line with a dimension; open Document (Design panel button).
- **Measured** (`p5-pp-unit.mjs`): `DESIGN-DIM ["3.937"]`, `DOC-DIALOG {"unit":"mm","w":"200","h":"200","labels":["mm","mm"],...}`, `SHARED DOC_UNIT in`,
  `DOCINFO 200 × 200 mm  ·  0.89× display`.
- **Cause:** `apps/penplotter/src/settings.js:20` (`DOC_UNIT_LS = "penplotter.docUnit"`), read at `:121`, written at `:126`, and shown by
  `apps/penplotter/src/viewport.js:56`. This goes against `packages/ui/style-panel.js:290` ("ONE document-unit control for every host"). The declared source is
  DOC_UNIT (`#core docUnit()`), so the shared setting is the one that is right.
- **Evidence:** `p5-docdialog.png` (2a37f403a8c9fbc5a066f3c0108d9ec9), `p5-settings-units.png` (da8fcd1f0db0e0181d23b33c714cf1c4), `p5-toolpath.png` (906802ff8c2bb6d52777a027e3eab349).
- **Fix direction (one place):** Pen Plotter's `inInches()` (settings.js) reads `docUnit()`, and its dialog's Units select writes DOC_UNIT; the
  `penplotter.docUnit` key goes. This is a behaviour change for existing Pen Plotter users whose stored paper unit differs: the owner rules on it.

### V6 (C): on a phone in landscape, the floating footer buttons cover the 3D info chip (Shaper Export) and Pen Plotter's paper readout and "Deselect all" (class f, advisor sniff 6)
- **App / stage / device:** Shaper Export and Pen Plotter Prepare (also Pen Plotter Export), phone landscape 844 x 390.
- **User sees:** Undo / Redo drawn across "built in 46 ms" of the 3D info chip. In Pen Plotter, the gear / Save / Account sit on the "200 × 200 mm · 1.10×
  display" readout, and Undo / Redo sit on the panel's "Deselect all" button.
- **True:** the readout is the opener of the Document dialog (`settings.js wireOpener("docInfo", ...)`), and "Deselect all" is a working button. Both are
  covered.
- **Measured** (`p6-overlap.mjs`, `elementFromPoint` along each element's middle): Shaper `#review-info` (x 10-220): x 178 hits `btn-undo`, x 209 hits
  `btn-redo`. Pen Plotter `#docInfo` (x 256-413): x 264 `btn-settings`, x 287 / 311 `sk-save`, x 335 `sk-account-circle`. Footer buttons
  `[[169,338,204,382],[205,338,240,382],[246,338,281,382],[283,338,318,382],[320,338,355,382]]`.
- **Cause:** `packages/ui/app-footer.js:53-54`: the group is `position: fixed` at the bottom-left of the work area for every stage, with no obstacle rule.
  On a short viewport, the Review's `#review-info` chip and Pen Plotter's `#docInfo` are in the same corner.
- **Evidence:** `p6-shaper-review-land.png` (46853dd8ca755bf8b9cd25ddf3baf4b6), `p6-pp-toolpath-land.png` (0a30644924ba1935fccbb131d2eaead0), full frames
  `p3-land-shaper-review.png` (1cd6a5bf62c1a5289085974e17253fd0), `p3-land-penplotter-toolpath.png` (80bcca9e87031b37edbfc4b26944b806).
- **Fix direction:** **task 819 part 2** moves this group into the lower-left corner on phones, which is exactly where these two elements are. 819
  should make the corner's other occupants move clear (one declared obstacle rule, like the toasts' `data-toast-obstacle`), or it will make this worse.

### V7 (C): hovering a point-to-line, midpoint or diagonal dimension lights the neighbouring lines too, and task 820's rule does not cover it (class a)
- **App / stage / device:** the shared Design canvas (shown in Shaper; the same renderer in all four apps), desktop 1280 x 800.
- **User sees:** hovering the "30" point-to-line dimension (from a point of a separate line to a rectangle's bottom side) lights four lines in the hover
  colour: the bottom side, BOTH vertical sides, and the separate line.
- **True:** the dimension binds the point and the bottom side only. The Design panel names it "Line 5 start – Line 3".
- **Measured** live (`p8-dimhover.mjs`): `HOVER {"hovered":"dPL","strokes":["L1=var(--sk-constraint-fill, #60A5FA)","L2=var(--sk-glyph-hover, #eab308)","L3=var(--sk-glyph-hover, #eab308)","L4=var(--sk-glyph-hover, #eab308)","L5=var(--sk-glyph-hover, #eab308)"]}`.
  Node, today's main (`p7-targets.mjs`) vs the 820 branch's constraintTargets (`p7b-targets-820.mjs`, `origin/agents/cthl-820`):
  - width A-B: main lights [Line 1, Line 2, Line 4]; **820 lights [Line 1]** (fixed by 820);
  - diagonal A-C: panel "Line 1 start – Line 2 end"; main AND 820 light [Line 1, Line 2, Line 3, Line 4];
  - point-to-line P to C-D: panel "Line 5 start – Line 3"; main AND 820 light [Line 2, Line 3, Line 4, Line 5];
  - midpoint P on C-D: panel "Line 5 start on Line 3"; main AND 820 light [Line 2, Line 3, Line 4, Line 5].
- **Cause:** `packages/ui/geometry-labels.js:41-42`: the any-joint fallback. 820 keeps it for any joint group that no single shape holds, and a 3-joint
  constraint (point + line) or a 2-point diagonal is such a group. The panel's `constraintGeometryText` in the same file resolves these cases correctly
  (its `segment()` rule).
- **Evidence:** `p8-rest.png` (eae43b546100726772ffffd24314248f), `p8-hover-point-to-line.png` (3a43ab64f873687ab4c1b322f3b47d29).
- **Fix direction (one place, constraintTargets):** resolve joints-only constraints with the panel's rule. A 3-joint distance or midpoint = the line
  holding joints 2-3 plus point 1 (no shape for the point). Two loose points = the points only (lit as points, no shape). This is a follow-up to 820
  (same function).

### V8 (K): the "Not cut" heading's box shows "none ticked" while the Stock row under it is ticked (class b, advisor sniff 4)
- **App / stage / device:** Shaper, Prepare, desktop 1280 x 800.
- **User sees:** after a tap on the "NOT CUT" heading's box, the heading box is empty, and so are both Guide rows. The Stock row under it is still ticked
  (greyed).
- **True:** the Stock is always exported, so not everything under the heading is out of the file. The heading's tooltip says "Tick all 2". The Stock row
  and tick do match the document in every case tried (Stock: ticked + disabled; no Stock: no row; the heading of a Stock alone: disabled, "Always exported").
- **Measured** (`p2f-heading.mjs`): `"Stock checked=true disabled=true"`, `"Guide checked=false ..."` x2, `"Not cut none title=Tick all 2: show and export them"`.
- **Cause:** `apps/shaper/src/op-list.js:159-163`: the heading box is computed over the tickable run only (the Stock filtered out), but it is drawn
  above the Stock row too.
- **Evidence:** `p2f-notcut-heading-desk.png` (caeca4c12f3788ab86c47d45ca41c3e3).
- **Fix direction (one place):** op-list.js heading box shows "some" (indeterminate) when the run's untickable rows are on and the tickable ones are not.
  Area: S2.

### V9 (C, needs a ruling): one Stock region lists and exports 3 elements: every Guide inside it is written twice, and any unassigned inner loop becomes a Stock-depth guide that the 3D board does not show (class g)
- **App / stage / device:** Shaper, Export (2D and 3D), desktop 1280 x 800.
- **User sees:** the 2D list shows "Stock · 1 region" with a count of **3**, and two extra blue outlines appear in the 2D view. The 3D board is plain: no hole,
  no mark.
- **True:** the file has 3 Stock-guide paths at 19.050 mm: the board outline plus the two Guide rectangles. The same two rectangles are written AGAIN as
  their own Guide elements at 0 and 1.5 mm, so each Guide line is on the Origin twice, at two depths. With an unassigned inner rectangle instead of the
  Guides, the Stock row counts 2 and the rectangle is exported as a Stock guide, and the 3D board still shows nothing for it.
- **Measured** (`p2c-stock.mjs`): `ELEMENTS ["path op=op-1 type=guide depth=19.050 mm ...", "path op=op-1 type=guide depth=19.050 mm ...", "path op=op-1 type=guide depth=19.050 mm ...", "path op=op-2 type=guide depth=0.000 mm ...", "path op=op-3 type=guide depth=1.500 mm ...", "path op=op-4 type=pocket ..."]`.
  With the unassigned rectangle (`p2e-frame.mjs`): `"rv2d-op: Stock · 1 region | 2"`, two `op=op-1` guide paths.
- **Cause:** `packages/core/profile-model.js:676` (task 814: a `drawnOnly` Guide owns no loop) combined with `:690` (a GUIDE-type profile, which the Stock
  is in the export, emits every hole that nobody owns as a guide). Task 814 wanted this for cut profiles ("the hole is cut AND the guide is written"). For
  the Stock it produces a duplicate line and a "region" count that does not match what the user drew.
- **Evidence:** `p2c-2d.png` (450d394675e855a95e159ea8f9e80ae5), `p2e-2d.png` (9aa5e39fb97ad6f162c077d04c1850a6), `p2e-3d.png` (31b44b47906a059e39a6a1bf074db50c).
- **Fix direction:** the owner rules whether the Stock's inner loops belong in the file. If not: in the one derivation (deriveProfileCuts), a Stock emits
  no automatic holes. If yes: the 3D board shows them.

## Unproven / cleared

- **U1, advisor sniff 2, `selection-list-795-live`'s Undo step: a test timing issue, not a visual race.** I ran it 3 times in parallel with 4 runs of
  export-preview-718-live. 2 of 3 failed, both at `[390x844] Undo sends nothing to Fusion`, with `actual ['highlight_selection:null']`; the 1280 x 800 phase
  passed every time. The extra message is the row-hover RESET (`fusion-bridge.js:359` mouseleave / `:361` focusout / `:375` re-render): the touch tap's emulated pointer
  leaves a list row when the footer Undo is tapped. It restores Fusion's normal look and draws nothing stale. The selection rows and geometry were right in
  every run (`t795-load*.txt`). Test fix (described, not made): clear `__sent` after the Undo tap's hover reset, or assert "no clear_selection /
  add" instead of "nothing".
- **U2, advisor sniff 2, `export-preview-718-live`: not reproduced.** It passed 5 of 5: once alone (27 s) and 4 times in parallel under the load above
  (`t718-run1.txt`, `t718-load1..4.txt`). No stale frame was seen.
- **U3: the note area's scrollbar on real phones.** Headless Edge with touch emulation draws the thin scrollbar (V1's screenshots). Android Chrome's overlay
  scrollbars usually show only while scrolling, which would leave no hint at all. This cannot be checked without a device.
- **U4: Roughing / Contour tab dots (task 810) on values the user never changed.** A new Contour starts from the LAST-used values (`cut-plan.js:201-203`
  `lastContour`), while its dots compare with the declared defaults (`cut-panel.js:101-103` `CONTOUR_DEFAULTS` / `TOOLDIA_DEFAULT_MM`). So a second Contour
  would show dots on its first open. Not reproduced: it needs a relief STL; area S2.
- **U5: a silent skip in a mixed selection.** `prepare-view.js applyCutTypeToSelected` `continue`s past an open path when a region type is picked while a
  loop and a path are both selected, and no notice says so. Not reproduced: S2 rewrites selection / the type menu.
- **Advisor sniff 3 (the shared tabs across apps): cleared, except V5.** DOC_UNIT is one shared setting, so the units are the same in all four apps
  (except Pen Plotter's paper unit, V5). Trace opens its Design step for a restored design with shapes (`apps/trace/src/app.js:149`). My sweep only showed
  the empty Trace step because the probe opened that step itself.
- **Footer Undo greyed in Shaper's Export step**, although the document has history: this is declared (`modes.js` createShaperHistory: "Review has
  none") and nothing on Export is undoable, so it is not a lie.

## What was checked per class

| class | checked | found |
|---|---|---|
| a. highlights | constraintTargets for every joints-only shape of constraint (node + live hover); the Design panel text vs the lit shapes; the Operations list rows | V7, V4 |
| b. colours / states | the DOF colour rule (svg-renderer.js:1258-1270 reads the nullspace through constraint-status cachedFreedom; bezier handles follow their ends, so a black bezier cannot change); footer Undo / Redo / Delete / Clear enabled state (polled every frame, app-footer.js:306); tab dot vs Save badge in 33 sweep screenshots; the Stock tick | V8 |
| c. stale drawings | unit change and Settings Reset in Prepare / Export; Design dimensions after a unit change (input-manager re-applies on every key) | V3 |
| d. hidden / cut-off messages | the 3-line note on desktop and phone with tabs, a pocket leftover and lead-in lines; toast placement (declared obstacle rule) | V1 |
| e. labels / numbers | the Export tick line, the list counts, the 2D list vs the Prepare rows, the Stock count | V2, V9 |
| f. z-order / overlap | full-frame sweep of 4 apps x every stage x 1280 / 390 / 844 x 390 (`p3-*.png`, 33 frames) | V6 |
| g. inconsistencies | unit settings per app, 3D vs 2D vs file, Prepare vs Export words for the same operation | V5, V9, V4, V2 |

# Drawing preview look audit (task 1048): Fusion 360 vs SketchStudio, step by step

AUDIT ONLY: no code in `packages/` or `apps/` changed. Owner-approved 2026-11-27. Worktree `preview-look-1048`, branch `agents/preview-look-1048` from `origin/main` de2e4cc8.

The owner's point: while a tool draws, Fusion shows a **prompt next to the cursor** ("Specify next point"), puts the **length box on a dimension line along
the segment** and the **angle box on an arc**, draws a **cursor square** and **inference marks**. Ours shows one two-field panel near the cursor and no prompt.
This document puts both side by side, one screenshot per tool step, mid-step, with the cursor resting at a sensible spot.

## How it was captured

**Fusion** (Fusion 360 Personal, 2026-11-27, shared Fusion lock held `sketch "1048 preview screenshots"`, released after): ONE new unsaved document,
marked with the user parameter `CLAUDE_MARK = 1048` (asserted before every change), one sketch on XY, top camera (eye +Z, up +Y, view extents 10 cm,
90 screen px per cm), display unit **mm**. Each tool was started by id (`DrawPolyline`, `ShapeRectangleTwoPoint`, `ShapeRectangleCenter`,
`ShapeRectangleThreePoint`, `CircleCenterRadius`, `ArcThreePoint`, `ArcCenterTwoPoint`, `ShapeSlotCenterToCenter`, `ShapePolygonInscribed`,
`SketchDimension`, `FilletSketchCmd`); the points were placed with real clicks (`hover_enter.py`), the mid-step cursor was a real cursor move only
(`.evidence/1048/hover.py`: SetCursorPos after checking Fusion is the foreground window and nobody moved the cursor), each screenshot is the Fusion
window (`win-mouse.py shot`) cropped to 900 x 560 px around the work. The document was closed unsaved (`close(False)`, by its creationId). No dialog
appeared. Fusion showed a "Read-Only: Document limit has been reached" banner for the scratch document; drawing still worked (nothing is saved).

**Ours** (SketchStudio, headless Edge through `tests/helpers/cdp-browser.js`, the way the live tests capture): desktop 1280 x 800 real mouse
(`Input.dispatchMouseEvent`), phone 390 x 844 real touch (`Input.dispatchTouchEvent`, the finger held down and moved for the mid-step shot, as a phone
user previews). Tools picked from the ribbon (`pressRibbonTool`, the variant rows `[data-mode]`), the buffer reset before every case. The same model
points as on the Fusion side (in "cm", y up), at 60 px per unit on desktop and 45 px on the phone. Desktop crop 760 x 420 css px at scale 1.5, phone
the canvas top 560 css px at scale 2. Script: `.evidence/1048/ours-capture.mjs` (untracked), log of the boxes at each shot:
`.evidence/1048/ours-log-desktop.json` and `ours-log-phone.json`.

**Not comparable on purpose**: the scale. Fusion was at 9 px per mm, ours opens at about 6 px per mm (the default view), so the same screen
distance is a different length; compare WHERE and HOW values are shown, not the numbers. Ours shows the document unit (mm) without a suffix.

**Cursor in our screenshots**: a headless capture does not paint the CSS cursor. Ours is the CSS cursor from `packages/ui/cursor-manager.js`
(lines 389-406): a 32 px black crosshair (14 px arms, white half-opacity under-stroke) with the tool's icon, monochrome, at its lower right, hotspot at
the crosshair centre; Fillet uses the plain `crosshair` (log: `"cursor":"crosshair"`). On a phone there is no cursor: a blue-ringed magnifier loupe
shows the spot under the finger, above it. Fusion paints its own cursor into the viewport: a small crosshair with a small square at its centre
(blue outline when it is on empty space).

Files: `f-<case>-<step>.png` (Fusion), `o-desk-<case>-<step>.png` and `o-phone-<case>-<step>.png` (ours), `cmp-<case>-<step>.png` (the three side by
side, Fusion left). All in `.evidence/1048/` (local, not committed); md5 of each in the last section.

## Fusion's prompt list (exact text, as read off the screenshots)

The prompt is a small tooltip (white, thin grey border, ~11 px text) about 30 px right of and 35 px below the cursor; it moves with the cursor.

| tool | step | prompt | file |
|---|---|---|---|
| Line | 1st point | `Place first point` | f-line-1 |
| Line | 2nd point | `Specify next point` | f-line-2 |
| Line | 3rd point of a chain | `Specify next point` | f-line-3 |
| Line | horizontal snap | `Specify next point` | f-line-4 |
| 2-Point Rectangle | 1st corner | `Place first corner` | f-rect2-1 |
| 2-Point Rectangle | opposite corner | `Specify size of rectangle` | f-rect2-2 |
| Center Rectangle | centre | `Place center point` | f-rectc-1 |
| Center Rectangle | corner | `Specify size of rectangle` | f-rectc-2 |
| 3-Point Rectangle | 1st corner | `Place first corner` | f-rect3-1 |
| 3-Point Rectangle | 2nd corner | `Place second corner` | f-rect3-2 |
| 3-Point Rectangle | 3rd corner | `Place third corner` | f-rect3-3 |
| Center Diameter Circle | centre | `Place center point` | f-circle-1 |
| Center Diameter Circle | rim | `Specify diameter of circle` | f-circle-2 |
| 3-Point Arc | start | `Place start point` | f-arc3-1 |
| 3-Point Arc | end | `Place end point` | f-arc3-2 |
| 3-Point Arc | through point | `Place point on arc` | f-arc3-3, f-arc3-3b |
| Center Point Arc | centre | `Place center point` | f-arcc-1 |
| Center Point Arc | start | `Specify start point` | f-arcc-2 |
| Center Point Arc | end | `Specify end point` | f-arcc-3 |
| Center to Center Slot | 1st centre | `Select start center point` | f-slot-1 |
| Center to Center Slot | 2nd centre | `Select end center point` | f-slot-2 |
| Center to Center Slot | width | `Select point on slot` | f-slot-3 |
| Inscribed Polygon | centre | `Place center point` | f-poly-1 |
| Inscribed Polygon | vertex | `Place point on polygon` | f-poly-2 |
| Sketch Dimension | pick | `Select sketch objects to dimension` | f-dim-1 |
| Sketch Dimension | placement | `Select additional sketch geometry or location for dimension` | f-dim-2 |
| Sketch Fillet | hover a corner | `Select first line or arc` | f-fillet-1 |
| Sketch Fillet | after the corner pick (radius box open) | `Select first line or arc` | f-fillet-2 |

Ours shows **no prompt** at any step, desktop or phone (the shot log lists no visible tooltip / status text at any step: `"tips":[]` in all 56 rows of
`ours-log-desktop.json` + `ours-log-phone.json`).

## What the angle is measured from

| case | Fusion | ours |
|---|---|---|
| Line, first segment | from the horizontal (+X) through the start point: a thin horizontal reference line is drawn to the right of the start and the angle arc spans from it to the segment; `33.6 °` (f-line-2) | from +X, counter-clockwise (`line-tool.js` lines 30-31): `33.7` (o-desk-line-2). Same reference, no arc drawn |
| Line, next segment of a chain | from the **previous segment**: the arc spans from the previous line to the new one, the interior angle; `109.4 °` (f-line-3), `146.4 °` at the horizontal snap (f-line-4) | still from +X: `-36.9` (o-desk-line-3), `0` at the horizontal snap (o-desk-line-4) |
| Center to Center Slot, 2nd centre | from the horizontal through the first centre, the arc drawn at the cursor end; `18.4 °` (f-slot-2) | no angle box (length only) |
| Center Point Arc, end | the sweep from the start radius to the end radius, on a dimension arc concentric with the preview arc, outside it; `111.7 °` (f-arcc-3) | the sweep: `108` (o-desk-arcc-3, the end snapped to the Y axis), no arc drawn, no `°` |

## Per-step differences

Common to every step, not repeated in the tables:

| | Fusion | ours |
|---|---|---|
| prompt | tooltip next to the cursor (list above) | none |
| where the value boxes sit (desktop) | each value in its own box ON the geometry it measures: a dimension line (extension lines + arrowheads) or an angle arc; the focused box's text is selected (blue) and the box has a blue underline | ONE panel 15 px right of and below the cursor (`numeric-input-manager.js` `updateInputPosition`, lines 620-624): two fields in a blue-bordered panel (L ∠ °, W × H, R sides N), or one orange-bordered field for single-value steps; no dimension line, no arc |
| where the value boxes sit (phone) | (no phone) | the same panel docked at the canvas top centre, 64 px down (`TOUCH_BOX_DOCK_TOP`), away from the finger |
| units in the box | `35.9168 mm`, `33.6 °` (4 decimals for lengths, 1 for angles) | `3.472`, `33.7` (no unit suffix, no ° sign in the field; `∠` / `×` / `sides` between the two fields) |
| preview line style | solid thin dark grey; finished curves turn blue | dashed grey; Rectangle / Polygon / Slot previews are dashed on a wide light-grey band |
| cursor | Fusion-painted crosshair with a small square at the centre | CSS crosshair + the tool icon at its lower right (desktop); loupe above the finger (phone) |
| extra on-canvas glyph | for Line / Rectangle / Circle / Arc / Polygon (not Slot, Dimension, Fillet): at the last placed point (or the origin before the first click) a triad: green dashed Y stub, red dashed X stub, a blue square, a quarter arc with a dot handle (see `uncertain`) | the green round **✓ Done** button on the canvas, seen in the Line chain, Slot width and Fillet shots (not in Fusion) |

### Line

| step | Fusion | ours (desktop / phone) |
|---|---|---|
| 1 first point (f-line-1 / o-*-line-1) | prompt; cursor square; nothing else | nothing (no cursor in the capture); phone: nothing until the finger moves |
| 2 second point (f-line-2) | length box on an aligned dimension line offset to the upper-left side of the segment, with extension lines and arrows; angle box on the angle arc at the cursor end, from the horizontal reference line | L ∠ ° panel right-below the cursor; dashed preview; phone: panel docked at the top, loupe above the finger |
| 3 chain, third point (f-line-3) | length on an aligned dimension line beside the new segment; angle box on a large arc between the previous segment and the new one (109.4 °); a midpoint `+` on the committed line | panel shows the angle from +X (-36.9); ✓ Done button on the canvas; phone: the loupe shows the snap diamonds of the axis crossings |
| 4 horizontal snap (f-line-4) | a **red dashed infinite line** through the start point (the X-axis colour) + the blue Horizontal glyph under the segment; length box on a horizontal dimension line above; angle box on the arc to the previous segment (146.4 °) | the dashed preview goes horizontal and the Horizontal glyph shows above it; **no infinite inference line**; angle field `0` |

### Rectangle

| step | Fusion | ours |
|---|---|---|
| 2-Point, 1st corner (f-rect2-1) | prompt `Place first corner` | nothing |
| 2-Point, opposite corner (f-rect2-2) | solid preview; width box on a horizontal dimension line BELOW the rectangle, height box on a vertical dimension line at its LEFT, both with extension lines + arrows | dashed preview on a grey band; the width and height drawn as bold plain numbers above / left of the sides (no dimension lines); W × H panel right of the cursor |
| Center, centre (f-rectc-1) | prompt `Place center point` | nothing |
| Center, corner (f-rectc-2) | as 2-Point plus **dashed construction diagonals** through the centre | as 2-Point plus a centre dot; no diagonals |
| 3-Point, 1st corner (f-rect3-1) | prompt | nothing |
| 3-Point, 2nd corner (f-rect3-2) | the first side solid; **one** length box on an aligned dimension line beside it; **no angle box**; a faint alignment line from the origin when the cursor lines up with it | the first side dashed; ONE orange single-value box (3.112) right of the cursor; no angle either |
| 3-Point, 3rd corner (f-rect3-3) | the rectangle solid; one height box on a dimension line perpendicular to the first side, on the far side | dashed + band; the first side's length drawn as a plain number, the box (1.466) right of the cursor **on top of the height label it repeats** (o-desk-rect3-3) |

### Circle (centre-diameter)

| step | Fusion | ours |
|---|---|---|
| centre (f-circle-1) | prompt `Place center point` | nothing |
| rim (f-circle-2) | solid preview circle; the **diameter line** through the centre from the cursor to the opposite rim, arrows at both ends; the diameter box on that line near the centre | dashed circle, centre point; ONE orange box with the diameter (3.206) right of the cursor; no diameter line |

### Arc

| step | Fusion | ours |
|---|---|---|
| 3-Point, start (f-arc3-1) | prompt `Place start point` | nothing |
| 3-Point, end (f-arc3-2) | the chord length box on a dimension line parallel to the chord, above it; red dashed horizontal inference + Horizontal glyph when level | dashed chord; ONE box (3.191) right of the cursor |
| 3-Point, through point (f-arc3-3, f-arc3-3b) | solid arc preview through the cursor; **no box at all** (checked twice, the second with a small extra move) | dashed arc; a box with the **radius** (1.603); a thin dotted line from the start to a dot (o-desk-arc3-3) |
| Center Point, centre (f-arcc-1) | prompt | nothing |
| Center Point, start (f-arcc-2) | the radius box ON the radius line (centre to cursor) | dashed radius line; box (1.47) right of the cursor |
| Center Point, end (f-arcc-3) | solid arc + both radius lines (thin grey); the sweep angle box ON a dimension arc concentric with the arc, outside it, arrows at both ends | dashed arc + a dotted radius line; box `108` right of the cursor, over the radius line; the end snapped to the Y axis showed a diamond snap mark + the axis drawn bold green |

### Slot (centre to centre)

| step | Fusion | ours |
|---|---|---|
| 1st centre (f-slot-1) | prompt `Select start center point` | nothing |
| 2nd centre (f-slot-2) | the centre line solid; length box on an aligned dimension line; **angle box** at the cursor end on the arc from the horizontal through the first centre (18.4 °) | dashed centre line with its length drawn as a plain label ABOVE it (2.702) AND the same value in the box right of the cursor; no angle box |
| width (f-slot-3) | solid slot; the full-width box on a dimension line ACROSS the slot at the end cap (perpendicular, arrows to both sides) | dashed slot on a band, dots at the four tangent points; a `Ø ...` label partly covered by the ✓ Done button; box (1.836, the full width) right of the cursor; a thin dotted line from the centre line to the cursor |

### Polygon (inscribed)

| step | Fusion | ours |
|---|---|---|
| centre (f-poly-1) | prompt `Place center point` | nothing |
| vertex (f-poly-2) | solid hexagon + its **construction circle** (circumscribed); the radius box ON the radius line from the centre to the cursor; the side count `6` in a separate floating box (grip at its left, ⋮ menu at its right) below | dashed hexagon on a band; centre point; ONE panel `R sides N` (1.603 sides 6) right of the cursor; no circle, no radius line |

### Dimension (placement)

| step | Fusion | ours |
|---|---|---|
| pick the line (f-dim-1) | the hovered line is highlighted blue (thicker); prompt | desktop: the hovered line highlighted blue (thicker) and a diamond snap mark at its midpoint, no prompt; phone (finger down, not moved): no highlight |
| placement (f-dim-2) | with the cursor above the line: a **horizontal** dimension, grey, value `30.00` drawn on its line (no box while placing); the line stays highlighted | an **aligned** dimension in light blue, the value in parentheses `(3.23)` (as a reference dimension is written), a diamond mark beside the value; phone: the same plus a green quarter arc at the line end (see `uncertain`) |

### Fillet (hover)

| step | Fusion | ours |
|---|---|---|
| hover the corner (f-fillet-1) | the fillet it would make drawn at the corner in **dark red** (the last radius), the two lines highlighted; prompt `Select first line or arc` | the full fillet preview as a dashed light-blue arc at R 5 (here larger than the 3 mm lines, so the lines' extensions to the tangent points are drawn dashed orange; a scale artefact of our default view, not a bug); H / V glyphs on the lines; phone: the radius box already open below the corner |
| after the corner pick (f-fillet-2) | the fillet made (blue), its centre point shown, a drag arrow on the arc, the radius in a **floating** box `5.00 mm` (grip + ⋮) away from the geometry; the prompt stays `Select first line or arc` | orange single box `5` below the corner, the ✓ Done button, a drag arrow on the arc, `R 5` label (phone) |

## Summary of the differences

1. **Prompt**: Fusion names every step next to the cursor (28 prompts above); ours has none.
2. **Box placement**: Fusion puts each value ON the geometry it measures (aligned / horizontal / vertical dimension lines with extension lines and arrows,
   angle arcs, the radius or diameter line). Ours shows one panel beside the cursor (desktop) or docked at the canvas top (phone), with no dimension
   line or arc drawn. Exceptions in Fusion: the polygon side count, the fillet radius are floating boxes; the dimension tool shows the value as text.
3. **Angle reference**: same for a first Line segment (+X). In a Line chain Fusion measures from the previous segment (interior angle), ours from +X.
4. **Which values are shown**: Fusion shows an angle where ours does not (Slot 2nd centre); ours shows a value where Fusion does not (3-Point Arc
   through point: radius). Both: no angle on the 3-Point Rectangle's first side.
5. **Inference marks**: Fusion draws a red dashed infinite line for a horizontal snap, faint alignment lines to existing points, and the constraint
   glyph; ours draws the glyph and straightens the preview, no inference line.
6. **Preview style**: Fusion solid thin dark grey (construction dashed); ours dashed grey, closed shapes on a light-grey band.
7. **Units and decimals in the boxes**: Fusion `mm` / `°` suffix, 4 decimals; ours bare numbers, 3 decimals (the Length precision setting).
8. **Cursor**: Fusion's crosshair + pick square; ours crosshair + tool icon; phone: loupe (no Fusion equivalent).
9. **Dimension tool**: Fusion picks horizontal from the cursor's side; ours shows an aligned dimension in parentheses.

## Extra (advisor request): Fusion's Offset constraint glyph

Measured in a second scratch document (`CLAUDE_MARK = 1048`, closed unsaved): a 30 x 20 mm rectangle, `sketch.offset(...)` 3 mm inward, sketch in edit, top view.
- The sketch holds ONE `OffsetConstraint` (parentCurves 4, childCurves 4, distance 0.3 cm) and one `SketchOffsetCurvesDimension` `3.00 mm`; each of the
  8 lines lists only that constraint.
- Glyphs: TWO glyphs for that one constraint. One sits on ONE parent curve (the outer bottom line), the other on ONE child curve (the inner bottom
  line). The other 6 lines have none. Each is just below its line (about 9-12 physical px, about 7 logical px at 150 %), near the line's midpoint.
  The `3.00` offset dimension is separate: an arrow from the outer line to the inner one.
- Icon: an inverted T (⊥) with a parallel outline around it (the shape and its offset copy), on a small rounded badge.
- Shown always while the sketch is in edit (nothing was selected in the idle shot); colour: idle light grey (rgb 167,172,174), hover dark slate,
  selected steel blue (rgb 103,147,166).
- Hovering or selecting EITHER glyph highlights BOTH glyphs and all 8 curves (parent and child) blue; the dimension is not highlighted.
- Files: f-offset-1 (idle), f-offset-hover, f-offset-sel, f-offset-glyph-states (idle | hover | selected, 8x).

## Uncertain

- **Fusion's triad glyph**: what the green / red stubs + blue square + quarter arc with a dot handle at the last placed point is (it reads as an
  on-canvas local-axes / rotate handle). Seen in every Line, Rectangle, Circle, Arc and Polygon shot, not in Slot, Dimension or Fillet. Not identified.
- **Fusion's grey glyphs at the origin in the Line chain shots** (a half-filled circle and a circled check mark, f-line-3 / f-line-4): what they are.
- **Our phone Dimension shot** (o-phone-dim-2): the green quarter arc at the line's end next to the Y axis; read as the axis highlighted by the finger's
  position, not checked.
- Fusion's 3-Point Arc third step showing no box at all was seen twice (f-arc3-3, f-arc3-3b); a Fusion setting that hides it was not looked for.

## Questions for the owner

1. Do we move toward Fusion's look on desktop: a step prompt beside the cursor, and each value box on its own dimension line / angle arc, instead of
   one panel beside the cursor? On the phone, does the docked panel stay (with the prompt shown above it)?
2. In a Line chain, should the angle box measure from the previous segment, like Fusion (109.4 °), instead of from +X (ours: -36.9)?

## Appendix: real bugs noticed (not fixed, not filed; audit rule 5)

- **Box over its own label**: 3-Point Rectangle third corner, desktop: the single box sits on top of the height label it repeats (o-desk-rect3-3).
- **✓ Done over a label**: Slot width step: the green ✓ Done button covers the `Ø` label of the cap (o-desk-slot-3, o-phone-slot-3).
- **Box over the preview**: Center Point Arc end step: the angle box covers the start radius line (o-desk-arcc-3).

## Evidence md5 (`md5sum`, `.evidence/1048/`)

| file | md5 |
|---|---|
| f-arc3-1.png | `e5d8b55a78c1ff70de4343bb4313c433` |
| f-arc3-2.png | `5205a42558bc24c5498235c8e781e06a` |
| f-arc3-3.png | `73c3659429e81a1bf1f3908ffe28bd06` |
| f-arc3-3b.png | `18f2b0d718dd03b1dc2223059fe9a987` |
| f-arcc-1.png | `7693b49a17ed84d50a14156f3cd6813d` |
| f-arcc-2.png | `e22e371859366350b5b789dd311269e3` |
| f-arcc-3.png | `a2264d8f3d6ebce711eeea14fbe101bc` |
| f-circle-1.png | `d0da20883cd97c63f1d434ce38a88ad7` |
| f-circle-2.png | `1a02d7f3f3ffe4299cdf23810cfb35a4` |
| f-dim-1.png | `e8b836d785efae7b533eb9cc1b1cfe22` |
| f-dim-2.png | `117fba5916397c2c011fbe4bea0a13c6` |
| f-fillet-1.png | `cf54d7e0f2631e758412eb4bb2d22e6e` |
| f-fillet-2.png | `742063cb2d2a09d3548164936e333e1c` |
| f-line-1.png | `e69bdfaf97557e8d099f45ac2c157ebd` |
| f-line-2.png | `d261422459a41fde3ad6a6f45405effa` |
| f-line-3.png | `ee1a148b6d4adc2b4af5c767c272d154` |
| f-line-4.png | `ea5b266718e5b5a522edeceaf040446e` |
| f-offset-1.png | `611846f5bf60abbaf3d8ec135d124cb5` |
| f-offset-glyph-states.png | `3edab7fc771906668009d86c09a3f1ac` |
| f-offset-glyph-zoom.png | `3337306a1df8c261e8b3d0d9f1c043af` |
| f-offset-hover-zoom.png | `827fb98bb02ef49b301e1e8449819544` |
| f-offset-hover.png | `fd12c3d1ba4296275e795f81a0d3763f` |
| f-offset-sel-zoom.png | `cb2b0dba21ae53a9066640fd97e7f3c1` |
| f-offset-sel.png | `ba2f8a43f8e30beb93d747c53b7abd7f` |
| f-poly-1.png | `7693b49a17ed84d50a14156f3cd6813d` |
| f-poly-2.png | `38514d2ce9317e1a2f771d5a1fbedf6f` |
| f-rect2-1.png | `fa04bbe635a99b1a0c03fda4ce96ba8e` |
| f-rect2-2.png | `8be76b6c036fdda3bf3cbe2fb5b34a02` |
| f-rect3-1.png | `fa04bbe635a99b1a0c03fda4ce96ba8e` |
| f-rect3-2.png | `ef81f71b3f9870db64b1671fd09a73ba` |
| f-rect3-3.png | `d0f87852fc5e30c863781a7368844b33` |
| f-rectc-1.png | `d0da20883cd97c63f1d434ce38a88ad7` |
| f-rectc-2.png | `3a1577f3297f027ffe9e94a99cfbf07a` |
| f-slot-1.png | `51d1e8af8deaf57e3d4e8e96c895e09b` |
| f-slot-2.png | `e7fc7452aec1fafc26324baefa4e600b` |
| f-slot-3.png | `0cc5f426be5e86d305738202c1eeb590` |
| o-desk-arc3-1.png | `d775e1fecc0d2cb1a927e7cbb56d64d3` |
| o-desk-arc3-2.png | `e5288e0242c37dc15a7fa0211dda6409` |
| o-desk-arc3-3.png | `3ab47c616c4fa080c2204544f2ea34ea` |
| o-desk-arcc-1.png | `d775e1fecc0d2cb1a927e7cbb56d64d3` |
| o-desk-arcc-2.png | `9277c3a7ba9d24f7e0c4e67d10dcd590` |
| o-desk-arcc-3.png | `f042cfe09dd4750e2eedd39deb5a90ec` |
| o-desk-circle-1.png | `d775e1fecc0d2cb1a927e7cbb56d64d3` |
| o-desk-circle-2.png | `18210ef36adbea2f0c615bab1ae1a3df` |
| o-desk-dim-1.png | `f7c8a676c723582f7e2f5c645ed5172d` |
| o-desk-dim-2.png | `6df21c4c68e838ffb4bdff6a8b8737e2` |
| o-desk-fillet-1.png | `f051522aed4c66e48904d8f8de7384df` |
| o-desk-fillet-2.png | `8fefbac623e803cab64604836bf7a2e9` |
| o-desk-line-1.png | `d775e1fecc0d2cb1a927e7cbb56d64d3` |
| o-desk-line-2.png | `277f93ca645dfe74cd3e7fde1717e74a` |
| o-desk-line-3.png | `5fadb886b4fe0ffa4a52c67f30316560` |
| o-desk-line-4.png | `eb3c74478c82126cc64c3f3f55051b67` |
| o-desk-poly-1.png | `d775e1fecc0d2cb1a927e7cbb56d64d3` |
| o-desk-poly-2.png | `4f9e65a9ab2967623c1b08f6f9cd20ed` |
| o-desk-rect2-1.png | `d775e1fecc0d2cb1a927e7cbb56d64d3` |
| o-desk-rect2-2.png | `a9f7ca35381b640b4549eb27f0cad934` |
| o-desk-rect3-1.png | `d775e1fecc0d2cb1a927e7cbb56d64d3` |
| o-desk-rect3-2.png | `233fbee8f4f839b2a28444b80fc6b4e2` |
| o-desk-rect3-3.png | `f7cd9174890c30793a245c05dc951bcc` |
| o-desk-rectc-1.png | `d775e1fecc0d2cb1a927e7cbb56d64d3` |
| o-desk-rectc-2.png | `0b8c87ca4edf91372f59b4d857552ff8` |
| o-desk-slot-1.png | `c73d315cd968f0c4a9a9d8b7d594031d` |
| o-desk-slot-2.png | `2dfc9efc75f5a7b753be75aafdd007d3` |
| o-desk-slot-3.png | `5ed7e654e80248778bb23afe8efcf789` |
| o-phone-arc3-1.png | `644990863b56a593cbe2f9e2458660ab` |
| o-phone-arc3-2.png | `ec47fc5b59cde93360e35dc203bfe59d` |
| o-phone-arc3-3.png | `3208fbc60ce2f14cb00fb0f95b60a307` |
| o-phone-arcc-1.png | `456137eebe001bf710f177ab63ec729b` |
| o-phone-arcc-2.png | `604502a76c93ecf9a739e0c33a7c6146` |
| o-phone-arcc-3.png | `b60237df08b2fa34e0e705845a5d178c` |
| o-phone-circle-1.png | `644990863b56a593cbe2f9e2458660ab` |
| o-phone-circle-2.png | `eee36fa8bd0d22ca645ba549907260c4` |
| o-phone-dim-1.png | `47c456b1ad6348ee1e5a030de2294c58` |
| o-phone-dim-2.png | `0da5154d5e7c272d27570d87d215aed3` |
| o-phone-fillet-1.png | `c0b6f017a47027d89f0873a514ce4905` |
| o-phone-fillet-2.png | `8420db2d3a1c2848b00959aee1a21be7` |
| o-phone-line-1.png | `644990863b56a593cbe2f9e2458660ab` |
| o-phone-line-2.png | `7f9bcb8e8a55432db75e59244bf4ec9b` |
| o-phone-line-3.png | `6ee2e7372bc56d9644a964edb795cbde` |
| o-phone-line-4.png | `2333e97fb312f40fe5918ee2acd732db` |
| o-phone-poly-1.png | `644990863b56a593cbe2f9e2458660ab` |
| o-phone-poly-2.png | `b60473301e6f072820498d7929604e23` |
| o-phone-rect2-1.png | `644990863b56a593cbe2f9e2458660ab` |
| o-phone-rect2-2.png | `64edc164eb7e9673598fe044a650afb1` |
| o-phone-rect3-1.png | `644990863b56a593cbe2f9e2458660ab` |
| o-phone-rect3-2.png | `2373a22799f2368cd67c3ed108cbed42` |
| o-phone-rect3-3.png | `d797739b746bb55043638dcf2a0ed9f8` |
| o-phone-rectc-1.png | `644990863b56a593cbe2f9e2458660ab` |
| o-phone-rectc-2.png | `bbd7a9666750136d8c4427cfee63b09e` |
| o-phone-slot-1.png | `644990863b56a593cbe2f9e2458660ab` |
| o-phone-slot-2.png | `be6e623a707e47dbc3066619bbd39dd1` |
| o-phone-slot-3.png | `f099f5c28873e55bf829ba45c4862c4e` |
| cmp-arc3-1.png | `9368d198ddb2f35e9fd114e68ec3b481` |
| cmp-arc3-2.png | `534a97869bec16f18ba2fb004c5738ce` |
| cmp-arc3-3.png | `dd7e5e319d4e253fb8705b2947530315` |
| cmp-arcc-1.png | `f922d310968f7fd03d1753b1e0163b1e` |
| cmp-arcc-2.png | `bb1fcd8545e048e83e62128f1b7967d2` |
| cmp-arcc-3.png | `fe25021a2a71ae2bc6a68afd86f7139d` |
| cmp-circle-1.png | `129ef0ba19aaeb3a3a80e4f6907f6b13` |
| cmp-circle-2.png | `e136fa9e3c9da1b21dc7a1cdba3f12ff` |
| cmp-dim-1.png | `c86ae95b0f2c24401d333d9a5eced967` |
| cmp-dim-2.png | `5bb46475483ffbf1838adc1b211c5ce6` |
| cmp-fillet-1.png | `378e37acac68383e5e3c8893e1b98f95` |
| cmp-fillet-2.png | `c06db0763fe8ca62dbf0a530b43f4392` |
| cmp-line-1.png | `42a3939e6bea5aebd66f3ad0bc426d57` |
| cmp-line-2.png | `aa9fd144c5fcc2b1f1a2671f0a7b4a1d` |
| cmp-line-3.png | `74a8cdd3593ad2597016b62d4cc56d24` |
| cmp-line-4.png | `5061f4eee9a60d6a22dfe752b445a1c8` |
| cmp-poly-1.png | `fbb30a1d6b7ec5512e33369375b8a859` |
| cmp-poly-2.png | `7e7745df78f74d4d54254b70550f9a48` |
| cmp-rect2-1.png | `39c42b33d355c79e91f23840d64128bf` |
| cmp-rect2-2.png | `8341469ffea9a6cbfe2c973bfc6c0002` |
| cmp-rect3-1.png | `991e81be9e313872123ec341683acc2d` |
| cmp-rect3-2.png | `a809724b48e0a62074297c2a9be74260` |
| cmp-rect3-3.png | `cd6d78f933a43acfe1e1bf78701ebfdb` |
| cmp-rectc-1.png | `089acf105caa1a5d830fa79deae3a340` |
| cmp-rectc-2.png | `c9d8119cc0a029b930df6e618abe1080` |
| cmp-slot-1.png | `9c183086c25135eedf3299c835671f9f` |
| cmp-slot-2.png | `7f45f9a7f0a32b9af1e132537edadce0` |
| cmp-slot-3.png | `3c90b60db8cec94479c3feeb0d7117e1` |

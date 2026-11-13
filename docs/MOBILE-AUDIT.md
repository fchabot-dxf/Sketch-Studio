# Mobile audit (task 561)

Audit only: no app code changed. Captured by `node scripts/mobile-audit.mjs [outDir]` (headless Edge, CDP
`Emulation.setDeviceMetricsOverride mobile:true` + `setTouchEmulationEnabled` + `Input.dispatchTouchEvent`).
Devices: 390x844 dpr3, 360x740 dpr3, 820x1180 dpr2. Screenshots and `measurements.json` are in `.evidence/561/` (not committed).
Full flow (every panel, draw, select, drag, pinch, pan, dim box, long press) on 390 in SketchStudio, Shaper, Pen Plotter;
first screens + measurements on 360 and 820. Numbers below are 390x844 unless stated.

## Ranked problems

| # | What | Where | Measured | Screenshot |
|---|------|-------|----------|-----------|
| 1 | Shaper and Pen Plotter are desktop layouts: content is wider than the screen, panes are cut off | Shaper header + Explore/Review, Pen toolpath | Shaper `#mode-nav` right edge 439 (page 390), Explore `#inspector` right edge 520, Explore canvas share 0 %, Review 3D canvas share 21.9 % (a ~90 px strip beside a 300 px side panel); Pen toolpath left panel clipped | `p390-shaper-explore`, `p390-shaper-review`, `p390-pen-toolpath`, `p390-shaper-design` |
| 2 | SketchStudio header and ribbon do not fit | header, ribbon | `#btn-debug-toggle` right edge 393 > 390 (clipped); ribbon is 1353 px wide in a 382 px box (72 % hidden; 40 % hidden even on the 820 tablet); Bezier cut at the edge. Swipe works (scrollLeft 0 to 477) but nothing says there is more | `p390-ss-first-screen`, `p390-ss-ribbon-after-swipe` (not individually re-opened) |
| 3 | Tap targets under 44 px | everywhere except ribbon tool buttons | SketchStudio first screen: 11 of 18 on-screen controls < 44 (min 24): header Menu 82x27, Design/Export/Style/Debug 29 high, polygon-sides 38x24, Construction 121x24, Recenter 87x24, footer Log/MAG/TUNE 26 high. Shaper stage nav 31 high (5 of 5 < 44), Pen stage nav 27 high, Pen toolpath 24 of 25 < 44 (an "Include" checkbox 7x13). Ribbon tool buttons 48x56 are fine | `p390-ss-first-screen`, `p390-pen-toolpath` |
| 4 | Touch and hold does nothing (no timer, relies on the browser `contextmenu` event; iOS Safari fires none) | `input-manager.js` l.961 | 0 `contextmenu` events from a real 700 ms CDP hold on canvas, shape, joint (all 3 hosts); see section below | `p390-ss-longpress-*`, `p390-ss-synthetic-contextmenu-*` |
| 5 | Context menu is finger-hostile | `context-menu.js` | rows 30 px high (min 44), opens with its corner at the touch point so the finger and the joint are under it; only in Select/Dim tools | `p390-ss-synthetic-contextmenu-joint`, `...-dimension` |
| 6 | Dimension edit box cannot take a parameter name; no autocomplete exists | `dimInput` (`numeric-input-manager.js`) | `type=number inputmode=decimal`; after inserting "wid" the field is blank (shot); 0 `<datalist>`, 0 suggestion elements; box 210x36 at y=610 (a phone keyboard, not emulated here, would cover y > ~540). The Parameters window says "type name = value into a dimension": a numeric keypad has no letters or "=" | `p390-ss-dim-input-typed-wid`, `p390-ss-dim-tool-after-tap` |
| 7 | Overlays swallow the canvas | Params window, Style, Debug, toast | Canvas is 74.7 % of the screen at rest (96.5 % uncovered). Params window leaves 40 % uncovered, Style and Debug 18 %. A toast "Dimension added as reference ..." wraps to 8 lines over the canvas bottom and footer (9 % of sample cells). Floating Construction/Recenter buttons cover ~3 % | `p390-ss-params-window`, `p390-ss-style-panel`, `p390-ss-debug-panel`, `p390-ss-dim-input-typed-wid` |
| 8 | Text too small | ribbon labels, footer, debug panel, Pen forms | Ribbon labels and group labels 8 px (8 elements), footer MAG LENS 9 px, TUNE 9 px, coords/VIEW 10 px, Pen labels/hints 9 px, Shaper cut-panel labels 11 px, Debug panel label rows pale grey on white (low contrast) | `p390-ss-first-screen`, `p390-ss-debug-panel`, `p390-pen-toolpath` |
| 9 | Touch snap reach is huge for points, small for lines | `constants.js` SNAP, `solver-config.js` | Joint pick 30 px x touch boost 2.0 = 60 px (a 120 px circle on a 390 px screen); line pick 20 px, not boosted; lock 16 px; constraint glyph tolerance 40 px (touch) vs 20. All in screen px (tasks 537/552 hold). A tap within 60 px of the origin or a joint takes that joint rather than a nearby edge | code; `p390-ss-select-joint-tap` |
| 10 | Finger covers the point, helper is off by default and hidden | `input-manager.js` | `TOUCH_OFFSET_Y = 0` (no offset); the magnifier ("MAG LENS") is off by default, toggled by a 81x26 px 9 px footer button that exists only in SketchStudio (0 in Shaper, Pen Plotter, Trace); the lens (r 50 px, 80 px above the snap point) shows only while a snap target is active. A line started by touch shows no rubber band under the finger (one dot, no preview line) | `p390-ss-line-rubberband-finger-down` |

Also noted (not ranked): there is no touch way to finish a Line chain or cancel (Esc only; right-click finishes a line; a hold with the Line tool active only calls `preventDefault`), so the only exit is picking another tool. Hover-only affordances: Pen toolpath row drag handle (`.tp-layer-row:hover .drag-handle`), 3 Pen controls with only a `title` tooltip (stroke colour, width, fill), right-click menus (item 4). Most other `:hover` rules are colour only.

## What works

- Pinch and two-finger pan: viewBox 20 wide to 7.27 after the pinch, origin x shifts -2.24 to -4.00 after the pan (SketchStudio); same in Shaper and Pen Plotter.
- Draw by touch: line (click, click) 10 to 14 geometry elements; rectangle (tap, tap) to 26; a joint drag leaves the view unchanged (no accidental pan).
- No 300 ms tap delay: pointerup to click 1.3 to 4.6 ms (ribbon). Canvas pointerdown to second animation frame 30 to 34 ms (about 2 frames; JS side only, not the touch hardware). Console errors: 0 on every page.
- No horizontal document scroll at 390, 360, 820 in SketchStudio (`scrollWidth` = `clientWidth`); the overflow in #1 and #2 is inside clipped containers (Shaper/Pen show it as a shifted page when a control is scrolled into view).
- Canvas share of the screen: SketchStudio 74.7 % (390), 71.5 % (360), 79.7 % (820); Shaper Design 85.3 %; Pen Design 84.2 %; Shaper Vcarve 35.5 %; Review 21.9 %.

## Touch and hold: the answer

Today a long press (600 to 700 ms, no move) does nothing the code itself creates: there is no timer or hold detector anywhere (grep for long-press finds only a constants comment). The only path is the browser `contextmenu` event: `input-manager.js` ~l.961 adds a document `contextmenu` listener that, in Select or Dimension tool and on the canvas, calls `openContextMenuFor` (shape, joint, dimension label or dimension glyph), which opens the shared `context-menu.js` menu (shape/joint: Lock, Delete; dimension: Driving, Reference, Delete).

- Chrome Android fires `contextmenu` on a long press, so the menu would open there. iOS Safari fires no `contextmenu` on a touch long press, so on an iPhone or iPad there is no way to the menu at all.
- Touch `pointerdown` goes to `handlePanZoomPointerDown` first (~l.550); for one finger it returns false (only 2+ fingers pinch), so the press then runs the normal select / drag path, selecting what is under the finger before any menu.
- CDP touch emulation does not fire `contextmenu` at all (control: a plain div with its own listener got 0 events after a 900 ms hold), so the real-browser result could not be measured headless. Per host, real CDP hold at 700 ms: empty canvas, shape edge, joint: 0 events, no menu, in SketchStudio, Shaper and Pen Plotter (`longPress` in measurements.json).
- Simulating what Chrome Android sends (a `contextmenu` PointerEvent, pointerType touch, dispatched on the element under the point) at the same targets, 390 px:

| Target | SketchStudio | Shaper | Pen Plotter |
|--------|--------------|--------|-------------|
| shape edge | menu: Lock, Delete | menu: Lock, Delete | menu: Lock, Delete |
| joint | menu: Lock, Delete | menu: Lock, Delete | menu: Lock, Delete |
| dimension | menu: Driving, Reference (checked), Delete | no dimension in the flow | no dimension in the flow |
| empty canvas | nothing, not prevented (browser native behaviour) | nothing | nothing |

  Rows are 30 px high. In Line, Rect and other drawing tools no menu opens (select/dimension only; Line with an active chain only prevents the native menu).
- Not tested (uncertain): the exact event order on a real Chrome Android hold (contextmenu then pointercancel or pointerup) and whether the press has already started a joint drag by 500 ms.

## Screenshots opened and judged (one line each)

390x844, `p390-` prefix. Every other capture (the 360 and 820 sets, the remaining 390 shots) was saved and measured but not individually re-opened.

- `ss-first-screen`: Debug button clipped at the right edge; ribbon cut at Bezier; footer 24 to 26 px controls with 9 px text.
- `ss-sidebar-open`: fine (large rows, drawer 280 px); Debug/Style stay half visible behind the backdrop.
- `ss-projects-modal`: fine, full screen; buttons and search ~31 px high; list empty.
- `ss-params-window`: bottom sheet covers 52 %; fine but the ribbon is scrolled away behind it.
- `ss-style-panel`: 28 controls in a floating card over the ribbon; works, "Same as ..." select truncated; hides the canvas that shows its effect.
- `ss-debug-panel`: pale grey labels on white, 11 px, hard to read; long scrolling form.
- `ss-line-rubberband-finger-down`: only one dot, no rubber band under the finger.
- `ss-dim-tool-after-tap`, `ss-dim-input-typed-wid`: edit box blank after typing letters; 8-line toast covers the lower canvas and footer.
- `ss-select-joint-tap`, `ss-longpress-shapeEdge`: press highlights the edge dark; no menu.
- `ss-synthetic-contextmenu-joint` / `-dimension`: menu opens under the finger on top of the selected joint / label.
- `shaper-explore`: two desktop panes, page far wider than the phone, "Select an ele..." cut.
- `shaper-design`: usable canvas; header scrolled sideways (Menu button off the left edge after a control scroll).
- `shaper-prepare`: panel is a 300 px card over the canvas; fields 34 px; fine.
- `shaper-review`: 3D view squeezed to a strip left of the side panel; toolbar buttons overlap a heading.
- `pen-toolpath`: left panel clipped at the left, canvas half off the right edge.

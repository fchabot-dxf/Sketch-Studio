# Real-Design UI/UX Audit — Parts C & D (TASK 1017)

> **Audit only** — zero changes to `packages/` or `apps/`.  
> **Branch / base:** `agents/designrun-1017` from `origin/main` (`a0634db3`, 2026-11-26).  
> **Method:** Live headless Chrome (`1280×800`, desktop) driven strictly through real pointer, keyboard, ribbon, context-menu, and Parameters-window UI events via [`tests/helpers/cdp-browser.js`](../tests/helpers/cdp-browser.js) and [`tests/audits/design-run-audit-1017-kit.js`](../tests/audits/design-run-audit-1017-kit.js). Zero direct state mutations (read-only state inspection only); Google/Drive/ShaperHub blocked with `installFakeDriveSession`.  
> **Fusion 360 expectations:** Marked `(unverified)` unless backed by a fixture under `tests/fixtures/fusion-oracle/` or `docs/` (cited inline where verified).

---

## Findings Summary Table (`R2-01` .. `R2-14`)

- **Regressions of FIXED entries in `docs/BUG-ARCHIVE.md`:** **0** (every prior fix exercised in Parts C & D held — see [Cross-Reference](#cross-reference-prior-bug-archive--audit-ids)).
- **Findings by verdict:** **11 `BUG`**, **1 `DIVERGENCE`**, **2 `FRICTION`** (14 finding rows `R2-01`..`R2-14`; across the 25 step sections `C-01`..`C-14`, `D-01`..`D-12`, and `E-01`..`E-04`: **15 `OK`**, **10 with findings**).

| ID | Part / Step | Verdict | What happened vs expected | Repro (probe row) | Severity |
|---|---|---|---|---|---|
| **R2-01** | Part D / `D-05c` | **BUG** | **Trim at an Arc endpoint deletes the entire line and its dimensions.** Clicking Trim on the 15 mm corner stubs where the `R 15` relief arc meets both legs deleted both entire 150 mm & 100 mm legs (`L: 3 -> 1`, losing `leg = 150`, `fx: 100`, `(33.7°)`). Expected: trim only the 15 mm stub up to the arc intersection. Cause: `packages/core/trim.js:57` skips all non-line cutters (`other.type !== 'line'`). | `node tests/audits/design-run-audit-1017-part-d.mjs` (`ROW D-05c.trimDeletesWholeLegs`) | `lost work` |
| **R2-02** | Part C & D / `E-01a`, `E-01b` | **BUG** | **Auto-reference dimension on an already-dimensioned edge is permanently lost by Undo + Redo.** Placing a 2nd (auto-ref) dimension `(80)` on a dimensioned line, then pressing `Ctrl+Z` once and `Ctrl+Y` once permanently drops `(80)` (`["80","(80)"] -> ["80"] -> ["80"]`; same on full Undo-all + Redo-all). Cause: `packages/core/sketch-state.js:123` (`_restoreSnapshot`) calls `addConstraintObject` → `hasConstraint`, which ignores `isDriven` and rejects `(80)` as a duplicate of `80`. | `node tests/audits/design-run-audit-1017-extra.mjs` (`ROW E-01a.autoRefUndoRedo`, `ROW E-01b.singleUndoAutoRef`) | `lost work` |
| **R2-03** | Part C / `C-08`, `C-08b` | **BUG** | **Trim on mirrored lines deletes the `symmetric` constraint on trimmed endpoints, breaking Mirror symmetry.** Trimming mirrored `guideR`/`guideL` at the inner offset line mints new joints and removes the orphaned tail endpoints (`packages/core/trim.js:113-116, 170-172`), dropping the bottom `symmetric` constraint. Editing `30° → 45°` rotates `guideR` to `45°` while `guideL` stays stuck at `(-36.62, 22)` (`142.06°` vs expected `135°`). | `node tests/audits/design-run-audit-1017-part-c.mjs` (`ROW C-08b.trimBreaksMirror`) | `wrong geometry` |
| **R2-04** | Part D / `D-02`, `D-03a` | **BUG** | **Line draw-time box with typed length/formula (`leg = 150`, `leg * 2/3`) + Enter drops Horizontal/Vertical inference.** Drawing along X/Y and committing a typed length/formula leaves both legs without H/V constraints (`dof = 1` each, free to rotate). Cause: `packages/ui/input-handlers/line-tool.js:56` clears `activeInference` whenever `hasLock()` is true, even when only `lockedLength` is set and `lockedAngle === null`. | `node tests/audits/design-run-audit-1017-part-d.mjs` (`ROW D-02`, `ROW D-03a.drawTimeNoHV`) | `wrong geometry` |
| **R2-05** | Part D / `D-10a`, `E-02a`, `E-02b` | **BUG** | **Break tool does not snap to an existing joint (hole center) on the line.** Clicking Break on the hypotenuse right at `H2 (75, -50)` (or `(90, -60)`) creates a detached 1-DOF break joint at `(74.94, -50.04)` / `(89.97, -60.02)` (`packages/ui/input-handlers/break-tool.js:63, 78-100`, `packages/core/break.js:58-59`); dragging the break joint slides it away from the hole (`(76.09, -49.27)` vs hole `(75, -50)`). | `node tests/audits/design-run-audit-1017-extra.mjs` (`ROW E-02a.breakSolidHyp`, `ROW E-02b.dragAfterBreak`), `part-d.mjs` (`ROW D-10a.afterBreak`) | `wrong geometry` |
| **R2-06** | Part C / `C-05a` | **BUG** | **Offset tool: clicking to choose side steals focus from `#offset-distance-input`, swallowing typed distance & Enter.** Clicking inside the rectangle sets the side (`setSide`), which focuses `#svgCanvas` (`activeElement = svgCanvas`) and never re-focuses `_open.el` (`packages/ui/input-handlers/offset-tool.js:169-174`). Typing `8` + `Enter` does nothing (`boxVal` stays `5`, `offsetStillOpen = true`) until the box is clicked again. | `node tests/audits/design-run-audit-1017-part-c.mjs` (`ROW C-05a.focusBug`) | `misleading UI` |
| **R2-07** | Part C / `E-04` | **BUG** | **Offset tool requires TWO `Esc` presses to cancel and leave the tool (violates owner's 1-Esc ruling / `BUG-105`).** With the Offset box open, 1st `Esc` closes the box (`box: false`) but stays in `tool-offset` (`packages/ui/input-handlers/offset-tool.js:218, 222` calls `ev.stopPropagation()` + `cancelAll()` without exiting to Select); a 2nd `Esc` is required. | `node tests/audits/design-run-audit-1017-extra.mjs` (`ROW E-04.offsetEsc`) | `misleading UI` |
| **R2-08** | Part C & D / `C-09b`, `D-06b`, `D-10c` | **BUG** | **Overlapping construction line wins hit-test over solid geometry (and vice versa) with no feedback.** (a) Clicking the solid arc apex at `(0, 3.28)` over the Y construction centreline hits the centreline in Tangent (`"not two lines"`). (b) Clicking Equal on two construction segments overlying the hypotenuse hits the solid hypotenuse twice (`"Pick a second curve, a different one."`). (c) Clicking Collinear on the two broken hypotenuse halves hits the overlapping construction line twice (`"Pick a second line, a different one."`), and Break at `(90, -60)` can silently split the construction line instead of the solid hypotenuse. | `part-c.mjs` (`ROW C-09b.apexHitBug`), `part-d.mjs` (`ROW D-06b.overlapEqualBug`, `ROW D-10c.afterRejoin`) | `misleading UI` |
| **R2-09** | Part D / `D-06c` | **BUG** *(related to open `BUG-136`)* | **Small-circle rim pick (`Ø 5`, `r_px < 15 px`) stolen by circle's own center joint in Equal tool.** At overview zoom (`vw ~ 310`, `r = 2.5 mm ≈ 10 px`), clicking `C1`'s rim in Equal hits `C1`'s center point instead of the rim — even though Equal only accepts curves, never points (`packages/ui/snap-detection.js:187` `JOINT_PRIORITY_RADIUS = 15`, open `BUG-136`). Applying `Equal(C1, C2)` silently does nothing (`C2.r` stays `4.92`) until zoomed in past ~20 px radius. | `node tests/audits/design-run-audit-1017-part-d.mjs` (`ROW D-06c.smallCircleRimBug`) | `misleading UI` |
| **R2-10** | Part D / `D-07a` | **BUG** | **Parameters window `ref` badge squishes vertically onto 3 stacked single-letter lines (`r`/`e`/`f`).** On reference dimension rows (`d2` `(33.7°)`), `.pt-ref` (`packages/ui/parameter-table.js:248`) lacks `flex: 0 0 auto; white-space: nowrap;` (unlike `.pt-fx` on line 245), so the `width: 100%` Name `<input>` crushes the `ref` pill to 1-char width and stretches the row to 44 px tall. | `node tests/audits/design-run-audit-1017-part-d.mjs` (`ROW D-07a.paramsOpen`) | `misleading UI` |
| **R2-11** | Part D / `D-08b`, `E-03` | **BUG** | **Reference Radius & Diameter labels format as `R (15)` and `Ø (5)` instead of `(R 15)` and `(Ø 5)`.** `packages/ui/svg-renderer.js:73-80` wraps `lenStr` in `(...)` before prepending `'Ø '` / `'R '`, producing `Ø (5)` and `R (15)` instead of standard `(Ø 5)` / `(R 15)`. | `part-d.mjs` (`ROW D-08b.flipRefAndBack`), `extra.mjs` (`ROW E-03.refFormatAndAngDrive`) | `misleading UI` |
| **R2-12** | Part D / `D-05a` | **DIVERGENCE** | **No 3-Point Arc tool (Center-Start-End Arc only).** `#tool-arc` has no variant dropdown/caret (`packages/ui/tool-ribbon.js:56`, `packages/ui/input-handlers/arc-tool.js:34-36`); a corner relief arc requires Center-Start-End instead of 3-Point Arc. | `node tests/audits/design-run-audit-1017-part-d.mjs` (`ROW D-05a.no3ptArc`) | `friction` |
| **R2-13** | Part D / `D-10c`, `E-02c` | **FRICTION** | **No Join / Merge / Unbreak command to reunite two collinear segments after Break.** Break already adds `collinear` (`BUG-091`), so Collinear reports `"Sketch geometry over constrained"`, and deleting the break joint deletes both halves; user must Undo or delete + redraw to merge back into one line. | `node tests/audits/design-run-audit-1017-extra.mjs` (`ROW E-02c.rejoinCollinear`) | `friction` |
| **R2-14** | Part C & D / `C-09b`, `D-06b`, `D-10a` | **FRICTION** | **No "Select Other" disambiguation picker for overlapping curves.** When a construction line and solid curve share the same path/intersection, there is no click-and-hold picker (as in Fusion 360 `(unverified)`), forcing endpoint or off-axis workarounds. | `part-c.mjs` (`ROW C-09b.apexHitBug`), `part-d.mjs` (`ROW D-06b.overlapEqualBug`) | `friction` |

---

## PART C — Router Jig Template (mm)

**Design goal:** 120 × 60 mm rectangle centred on origin using **Symmetric** about Y & X (not a center rectangle); inner outline offset **8 mm** via Offset tool; two angled guide lines at **30°** to X mirrored about Y via Mirror tool, each trimmed at the inner outline; a tangent arc joining their top ends; construction centrelines; fully constrained; then edit angle `30° → 45°` and offset `8 → 10` and check whether mirror, offset, trims, and tangency hold; end-of-part Undo/Redo & Save/Reload checks.

**Probe script:** [`tests/audits/design-run-audit-1017-part-c.mjs`](../tests/audits/design-run-audit-1017-part-c.mjs) (run cleanly to exit 0).

### Numbered Step Plan & Results (`C-01` .. `C-14`)

#### Step C-01 — Open fresh SketchStudio (`1280×800`)
1. **What we did:** Opened fresh SketchStudio (`resetBufferLive`, navigated to `/apps/sketchstudio/index.html`, framed viewport `cx=0, cy=0, vw=180` via wheel/pan).
2. **Fusion 360 expectation:** Blank sketch with origin and axes visible `(unverified)`.
3. **SketchStudio result:** `ROW C-01 | fresh open: shapes=0(L:0,A:0,C:0,constr:0) joints=0 dof=0(free:0,full:false) dims=[] tool=tool-select toasts=[]`.
4. **Verdict:** **OK**

#### Step C-02 — Draw vertical & horizontal construction centrelines centred on origin
1. **What we did:** Clicked footer Construction toggle (`#btn-construct-toggle`), clicked Line, drew vertical line `(0, -40)` → `(0, 40)` and horizontal line `(-72, 0)` → `(72, 0)`, toggled Construction off, applied Midpoint of each line to origin `(0, 0)`, dimensioned lengths `80` and `144` via Dim tool.
2. **Fusion 360 expectation:** Construction toggle draws dashed construction lines; Midpoint to `sk.originPoint` locks centreline symmetrically (`docs/FUSION-COMPARISON.md` line 15: origin never moves; `midpoint` 6/6 same); length dims make both lines fully constrained (`docs/FUSION-COMPARISON.md` line 16).
3. **SketchStudio result:** `ROW C-02a | toggle Construction button clicked=true constructionOn=true`; `ROW C-02b | after construction centrelines: constructionOn=false shapes=2(L:2,A:0,C:0,constr:2) joints=4 dof=0(free:0,full:true) dims=["80","144"] tool=tool-select toasts=[]`.
4. **Verdict:** **OK**

#### Step C-03 — Draw 2-Point Rectangle `120 × 60` (off-centre, draw-time `120 Tab 60 Enter`)
1. **What we did:** Clicked 2-Point Rectangle (`#tool-rect`), clicked first corner `(-42, -22)`, moved toward `(50, 25)`, typed `120`, `Tab`, `60`, `Enter`, `Esc`.
2. **Fusion 360 expectation:** 2-Point Rectangle draw-time width/height dual inputs accept `120 Tab 60 Enter`, creating 4 H/V lines with driving `120` and `60` dimensions, 2 translational DOF remaining `(unverified)`.
3. **SketchStudio result:** `ROW C-03 | rect 120x60 draw-time dualBox=true -> solidLines=4 shapes=6(L:6,A:0,C:0,constr:2) joints=12 dof=16(free:8,full:false) dims=["80","144","120","60"] tool=tool-select toasts=[]`.
4. **Verdict:** **OK**

#### Step C-04 — Centre the 120 × 60 rectangle with Symmetric constraint about Y and X centrelines
1. **What we did:** Clicked Symmetric (`#tool-symmetric`), clicked left vertical edge, right vertical edge, and Y construction centreline; tool stayed active, so clicked top horizontal edge, bottom horizontal edge, and X construction centreline; pressed `Esc`.
2. **Fusion 360 expectation:** Symmetry constraint centres the rectangle symmetrically on `(-60..60, -30..30)` (`DOF = 0`, fully constrained), and the Symmetric tool stays active after first application `(unverified; tool-stay matches owner ruling turn 3741)`.
3. **SketchStudio result:** `ROW C-04a | after Symmetric L/R about Y: ... dof=8 ... tool=tool-symmetric toasts=[]`; `ROW C-04b | after Symmetric T/B about X: stayedActive=true ... dof=0(free:0,full:true) ...`; `ROW C-04c | rect coords=[(-60,-30)-(60,-30), (60,-30)-(60,30), (-60,30)-(60,30), (-60,-30)-(-60,30)]`.
4. **Verdict:** **OK**

#### Step C-05 — Inner outline offset `8 mm` with Offset tool
1. **What we did:** Clicked Offset (`#tool-offset`), clicked top edge of outer rectangle (chain picked, `#offset-distance-input` focused with `5`), clicked inside the rectangle at `(0, 0)` to choose inward side, then typed `8` + `Enter`. When that failed to type into the box (`C-05a`), manually clicked `#offset-distance-input`, selected all, typed `8`, pressed `Enter` (`C-05b`).
2. **Fusion 360 expectation:** Clicking to flip/choose side keeps focus ready for typing the offset distance + `Enter` `(unverified)`; committing produces a parametric `8 mm` inward chain (`-52..52 × -22..22`, `104 × 44 mm`, fully constrained) `(unverified)`.
3. **SketchStudio result:**
   - **Focus bug (`R2-06`):** `ROW C-05a.focusBug | focusAfterPick=offset-distance-input focusAfterSideClick={"active":"svgCanvas","boxVal":"5"} boxValAfterTry1=5 offsetStillOpen=true shapesAfterTry1=6`. Screenshot `.evidence/1017/part-c-05a-offset-focus-bug.png` (`md5=1ae5eeac42d80277249dfb8695fb637d`) shows the orange-bordered offset box still showing `5` (unfocused) with the inward preview arrow and green check while typed `8` + `Enter` was swallowed by `#svgCanvas`. Cause: `packages/ui/input-handlers/offset-tool.js:169-174` (`setSide`) never re-focuses `_open.el`.
   - **After re-clicking the box (`C-05b`):** `ROW C-05b | offset 8mm committed: toolAfterCommit=tool-select innerCount=4 shapes=10(L:10,A:0,C:0,constr:2) joints=16 dof=0(free:0,full:true) dims=["80","144","120","60","8"] tool=tool-select toasts=[]`; inner coords `(-52,-22)-(52,-22)-(52,22)-(-52,22)` (`104 × 44 mm`). Screenshot `.evidence/1017/part-c-05b-offset-ok.png` (`md5=a2e1bb66f810cec3d5df64787ad5ead0`).
   - **Esc check (`E-04`, `R2-07`):** `ROW E-04.offsetEsc | beforeEsc=[tool:tool-offset,box:true] after1Esc=[tool:tool-offset,box:false] after2Esc=[tool:tool-select,box:false]` — 1st `Esc` closes the box without exiting `tool-offset` (`packages/ui/input-handlers/offset-tool.js:218, 222`), violating the owner's 1-Esc rule (`BUG-105`, live-verified against Fusion 2026-11-26).
4. **Verdict:** **BUG** (`R2-06`, `R2-07`) — geometry commit after manual focus is **OK**.

#### Step C-06 — Draw right angled guide line and dimension `30°` to X centreline
1. **What we did:** Clicked Line, drew `guideR` from `(8, 6)` extending past inner bottom edge to `(46, 27)`. Clicked Dim (`#tool-dim`), clicked X centreline at `(30, 0)` then `guideR` midpoint, dropped label at `(36, 10)`, typed `30 Enter`, `Esc`.
2. **Fusion 360 expectation:** Angle dimension between X centreline and `guideR` rotates `guideR` cleanly to `30°` (`docs/FUSION-COMPARISON.md` `dim-angle` 18/18 same).
3. **SketchStudio result:** `ROW C-06a | guideR drawn: {"x1":"7.99","y1":"5.99","x2":"46.08","y2":"26.94"}`; `ROW C-06b | angle dim 30: boxOpened=true boxVal=28.8 actualAngle=30deg ... dims=["80","144","120","60","8","30°"] toasts=[]`.
4. **Verdict:** **OK**

#### Step C-07 — Mirror `guideR` about Y centreline using Mirror tool
1. **What we did:** Clicked Mirror (`#tool-mirror`), clicked `guideR` midpoint, clicked green Done check (`.sk-done-btn`) to advance to mirror-line pick, clicked Y centreline at `(0, -34)`.
2. **Fusion 360 expectation:** Creates mirrored `guideL` symmetric to `guideR` about the Y centreline with symmetry constraints on both ends `(unverified)`.
3. **SketchStudio result:** `ROW C-07 | mirror guideR -> guideL={"x1":"-8.21","y1":"5.6","x2":"-45.86","y2":"27.33"} shapes=12 ... toasts=[]`. Screenshot `.evidence/1017/part-c-07-mirror.png` (`md5=a5b10d82655da249a15281c433b40bb2`) shows `◁|▷` symmetric constraint badges on **both** top and bottom endpoint pairs.
4. **Verdict:** **OK**

#### Step C-08 & C-08b — Trim both overhanging tails at inner outline (`y = 22`), then test whether Mirror symmetry survived Trim
1. **What we did:** Clicked Trim (`#tool-trim`), clicked `guideR`'s tail `(42, 25)` and `guideL`'s tail `(-42, 25)` below the inner bottom edge `y = 22`, pressed `Esc`. Then (`C-08b`) double-clicked `30°` and changed it to `45°` to test whether Mirror symmetry survived Trim, captured screenshot, and pressed `Ctrl+Z` to return to `30°`.
2. **Fusion 360 expectation:** Trim cuts each tail at `y = 22`, binds both trimmed endpoints onto the inner bottom line (`BUG-092`), **and preserves Mirror symmetry** so changing `30° → 45°` keeps `guideL` mirrored at `135°` `(unverified)`.
3. **SketchStudio result:**
   - Trim cut cleanly to `y = 22`: `ROW C-08 | after Trim: guideR={"x1":"8.21","y1":"5.6","x2":"36.62","y2":"22"} guideL={"x1":"-8.21","y1":"5.6","x2":"-36.62","y2":"22"}`. Screenshot `.evidence/1017/part-c-08-trim.png` (`md5=95f7f1519930c467a51a123bb7424ab1`) already shows the bottom `◁|▷` symmetric badges **gone**!
   - **Mirror broken by Trim (`R2-03`):** `ROW C-08b.trimBreaksMirror | pre-arc angle->45: angR=45deg angL=142.06deg(expected 135deg) guideR={"x1":"11.04","y1":"2.05","x2":"30.98","y2":"22"} guideL={"x1":"-11.04","y1":"2.05","x2":"-36.62","y2":"22"}`. Screenshot `.evidence/1017/part-c-08b-trim-breaks-mirror.png` (`md5=839e2927e6fa459bf12120e9f44e5a05`) visibly shows `guideR` steepened to `45°` while `guideL` stays shallow at `142.06°` with its bottom end stuck at `(-36.62, 22)`. Cause: `packages/core/trim.js:113-116, 170-172` mints new endpoints and calls `removeGeometry` on the orphaned tail joints, deleting the bottom `symmetric` constraint.
4. **Verdict:** **BUG** (`R2-03`)

#### Step C-09 — Join top ends of `guideL` & `guideR` with a Tangent Arc
1. **What we did:** Clicked Arc (`#tool-arc`), placed center on Y centreline `(0, 19)`, start on `guideL` top `(-8.21, 5.6)`, end on `guideR` top `(8.21, 5.6)`, `Esc`. Clicked Tangent (`#tool-tangent`), first tried clicking the arc's apex at `(0, 3.28)` where it crosses the Y construction centreline (`C-09b.apexHitBug`), then picked the arc off-axis at `(-4.27, 3.87)` + `guideR`, and off-axis + `guideL`.
2. **Fusion 360 expectation:** Clicking the solid arc apex selects the solid arc (or click-and-hold opens Select Other `(unverified)`); Tangent between line and arc (`docs/FUSION-COMPARISON.md` `tangent-line-arc` 16/16 same) makes both joins smooth.
3. **SketchStudio result:**
   - **Apex hit bug (`R2-08`, `R2-14`):** `ROW C-09b.apexHitBug | clicking arc apex at (0, 3.28) over Y centreline: ... tool=tool-tangent toasts=["[warning] ⚠️Tangent takes a line and a circle or arc, or two circles / arcs (not two lines)."]` — clicking directly on the solid arc where it crosses the dashed construction Y centreline silently hit the construction line!
   - Off-axis picks succeeded: `ROW C-09b | tangent arc(offAxis)+guideR: ... toasts=[]`; `ROW C-09c | tangent arc(offAxis)+guideL: stayedActive=true ... toasts=[]`.
4. **Verdict:** **BUG** (`R2-08`) / **FRICTION** (`R2-14`) on apex pick; off-axis Tangent **OK**.

#### Step C-10 — Finish constraining Part C (`R 16` + vertical height `6` to top end)
1. **What we did:** Clicked Dim, picked the arc off-axis and typed `16 Enter` (`R 16`), then picked X centreline `(20, 0)` and `guideR`'s top joint `(8.21, 5.6)` and typed `6 Enter`, `Esc`.
2. **Fusion 360 expectation:** Sketch becomes 100% fully constrained (`DOF = 0`, all solid curves black; `docs/FUSION-COMPARISON.md` line 16).
3. **SketchStudio result:** `ROW C-10 | Part C complete (30deg, off=8): shapes=13(L:12,A:1,C:0,constr:2) joints=23 dof=0(free:0,full:true) dims=["80","144","120","60","8","30°","R 16","6"] tool=tool-select toasts=[]`; `ROW C-10.freeJoints | []`. Screenshot `.evidence/1017/part-c-10-complete-30deg.png` (`md5=9ba6e33a148307e843621f14db764397`) shows the entire router jig template in crisp black (`DOF = 0`).
4. **Verdict:** **OK**

#### Step C-11 — Edit angle `30° → 45°`
1. **What we did:** Double-clicked `30°` label, typed `45 Enter`.
2. **Fusion 360 expectation:** Both guides steepen symmetrically to `45°` / `135°`, tangent arc adjusts cleanly, trimmed ends slide along inner outline `y = 22`, sketch remains `DOF = 0` `(unverified)`.
3. **SketchStudio result:** `ROW C-11b | after angle->45: angR=45 angL=135.01 guideR={"x1":"11.31","y1":"6","x2":"27.31","y2":"22"} guideL={"x1":"-11.31","y1":"6","x2":"-27.32","y2":"22"} ... dof=0(free:0,full:true) dims=["80","144","120","60","8","45°","R 16","6"]`. *(Note: symmetry held here ONLY because step C-09 added a second `tangent(arc, guideL)` constraint — before the arc, `C-08b` proved Mirror itself was broken by Trim!)* Screenshot `.evidence/1017/part-c-11-angle45.png` (`md5=f62890c083a9279826876f057c36ec8c`).
4. **Verdict:** **OK** *(masked `R2-03` once symmetric arc tangency was added)*

#### Step C-12 — Edit offset `8 → 10`
1. **What we did:** Double-clicked `8` offset label, typed `10 Enter`.
2. **Fusion 360 expectation:** Inner offset box shrinks to `(-50..50, -20..20)`, trimmed guide endpoints slide cleanly onto `y = 20`, tangency and `45°` hold, `DOF = 0` `(unverified)`.
3. **SketchStudio result:** `ROW C-12b | after offset->10: guideR={"x1":"11.31","y1":"6","x2":"25.31","y2":"20"} guideL={"x1":"-11.31","y1":"6","x2":"-25.32","y2":"20"} innerBox=[["-50","-20","50","-20"],["50","-20","50","20"],["50","20","-50","20"],["-50","20","-50","-20"]] ... dof=0(free:0,full:true) dims=["80","144","120","60","10","45°","R 16","6"]`. Screenshot `.evidence/1017/part-c-12-offset10.png` (`md5=d0ff8e55f18f33cbeb0044e42a989665`).
4. **Verdict:** **OK**

#### Step C-13 — End-of-part Undo all to empty & Redo all forward
1. **What we did:** Pressed `Ctrl+Z` until `!canUndo` (22 steps), verified empty canvas, then pressed `Ctrl+Y` until `!canRedo` (22 steps), compared full state.
2. **Fusion 360 expectation:** Undo reaches empty sketch; Redo restores every entity, constraint, and dimension identically `(unverified)`.
3. **SketchStudio result:** `ROW C-13 | undoSteps=22 afterUndoAll=[shapes=0,joints=0,dims=0] | redoSteps=22 afterRedoAll=[shapes=13,joints=23,dof=0,dims=["80","144","120","60","10","45°","R 16","6"]] vs before=[shapes=13,joints=23,dof=0,dims=["80","144","120","60","10","45°","R 16","6"]]`. *(Note: Part C had no auto-reference dimension; when an auto-ref dimension IS present, see `E-01` / `R2-02` where Undo+Redo permanently drops it!)*
4. **Verdict:** **OK** *(see `R2-02` for auto-reference dimension Undo/Redo failure)*

#### Step C-14 — Save (`Ctrl+S`), Reload page, and Reopen
1. **What we did:** Pressed `Ctrl+S`, typed `PartC-RouterJig` in the Save dialog, clicked Save, navigated/reloaded the page (`cdp.navigate`), verified restored document name, ID, shapes, constraints, dimensions, construction flags, and DOF.
2. **Fusion 360 expectation:** Save + reopen restores all geometry, constraints, dimensions, and construction flags identically `(unverified)`.
3. **SketchStudio result:** `ROW C-14b | after reload: name=PartC-RouterJig id=drive:fakeid-2 (before=PartC-RouterJig/drive:fakeid-2) shapes=13(L:12,A:1,C:0,constr:2) joints=23 dof=0(free:0,full:true) dims=["80","144","120","60","10","45°","R 16","6"] tool=tool-select toasts=[]`. Every constraint (`offset`, `angle`, `symmetric`, `tangent`, `midpoint`, `pointOnLine`, `distance`) restored cleanly (`ROW C-14c`).
4. **Verdict:** **OK**

---

## PART D — Frame Gusset / Triangle (mm)

**Design goal:** Right triangle with legs **150** (named `leg`) and **100** (`= leg * 2/3` typed as a formula in the draw-time box), hypotenuse with an **angle dimension** rather than length; **3-point arc relief** at the right-angle corner; **three Ø 5 holes** along the hypotenuse with equal spacing, **15 mm from each end** (Equal + Midpoint/Coincident on a construction line); then change `leg` in the Parameters window (`150 → 180`), flip one dimension to Reference and back, lock the triangle and try to drag it, unlock it, Break the hypotenuse at one hole and re-join it; end-of-part Undo/Redo & Save/Reload checks.

**Probe scripts:** [`tests/audits/design-run-audit-1017-part-d.mjs`](../tests/audits/design-run-audit-1017-part-d.mjs) + [`tests/audits/design-run-audit-1017-extra.mjs`](../tests/audits/design-run-audit-1017-extra.mjs) (both ran cleanly to exit 0).

### Numbered Step Plan & Results (`D-01` .. `D-12` + `E-01` .. `E-04`)

#### Step D-01 — Open fresh SketchStudio (`1280×800`)
1. **What we did:** Opened fresh SketchStudio framed at `cx=45, cy=-50, vw=310` (clear of the top-left `SKETCHES` card).
2. **Fusion 360 expectation:** Blank sketch `(unverified)`.
3. **SketchStudio result:** `ROW D-01 | fresh open: shapes=0(L:0,A:0,C:0,constr:0) joints=0 dof=0(free:0,blue:0,full:false) dims=[] tool=tool-select toasts=[]`.
4. **Verdict:** **OK**

#### Step D-02 & D-03 — Draw horizontal leg `leg = 150` and vertical leg `leg * 2/3` using draw-time box
1. **What we did:** Clicked Line, clicked origin `(0, 0)`, moved horizontally to `(130, 0)` (horizontal inference active), typed `leg = 150` + `Enter`, `Esc`. Then clicked Line, clicked origin `(0, 0)`, moved vertically to `(0, -90)` (vertical inference active), typed `leg * 2/3` + `Enter`, `Esc`. When both legs remained unconstrained in angle (`dof = 2`), manually clicked H/V (`#tool-hv`) on both legs (`D-03b`).
2. **Fusion 360 expectation:** Typing a length/formula in the draw-time box while moving horizontally/vertically **keeps** the inferred Horizontal/Vertical constraint so both legs are immediately fully constrained (`DOF = 0`), with `leg = 150` and `fx: 100` (`leg * 2/3`) created `(unverified)`.
3. **SketchStudio result:**
   - Naming & formula parsing worked (`BUG-180` held): `dims=["150","fx: 100"]`, `leg1 len=150`, `leg2 len=100`.
   - **H/V inference dropped (`R2-04`):** `ROW D-02 | draw-time "leg = 150": ... dof=1(free:1,...)`; `ROW D-03a.drawTimeNoHV | draw-time "leg * 2/3": leg2={"x1":"0","y1":"0","x2":"0","y2":"-100","len":"100"} ... dof=2(free:2,...) dims=["150","fx: 100"]`. Both lines were left free to rotate around origin because `packages/ui/input-handlers/line-tool.js:56` wipes `activeInference` whenever `hasLock()` is true, even when only `lockedLength` is locked (`lockedAngle === null`).
   - Manual H/V fixed it: `ROW D-03b.afterManualHV | dof=0(free:0,blue:0,full:true)`.
4. **Verdict:** **BUG** (`R2-04`) on dropped H/V inference; draw-time `leg = 150` & `leg * 2/3` formula creation **OK**.

#### Step D-04 — Draw hypotenuse and add an angle dimension (and test driving angle in `E-03`)
1. **What we did:** Clicked Line, connected `(150, 0)` → `(0, -100)`, `Esc`. Clicked Dim, picked horizontal leg then hypotenuse, placed angle dimension at `(112, -14)`. Also in `E-03`, flipped the `100` leg to Reference, promoted `(33.7°)` to Driving, and edited it to `40°`.
2. **Fusion 360 expectation:** With both legs already driving (`150`, `100`), an angle dimension is redundant (Fusion prompts/creates driven; SketchStudio auto-creates Reference per `BUG-126`). Once `100` is flipped to Reference, promoting `(33.7°)` to Driving and editing to `40°` drives the hypotenuse angle cleanly `(unverified; BUG-122/126)`.
3. **SketchStudio result:**
   - `ROW D-04b | hypotenuse angle dim: boxOpenedOnDrop=false ... dof=0(free:0,blue:0,full:true) dims=["150","fx: 100","(33.7°)"] toasts=[]` — cleanly auto-born Reference `(33.7°)` (`BUG-126` held!). Screenshot `.evidence/1017/part-d-04-triangle.png` (`md5=8f7dbb00073b8904a02ee5a84edcf8e9`).
   - `ROW E-03.refFormatAndAngDrive | ... promotedAng="33.7°" afterEdit40=["150","(125.865)","40°","R (15)"] dof=0 toasts=[]` — promoting and editing angle to `40°` drove the vertical leg to `150 * tan(40°) = 125.865 mm` with `DOF = 0`!
4. **Verdict:** **OK**

#### Step D-05 — 3-Point Arc relief at the right-angle corner & trim corner stubs
1. **What we did:** Checked ribbon `#tool-arc` for a 3-Point Arc variant (`D-05a`). Drew `R 15` relief arc via Center-Start-End Arc centered at origin `(0, 0)` from `(15, 0)` to `(0, -15)`, dimensioned `R 15` (`D-05b`). Clicked Trim (`#tool-trim`) on the 15 mm horizontal stub `(6, 0)` and vertical stub `(0, -6)` (`D-05c`), then `Ctrl+Z` twice to recover (`D-05e`).
2. **Fusion 360 expectation:** 3-Point Arc tool available in Create → Arc `(unverified)`. Trimming the 15 mm stubs between `(0,0)` and the arc endpoints cuts ONLY the 15 mm stubs and preserves the remaining 135 mm and 85 mm legs `(unverified)`.
3. **SketchStudio result:**
   - **No 3-Point Arc (`R2-12`):** `ROW D-05a.no3ptArc | {"hasArcBtn":true,"hasVariantCaret":false,"allArcBtns":[{"id":"tool-arc","text":"Arc","title":"Arc (A)"}]}` — only Center-Start-End Arc exists.
   - **Trim at Arc deletes ENTIRE legs (`R2-01`):** `ROW D-05b.arcBeforeTrim | ... shapes=4(L:3,A:1,C:0) dof=0 dims=["150","fx: 100","(33.7°)","R 15"]` → `ROW D-05c.trimDeletesWholeLegs | shapes=2(L:1,A:1,C:0) joints=5 dof=10(free:5) dims=["R 15"]`. Screenshot `.evidence/1017/part-d-05-relief-trim-bug.png` (`md5=55777b3ddbb96507f4a59caed1b5c916`) shows BOTH triangle legs and all three dimensions (`leg = 150`, `fx: 100`, `(33.7°)`) completely wiped out, leaving only the floating blue hypotenuse and the `R 15` arc! Cause: `packages/core/trim.js:57` skips all non-line cutters (`other.type !== 'line'`).
   - `Ctrl+Z` × 2 recovered cleanly (`ROW D-05e.undoCornerTrim`).
4. **Verdict:** **BUG** (`R2-01`) + **DIVERGENCE** (`R2-12`)

#### Step D-06 — Three Ø 5 holes along hypotenuse: equal spacing, 15 mm from each end
1. **What we did:** Toggled Construction on, drew 3 collinear construction segments along the hypotenuse (`(150,0) → H1 → H3 → (0,-100)`), toggled Construction off (`D-06a`). Dimensioned end segment `seg1 = 15`, then tried `Equal(seg1, seg3)` (`D-06b`). Workaround: dimensioned `seg3` endpoints `= 15`. Drew 3 circles: `C1` at `H1` with draw-time diameter `5`, `C2` at hypotenuse midpoint `H2 (75, -50)`, `C3` at `H3` (`D-06c`). Tried `Equal(C1, C2)` at overview zoom `vw ~ 310` (`D-06c.smallCircleRimBug`), then zoomed in (`vw = 130`) to apply `Equal(C1, C2)` and `Equal(C2, C3)` (`D-06d`).
2. **Fusion 360 expectation:** Circle draw-time `5` creates Diameter `Ø 5` (`BUG-140`, Fusion `SketchDiameterDimension`). Equal on circles sets equal diameter (`docs/FUSION-COMPARISON.md` `equal-circle-circle` 14/14 same) and clicking a small circle's rim in Equal picks the circle rim, not its center point `(unverified)`. Click-and-hold "Select Other" picks overlapping construction segments `(unverified)`.
3. **SketchStudio result:**
   - **Overlapping construction line hit-test bug (`R2-08`, `R2-14`):** `ROW D-06b.overlapEqualBug | ... toasts=["[warning] ⚠️Pick a second curve, a different one."]` — clicking `seg1` and `seg3` midpoints hit the underlying solid hypotenuse BOTH times!
   - **Small-circle rim pick stolen by center joint (`R2-09`, related to open `BUG-136`):** `ROW D-06c.smallCircleRimBug | at vw~310 Equal(C1 r=2.5, C2): C2.r=4.92 (expected 2.5) toasts=[]` — at overview zoom (`r = 2.5 mm ≈ 10 px < 15 px`), `JOINT_PRIORITY_RADIUS = 15` (`packages/ui/snap-detection.js:187`) gave the rim click to `C1`'s center point, so Equal ignored it silently! Zooming in (`vw = 130`) allowed `Equal(C1, C2)` (`C2` became `Ø 5` and black); `C3` still failed to pick `C2`'s bottom rim past `C2`'s midpoint glyph (`d = 9.98`, blue in `.evidence/1017/part-d-06-holes.png`, `md5=a1d5b11426ca576f62e4bcf02b00650b`).
4. **Verdict:** **BUG** (`R2-08`, `R2-09`) + **FRICTION** (`R2-14`)

#### Step D-07 — Change `leg` in the Parameters window (`150 → 180`)
1. **What we did:** Clicked `#btn-parameters` (`fx`), inspected all rows (`D-07a`), clicked the Expression `<input>` on the `leg` row, selected all, typed `180 Enter` (`D-07b`..`D-07d`).
2. **Fusion 360 expectation:** Parameters table displays `leg`, `d1 = leg * 2 / 3`, and reference `d2` cleanly; editing `leg` to `180` updates `d1` to `120` (`fx: 120`), preserves `15 mm` hole end offsets and midpoint `H2 (90, -60)` `(unverified)`.
3. **SketchStudio result:**
   - **Parametric update worked cleanly:** `ROW D-07c.afterParamEdit | leg1Len=180 leg2Len=120 holes=[{"cx":"167.52","cy":"-8.32","d":"5"},{"cx":"90","cy":"-60","d":"5"},{"cx":"12.48","cy":"-111.68","d":"9.98"}] ... dims=["180","fx: 120","(33.7°)","R 15","15","15","Ø 5"]`. Both end holes stayed exactly `15 mm` from their vertices (`hypot(180-167.52, 8.32) = 15.00`, `hypot(12.48, 120-111.68) = 15.00`) and `H2` stayed at exact midpoint `(90, -60)`! Screenshot `.evidence/1017/part-d-07c-after-param-180.png` (`md5=4cf809250ba1fc6a439b3675dfa2c658`).
   - **Squished `ref` badge bug (`R2-10`):** `ROW D-07a.paramsOpen | ... refBadge:{"text":"ref(reference)...","w":427,"h":44}`. Screenshot `.evidence/1017/part-d-07a-params-window.png` (`md5=8f19a6b6c2f366008883d9793b06b06e`) clearly shows the `ref` badge next to `d2` crushed onto 3 vertical single-letter lines (`r` / `e` / `f`). Cause: `packages/ui/parameter-table.js:248` omits `flex: 0 0 auto; white-space: nowrap;`.
4. **Verdict:** **BUG** (`R2-10`) on Parameters table UI; parametric recalculation **OK**.

#### Step D-08 — Flip one dimension to Reference and back (and `E-03` on Radius)
1. **What we did:** Right-clicked `leg` (`180`) → `Make Reference (Driven)` (`D-08a`, testing O9 dependency refusal); then right-clicked `Ø 5` → `Make Reference (Driven)` → right-clicked again → `Make Driving` (`D-08b`). In `E-03`, also flipped `R 15` → Reference.
2. **Fusion 360 expectation:** Refusing to make `leg` driven while `d1` references `leg` prevents broken formulas `(unverified)`. Flipping `Ø 5` / `R 15` to Reference formats as `(Ø 5)` / `(R 15)` `(unverified)` and flips cleanly back to Driving `Ø 5` (`BUG-120..123`).
3. **SketchStudio result:**
   - O9 refusal worked cleanly: `ROW D-08a.flipLegO9 | toasts=[{"level":"warning","text":"⚠️Cannot make this a reference dimension: leg is used by d1."}]`.
   - Toggle worked cleanly, **BUT format bug (`R2-11`)**: `ROW D-08b.flipRefAndBack | orig="Ø 5" -> ref="Ø (5)" -> back="Ø 5" toasts=[]`; `ROW E-03.refFormatAndAngDrive | R15_as_ref="R (15)"`. Cause: `packages/ui/svg-renderer.js:73-80` wraps `lenStr` in `(...)` before prepending `'Ø '` / `'R '`.
4. **Verdict:** **BUG** (`R2-11`) on `Ø (5)` / `R (15)` label format; O9 refusal & toggle behavior **OK**.

#### Step D-09 — Lock the triangle, try to drag it, and unlock it
1. **What we did:** Selected all 3 triangle sides (Shift+click), pressed `F` (Lock), dragged right vertex `(180, 0)` toward `(205, 20)`, re-selected all 3 sides, pressed `F` (Unlock).
2. **Fusion 360 expectation:** Lock fixes all triangle endpoints so dragging moves nothing (`0 mm`); Unlock releases them (`BUG-123`, `BUG-160`).
3. **SketchStudio result:** `ROW D-09.lockDragUnlock | fixedLocked=3 lockedDragMove=0 fixedUnlocked=0 toasts=[]`.
4. **Verdict:** **OK**

#### Step D-10 & E-02 — Break the hypotenuse at one hole (`H2`) and re-join it
1. **What we did:** In Part D (`D-10a`), clicked Break (`#tool-break`) at middle hole `H2 (90, -60)` and tried Collinear on the two halves (`D-10c`). In `E-02` (clean triangle with NO overlapping construction line), clicked Break at `H2 (75, -50)`, tried dragging the break joint perpendicular by `(+15, -20)`, undid drag, and tried Collinear to re-join (`E-02a..c`).
2. **Fusion 360 expectation:** Break splits the solid hypotenuse cleanly at `H2`'s center (or snaps to the existing point on the line) `(unverified)`.
3. **SketchStudio result:**
   - **Break does not snap to `H2` (`R2-05`):**
     - `ROW D-10a.afterBreak | midHole={"cx":"90","cy":"-60"} solidLines:3->4 diagHalves=[{"x1":"180","y1":"0","x2":"89.97","y2":"-60.02","len":"108.2"},{"id":"Lbrk_j19_...","x1":"89.97","y1":"-60.02","x2":"0","y2":"-120","len":"108.13"}] dof=1`. Screenshot `.evidence/1017/part-d-10a-break.png` (`md5=5abafdfafa1ec149ff3403ddc12f993c`).
     - `ROW E-02a.breakSolidHyp | before=[L:3,dof:0] -> after=[L:4,dof:1,profiles:1] diagHalves=[{"x1":"150","y1":"0","x2":"74.94","y2":"-50.04"},{"id":"Lbrk_j14_...","x1":"74.94","y1":"-50.04","x2":"0","y2":"-100"}]` (`.evidence/1017/extra-e02-break-solid-hyp.png`, `md5=5a7026ff3ec6ac475196b6a654d3e13d`).
     - `ROW E-02b.dragAfterBreak | dof=1 diagAfterDrag=[{"x1":"150","y1":"0","x2":"76.09","y2":"-49.27"},{"x1":"76.09","y1":"-49.27","x2":"0","y2":"-100"}] circle=[{"cx":"75","cy":"-50"}]` — dragging the break joint slid it off the hole center while the hole stayed at `(75, -50)` (`.evidence/1017/extra-e02b-drag-after-break.png`, `md5=dcd50057d898f10f3c549dceda70cd1a`). Cause: `packages/ui/input-handlers/break-tool.js:63, 78-100` projects raw pointer without snapping to existing joints, and `packages/core/break.js:58-59` unconditionally mints `state.genJ()`.
   - **Overlapping construction line hijack (`R2-08`):** `ROW D-10c.afterRejoin | ... toasts=["[warning] ⚠️Pick a second line, a different one."]` — clicking both broken hypotenuse halves in Collinear hit the overlapping middle construction line twice! (And in run `task-613`, Break at `(90, -60)` split the construction line instead of the solid hypotenuse: `solidLines:3->3, constr: 3->4`.)
   - **No Join / Merge command (`R2-13`):** `ROW E-02c.rejoinCollinear | dof=1 toasts=[{"level":"warning","text":"⚠️Sketch geometry over constrained"}]` — Break already added `collinear` (`BUG-091`), and there is no Merge/Join tool to combine the two halves back into a single line.
4. **Verdict:** **BUG** (`R2-05`, `R2-08`) + **FRICTION** (`R2-13`)

#### Step D-11 & E-01 — End-of-part Undo all to empty & Redo all forward (+ isolated auto-ref Undo/Redo check)
1. **What we did:** In Part D (`D-11`), pressed `Ctrl+Z` until `!canUndo` (24 steps) and `Ctrl+Y` until `!canRedo` (24 steps). In `E-01`, placed a driving dim `80` and a 2nd auto-ref dim `(80)` on the same line, then tested both full Undo-all/Redo-all (`E-01a`) and a single `Ctrl+Z` + `Ctrl+Y` (`E-01b`).
2. **Fusion 360 expectation:** Undo back to empty and Redo forward restore every shape, dimension (including auto-reference dimensions), name, formula, and constraint `(unverified)`.
3. **SketchStudio result:**
   - Part D full Undo/Redo (`D-11`): `ROW D-11.undoRedo | undoSteps=24 afterUndoAll=[shapes=0,joints=0,dims=0] | redoSteps=24 afterRedoAll=[shapes=11,joints=15,dof=1,dims=["180","fx: 120","(33.7°)","R 15","15","15","Ø 5"]] vs before=[shapes=11,joints=15,dof=1,dims=["180","fx: 120","(33.7°)","R 15","15","15","Ø 5"]]` — **OK** (here `(33.7°)` was an angle dim on distinct geometry, not a duplicate distance on the same edge).
   - **Auto-ref Undo/Redo data loss (`R2-02`):**
     - `ROW E-01a.autoRefUndoRedo | afterPlace=["80","(80)"] beforeUndo=["80","(80)"] undo=4(shapes=0,dims=0) redo=4 afterRedo=["80"]`
     - `ROW E-01b.singleUndoAutoRef | before=["80","(80)"] after1Undo=["80"] after1Redo=["80"] shapesAfterUndo=2 shapesBefore=2`
     - Cause: `packages/core/sketch-state.js:123` (`_restoreSnapshot`) calls `addConstraintObject(this, proto)` → `hasConstraint`, which ignores `isDriven` and silently drops `(80)` as a duplicate of `80`!
4. **Verdict:** **BUG** (`R2-02`) on auto-reference dim Undo/Redo; Part D `D-11` Undo/Redo **OK**.

#### Step D-12 — Save (`Ctrl+S`), Reload page, and Reopen
1. **What we did:** Saved as `PartD-Gusset` via `Ctrl+S`, reloaded page, inspected restored state and buffer JSON (`D-12a`, `D-12b`).
2. **Fusion 360 expectation:** Save + reopen restores all geometry, dims, names (`leg`), formulas (`leg * 2 / 3`), reference flags, diameter flags, constraints, and construction flags identically `(unverified)`.
3. **SketchStudio result:**
   - `ROW D-12a.reload | name=PartD-Gusset id=drive:fakeid-2 (before=PartD-Gusset/drive:fakeid-2) shapes=11(L:7,A:1,C:3,constr:3) joints=15 dof=1(free:1,blue:0,full:false) dims=["180","fx: 120","(33.7°)","R 15","15","15","Ø 5"] tool=tool-select toasts=[]`
   - `ROW D-12b.reloadedDims | [{"name":"leg","type":"distance","val":180,"driven":false,"isDia":false},{"name":"d1","type":"distance","val":120,"expr":"leg * 2 / 3","driven":false,"isDia":false},{"name":"d2","type":"angle","val":146.30993247402023,"driven":true,"isDia":false},{"name":"d3","type":"distance","val":15,"driven":false,"isDia":false},{"name":"d4","type":"distance","val":15,"driven":false,"isDia":false},{"name":"d5","type":"distance","val":15,"driven":false,"isDia":false},{"name":"d6","type":"distance","val":5,"driven":false,"isDia":true}]`
4. **Verdict:** **OK**

---

## End-of-Part Checks Summary

| Check | Part C (Router Jig) | Part D (Frame Gusset) |
|---|---|---|
| **Fully constrained where expected** | **PASS** (`DOF = 0`, 0 free joints, all solid black at `C-10`, `C-11`, `C-12`) | **PARTIAL** — triangle + arc + `C1`/`C2` reached `DOF = 0` (`D-04`, `D-05b`, `D-07c`), but `R2-04` (draw-time dropped H/V), `R2-08` (overlapping construction lines), and `R2-09` (small `Ø 5` circle rim blocked by `JOINT_PRIORITY_RADIUS = 15`, leaving `C3` blue) impeded reaching full constraint cleanly. |
| **Parametric edits hold** | **PARTIAL** — Angle `30°→45°` & Offset `8→10` held AFTER adding tangent arc (`C-11`, `C-12`), **FAIL** before arc because Trim broke Mirror symmetry (`R2-03`, `C-08b`). | **PASS** — Editing `leg: 150 → 180` in Parameters window updated `d1 = leg * 2/3` to `120` and preserved all 3 hole positions (`15 mm` from ends + midpoint `(90, -60)`). |
| **Undo all → empty & Redo all → full** | **PASS** (`22` undo → `0`, `22` redo → identical `13` shapes, `DOF=0`, all 8 dims). | **PASS** on Part D (`24` undo → `0`, `24` redo → identical), **FAIL** (`R2-02`) whenever an auto-reference dim shares an already-dimensioned edge (`E-01a/b`). |
| **Save, reload & reopen** | **PASS** (`PartC-RouterJig`, all 13 shapes, 2 construction, 8 dims, all constraints, `DOF=0`). | **PASS** (`PartD-Gusset`, all 11 shapes, 3 construction, `leg`, `d1 = leg * 2 / 3`, `(33.7°)`, `Ø 5`, `R 15`). |

---

## Cross-Reference (Prior `BUG-ARCHIVE.md` & Audit IDs)

- **Open bug related to `R2-09`:** `BUG-136` (`B-20c`, `packages/ui/snap-detection.js:187` `JOINT_PRIORITY_RADIUS = 15`, currently `open`). `R2-09` exposes a desktop curve-only consequence: in curve-only tools (`Equal`), a circle's own center joint should never steal clicks on its rim.
- **Verified FIXED (0 regressions):**
  - `BUG-091` (Break preserves collinear + orientation constraints) — verified in `E-02a/c`.
  - `BUG-092` (Trim binds trimmed end to cutting line) — verified in `C-08`, `C-12`. *(New gaps: `R2-01` arc cutters ignored; `R2-03` mirror `symmetric` dropped.)*
  - `BUG-093` (Trim/Break on arc/circle target refusal) — separate from `R2-01` (arc as cutter of a line).
  - `BUG-105` (1-Esc rule, Fusion verified 2026-11-26) — Dimension tool OK; Offset tool violates it (`R2-07`, new).
  - `BUG-110..115` (Constraint tools stay active after use/refusal) — verified in `C-04b`, `C-09c`.
  - `BUG-120..126` (Driving↔Reference, Lock undo, redundant angle auto-Reference) — verified in `D-04b`, `D-08b`, `D-09`, `E-03`.
  - `BUG-140` (Circle gets Diameter `Ø`, Arc gets Radius `R`) — verified in `D-06c`, `D-08b`. *(New format bug on Reference: `R2-11`.)*
  - `BUG-180` (Draw-time `name = value` & formulas) — verified in `D-02`, `D-03a`. *(New pre-existing gap: `R2-04` H/V inference cleared by `line-tool.js:56`.)*

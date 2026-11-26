# Solver UI/UX Audit — Round 2 Cross-Examination (TASK 1000 vs 1000B)

> **Audit / Cross-examination only — no app code or existing tests changed.**
> Base: `agents/solveraudit-1000` merged with `origin/main` at `3a88641c` (includes task 1001 merge `9b1eb8e4`).
> Independent cross-probe: `node tests/audits/solver-ux-cross-1000.mjs` (outside `scripts/gate.cjs`; run **3/3**, exit 0).
> Yardstick update (owner ruling turn 3741, confirmed): **a constraint tool (Coincident, Parallel, H/V, Equal, Midpoint, Tangent, …) stays active after each use; ONLY `Esc` or picking another tool exits; re-clicking the same tool's button does NOT exit. Any finding where a constraint tool exits by itself (after a use, after a refusal, or on a second ribbon click) is a BUG.**

---

## 1. Re-Check of Our Findings Touched by `origin/main` (Task 1001, `9b1eb8e4`)

Task 1001 removed raw `[ERR-*]` / `Reason:` / `Args:` strings from user toasts, muted normal reference-dimension popups, and unified Equal's invalid-pair refusal (`EQUAL_SELECTION_REFUSAL`). Fresh checks after merging `origin/main` (`3a88641c`):

| Our ID | Status on `origin/main` (`9b1eb8e4`) | Verbatim Evidence |
|---|---|---|
| **UX-19** | **FIXED-ON-MAIN** | `git grep -n "\[ERR-" packages/ apps/` returns **0** `notify`/`showNotification` lines (only `dbg.warn`/`dbg.log`/internal `drivenReason` in `constraint-manager.js:269,274-275,301,306-307`). `ROW MAIN1001.notices \| angle45-on-HV=[]; sym-same-pt=["[error] Copy⚠️Symmetric rejected — the two entities are the same point"]; redundant-dist=[]`. |
| **UX-16** | **PARTIALLY FIXED-ON-MAIN** (toast fixed; silent un-undoable demotion STILL LIVE) | `ROW MAIN1001.UX16 \| dblclick fixed-end driving dim: opened=false, toasts=[], nowDriven=true, hist 0->0`. Task 1001 moved `[ERR-DRIVEN-02]` to `logDiagnostic` (`numeric-input-manager.js:478`), removing the misleading `"Dimension added as Driven ... [ERR-DRIVEN-02]"` toast — but double-clicking an existing fixed-end driving dimension still silently mutates `isDriven = true` with zero undo step. |
| **UX-14** | **PARTIALLY FIXED-ON-MAIN** (raw `[ERR-EQUAL-01]` JSON fixed; ribbon vs key asymmetry STILL LIVE) | `ROW MAIN1001.UX14 \| L1+C1 press E toasts=["[warning] ⚠️Equal needs two lines, or two circles or arcs."]; click Equal ribbon toasts=[]`. `E` key now uses `EQUAL_SELECTION_REFUSAL` cleanly, but still differs from the Equal ribbon button (which drops 2-item preselections silently on both valid `L1+L2` and invalid `L1+C1`). |
| **UX-15** | **STILL LIVE — direction confirmed by turn 3741** | Under owner ruling turn 3741, **Shaper / Pen Plotter** (`switchToTool`, `input-manager.js:1566-1585`) are the **correct** behaviour (stay in tool after H/V preselection; 2nd ribbon click does NOT exit), while **SketchStudio** (`apps/sketchstudio/ui/ui-manager.js:70,90-94`) is the **BUG** (exits to `select` after H/V preselect AND exits to `select` on 2nd click of the same constraint button). |
| **UX-01..13, UX-17, UX-18, UX-20..29** | **STILL LIVE** (untouched by `9b1eb8e4`) | *(Note on **UX-13**: `packages/core/reference-lines.js:37-40` intentionally restricts built-in axes to the Dimension tool's second pick per task 555, so `AxisX -> Line` vs `Line -> AxisX` may be a deliberate **DIVERGENCE** rather than an accidental bug — flagged for owner decision.)* |

---

## 2. Cross-Examination of Auditor B's Findings (`B-1` .. `B-20`) & Divergences

Every verdict below is backed by fresh reproduction (`node tests/audits/solver-ux-cross-1000.mjs`, **3/3**) or direct code inspection on merged `origin/main` (`3a88641c`).

| B-id | Verdict | Evidence (our own run / code on `3a88641c`, N/N) | Maps-to UX-id |
|---|---|---|---|
| **B-1** | **DUPLICATE** (agree 100%) | Already reproduced 2/2 (`IR2.1.C1`: `lockState={"has":true,"locked":true}, C1:free, rimDrag r:20->40.026`). Both audits identify identical cause (`toggleFixedSelection` fixes only `s.joints`, leaving `circle.radius` free). | **UX-06** |
| **B-2** | **DUPLICATE** (agree 100%) | Already reproduced 2/2 (`D9.1`: `d1.value=50, b=(50,40), max move 20`; `D9.2`: `d1.value=50, b=(30,50), max move 10`). Exact same 1-place cause (`dimension-seams.js:361-365`). | **UX-01** |
| **B-3** | **CONFIRM** (3/3) | `ROW XB-3a \| line-line ref (born 20, moved to y=55) toggleDriving: res={"nowDriving":true,"refused":false,"error":null}, val=20, yAfter=20`<br>`ROW XB-3b \| point-to-axis ref (born 25, moved to y=60) toggleDriving: res={"nowDriving":true,"refused":false,"error":null}, val=25, yAfter=25`. Genuine wrong-geometry bug in `dimension-seams.js:349-387` (`state.joints.get` misses `j_ref_x`, and no line-line re-measure branch). | *(new — missed by 1000)* |
| **B-4** | **DUPLICATE** (agree 100%) | Already reproduced 2/2 (`D9.3b` `toggleDriving` hist `1->1`; `IR2.1.L1` / `IR2.1.undo` Lock `F` hist `0->0`). Both agree completely. | **UX-08** |
| **B-5** | **DUPLICATE** (agree 100%) | Already reproduced 2/2 (`C2.1`: `shapes 1->1, constraints 2->1 (d1 still present: false)`). Exact same 1-place bug (`delete-manager.js:183-187`). | **UX-07** |
| **B-6** | **CONFIRM** (3/3; **also BUG under turn 3741**) | `ROW XB-6a \| preselect joint p -> click Parallel -> click L1: parallel=[["p","L1"]], toasts=[]` (corrupt joint ID in `shapes[0]`!)<br>`ROW XB-6b \| preselect circle C1 -> click H/V -> click L1: tool=select, hvCount=0, toasts=["[warning] ⚠️Horizontal / Vertical takes a line, or two points: pick the second point (not a line)."]` (**exits to `select` on refusal — BUG under turn 3741**). | *(new — missed by 1000)* |
| **B-7** | **CONFIRM** (2/2 across all 3 hosts) | `ROW XB-7.sketchstudio \| mid={"n":1,"placing":true} -> switchToLine={"tool":"line","n":1,"placing":true,"flags":[true]}`<br>`ROW XB-7.shaper \| mid={"n":1,"placing":true} -> switchToLine={"tool":"line","n":1,"placing":true,"flags":[true]}`<br>`ROW XB-7.penplotter \| mid={"n":1,"placing":true} -> switchToLine={"tool":"line","n":1,"placing":true,"flags":[true]}`. Furthermore, `dimension-tool.js` module-level `dimensionState.placingConstraint` even leaked across designs until `Esc` reset it. | *(new — missed by 1000)* |
| **B-8** | **CONFIRM** (3/3) | `ROW XB-8a \| circle click snapped to b(40,0) -> move -> type "30"+Enter: created=true, r=15, coincidentOnCenter=0` (center snap dropped!)<br>`ROW XB-8b \| circle click-1 NO move -> type "30"+Enter: created=false, stillActive=true` (Enter does nothing without prior mouse move!). | *(new — missed by 1000)* |
| **B-9** | **CONFIRM** (angle born driving, 2/2) + **DUPLICATE** (`UX-16`, partial **FIXED-ON-MAIN** on toast) | `ROW XB-9 \| angle=90 on H+V lines: created=true, isDriven=false, isDetermined=true, toasts=[]` (`constraint-manager.js:246` checks `DISTANCE` only, omitting `ANGLE`). Double-click auto-demote without undo = `UX-16` (`MAIN1001.UX16`: `toasts=[], nowDriven=true, hist 0->0` — the `[ERR-DRIVEN-02]` toast B saw is now **FIXED-ON-MAIN** by `9b1eb8e4`, leaving the demotion silent). | **UX-16** (partial) + new angle part |
| **B-10** | **CONFIRM** (3/3; **Arc exit also BUG under turn 3741**) | `ROW XB-10 \| Line own-end={"tool":"midpoint","bufLen":2,"toasts":[]} -> nextValidPt={"bufLen":3,"midpoints":0,"toasts":[]}; Arc own-end={"tool":"select","bufLen":1,"toasts":["[warning] ⚠️Midpoint of an arc: pick a point that is not the arc's own centre or end."]}`. Line permanently wedges silently; Arc warns **but exits to `select` on refusal (BUG under turn 3741)**! | *(new — missed by 1000)* |
| **B-11** | **CONFIRM** (3/3) | `ROW XB-11 \| Coincident own-end: lineOwn={"pol":0,"toasts":["[overconstrained] Sketch geometry over constrained"]}, arcOwn={"pol":1,"toasts":[]}, circOwn={"pol":1,"toasts":["[overconstrained] Sketch geometry over constrained"]}`. Arc silently creates a bogus `pointOnLine` on its own endpoint (`constraint-tools.js:152`). | *(new — missed by 1000)* |
| **B-12a** | **CONFIRM** (3/3) | `ROW XB-12a \| free-R fillet drag rightTop left -45: arcC=(22.986, 10), arcS=(22.986, 17.986), arcE=(15, 10), vSharp=(15, 17.986), r=7.986, flippedOutside=true`. Matches B's `6d` to 3 decimals (complements our `UX-05` fixed-R fillet dragged past 180°). | related to **UX-05** |
| **B-12b** | **CONFIRM** (3/3) | `ROW XB-12b \| 10-deg arc 10-step solver drag past start: spanBefore=10deg -> spanAfter=350.56deg (wrapped>330=true)` (known `EA-4`; distinct from our `UX-03` where UI drag-snap glues `e` to `s` with `coincident:e,s`). | related to **UX-03** |
| **B-12c** | **DUPLICATE** (classification differs: B=BUG, 1000=DIVERGENCE) | Same observation: Bezier control points `c1`/`c2` stay frozen when endpoints move (`mirror.js:30` explicitly declares this an MVP limit). Agree on facts; owner decides BUG vs DIVERGENCE. | **DIV-04** |
| **B-12d** | **DUPLICATE** (agree 100%) | Already reproduced 2/2 (`DR4.3b`: `ML m1 (0,-50)->(8.135,-49.643), m2 (0,50)->(-0.403,49.995)`). Both agree completely. | **UX-10** |
| **B-12e** | **DUPLICATE** (known open `NEW-11`; 0/2 by B) | Same root cause noted in our `UX-05` (`fillet.js:522` leaves `arc.sweep = undefined`, flipping arc midpoint near 180°). B did not reproduce it (`6j` only reached 118.86°). | **UX-05** |
| **B-13** | **CONFIRM** (circle part, 2/2) + **DUPLICATE** (2-joint part) | 2-joint `D` preselect blocked by H-dim = `UX-24` (`D10.1`). Circle with ONLY Reference radius dim -> Dim tool click: `ROW XB-13 \| circle with ONLY ref radius dim -> Dim tool click: totalDims=1, newIsDriven=true, toasts=[]`. Confirmed even sharper via `dimension-tool.js:35-38,599-608`: `hasDrivingDistanceForShape` ignores `isDriven`, passes `isDriven: true`, duplicate check rejects (`res=null`), and `:608` grabs & re-places the existing reference dim! | **UX-24** (2-joint) + new circle part |
| **B-14** | **DUPLICATE** (`a,b,d`) + **CONFIRM** (`c`, 2/2) — **turn 3741 confirms SketchStudio is the BUG** | `a` = `UX-14` (`E` vs Equal ribbon; raw ERR fixed by `9b1eb8e4`, preselect asymmetry live); `b,d` = `UX-15` (SketchStudio exits to `select` on H/V preselect & 2nd ribbon click — **BUG under owner ruling turn 3741**, while Shaper/PenPlotter follow turn 3741!). `c` **CONFIRMED** (`ROW XB-14c \| dup H on already-H line: preselect H-key=[]; preselect H/V-ribbon=[]; H/V-tool click=["[overconstrained] Sketch geometry over constrained"]` because `autoDetectHorizontalVertical` passes `source: 'auto-detect'`). | **UX-14**, **UX-15** + new `14c` |
| **B-15** | **CONFIRM** (3/3; **confirmed BUG under turn 3741**) | `ROW XB-15 \| invalid pick tool retention: {"parallel":"EXIT->select","perp":"EXIT->select","collinear":"EXIT->select","hv":"EXIT->select","midpoint":"EXIT->select","symmetric":"EXIT->select","coincident":"STAY","tangent":"STAY","equal":"STAY"}`. Under owner ruling turn 3741, all 6 tools exiting to `select` on refusal/invalid pick (`input-manager.js:760-762`) are **BUGs**; `coincident`/`tangent`/`equal` staying active is the expected behaviour. | *(new — missed by 1000)* |
| **B-16** | **CONFIRM** (3/3) | `ROW XB-16 \| pattern label dblclick in Dimension tool: labelFound=true, dimInputOpened=true` (`dimension-tool.js:369-372` omits the `isPatternConstraint` branch that `selection-tools.js:198` has). | *(new — missed by 1000)* |
| **B-17** | **REFUTE (B's repro)** / **CONFIRM (same-tier tie root cause, 2/2)** | **B's repro (`line:free` + `circle:free`) is NOT a bug**: `packages/core/creation-placement-table.js:485-516` (`agree: 200, differ: []`, measured live from Fusion 360!) puts `line:free` in Tier 0 and `circle:free` in Tier 1, so Fusion 360 moves the line in BOTH pick orders (`ROW XB-17.free-free.L-then-C \| lineMoved=25, circleMoved=0` & `C-then-L \| lineMoved=25, circleMoved=0`). **HOWEVER**, B's suspected code line (`constraint-tools.js:288` always passing `{ line, circle }`) **DOES break same-tier ties** where Fusion's table says `"tie": "second"` (e.g. `line:free` + `circle:sized`, both Tier 0): `ROW XB-17.tie-lineFree-circleSized.L-then-C \| lineMoved=0, circleMoved=25` vs `C-then-L \| lineMoved=0, circleMoved=25` (should move line when circle is picked first!). | *(refuted on B's repro; real tie bug confirmed)* |
| **B-18a** | **CONFIRM** (3/3) | `ROW XB-18a \| cluster drag to near LT midpoint (0,40): snapAtEnd={"type":"midpoint","isLocked":true}, posDuringDrag=(1.06, 39.227), posAfterRelease=(0, 40), midConstraints=1`. `selection-tools.js:803` omits `'midpoint'` from the `snapPt` type whitelist, so the dragged corner doesn't pull live to the midpoint until release! | *(new — missed by 1000)* |
| **B-18b** | **DUPLICATE** (agree 100%) | Already reproduced 2/2 (`IR4.3`: line midpoint -> `midpoint`, arc midpoint -> `shape`). Both agree completely. | **UX-27** |
| **B-19a** | **DUPLICATE** (classification differs: B=BUG, 1000=DIVERGENCE) | Same observation (`IR8.3`: Circle draw-time box asks Diameter, creates Radius dim with `(d1) / 2`). Owner decides BUG vs DIVERGENCE. | **DIV-01** |
| **B-19b** | **CONFIRM** (3/3) | `ROW XB-19b \| polygon draw-time "d1 / 2": shapes=13, distDims=[{"name":"d1","val":60,"expr":null}]` — formula evaluated once, dropped, and no radius dim created. | *(new — missed by 1000)* |
| **B-19c** | **CONFIRM** (3/3) | `ROW XB-19c.slot-c2c \| newDims=[{"val":"15","expr":null}]` vs `ROW XB-19c.slot-center \| newDims=[{"val":"15","expr":null},{"val":"30","expr":"d1 / 2"}]` — `slot-c2c` drops span dim & formula, and both modes drop width formula. | *(new — missed by 1000)* |
| **B-19d** | **CONFIRM (as DIVERGENCE, 2/2)** | `ROW XB-19d \| line draw-time length=50 angle=30: shapes=1, constraints=[{"type":"distance","val":50},{"type":"coincident"}]` — no angle constraint created (B also lists this under Divergences #5). | *(new divergence)* |
| **B-19e** | **CONFIRM** (3/3) | `ROW XB-19e \| parseFilletRadius("d1 / 2")=null, parseOffsetDistance("d1 / 2")=null` — Fillet & Offset still call `parseUnit`, rejecting formulas despite task 876 adding formulas to draw-time boxes. | *(new — missed by 1000)* |
| **B-20a** | **DUPLICATE** + **FIXED-ON-MAIN** | Same raw `[ERR-*]` / JSON toast sites as `UX-19`. **All fixed on `origin/main` by task 1001 (`9b1eb8e4`)** (verified by `git grep` + `MAIN1001.*`). | **UX-19** (**FIXED-ON-MAIN**) |
| **B-20b** | **CONFIRM** (3/3) | `ROW XB-20b \| fixed-endpoint Bezier status: dof 0 {B1:fixed}` — marks Bezier black/fixed while `c1`/`c2` handles remain unconstrained shape data. | related to **DIV-04** |
| **B-20c** | **CONFIRM** (3/3) | `ROW XB-20c \| cursor 18px right of joint a along L1: boost=1 -> shape (d=0.5); boost=2 (touch) -> shape (d=0.5)` (`snap-detection.js:187` `JOINT_PRIORITY_RADIUS = 15` is not scaled by touch `boost`). | *(new — missed by 1000)* |

### Cross-Check of Auditor B's 6 Divergences

| B-Div | Verdict | Evidence / Notes | Maps-to 1000 |
|---|---|---|---|
| **B-Div 1** (No Sketch Chamfer) | **DUPLICATE** | Agree (`git grep -i chamfer packages/ apps/`). | 1000 Div #5 |
| **B-Div 2** (Mirror/Pattern/Offset under MODIFY vs Fusion CREATE) | **CONFIRM** | Deliberate owner ruling documented in `packages/core/constants.js:133-151`. | *(not listed in 1000)* |
| **B-Div 3** (Redundant geometric constraints accepted) | **DUPLICATE** | Agree (`C1.10–C1.12`). | **DIV-02** |
| **B-Div 4** (Bezier handles unconstrained shape data) | **DUPLICATE** | Agree (`DR1.5/1.6`, `mirror.js:30`). | **DIV-04** |
| **B-Div 5** (Line angle & Arc sweep draw-time boxes create no constraint) | **CONFIRM** | Confirmed 2/2 (`XB-19d`). | *(not listed in 1000)* |
| **B-Div 6** (Angle accepts `360°`, rejects `0°`) | **REFUTE (Fusion claim)** | B marked this a divergence from Fusion `(unverified)`, claiming Fusion caps below 360°. In fact `WORK-LOG.md` TURN 551 & `packages/core/dimension-seams.js:84` explicitly document that `(0, 360]` (0 and negatives refused, 360 accepted) was **measured live in Fusion 360 with real keys**! So this is **Fusion-matched OK**, not a divergence. | 1000 OK baseline (`D4.*`) |

---

## 3. Our Findings (`UX-nn` / `DIV-nn`) That Auditor B Did NOT Find

Auditor B missed **18 distinct findings** from `docs/SOLVER-UX-AUDIT-1000.md` (including 6 wrong-geometry bugs, 8 misleading-UI / irregularity bugs, and end-to-end 200-item drag frame lag):

### Wrong Geometry (6 missed by B)
1. **UX-02**: `findCollapsedShape` 1% rule (`constraint-verifier.js:409-427`) falsely refuses shrinking a 500×40 rectangle width to `4 mm` (`"4.00 would collapse a line to a point. Reverted."`; 5 mm works) — reproduced in Node + live Chrome desktop & phone.
2. **UX-03**: UI Select drag-snap of an arc's end onto its own start adds permanent `coincident:e,s`, collapsing the arc to zero sweep (unlike the Coincident tool, which refuses it; distinct from B-12b's solver-only 350° wrap).
3. **UX-04**: `breakShape` (`packages/core/break.js:24-58`) ignores `state.constraints`, leaving H/V and length dims on `[a, b]` while break joint `M` bends the line into a V.
4. **UX-05**: Fixed-R fillet leg dragged past 180° folds the fillet arc inside-out with `residual ok` (distinct from B-12a's free-R rect edge drag; also explains mirrored fillet arcs inheriting `sweep: undefined`).
5. **UX-09**: Dragging a point coincident with an arc centre translates rigidly or shrinks arc radius (`30 -> 22.374`) depending purely on Map/SVG z-order (`selection-tools.js:420` checks `s.joints[0] === hitJoint.id` instead of `cluster.has(s.joints[0])`).
6. **UX-11**: `trimShape` (`packages/core/trim.js`) creates no `pointOnLine` binding the trimmed end to the cutter line, and trimming a dimensioned rectangle edge leaves the old width dimension `d1=80` orphaned across the cut gap.

### Misleading UI / Irregularities (8 missed by B)
7. **UX-12**: Attempting to drag a fully-constrained (0-DOF) point silently wipes `state.redoStack` (`1 -> 0`) (`selection-tools.js:506-521`).
8. **UX-13**: Dimension tool `Line -> AxisX` creates an angle (`26.565°`), whereas `AxisX -> Line` ignores the axis and creates a line length (`67.082`) *(note: intentional per task 555 in `reference-lines.js:37-40`, flagged for owner decision)*.
9. **UX-17**: Draw-time box vs Edit box: (a) typing `w = 50` in draw-time box fails with self-contradictory hint `"=" only as name = value at the start"` (works in edit box; live screenshots on desktop & phone); (b) typing `-5` or `0` stays open inline in draw-time box vs closes & discards text with toast in edit box; (c) `#dimComplete` autocomplete works in edit box only, never in draw-time boxes.
10. **UX-18**: In inch documents (`DOC_UNIT = 'in'`), dimension edit refusal toasts print raw internal millimeters (`"Can't set to 2540"` for `100 in`, `"-50.8"` for `-2 in`, `numeric-input-manager.js:684`).
11. **UX-20**: A conflicted sketch (impossible `50-40-120` triangle, 10 mm residual) flattens silently and renders normal black/blue strokes with ZERO over-constrained visual indicator (live desktop & phone verified).
12. **UX-21**: One conflicted component blocks adding Horizontal to an unrelated free line via global `_sandboxVerify` (`constraint-manager.js:462-495`).
13. **UX-22**: Multi-selecting 1 fixed line + 1 free line freezes the free line completely (`max move 0`, `selection-tools.js:89-99`).
14. **UX-23**: Fast 1-step flick on body drags skips task 548 sub-moves (`selection-tools.js:694` gates on `state.joints.has(state.drag.id)`), lagging far behind equivalent joint drags.
15. **UX-25**: Trim and Break show helpful notices on Bezier curves, but are completely silent on Arcs and Circles.

### Cosmetic / Divergences / End-to-End Perf (4 missed by B)
16. **UX-26**: `selectionLockState` reports `locked: false` on filleted locked lines (`input-manager.js:1484-1492`).
17. **UX-28**: `revert()` runs `engine.solve(ITER())` after `restoreAll()`, drifting `0.0018 mm` on a supposedly reverted edit (`dimension-seams.js:120`).
18. **UX-29** & **DIV-03**: Cryptic cycle hint `"d1 -> d1"` / `"d1 -> d2 -> d1"`; double-clicking a Reference dimension is completely silent.
19. **End-to-end 200-item drag frame time**: B benchmarked core `solve()` alone (`5.75 ms`) and concluded 200-item drag is well under 16.6 ms; our full-pipeline benchmark measured **Node `realPointerMove` mean 26.6 ms (p95 32.17 ms) on 50 rects / 64.6 ms (p95 87.01 ms) on 200 coupled segments**, and **real Chrome 1280×800 rAF mean 20.7 ms (p95 33.4 ms)** due to per-move `analyzeConstraintStatus` + rAF `solve(500)` + full SVG rebuild.

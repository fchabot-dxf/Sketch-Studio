# Solver UX audit, cross-examination of the first auditor's report (TASK 1000B round 2)

Subject: `docs/SOLVER-UX-AUDIT-1000.md` (branch `agents/solveraudit-1000`, UX-01..UX-29, DIV-01..DIV-04) against this branch (`agents/solveraudit-1000b`, origin/main 9b1eb8e4 merged, i.e. task 1001 included). Sniff only: no app code or existing test changed.

Probes (outside the gate):
- `tests/audits/solver-ux-audit-1000b-cross.mjs` (my probe, run 2/2, identical apart from random ids) and `tests/audits/solver-ux-audit-1000b-cross2.mjs` (UX-20 colours, lock undo, tool second-click matrix, run 1/1).
- 1000's own probes (`solver-ux-audit-1000-{dimensions,drag,constraints-status-undo,irregularities}.mjs` + `-kit.js`, copied untracked from origin/agents/solveraudit-1000, NOT committed) run 2/2 on this branch. ROW output of run 1 and run 2 identical, except `dimensions` D2.3..D2.6 (see UX-28 and the note at the end).
- `solver-ux-audit-1000b-irregularities-node.mjs` (this branch's own) re-run for the tool-exit rows.
- Raw output: `.evidence/1000B-r2/` (local, not committed).

Yardstick (owner turn 3741): a constraint tool stays active after each use; only Esc or another tool exits; re-clicking its own button does NOT exit. Findings where a tool exits by itself are marked **YARDSTICK-BUG**.

Verdicts: CONFIRM (reproduced here), REFUTE, DUPLICATE (same as a B-n here), FIXED-ON-MAIN (task 1001). Last column = maps-to B-id in `docs/SOLVER-UX-AUDIT-1000B.md`.

## Table

| UX-id | Verdict | Evidence (verbatim from my runs) | B |
|---|---|---|---|
| UX-01 toggleDriving of an H/V reference dim uses the hypotenuse | CONFIRM + DUPLICATE, descriptions agree (2/2) | 1000 `D9.1`: `d1.value=50 (expected 30, hyp=50); b=(50, 40); max move 20 (b)`; `D9.2`: `d1.value=50 (expected 40...); b=(30, 50)` | B-2 |
| UX-02 1% collapse rule refuses 4 mm of 500 | CONFIRM (2/2) | cross: `"t4":[{"level":"warning","text":"Can't set to 4 — 4.00 would collapse a line to a point. Reverted."}],"valAfter4":500 ... "t5":[],"valAfter5":5` | none |
| UX-03 arc end dragged onto its own start adds a coincident | CONFIRM (2/2) | cross: `"toolRefused":true ... "eAfterDrag":[40,0],"coincidentsAfterDrag":[["e","s"]]`; 1000 `DR4.1 ... cross0={"e":"(40, 0)",...,"constraints":["equal:c,s,c,e","coincident:e,s"]}`. Related to B-11 (Coincident TOOL on an arc's own point) but a different route | B-11 (related) |
| UX-04 Break ignores H/D constraints, bends into a V | CONFIRM (2/2) | cross: `"midAfterDrag":[40,30],"constraints":["horizontal:...","distance:..."]`; 1000 `M1.5 ... mid=(40, 29.994) (bent into V!)` | none |
| UX-05 fillet arc has no sweep, folds past 180 | CONFIRM + DUPLICATE (B-12a/e) (2/2) | cross: `"filletSweep":"undefined","mirroredFilletSweep":"undefined","cAfter":[97.41,-15.88],"arcStart":[51.63,0],"arcEnd":[48.45,0.52],"crossedBack":true` | B-12 |
| UX-06 Lock on a circle does not fix it | CONFIRM + DUPLICATE, agree (2/2) | 1000 `IR2.1.C1 | Lock C1 via F: hist 0->1, lockState={"has":true,"locked":true}, dof 10 {L1:fixed C1:free ...} rimDrag r:20->40.026` | B-1 |
| UX-07 locked sketch: selected dim still deleted | CONFIRM + DUPLICATE, agree (2/2) | 1000 `C2.1 | deleteSelection with LOCKED sketch-1 shape L1 + dim d1 selected: shapes 1->1, constraints 2->1` | B-5 |
| UX-08 toggleDriving and Lock/Unlock record no undo step | CONFIRM + DUPLICATE, agree (2/2) | cross `UX-08`: `"hBefore":0,"hAfter":0,"exprAfterToggle":null`; cross2: `"h0":0,"h1":0,"fixedAfterF":true,"shapesAfterCtrlZ":["L1","L2"]`; 1000 `IR2.1.L1 | Lock L1 via F: hist 0->0`; `D9.3b afterUndo={"isDriven":false,"expr":null,"hist":0}` (formula lost) | B-4 |
| UX-09 arc centre coincident with a line end: radius shrinks depending on which joint is grabbed | CONFIRM (2/2) | cross: `"o1":{"cFirst":true,...,"rBefore":30,"rAfter":22.367},"o2":{"cFirst":false,...,"rAfter":30}`; 1000 `DR6.4a ... r 30->22.374` vs `DR6.4b ... r 30->30` | none |
| UX-10 dragging mirrored geometry rotates a FREE mirror line | CONFIRM + DUPLICATE (B-12d) (2/2) | 1000 `DR4.3b | ... ML m1 (0, -50)->(8.135, -49.643), m2 (0, 50)->(-0.403, 49.995)` | B-12 |
| UX-11 Trim leaves no pointOnLine; rect dim d1=80 survives across the trimmed span | CONFIRM (2/2) | cross: `"trimmedEndAfterCutterDrag":[50,20],"cutterXAfterDrag":70,"rectTopLenAfterTrim":40,"d1StillExists":true,"d1Val":80` | none |
| UX-12 drag of a 0-DOF item wipes the redo stack | CONFIRM (2/2) | cross: `"redoBefore":1,"redoAfter":0`; 1000 `DR2.3 ... redoStack 1->0` | none |
| UX-13 Dim tool: Line then AxisX gives an angle, AxisX then Line gives a length | CONFIRM (2/2) | cross: `"lineThenAxis":{...{"type":"angle",...,"value":26.565}]},"axisThenLine":{"axisFirst":true,"constraints":[{"type":"distance","value":67.082}]}` | none |
| UX-14 `E` applies Equal to 2 preselected shapes, the Equal ribbon drops the preselection | CONFIRM + DUPLICATE (B-14a), agree. The `[ERR-EQUAL-01]` half is FIXED-ON-MAIN | 1000 `IR1.1a ... tool=select, constraints=equal` vs `IR1.1b ... tool=equal, pending={"type":"equal","firstElement":null}, constraints=`; mine `P1-A: "afterBtn":{"tool":"equal","equalCount":0 ...},"afterKey":{"tool":"select","equalCount":1}`. Toast now `[warning] Equal needs two lines, or two circles or arcs.` (no code, no Args) | B-14 |
| UX-15 host/button asymmetries | CONFIRM + DUPLICATE (B-14b-d, B-15 part). **YARDSTICK-BUG** | 1000 `IR1.host.sketchstudio | HV-preselect={"tool":"select"...}; parallel-2x=parallel->select; coin-2sel={"tool":"coincident","selCount":0,"pending":null}` vs shaper `parallel-2x=parallel->parallel ... "selCount":2`. cross2 second ribbon click, SketchStudio: `"parallel":{"afterFirstClick":"parallel","afterSecondClick":"select"}`, same for horizontal(hv), equal, midpoint, tangent, collinear, symmetric; `coincident` stays. Shaper: all stay (`"afterSecondClick":"parallel"` ...). cross `UX-15d`: `"afterBtn":{"tool":"hv","hvCount":0},"afterKey":{"tool":"select","hvCount":1}` | B-14, B-15 |
| UX-16 dblclick on a determined driving dim silently demotes it to Reference, no undo | CONFIRM for the silent demotion; the toast/ERR part is FIXED-ON-MAIN, and now there is NO feedback at all (worse) | cross: `"editorOpen":false,"isDrivenAfter":true,"hBefore":0,"hAfter":0,"toasts":[]`; 1000 `D5.1 | ... NOT OPENED ... now value 50 REFERENCE; ... history 0 -> 0` | none |
| UX-17 draw-time box vs edit box (`w = 50` hint, `-5`, autocomplete) | CONFIRM, related to B-19 | cross: `"drawEq":{"stillOpen":true,"hint":"\"=\" only as  name = value  at the start"}`; 1000 `IR8.1b ... hint=""=" only as name = value at the start"` vs `IR8.1c | EDIT box type "w = 50"+Enter: box closed ... dim name=w val=50`; `IR8.1a` stays open vs `D1.1` closes with a toast; `IR8.4 | autocomplete visible: draw-time box=false vs edit box=true` (2/2). My own edit-side check in cross reported `opened:false` (probe limitation, not counted) | B-19 (related) |
| UX-18 inch document: refusal toast prints mm | CONFIRM (2/2) | 1000 `D8.1 | ... "Can't set to 2540 — conflicts with distance. Reverted."`; `D8.2 ... "Can't set to -50.8 — a length must be more than 0. Reverted."`; cross: `"negInchToasts":[{"level":"warning","text":"Can't set to -50.8 — ..."}]` | none |
| UX-19 raw `[ERR-*]` / Args in toasts | FIXED-ON-MAIN (task 1001). Same fix covers B-20a | 1000 `C1.9 | toasts=["[error] Copy⚠️Symmetric rejected — the two entities are the same point"]`; `C1.8 ... toasts=[]`; `IR1.2a toasts=["[warning] ⚠️Equal needs two lines, or two circles or arcs."]`. Codes remain only in the Log and in the internal field `drivenReason` (`constraint-manager.js:274`, cross: `"drivenReason":"math-precheck: lines are H and V (angle is 90°) [ERR-CMATH-02]","toasts":[]`); nothing in the UI reads it | B-20a |
| UX-20 conflicted triangle shows no conflict colour | CONFIRM (1/1, plus 1000 `DR3.0` 2/2) | cross2: `"cols":{"L1":"#202020","L2":"#60A5FA","L3":"#60A5FA"},"hasConflictClass":false`; cross: `"abLen":60,"abError":10`; 1000 `DR3.0 | residual 10 on distance d1` | none (B-20b is a different case) |
| UX-21 one conflict blocks constraints on unrelated geometry | CONFIRM (2/2) | cross: `"l4HorizontalBlocked":true,"l4Toasts":[{"level":"overconstrained","text":"Sketch geometry over constrained"}]`; 1000 `C1.13 ... residual 10 on distance d1` | none |
| UX-22 fixed + free multi-select: the free item will not drag | CONFIRM (2/2) | cross: `"pBefore":[60,20],"pAfter":[60,20]`; 1000 `DR6.3a ... max move 0` vs `DR6.3b ... max move 40.0575` | none |
| UX-23 body flick skips sub-moves, lags behind joint flick | CONFIRM (2/2) | cross: `"jointFlick":{"body":false,"bAfter":[-12.55,58.67]},"bodyFlick":{"body":true,"bAfter":[56.92,18.97]}` | none |
| UX-24 preselect 2 joints + D refused when an H dim exists, Dim tool click-click allows | CONFIRM + DUPLICATE, agree (2/2) | 1000 `D10.1 ... toasts=["[info] ℹ️Joints already dimensioned. Click the label to edit existing dimension."]`; mine `P1-D: "preselectRes":{"constraints":1,"placing":false,...},"clickClickRes":{"constraints":2,"placing":true}` | B-13 |
| UX-25 Trim/Break silent on arc/circle, warn on Bezier | CONFIRM (2/2) | cross: `"trimCircle":[],"trimArc":[],"trimBezier":[{...Trim: not available on a Bezier curve...}],"breakCircle":[],"breakArc":[]` | none |
| UX-26 fillet on locked lines: selectionLockState(L1) = not locked | CONFIRM (2/2) | cross: `"selectionLockState":{"has":true,"locked":false},"l1InFixedShapes":true` | none |
| UX-27 no arc midpoint snap | CONFIRM + DUPLICATE (B-18b), agree (2/2) | 1000 `IR4.3 | snap at LINE midpoint (-35,0): type=midpoint; snap at ARC midpoint (61.213,21.213): type=shape (no arc midpoint snap!)` | B-18 |
| UX-28 a refused edit still drifts joints 0.0018 mm | CONFIRM in 1000's sequence (2/2), NOT in my clean case | 1000 `D2.6 ... Reverted ... max move 0.0018 (c)`; cross (fresh flat triangle): `"reverted":true,"cBefore":[-10,0],"cAfter":[-10,0],"driftMm":0`. Drift appears only when the start was not fully converged (c at y=0.004 after D2.5); cosmetic | none |
| UX-29 cycle hint shows only `d1 -> d1` | CONFIRM (2/2) | 1000 `D1.4 ... hint "d1 -> d1"`, `D1.6 ... hint "d1 -> d2 -> d1"` | none |
| DIV-01 circle box asks diameter, makes a Radius dim | CONFIRM + DUPLICATE (B-19a) (2/2); DIVERGENCE agreed (Fusion uses diameter for circles, unverified) | 1000 `IR8.3 | Circle draw-time box type "d1" (d1=60): circle.radius=30, created dim: isRadius=true ... expr="(d1) / 2"` | B-19 |
| DIV-02 redundant parallel/perp/equal accepted | CONFIRM (2/2). Owner to decide: Symmetric refuses the same situation | 1000 `C1.10 | add parallel ... res=ADDED`, `C1.11`, `C1.12 ... res=ADDED`; cross: `"div02RedundantParAccepted":true,"div02RedundantEqAccepted":true` | none |
| DIV-03 dblclick on a reference dim does nothing | CONFIRM (2/2). I would class it BUG: silent no-op | 1000 `D3.1 ... NOT OPENED (the box did not open) toasts []`; cross: `"div03RefEditOpened":false,"div03RefToasts":[]` | none |
| DIV-04 bezier end drag leaves the handle | CONFIRM (2/2), DIVERGENCE agreed | 1000 `DR1.5 ... c1 [20,40]->[20,40] (delta 0,0)` vs `DR1.6 ... c1 delta (30.055,9.982)`; cross `"div04EndDragC1Delta":[0,0]` | none (B-12c is the mirrored Bezier) |

No finding was REFUTED. Refined: UX-16 (toast gone, silence remains), UX-28 (only from a non-converged start).

## B findings 1000 did NOT find

- B-3 promoting a driven dim snaps geometry back (parallel line dim, axis dim). Not re-run.
- B-6 Parallel with a pre-selected joint creates a corrupt constraint. Re-run: `P3-D WRONG PRESELECT ... "corruptParallel":[{"type":"parallel","shapes":["j43_1795666083264","L_j43_1795666083264_j44_1795666083264"]` (1/1).
- B-7 switching tool mid-dimension leaves the placing constraint in the document. Re-run: `P1/P7-C ... "afterSwitchToLine":{"tool":"line","constraints":1,"placingFlagOnC":[{"type":"distance","placing":true}],"statePlacing":true` (3 hosts).
- B-8 circle centre loses its coincident when a radius is typed. Not re-run.
- B-9 redundant Angle born Driving silently. Not re-run.
- B-10 Midpoint own-endpoint: line silent and wedges the buffer, arc warns. Re-run: `"lineOwnEnd":{"tool":"midpoint","toasts":[],"pendingBuf":[...]` vs `"arcOwnEnd":{"tool":"select","toasts":[{"level":"warning","text":"Midpoint of an arc: pick a point that is not the arc's own centre or end."}]}`.
- B-11 Coincident on an arc's own point silently adds pointOnLine. Re-run: `"arcOwn":{"polCount":1,"toasts":[]}` vs `"lineOwn":{"polCount":0,...overconstrained}`.
- B-12 b, c (10 degree arc end drag, mirrored Bezier). Not re-run.
- B-15 invalid pick: 6 tools exit to Select, 3 stay (**YARDSTICK-BUG**). Re-run: `parallel/perp/collinear/hv/midpoint/symmetric ... "toolAfter":"select","stayedInTool":false` vs `coincident/tangent/equal ... "stayedInTool":true`. 1000 only saw the second-click exit (UX-15b), not the exit after a refusal.
- B-16 pattern dblclick differs by tool. Not re-run.
- B-17 Tangent pick order discarded. Re-run: `tan.A-B movedA=25, movedB=0` and `tan.B-A movedA=25, movedB=0` (1000's own `IR5.5` rows show it, but it did not list it).
- B-18a snap preview vs drag result mismatch. Not re-run.
- B-20b fixed-end Bezier colour. Not re-run.

## New this round, in neither report

- YARDSTICK-BUG: in SketchStudio a second click on the active constraint button exits to Select for Parallel, H/V, Equal, Midpoint, Tangent, Collinear, Symmetric (Coincident stays); Shaper stays in all. (Perpendicular has no matching `data-tool` button in my selector, `"perpendicular":"no-button"`, not checked.)
- UX-16 follow-up: after task 1001 the silent demotion gives no message at all.

## Summary

33 items checked (UX-01..29, DIV-01..04): 33 reproduced (UX-19 as FIXED-ON-MAIN, UX-16 with its toast part fixed, UX-28 only in 1000's sequence), 0 refuted. 13 map to a B finding (UX-01, 05, 06, 07, 08, 10, 14, 15, 24, 27, 19, DIV-01, plus UX-03/UX-17 as related). 20 are findings B did not have. B findings 1000 missed: 13 (list above). Yardstick BUGs: UX-15, B-15, and the new second-click matrix (7 of 8 tools in SketchStudio).

Note on flakiness: in one of the two 1000 `dimensions` runs, D2.3 (type 69.9 after a flat 70 triangle) reported `NOT OPENED (the box did not open)`; the other run opened it. Not analysed (probably label hit-test on a flat triangle); listed as uncertain.

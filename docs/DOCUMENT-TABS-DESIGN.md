# Document tabs: several designs open at once (task 558, design only)

Owner request (2026-11-12): "Can we add tabs for open drawings?" Several designs open at once, switched with tabs, like
Fusion's document tabs or a browser's tabs. This file is the design (phase 1). No code under `packages/` or `apps/` was
changed. Every statement about today's code cites `file:line` on main `d128cb8`.

---

## 1. Summary for the owner (plain language)

Today each app (Sketch, Shaper, Pen Plotter) has exactly ONE drawing open. Opening another design from Projects or
Open recent throws the current one out of the screen (it is saved first, so nothing is lost) and loads the other in its
place. The app already does that switch safely: save, then replace everything (`packages/ui/document-buffer.js:136`).

Document tabs keep that safe switch and add memory: each tab remembers its own undo history, its zoom and position, and
the app's extra data (Shaper's cut plan, Pen Plotter's pens and toolpaths). Clicking a tab saves the current design,
puts it aside with its history, and brings the other one back exactly as you left it, Undo included.

I measured the switch on a design with 300 constraints: about 30 ms (one screen refresh is 16 ms), and almost all of
that is the solver doing the same work it already does on every frame. So "one live drawing, swapped on a tab click" is
fast enough, and it avoids rebuilding the solver and every app around several live drawings at once.

The tab strip is a thin row ABOVE each app's header, like a browser's tabs or Fusion's document tabs. Shaper's
Explore / Design / Vcarve / Prepare / Review and Pen Plotter's Design / Toolpath / Export stay where they are, in the
header below: those are steps WITHIN one design; the new row is WHICH design. Trace has no designs, so it gets no tabs.

Because everything autosaves, closing a tab asks nothing (unless the last save failed). Opening a design that is already
in a tab just switches to that tab. After a reload the same tabs come back, with the one you were on in front (undo
history does not survive a reload, as today).

What I need from you: the decisions in section 2. Each has my recommended answer; "yes to all recommendations" is a
complete answer.

## 2. Owner decisions (each with a recommended answer)

| # | Question | Recommended answer |
|---|----------|--------------------|
| T1 | SketchStudio is "don't touch" by principle (NEXT-SESSION.md, PROJECT PRINCIPLES). May it get the tab strip? | **Yes.** Sketch is where drawings are made; the strip is additive, shell-smoke must stay 12/12. |
| T2 | Opening a design from Projects / Open recent / Open from file: new tab or the current one? | **New tab** (Fusion does this). Exception: if the current tab is an untouched empty "Untitled", reuse it. |
| T3 | New design | **Opens a new tab.** |
| T4 | Close a tab: confirm? | **No confirm** (autosave). Confirm ONLY when that design's last save failed or Drive reports an error for it. |
| T5 | A tab that was never drawn in (empty Untitled), closed: keep the empty design in Projects? | **Delete it** (no junk "Untitled" rows). Today an empty Untitled is stored as soon as the app starts (finding F1). |
| T6 | Closing the LAST tab | **A fresh empty Untitled tab appears** (an app never shows "nothing"). |
| T7 | Maximum tabs | **10.** Opening an 11th says "Close a tab first" (memory: each tab keeps up to 100 undo steps, section 4.4). |
| T8 | Drag to reorder | **Not in v1** (slice 7, later). v1: new tabs open at the right end. |
| T9 | After a reload | **All tabs come back, the last active in front.** Undo history is not kept across a reload (as today). |
| T10 | Cross-app (decision D) | **One set of open designs shared by Sketch, Shaper and Pen Plotter** (like today's shared "current design"). Each app page has its own active tab. |
| T11 | Shaper's mode / Pen Plotter's stage per tab? | **No:** the stage is the app's, not the design's (v1). Switching tabs keeps you in Prepare if you were in Prepare. |
| T12 | Where the strip sits (decision B) | **Its own thin row above the app header** (browser / Fusion layout), not inside the header row. |

Design calls I make (advisor may overrule): the swap model (A), the per-tab session record and its single owner
(document-buffer.js), the copy/paste contract with task 559 (E), the slice plan (F).

---

## 3. How ONE document lives today (ground truth)

### 3.1 The engine store is module-level: one per page
- `packages/core/constraint-solver.js:6-10`: `const joints = new Map(); const shapes = []; const constraints = []; let jid = 0;`
  at MODULE level. `createEngine()` (`:24`) builds its Newton solver over those same three objects (`:28`) and every
  engine's `getJoints/getShapes/getConstraints` (`:41-43`) returns them. `_initStore()` (`:16-22`) clears them.
- Measured (section 4.2 evidence): two `createSketch()` calls in one process return the SAME `state.joints` Map
  (`same store? ... identical Map: true`). This is task 535-1b's finding: two drawings cannot be live at once.
- Construction sites: SketchStudio `apps/sketchstudio/main.js:49` (createEngine) + `:66` (createSketchState);
  Shaper, Pen Plotter and Trace through `mountSketch` (`packages/ui/sketch-canvas.js:78-82`), called at
  `apps/shaper/src/main.js:545`, `apps/penplotter/src/sketch-stage.js:267`, `apps/trace/src/edit-view.js:38`.

### 3.2 The state object and its history
- `createSketchState(engine, view)` (`packages/ui/sketch-state.js:19`) exposes the engine's store (`:28-30`), the view,
  selection sets, hover/active/drag (`:34-47`), groups / profiles / parameters / vcarves (`:50-53`), the host hook
  `hostSnapshot` (`:56`, Shaper's cut plan rides undo through it: `apps/shaper/src/main.js:556`), and the undo stacks
  `history` / `redoStack` (`:57-59`, depth `HISTORY_DEPTH = 100`, `:17`).
- A snapshot is a deep copy of the document parts (`_captureSnapshot`, `:66-83`) stamped with `t` and `label`
  (`:87-91`); undo/redo restore through `_restoreSnapshot` (`:93-125`), which clears selection and `active`.
- Every code path reads `this.history` / `this.redoStack` through the state object, so a tab can swap those two
  arrays by reassigning the properties.
- Draw steps (task 549): `beginDrawStep` / `closeDrawStep` (`:231-247`): a half-drawn element is cancelled by
  `closeDrawStep()`; the ribbon calls it on every tool pick (`packages/ui/tool-ribbon.js:157`).
- Memory per snapshot, measured in task 466 (`sketch-state.js:13-16`): ~276 KB typical, ~539 KB for a 2000-shape
  sketch; 28-54 MB for a full 100-step history.

### 3.3 The document format
- `serializeDocument(state, { hosts })` (`packages/core/document.js:33-57`): `{ version: DOCUMENT_VERSION (=2, :24),
  geometry: { joints, shapes, constraints, sketches, activeSketchId, groups, profiles, parameters, vcarves }, hosts }`.
  `hosts` is opaque per-app sidecar data (`:12-15`).
- `deserializeDocument(doc, state)` (`:84-132`) REPLACES the whole geometry IN PLACE (it clears the same Map/arrays:
  `:89`, `:95`, `:98`) and re-adds constraints through `addConstraintObject` (`:101`); clears selection and `active`
  (`:126-129`). It does NOT touch `history` / `redoStack` / `view`.
- The document unit is NOT in the document: `DOC_UNIT` is an app-wide setting (`packages/core/settings-manager.js:103`,
  read e.g. at `apps/shaper/src/main.js:83`). All tabs share one unit (as all designs do today).

### 3.4 The autosave buffer (one per app page)
- `createDocumentBuffer` (`packages/ui/document-buffer.js:46`) polls every 1.5 s (`:120`): serializes (`:74-77`),
  compares with `lastSig`, and writes into the design it is BOUND to (`boundId`, `:49`, `:85`). It is bound to the
  design it loaded or created, never to whatever the global pointer says later (`:18-19`).
- `load(design)` (`:92-100`) = `deserializeDocument` + rebind + baseline signature + the host's `onRestored`
  (each host re-solves, refits the view and applies its sidecar: SketchStudio `apps/sketchstudio/main.js:192`,
  Shaper `apps/shaper/src/main.js:562-576`, Pen Plotter `apps/penplotter/src/sketch-stage.js:278-282`).
- `openDesign(id)` (`:136`) = `await flush()` then `load(await store.open(id))`. **This is already a document swap**;
  tabs add only the per-design session memory and the strip.
- The ready gate (task 542, `:51-71`, `:102-111`): until the INITIAL restore settles, pointer/key input on the canvas
  is swallowed and the canvas carries `data-doc-ready="0"`. It applies once per page; later loads are synchronous
  after their store read (`load` is sync), so a tab switch needs no gate if the incoming document is in memory.
- Hidden / closing page: `flush()` (`:113-117`, `:133`) saves and flushes Drive writes of the BOUND design only
  (`store.flushDrive(boundId)`). The store can flush all designs (`store.flushDrive()` with no id,
  `packages/ui/project-store.js:631`).
- A Drive conflict reloads only the bound design (`onConflict`, `:115`).

### 3.5 The project store and the global "current design"
- One store per page (`getProjectStore`, `packages/ui/project-store.js:668-679`), IndexedDB plus the Drive router.
- The CURRENT pointer is one device-wide meta key (`:8-9`, `:56`), shared by every app: that is the cross-app carry
  (`document-buffer.js:4-6`): Shaper and Pen Plotter (and Sketch) open whatever design is current at boot
  (`loadCurrent`, `project-store.js:443-460`). `open(id)` makes a design current (`:481-486`); `newDesign`,
  `saveAs`, `importFile` make the new design current; `remove` clears the pointer if it pointed there (`:511-516`).
- `subscribe(fn)` fires on any change in this page AND in other browser tabs through a BroadcastChannel (`:206-213`,
  `:633-634`). `status(id)` is already per design id (`:621-626`).

### 3.6 Projects UI, sidebar, title
- `project-actions.js` declares every design / project action once (`packages/ui/project-actions.js:12-79`); Open is
  `buf().openDesign(id)` (`:16-19`), New is `buf().newDesign()` (`:66`), Open from file `buf().openFile()` (`:67`).
- The sidebar (`packages/ui/sidebar-projects.js:26`) shows the document name and save status from the GLOBAL pointer
  (`refreshName`, `:38-45`: `store.current()`), the status line from `store.status(currentDesignId)` (`:71-78`), and
  sets the browser tab title through `applyAppIdentity(appId, { designName })` (`:44`;
  `packages/ui/app-registry.js:29-33`, `:39-46`: `"<design> — <App>"`).
- Open recent rows open with `openDesignById` (`sidebar-projects.js:99`); the Projects modal uses the same actions
  (`project-manager.js`, via `projectActions`, `sidebar-projects.js:53`).

### 3.7 The journal and the diagnostic report
- `buildJournal(history, current, { redoStack })` (`packages/core/journal.js:166`) turns `state.history` +
  `state.redoStack` into the replayable log (`:5-18`). The report reads them from the live state at copy time
  (`packages/ui/diagnostic-log.js:213`). So the journal is per document exactly when the history is.

### 3.8 Parameters (535-1b) and floating windows
- User parameters live in `state.parameters` (`sketch-state.js:52`), saved in the document (`document.js:50`,
  `:119`) and in every undo snapshot (`sketch-state.js:78`, `:117`). Nothing module-level.
- The Params window (`packages/ui/parameters-window.js:34`) is created once per ribbon over the ONE state object
  (`tool-ribbon.js:150-153`, `paramsWin` / `parametersWindow`) and, while open, rebuilds from a per-frame row signature (`parameters-window.js:53-61`).
  With one live state that is swapped in place, it follows the active tab with no change.

### 3.9 Other per-page module state that a swap must respect
- Host sidecars are module singletons: Shaper `CUT_PLAN` (`apps/shaper/src/cut-plan.js:18`) and `STOCK`
  (`apps/shaper/src/stock.js:7`); Pen Plotter `state` (`apps/penplotter/src/state.js:17`). They are already saved and
  re-applied per design by `getHostData` / `onRestored` (section 3.4).
- Pen Plotter has a SECOND undo history for its Toolpath / Export stages, module-level:
  `apps/penplotter/src/history.js:13-15` (`undoStack`, `redoStack`). Not in the document, not in `state.history`.
- Tool-in-progress state in the input handlers is module-level: `drawing-tools.js:20-23`, `line-tool.js:27-32`
  (`pendingStepSnapshot`), `fillet-tool.js:23-29`, `break-tool.js:8`, `trim-tool.js:9`; the input layer itself is one
  per page (`packages/ui/input-manager.js:70` `canvasSvg`, `:130` `isActiveFn`, `setupInput` `:259`). `handleEscape`
  (`:1405`) is the existing one place that ends whatever is in progress.

### 3.10 Hosts, their own tabs, and the header
| Host | Header markup | Its own (HOST) tabs | Buffer |
|------|---------------|---------------------|--------|
| SketchStudio | `#app-header-host` (`apps/sketchstudio/index.html:358`) filled by the shared `createAppHeader` (`packages/ui/app-header.js:37-46`; `apps/sketchstudio/main.js:165-178`) | Design / Export (`main.js:174`) | `main.js:189` |
| Shaper | `header.toolbar` (`apps/shaper/index.html:293-316`) | Explore / Design / Vcarve / Prepare / Review (`index.html:299-305`), mode persisted (`main.js:427`, `:644`, `:714`) | lazy, with the sketch (`main.js:543-582`; the sidebar calls `ensureSketch`, `:53`) |
| Pen Plotter | `header.toolbar` (`apps/penplotter/index.html:248-256`) | Design / Toolpath / Export from `STAGES` (`apps/penplotter/src/main.js:21-27`) | `sketch-stage.js:275`, pre-mounted at startup (`main.js:104`) |
| Trace | `header.tr-header` (`apps/trace/index.html:30-39`) | Trace / Edit / Export | none (no designs) |

All four headers hold the shared sidebar button (`#app-sidebar-host`, from `mountProjectSidebar`). There is no
hash / URL routing anywhere in `apps/` or `packages/` (grep for `location.hash`, `hashchange`, `pushState`,
`replaceState`: no hits outside tests); the only `location.search` read is the dev tuning flag
(`apps/sketchstudio/main.js:111`).

---

## 4. A. The model: swap, or several live documents

### 4.1 Alternatives
**A1 SWAP (recommended).** One live state + engine per page, as today. A tab click saves the active design, stores
its session (document, undo/redo arrays, view, host session) in an in-memory TAB RECORD, and loads the other tab's
record into the same state. This is `openDesign` (`document-buffer.js:136`) plus a remembered session.
- Pros: no change to the solver, the input layer, the renderer or any host's module state; the Params window, info
  panels, diagnostic log, ribbon all keep pointing at the one state object; the cost is measured (4.2).
- Cons: a switch ends any interaction in progress (a half-drawn line is cancelled, as a tool switch does today); a
  switch costs one solve (~30 ms at 300 constraints); inactive tabs are data, not running drawings.

**A2 SEVERAL LIVE DOCUMENTS.** One state + engine (+ canvas, input layer, RAF loop) per tab, hidden when inactive.
Needs, at least: the module-level store moved into `createEngine` (`constraint-solver.js:6-22`); the input layer made
per-instance (`input-manager.js:70`, `:130`, and every handler's module state, 3.9); the host sidecars made per
document (`cut-plan.js:18`, `stock.js:7`, Pen Plotter `state.js:17`, `history.js:13-15`); one `setupInput` per canvas;
the Params window, info panel, ribbon and diagnostic log rebound on each switch anyway.
- Pros: instant switch; a background tab could keep a tool mid-draw.
- Cons: touches the solver core and every host; large, risky, no user-visible gain over a 30 ms swap.

**Recommendation: A1.** Moving the store into `createEngine` is still a worthwhile cleanup on its own (it would let a
test hold two engines), but tabs do not need it and should not wait for it.

### 4.2 Measured swap cost (300 constraints)
Script `.evidence/558/measure-swap.mjs` (untracked): builds design A (30 fully dimensioned rectangles) and design B
with the real harness (`tests/harness/sketch.js`) and the app's `createSketchState`, then 21 times: `serializeDocument`
of the active design, `JSON.stringify` (the autosave signature), `deserializeDocument` of the other design into the SAME
state (the path `load()` runs), and the first `engine.solve(500)` after it (what every host's `onRestored` does), plus
one more warm `solve(500)` for comparison with a normal frame. Run 0 is reported apart (JIT warm-up). Node v24.20.0,
on the shared PC while other seats ran. Output, verbatim (`.evidence/558/measure-swap.out.txt`):

```
design A: 300 constraints, 241 joints, 120 shapes, 30 rects, 58554 bytes JSON
design B: 320 constraints, 257 joints, 128 shapes, converged=true
same store? createSketch() twice -> state.joints identical Map: true
runs=20 (after 1 warm-up run: {"serialize":"0.1","stringify":"0.1","deserialize":"2.2","firstSolve":"20.3","total":"22.8","warmSolve":"16.3"})
serialize    median 0.1 ms  min 0.1  max 0.2
stringify    median 0.2 ms  min 0.1  max 0.3
deserialize  median 1.4 ms  min 0.7  max 1.9
firstSolve   median 28.7 ms  min 15.6  max 35.1
total        median 30.2 ms  min 16.5  max 36.9
warmSolve    median 30.0 ms  min 15.9  max 39.6
final state: 300 constraints (design A)
```

Reading: the swap's own work (serialize + deserialize) is ~1.7 ms; the rest is ONE solve, the same cost as a normal
frame (`warmSolve`), which the render loop pays every frame anyway (`apps/sketchstudio/main.js:234-247`, solve at `:237`). A swap is
about two frames. Solver speed is task 541's subject, not this design's.

### 4.3 The TAB RECORD (declared once) and who owns it
One record per open tab, held by the app's document buffer (the ONE module that already loads, binds and saves
designs; nothing else gets a second copy):

```
{ designId, name,
  doc,              // serializeDocument(...) of the design when it was put aside (the in-memory copy; the store has the saved one)
  savedSig,         // the signature last written to the store (the buffer's lastSig for that design)
  storeUpdatedAt,   // the store's updatedAt when it was put aside: detects a change made elsewhere (another browser tab, another app, Drive)
  history, redoStack,   // the state's undo / redo ARRAYS, moved (not copied) out of the state
  view,             // { x, y, w, h } of state.view
  hostSession }     // OPTIONAL, host-declared: in-memory per-design data that is NOT in the document (Pen Plotter's history.js stacks)
```

The host declares its session hook next to its sidecar in the `createDocumentBuffer` options:
`session: { capture() -> data, restore(data|undefined) }` (`undefined` = a fresh design: reset). Shaper needs none (its
cut plan already rides the sidecar and every undo snapshot, `sketch-state.js:81`, `:119`). Pen Plotter declares one
for `history.js:13-15`. SketchStudio needs none.

### 4.4 The switch, step by step (one function in document-buffer.js)
1. End what is in progress: the existing Escape path (`input-manager.js:1405`, which runs `closeDrawStep()`), close an
   open dimension box, cancel a drag. Same rule as picking another tool (`tool-ribbon.js:157`).
2. `await poll()` (`document-buffer.js:79-89`): the active design is written to the store (IndexedDB; a Drive design
   is queued in the throttled writer per design id and keeps flushing in the background: the switch does NOT wait for
   the network).
3. Put aside: `{ doc: serializeDocument(state, hosts), history: state.history, redoStack: state.redoStack, view: {...state.view},
   hostSession: session.capture() }`; then `state.history = []`, `state.redoStack = []`.
4. Bring in tab B: if the store's `updatedAt` for B equals `B.storeUpdatedAt`, use `B.doc` (no store read: a Drive
   design is not re-downloaded); otherwise B changed elsewhere: read it from the store and DROP B's history (it no
   longer describes that document) and say so in the sidebar status line ("Updated from another window; undo history
   cleared"). Then `load()` (`:92-100`) with a `reason: 'switch'` so hosts restore B's saved `view` instead of refitting
   (`fitToDrawing` stays for open / new / file), put B's arrays back on the state, `session.restore(B.hostSession)`,
   `_notifyHistory()` so the ribbon's Undo/Redo buttons update.
5. Make B the store's CURRENT design (cross-app carry and the next boot follow the active tab) and refresh the sidebar
   name, status and the browser title (section 6.3).

**Hazard to close in the same slice (found while reading):** `poll()` sets `boundId = r.id` and `lastSig = sig` AFTER
its `await store.save(...)` (`document-buffer.js:85-87`). An interval poll still in flight when the buffer is rebound
would put the OLD design's id and signature back, and the next tick would write tab B's drawing into tab A's design.
Today `openDesign` is protected only by the store's write order (its `flush()` save is queued behind the in-flight one).
Fix at the cause, in `poll()`: write to the id captured when the signature was taken and adopt `r.id` / `sig` only if
the buffer is still bound to that id. A test pins it (F, slice 1).

### 4.5 Undo / redo and the journal per tab
- Undo/redo: the arrays move with the tab record (4.4 step 3/4); each snapshot keeps its own `host` part (Shaper's
  cut plan, `sketch-state.js:81`), so undo in tab B can never restore tab A's cut plan.
- Journal: built from `state.history` + `state.redoStack` at report time (3.7), so Copy Report always gives the ACTIVE
  tab's journal, complete, with no change to journal.js.
- Pen Plotter's toolpath history: in its host session (4.3).
- Memory: up to 100 snapshots per tab (3.2: ~28 MB typical full history for a large sketch); hence the 10-tab limit (T7).
  The 300-constraint test design is 58.5 KB as JSON, so a typical full history is a few MB.

---

## 5. B. Where the strip sits (one shared component)

### 5.1 The component
- New shared module `packages/ui/document-tabs.js`: `createDocumentTabs({ buffer, store, appId })` -> `{ el, refresh,
  destroy }`. Pure DOM over the buffer's tab API (`tabs()`, `activate(id)`, `close(id)`, `newTab()`); themed from the
  host's existing header tokens (as `parameters-window.js` themes from the ribbon's), so light Sketch, dark Shaper and
  paper Pen Plotter each get their own look without host CSS.
- Declared, not hand-placed: `mountProjectSidebar` already runs in every host that has designs and receives
  `getBuffer` (`sidebar-projects.js:26`); it gains ONE opt-in `documentTabs: true` and inserts the strip as a row
  immediately BEFORE the host's `<header>` (the element that contains its button). SketchStudio, Shaper and Pen Plotter
  pass `true`; Trace does not (no buffer, no designs), so the feature cannot appear there.
- Each tab: design name (ellipsis past ~180 px, full name in the tooltip), a status dot from `store.status(id)`
  (saving / error), a close x. A "+" at the end = New design (T3). `role="tablist"` with `aria-label="Open designs"`,
  arrow keys move between tabs, Enter activates. Keyboard shortcut: none in v1 (Ctrl+Tab and Ctrl+W belong to the browser).
- Phone width (<= 640 px): one line, horizontal scroll, the active tab scrolled into view; no second row.

### 5.2 Visual proposal per host
Document tabs are the OUTER level (which design), the host tabs the INNER level (which step of that design). Fusion
uses the same order: document tabs on top, the workspace toolbar below. The look differs on purpose: document tabs are
file tabs (square bottom, joined to the header below, a close x on each); host tabs stay pills inside the header.

SketchStudio
```
 ┌ Bracket ─ x ┐┌ Lid  ● x ┐┌ Untitled x ┐  +                          <- NEW: document tabs row
 [≡] [Design] [Export]                                  [Debug] [Style]  Saved   <- header (unchanged)
 [ tool ribbon ................................................................]
 [ canvas ]
```
Shaper
```
 ┌ Sign ─ x ┐┌ Coaster x ┐  +
 [≡] Saved  (Explore) (Design) (Vcarve) (Prepare) (Review)     [Open SVG] [Fit] [Export]  ⚙
```
Pen Plotter
```
 ┌ Postcard ─ x ┐┌ Logo x ┐  +
 [≡] Saved  (Design) (Toolpath) (Export)
```
Trace: unchanged (no row).

The `Saved` / `Saving…` text stays where it is (it is the active tab's status); the per-tab dot only shows saving or
an error for the inactive tabs too.

---

## 6. C. Behaviour

### 6.1 Opening, new, closing
- Open from Projects / Open recent / Open from file: a NEW tab (T2) at the right end (T8); if the active tab is an
  untouched empty Untitled, it is reused. `project-actions.js` stays the one declaration: `openDesign`, `newDesign`,
  `openFile` (`project-actions.js:16-19`, `:66-67`) call the buffer's tab API instead of replacing the document.
- The same design already open: no second tab; its tab is activated (refuse + switch). Keyed by design id; a design
  re-created under a new id after a Drive loss follows `followMoves` (`document-buffer.js:148`).
- Save as / Duplicate: Save as keeps today's meaning (the CURRENT tab becomes the copy, `document-buffer.js:138`);
  Duplicate does not open anything (`project-actions.js:21-26`). Unchanged.
- Close: no confirm (T4) unless `store.status(id)` says the save failed; flush that design first (its Drive write too).
  An untouched empty Untitled is deleted on close (T5). The last tab closed -> a fresh Untitled tab (T6).
- Deleting a design that is open in a tab (Projects modal, Delete): its tab closes (the store already clears the pointer,
  `project-store.js:511-516`).
- Max 10 tabs (T7).

### 6.2 Reload and restore
- The open set is persisted in the store's device-local meta (the same place as the CURRENT pointer: a remote adapter
  keeps meta local, `project-store.js:28`) as `openTabs` = `[designId, ...]` in order; the active tab = CURRENT (T9).
- Boot: `restore()` loads CURRENT exactly as today (the ready gate of task 542 is unchanged, it covers the first
  design); the other tabs are listed by name only and their documents are read on first activation (so boot cost does
  not grow with the tab count). A listed design that no longer exists is dropped silently from the list.

### 6.3 Per-tab Drive state, sidebar and title
- The store's `status(id)` is per design already (3.5). The sidebar must show the ACTIVE tab's name and status: today
  it reads the global pointer (`sidebar-projects.js:38-45`) instead of the buffer's bound design. With tabs the sidebar
  reads `buffer.designId()` (it already does for rename, `:36`).
- Inactive tabs keep their pending Drive writes in the store's per-id writer; on page hide the buffer flushes ALL
  designs (`store.flushDrive()` with no id), not only the bound one (`document-buffer.js:133` today).
- A Drive conflict for an INACTIVE tab: its record is marked stale; activation then reloads it from the store (4.4
  step 4). For the active tab, today's `onConflict` (`:115`) stays.
- Browser title: `"<active design> — <App>"` (`app-registry.js:32`), unchanged format.

### 6.4 Floating windows and panels follow the active tab
- Params window: follows by construction (3.8); the switch's step 1 closes nothing in it (it is modeless) and its
  per-frame signature rebuilds the rows.
- Info / DOF panel, ribbon Undo/Redo enable state: refreshed by `onRestored` and `_notifyHistory()` (4.4 step 4).
- Diagnostic log: reads the state at copy time (`diagnostic-log.js:213`): the active tab's journal.
- Selection, hover, the open dimension box, context menu: cleared / closed by the switch (4.4 step 1; `document.js:126-129`).
- Style panel: app-wide settings, not per design: unchanged.

---

## 7. D. Cross-host

- Today the CURRENT pointer is device-wide and shared by every app (3.5), so the "shared autosave buffer" between Shaper
  and Pen Plotter is really one shared POINTER: whichever app starts next opens the same design; each app's buffer
  stays bound to its own design once loaded (`document-buffer.js:18-19`).
- **D1 per-app tab sets:** Sketch's tabs only in Sketch. Simple, but GO TO another app would open only the current
  design and lose the rest of the set, unlike today's carry.
- **D2 one shared open set (recommended, T10):** `openTabs` lives in the store meta, shared by Sketch, Shaper and Pen
  Plotter (same origin, same store). Membership is shared and kept in sync through the store's `subscribe`
  (BroadcastChannel, `project-store.js:206-213`); the ACTIVE tab is per page (each app page shows what its user clicked);
  CURRENT = the last activated anywhere, so the next app opened starts on it. A design does not belong to an app (its
  `app` field is only "who saved it last", `document-buffer.js:30`), so a shared set matches the data.
- Two pages editing the SAME design at the same time (Sketch and Shaper side by side, or two browser tabs) is possible
  today and not solved by this design (last write wins, finding F3). Tabs do not make it worse; activation's
  `storeUpdatedAt` check (4.4 step 4) at least shows the other page's version when you come back to a tab.

---

## 8. E. Copy / paste between tabs (task 559, built in parallel)

559 owns the clipboard format. What tabs require of it, and what tabs guarantee:
- The clipboard must hold its OWN JSON-safe copy (not references into `state.joints` / `state.shapes` /
  `state.constraints`): a swap clears and refills those same objects in place (`document.js:89-123`), so a reference
  kept across a switch would point at the other design's data.
- The clipboard must not live in `state.*`: `deserializeDocument` and `clearDocument` reset the document parts of the
  state (`sketch-state.js:143-169`); a module-level or system-clipboard store survives a swap untouched.
- Paste must mint new ids (`state.genJ()`); 559 needs this within one design anyway. The engine's id counter is page-wide
  and timestamped (`constraint-solver.js:15`), so ids made in different tabs of one page never collide.
- Units: one app-wide `DOC_UNIT` (3.3), so no unit conversion between tabs.
- Formulas referencing user parameters (535) that the target design lacks: 559's call; flagged here.
- Tabs guarantee: the switch never touches the clipboard; focus returns to the canvas after a tab click so Ctrl+V reaches
  the input layer (`input-manager.js:946`, `:962`, `:1065` gate on `isActiveFn`).
- Test (whichever of 558 slice 4 / 559 lands second): copy a shape in tab A, switch to B, paste: B gains it with new
  ids, A unchanged after switching back, Undo in B removes the paste only.

---

## 9. F. Tests and slice plan

Every slice: gate green (`npm run gate`), SMOKE 12/12, HEADLESS-LEFT 0, WORK-LOG entry, behaviour changes listed.

| Slice | What | Size | STOP conditions |
|-------|------|------|-----------------|
| 1 | Headless tab model in `document-buffer.js`: tab records, `tabs()/openTab/activate/close/newTab`, the `poll()` bound-id fix (4.4 hazard), `session` hook, `reason: 'switch'` in `onRestored`. No UI; `openDesign` unchanged for users. | M | Any host's `onRestored` cannot tell a switch from an open without a second code path -> stop. The poll race cannot be pinned by a failing test BEFORE the fix -> stop and report. |
| 2 | Host sessions: Pen Plotter declares `session` for `history.js` stacks; each host honours `reason: 'switch'` (no refit, restore view). Shaper: confirm nothing needed (cut plan in snapshots + sidecar). | S-M | A host keeps per-design data that is neither in the sidecar nor declarable as a session -> stop, list it. |
| 3 | The strip `packages/ui/document-tabs.js` + `documentTabs: true` in `mountProjectSidebar`, SketchStudio first (needs T1). | M | SMOKE not 12/12, or any SketchStudio control moves (screenshot diff of the header row) -> stop. |
| 4 | Actions: Open / Open recent / Open from file / New open tabs (T2, T3); same design -> switch; close rules (T4-T6); max (T7); sidebar name/status/title from the active tab; flush-all on page hide. | M | A store API change is needed beyond reading meta -> stop and ask. |
| 5 | Shaper + Pen Plotter get the strip; live tests in both. | S-M | The strip overlaps or shifts `#mode-nav` (task 522 pinned its position) -> stop. |
| 6 | Persistence + cross-app (T9, T10): `openTabs` meta, restore at boot, BroadcastChannel sync. | M | The ready gate (542) would have to wait for more than the CURRENT design -> stop. |
| 7 | (v2, T8) drag to reorder. | S | - |
| 8 | Cross-tab copy/paste test once 559 is merged (section 8). | S | 559's clipboard holds live references -> report to 559, do not patch in 558. |

Tests (node unless marked live):
- Swap round trip: A drawn + 5 undo steps, switch to B, draw, back to A: A's geometry, `history.length`, labels and
  `redoStack` identical (deep compare); undo in A restores A's previous step, never B's.
- Journal: `buildJournal` on A before and after a round trip gives the same `current.hash` and steps.
- Autosave target: after switching, the store's A record equals A's last document and B's equals B's (read back from a
  memory adapter); the poll race test: hold `store.save` open, switch, release: A's record is not overwritten by B.
- Same design twice: opening an open design activates its tab; tab count unchanged.
- Close: flushes; an untouched Untitled is deleted; a failed-save tab asks (memory adapter that throws).
- Stale tab: change B in the store behind its back (second store instance on the same adapter), activate B: the store
  version shows, history cleared, status line says so.
- Host session: Pen Plotter toolpath undo in tab A survives a switch to B and back (live).
- Shaper: cut plan of A and B stay apart through switch + undo (live, real clicks).
- Strip (live, real pointer): click, close, +, keyboard arrows; phone width 390 px: one row, scrolls; Trace has no strip.
- Swap cost guard: the 300-constraint swap stays under a generous bound (e.g. 500 ms, pathological only), printed.

---

## 10. Findings while reading (reported, not fixed)

- **F1** On a fresh page with nothing stored, the first autosave tick stores an empty "Untitled" design: `restore()`
  leaves `lastSig` null when there is no design (`document-buffer.js:102-111`), so the first `poll()` differs and calls
  `store.save` with no target, which creates one (`project-store.js:548-551`, the `!target` branch of `save`). Relevant to T5.
- **F2** The sidebar name, status and the browser title follow the device-wide CURRENT pointer
  (`sidebar-projects.js:38-45`, refreshed on every store change including other browser tabs via BroadcastChannel,
  `project-store.js:206-213`), while the buffer writes to its own bound design. Two browser tabs on two designs: opening a
  design in one should relabel the other's sidebar and title with the wrong name (code reading; not reproduced live).
- **F3** Two pages bound to the same design overwrite each other's autosaves (last write wins); no lock or warning
  (code reading of `poll()` + `store.save`).
- **F4** The `poll()` rebind hazard (4.4): latent today, real once tabs switch often.
- **F5** The module-level engine store (3.1), already known from 535-1b; measured again here.

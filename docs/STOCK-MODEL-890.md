# One STOCK model for the website and the Fusion panel — TASK 890 (design only)

The base for the Fusion setups redesign (docs/FUSION-PANEL-881.md section 11). This file contains no code. Line numbers are at
this branch after merging `origin/main` d14b4778 (task 884 included) (Sketch-Studio) and b32f277 (shaper-addin, main checkout, read only).

## 0. Owner facts this design follows

- The Stock is "like an operation" (turns ~3576-3580). In Fusion it is picked as a sketch: "instruct the user to draw the stock as a sketch
  in fusion". The Design tab does not come back to Fusion for it.
- "In fusion the useful thing is that sometimes the part thickness is stock thickness."
- Turn 3641, "Default to the part": a SETUP's stock thickness DEFAULTS TO THE PART's thickness, as in Fusion CAM.
- Setups (FUSION-PANEL-881.md section 11.5): one board each = the picked part(s) / bodies (the "Model") + the Stock (default: the parts'
  bounds + a margin, thickness from the part; or a picked sketch) + its operations + one SVG export. A file can hold separate boards and
  parts nested on one board. An operation's dialog accepts only faces of its setup's parts.
- Task 879: the website board = `drawingExtent` (the geometry actually drawn) + `DEFAULT_STOCK.margin` 152.4 mm (6 in). A stored margin
  is ignored.
- Turn 3603: old files don't matter. No migration code.
- Turn 3594 (review): the reviewer's starting point is checked line by line in section 1.6.

## 1. Inventory: who reads and writes the stock today

### 1.1 The three forms of the one record

| Form | Where | What |
|---|---|---|
| The declared record | packages/core/relief-model.js:23 `DEFAULT_STOCK = { thickness: 19.05, width: null, height: null, margin: 152.4 }` | Every field is in base mm. width / height null = derived from the bounds |
| Its live copy (app state, one per document, module level) | apps/shaper/src/stock.js:7 `STOCK`; :9 `getStock`; :10-14 `setStockField`; :21-25 `setStock` (defaults first, then the known fields, except the DECLARED_ONLY `margin`, :18) | |
| The Stock LOOP: an operation of type `stock` | apps/shaper/src/shaper.js:109 `STOCK_TYPE_ID = 'stock'`; :75 its CUT_TYPES entry (exported as a guide, `exportFirst`, depth row = `stockDepth`) | Its geometry (one closed shape) is the board's profile. Its `cutDepth` is the board thickness |
| The bounds form | packages/core/geometry-bounds.js:58 `drawingExtent(state)`; relief-model.js:347-352 (the box = bounds centred, + 2 × margin, or the explicit width / height) | Used when no Stock loop gives a profile |
| ONE resolver | apps/shaper/src/stock.js:33-39 `resolveStock(state)` -> `{ stock, fromLoop }`: if `planStockProfile` returns something, the profile + the loop's thickness (unset -> the record's); otherwise the record | |

### 1.2 Writers

| Writer | Where | What it writes |
|---|---|---|
| Stock card (typed thickness, − / + stepper) | apps/shaper/src/stock-card.js:30-39 (`setStockField('thickness', v)` at :35, one undo step at :34), stepper :41-45 | record.thickness. The ONLY caller of `setStockField` |
| Document restore (website) | apps/shaper/src/shaper-doc.js:261 `setStock(d && d.stock)` | the whole record from the sidecar (width / height go through if a file has them; margin never does) |
| Undo / redo snapshot | shaper-doc.js:34 `capturePrepare` (`stockThickness`), :41 restore | record.thickness |
| Fusion project restore (per-design) | apps/shaper/src/fusion-bridge.js:142 (empty: `setStock({ ...DEFAULT_STOCK })`), :145 (`setStock({ ...DEFAULT_STOCK, ...project.stock })`) | the whole record |
| Fusion selection import | apps/shaper/src/fusion-import.js:551-552 (reads `payload.stock.thicknessMm`); :561 a fresh start or `stock: 'part'` -> the part's thickness as a NUMBER (default 19.05 when the payload has none); :562 an add -> `Math.max(current, part)` | record.thickness, a number: it is not re-read when the part changes |
| STL Open / Insert / re-slice (website and Fusion) | apps/shaper/src/stl-import.js:110-113 (`stock: keep ? 'keep' : 'part'`: an opened STL sets the thickness, an inserted one leaves it); the height comes from packages/core/stl-slice.js:383 `stock: { thicknessMm: r6(H) }` | record.thickness through fusion-import.js:561 |
| Stock pick in Prepare | apps/shaper/src/prepare-stage.js:240-249 -> cut-plan.js:314-323 `setStock(key)` (ONE Stock per document: the previous one is deleted, :318); `key` null = an EMPTY Stock (:312-313); cut-plan.js:326-328 `changeOpType` to Stock deletes any other Stock | the Stock op; its settings come from `freshRecord(key)` (cut-plan.js:55-59: the region's imported depth as a NUMBER, not `'model'`) |
| Stock thickness row in Prepare (the op's depth row, labelled Thickness) | cut-panel.js:805 (`depthParam` `stockDepth`, param-hints.js:24) -> cut-plan.js `setOpFields` :337-345 (`normalizeDepth` :163-169 stores `'model'` when it equals every shape's imported depth) | Stock op `settings.cutDepth` |
| Fusion "Select in Fusion -> Update" on another op (SA-16 `assign`) | fusion-import.js:527-547; the Stock's Fusion tokens are kept in `keepTokens` since task 864 (fusion-bridge.js:181-191) | Stock op geometry (kept) |
| Per-part thickness on the selection entry | selection-edit.js:72, :86 (`thicknessMm` from the payload); selection-list.js:91 (restore); fusion-bridge.js:104 (saved in the Fusion project) | entry.thicknessMm. **No reader uses it for the stock today** (it is only persisted and restored) |
| width / height | none from the UI (`setStockField` is only called at stock-card.js:35); only a restore of a stored file (shaper-doc.js:261, fusion-bridge.js:145) can set them | |

### 1.3 Readers

| Reader | Where | What it reads |
|---|---|---|
| 3D Export view (the board) | apps/shaper/src/shaper-app.js:849 `reviewInputs`: `resolveStock(st).stock` + `bounds: drawingExtent(st)` -> review-view.js:359 `buildRelief` (relief-model.js:288-352; T at :292; board 'none' when there are no bounds, profile and width + height, :342-345; the info lines review-view.js:379-382) | resolved stock |
| 3D rebuild signature | shaper-app.js:851 `reviewSig`: `getStock()` + the store signature + joints | the RECORD, not the resolved stock (see the note in 2.4) |
| Simulation wood | review-view.js:426-427 `simBoard` (the built `stockBox` as a profile), :438, :450 `sweptVolumes(..., { thickness: stockBox.thickness })` | resolved (through buildRelief) |
| Through test, cut depths clamped to T | relief-model.js:29 `isThrough`, :431 | T |
| Stock card readout / disabled state / tooltip | stock-card.js:21-28 (`resolveStock(...).fromLoop`: the field shows the loop's thickness and is disabled with a Stock loop); :15 `boardOf` ('loop-set' / 'loop-unset' / 'bounds'); param-hints.js:103, :222-226; index.html:853 `#review-stock-thickness`; shaper-app.js:959-962 (mount), re-sync `showStockThickness` at :704, :733, :813, :935, :953, :1025 | resolved |
| Stock loop profile | cut-plan.js:1072-1075 `stockKeyOf` (the first Stock in the plan); :1083-1097 `planStockProfile` (thickness = the loop's `cutDepth` through `recordOf`, so `'model'` -> `sourceDepth`, cut-plan.js:40, :44) | Stock op |
| Prepare canvas STOCK label | prepare-view.js:642-648 (`stockKeyOf`); index.html:339, 377-378 (style) | Stock op |
| Roughing boundary = Stock | cut-plan.js:122-129 and :688-689 (`stockKeyOf` -> `boundaryTarget`); prepare-stage.js:73 `hasStock`; cut-panel.js:73-74 (greyed without a Stock); packages/core/stepped-cut.js:686, :710-716 ('no-stock') | Stock op |
| Not a cut | cut-plan.js:1053 (`planReliefItems` skips it); prepare-view.js:394; fusion-toolpaths.js:210, :305 | Stock op |
| Op list tick | operations.js:284 (`tickable: false`); cut-plan.js:66 `isTicked` (always ticked); op-list.js:22, :228 | Stock op |
| SVG file | shaper.js:75 (`exportFirst`, written as a guide with its thickness in `cutDepth`); packages/core/shaper-export.js:243, :278 (written first); packages/core/profile-model.js:663-668 (outline only); origin-rules.js:211, :274 | Stock op |
| SVG page size | shaper-export.js:61-70 `boundsOf` = `drawingExtent` ∪ every written element (:299); **the margin is not on the page**: the bounds + 6 in board is 3D only. A partial (ticked) file with no Stock gets the frame guide = the whole file's drawn extent (shaper-export.js:283-288; export-payload.js:45-49) | drawing + Stock op |
| 2D / Paths preview | export-preview.js:53-55 (the Stock guide drawn as an outline, behind) | Stock op |
| STL "taller than the stock" note | stl-import.js:96 `tallerText` | record.thickness |
| Fusion "Select in Fusion" | fusion-bridge.js:794 `canSelectForOperation` (hidden on the Stock row: `tickable !== false`); :177-187 the Stock's region `sources` (Fusion entity tokens) kept in `keepTokens` (task 864); the tokens are stored on the REGION by the import (fusion-import.js:438-441) | Stock op + its region |
| Fusion project save | fusion-bridge.js:114 `stock: getStock()`; the add-in stores it as is (shaper-addin docs/SELECTION-BRIDGE.md:534) | record |
| Fusion viewport toolpaths | fusion-toolpaths.js:16 (Z = depth from the PART's top) | none: the stock top is assumed to be the part top |

### 1.4 The add-in payload (shaper-addin, read only)

| What | Where |
|---|---|
| `selection_data.stock` is a declared top-level field | bridge.py:31 |
| A body: `stock = { thicknessMm }` = its Z extent along the cut direction (top - bottom) | body_extract.py:558, :847 |
| Sketch / profile / curve / standalone face: `stock: null` | selection_extract.py:870; docs/SELECTION-BRIDGE.md:145 |
| **Several bodies in one selection: `stock` is set only when there is exactly ONE body** (`if len(body_msgs) == 1`), so two bodies arrive with `stock: null` and a fresh import falls back to 19.05 | fusion_selection.py:1387-1388 |
| The per-design project keeps `stock` as the palette sent it | docs/SELECTION-BRIDGE.md:534 |

### 1.5 Findings from the inventory (reported, not fixed here)

- F1. An EMPTY Stock op (geometry `[]`: the toolbar's Stock with nothing selected, or the 864 fixture's `op-1`, cutDepth 38.1) has a thickness
  that nobody reads. `planStockProfile` returns null (cut-plan.js:1091), so `resolveStock` uses the record (stock.js:36).
- F2. `reviewSig` (shaper-app.js:851) carries `getStock()`, not the resolved stock. That works today only because every input of the
  resolution is either the record or in the store signature.
- F3. A Stock picked on an imported region keeps the region's depth as a typed number (`freshRecord`, cut-plan.js:57), not `'model'`. A
  Stock loop's thickness does not follow the part.
- F4. The entry's `thicknessMm` (the part's own thickness, per selection) is stored and persisted but never read.
- F5. A multi-body selection loses the part thickness (1.4).

### 1.6 The reviewer's starting point, checked

| Claim | Verdict |
|---|---|
| `DEFAULT_STOCK { thickness: 19.05, width: null, height: null, margin: 152.4 }` (relief-model.js:~23) | TRUE, relief-model.js:23 |
| A Stock loop op (STOCK_TYPE_ID, planStockProfile, cut-plan.js ~1083-1097) whose thickness is the loop's cutDepth | TRUE, shaper.js:109; cut-plan.js:1083-1097 (thickness at :1095-1097) |
| The bounds form drawingExtent + margin in buildRelief (~349) | TRUE, geometry-bounds.js:58; relief-model.js:349-351 |
| Fusion writes a NUMBER: `setStock({...getStock(), thickness})` (fusion-import.js ~561-562) | TRUE, :561-562 |
| Depth already has a source form ('model' -> sourceDepth, cut-plan.js ~40) | TRUE, cut-plan.js:40, :44 |
| width/height have no writer (setStockField only at stock-card.js ~35) | TRUE for the UI (stock-card.js:35); a stored file can still restore them (shaper-doc.js:261, fusion-bridge.js:145) |
| Proposed `{ source, shapeKey / Fusion tokens, margin, thickness, thicknessFrom, width/height }` | Evaluated in 2.1: thickness + thicknessFrom kept, the rest dropped |

## 2. The model

### 2.1 The decision: the Stock IS the Stock operation, one per setup

Owner: the Stock is "like an operation". The code already has that operation, and it already holds the two things a stock needs: its
footprint (its geometry: one closed shape, or EMPTY) and its thickness (its `cutDepth`, with the same `'model'` form Depth has). So the
model adds no new record. It gives the operation the meaning it is missing:

| Stock op | Footprint | Thickness |
|---|---|---|
| geometry `[key]` (a drawn shape on the website, an imported Fusion sketch profile in Fusion) | that profile (`planStockProfile`, holes from a combined profile) | its `cutDepth` |
| geometry `[]` (EMPTY) | the setup's `drawingExtent` + `DEFAULT_STOCK.margin` (152.4 mm) | its `cutDepth` (new: F1) |
| no Stock op at all (the website's default) | `drawingExtent` + margin | the declared record's typed thickness (the card), default 19.05 |

`cutDepth` on a Stock op takes one of three values:
- a number: TYPED;
- `'model'`: FROM THE PART, re-read at every resolution (2.3);
- `'unset'`: the declared record's thickness (today's loop-unset).

The reviewer's proposed fields, and why most are left out:
- `source: 'bounds'|'loop'|'fusion-sketch'|'explicit'`: NOT stored. The form is DERIVED from the Stock op (does it exist, is its geometry
  empty). A stored copy could say 'loop' while the op's geometry is `[]`, which is exactly the drift of task 864 (geometry emptied while
  the rest still said Stock).
- `'fusion-sketch'` as a separate form: NOT needed. A sketch picked in Fusion arrives like any selection (`selection_data`, SA-16 `assign`
  onto the Stock op, fusion-import.js:527-547). It is then a Stock op with a region, the same form as a drawn Stock loop. Only its region
  carries Fusion `sources` tokens, and task 864 already keeps them.
- `shapeKey` / Fusion tokens in the record: NOT stored there. They are the op's geometry key and the region's `sources`. A copy would be a
  second truth.
- `margin`: stays declared-only (task 879, stock.js:18).
- `thickness` + `thicknessFrom: 'typed'|'model'`: KEPT, as the Stock op's `cutDepth` (number | `'model'`), the form Depth already has
  (cut-plan.js:40-44, :163-169, :341). It is the same word and the same rules: one form, declared once.
- `width` / `height` (explicit): left out. They have no writer since task 459 and the owner never asked for them. buildRelief keeps
  honouring them, so packages/core is not touched. Removing them is the optional last task (T9).

The declared record (`DEFAULT_STOCK` + the card's typed thickness) stays as it is. It is the website's stock when there is no Stock op, and
the fallback for `'unset'`.

### 2.2 Defaults

- Website: no Stock op -> bounds + 6 in margin, typed thickness, default 19.05 mm (3/4 in). Unchanged.
- Fusion setup: every setup has its Stock op from the start: geometry EMPTY (part bounds + margin), `cutDepth: 'model'` (from the part,
  turn 3641). The user may pick a stock sketch (the footprint becomes that profile) and / or type a thickness.

### 2.3 "From the part": what it reads and when

- The part thickness of a setup = the largest `thicknessMm` of the setup's parts, i.e. of the selection entries (F4: the value is already
  there, selection-edit.js:86). Nested parts of different heights get the thickest, the same rule as today's add (fusion-import.js:562).
  A setup whose parts carry no thickness (sketch-only parts) resolves `'model'` to the declared record's thickness, the same way Depth
  `'model'` falls back to `'unset'` (cut-plan.js:44).
- It is re-read, never copied. `recordOf` resolves `'model'` at read time from `regionOf(key).source` (cut-plan.js:40-44). For the Stock
  type, the same read takes the setup's part thickness instead of the region's depth: ONE place, `recordOf`, decides what `'model'` means
  for each type. When the part changes in Fusion, the add-in sends `selection_data` again, the entry is replaced (fusion-import.js:553-554,
  `upsert`), and the next resolution reads the new thickness. A reopened per-design project resolves at once from the persisted
  `thicknessMm` (fusion-bridge.js:104), before the re-extraction arrives.
- F5 must be fixed in the add-in (T8a): a multi-body selection must say each body's thickness.

### 2.4 The one resolver: `resolveStock`, EXTENDED, not replaced

`resolveStock(state, setup)` stays the one function (apps/shaper/src/stock.js). It stays app state, not #core: only Shaper has a stock, and
the cut-plan store it reads is app state (cut-plan.js:6).

- In: the solved state and the setup (the website's implicit setup = the whole design).
- Out: `{ stock, board }`. `stock` is exactly what buildRelief takes today: `{ thickness, margin, width, height, profile? }`, so
  packages/core does not change. `board = { kind: 'bounds' | 'profile', key: <Stock op geometry key> | null, thickness,
  thicknessFrom: 'typed' | 'model' | 'default' }` replaces `fromLoop` (two callers: stock-card.js:23, and the tests).
- `bounds` for the bounds form = `drawingExtent` of the setup's own shapes: a view of the state with only those shapes, as fusion-import.js:565
  already does for `fitToDrawing`. geometry-bounds.js is not changed.
- `reviewSig` (shaper-app.js:851) carries the RESOLVED stock (F2). Otherwise a part's new thickness would not rebuild the 3D board.

## 3. How setups use it

### 3.1 The setup

`setup = { id, name, parts }`, plus `op.setupId` on every operation, Stock included. `parts` = the selection entry ids (the Fusion
bodies / sketches picked as the "Model"). The website has ONE implicit setup with `parts: null` = the whole design, and never shows it
(section 11.3: the website keeps its own flow). Old files open as that implicit setup (turn 3603: no migration code; a missing `setupId` IS
the implicit setup).

- ONE Stock op per SETUP, instead of one per document. The three places that enforce "one" become per setup: cut-plan.js:314-323 `setStock`,
  :326-328 `changeOpType`, :1072-1075 `stockKeyOf` (and with it the Roughing boundary 'Stock', cut-plan.js:122-129).
- An operation belongs to the setup it was created in. Its geometry must come from the setup's parts: the add-in's dialog accepts only
  those faces (section 11.5), and the palette refuses any other geometry (one `typeRefusal`-style rule, cut-plan.js:279).

### 3.2 Nested parts on one board vs separate boards

- Nested on one board = ONE setup with several bodies. The add-in projects them into the one frame of the setup. A multi-body selection
  already arrives as ONE message with the bodies' regions merged (fusion_selection.py:1377-1386, frame attached at :1390); T8b confirms
  that every body of a setup is projected in the same frame. Footprint = the drawn extent of all of them + margin, or the stock sketch.
  Thickness = the thickest (2.3).
- Separate boards = one setup each, each with its own frame, Stock, operations, 3D board and SVG. Parts that overlap in XY in Fusion do not
  mix: loops are topological (packages/core/loop-finder.js:1, :193) and hole ownership is per sketch (task 774), and each import is its own
  sketch. A test asserts this (T5).

### 3.3 The SVG page / frame per setup

The same rules as today, scoped to the setup:
- the file = the setup's ticked operations;
- the frame (shaper-export `options.frame`) = the setup's whole plan, so a partial file of a setup lines up on the Origin with that setup's
  full file;
- the page = `boundsOf` over the setup's drawn extent ∪ its written elements;
- a setup with a stock sketch writes it first as the Stock guide (`exportFirst`);
- a setup without one gets the frame guide on a partial file (shaper-export.js:283-288).

The bounds + margin board stays a 3D / preview concept and is not written into the file (today's rule, 1.3). File name: the design's name +
" - " + the setup's name, then task 884's ticked part (export-payload.js:34-43 `exportFileName(designName, ops)`, given the setup's
operations). With the implicit setup (the website) the file and its name are byte-identical to today's.

## 4. UI

### 4.1 Website stock card: no change in behaviour

- The readout comes from `resolveStock(...).board.thickness`, as it does today through `fromLoop` (stock-card.js:23-24).
- With a non-empty Stock loop the card stays disabled ("set it in Prepare", param-hints.js:225-226).
- With no Stock op, or an EMPTY one, the card edits the thickness the board actually reads: the record when there is no Stock op (today), or
  the empty op's `cutDepth` (new, F1; on the website the board looks the same unless an old file has a typed thickness on an empty Stock).
- Clearing the field = "from the part" (`'model'`) when the setup's parts have a thickness. This is the Roughing Depth rule: a field
  emptied = model (cut-plan.js:341). Otherwise clearing does nothing, as today. On the website, only STL parts carry a thickness: see
  Q3.
- The tooltip (param-hints.js:222-226) gets one more note: "From the part: <t>". The field shows the resolved value either way.

### 4.2 Fusion: the Stock item in a setup

- In the palette's setups list: Setup > Stock (one row, always there, not tickable) > its operations. The Stock row reads, for example,
  "Stock · part bounds + 6 in · 38.1 mm (from part)" or "Stock · Sketch3 · 1 in".
- The native Fusion Stock dialog (add-in, T8c) has two parts:
  - footprint: "From part bounds + margin" (the default: an empty Stock op) or a sketch-profile selection input (sketch profiles only);
  - thickness: a "From part" checkbox (on by default = `'model'`) or a value (typed).
  OK sends `select_for_operation`-style data for the Stock op (the existing SA-16 path) plus the thickness.
- Until that dialog exists (T4): the palette's Stock row gets "Select in Fusion" (today hidden, fusion-bridge.js:794). The user picks the
  stock sketch with the existing SA-16 flow. The Export footer's thickness field (task 880) follows 4.1.

## 5. The task split (each mergeable alone; the website unchanged unless the task says so)

No task touches packages/core except the optional T9. Every other task works in apps/shaper, which the website and the Fusion panel
(build-site.cjs shaper-fusion) share, or in shaper-addin. If a task finds it has to change #core, STOP and ask.

| # | Task | Where | Visible change | Tests that prove it |
|---|---|---|---|---|
| T1 | `resolveStock` extended (2.4): `board` replaces `fromLoop`; the Stock type's `'model'` = the parts' largest thickness (`recordOf`, ONE place); an EMPTY Stock op's set thickness is read (F1); `reviewSig` carries the resolved stock (F2) | apps/shaper: stock.js, cut-plan.js (`recordOf`), stock-card.js, shaper-app.js:851 | website: none, except an old file with a typed thickness on an EMPTY Stock op (F1: the board now uses it). Fusion: none yet (nothing writes `'model'` on a Stock) | new tests/stock-model-890-node.test.js (every row of 2.1 × typed / model / unset; parts of 2 thicknesses -> the max; a part's new `thicknessMm` -> new board, new `reviewSig`); stock-loop.test.js:137-140 moved from `fromLoop` to `board` (the only test change); unchanged and green: stock-loop-node, stock-outline-825-node, board-extent-879-node + live, relief-model, perdesign-855-node, fusion-import-664-node |
| T2 | Fusion import: the default branch (fusion-import.js:559-562, `stock` option null: the Fusion selection) ensures ONE EMPTY Stock op with `cutDepth: 'model'` instead of writing a number; an add no longer raises a typed thickness and says a taller part instead (stl-import.js:96 rule). The STL options `'keep'` / `'part'` are unchanged | apps/shaper: fusion-import.js | Fusion: a Stock row appears after the first import (Q2); typed thickness kept on add (today raised to the max) | fusion-import-664-node / live, stockkeep-864-live, perdesign-855-node / live (the Stock op with `'model'` saved and resolved on reopen from the persisted `thicknessMm`), insert-stl-841-node / live and stl-open-790-live unchanged |
| T3 | Stock card rule 4.1 (empty Stock op edited; cleared field = from the part) + the tooltip note | apps/shaper: stock-card.js, param-hints.js | website: only through Q3 | stock-model-890-node (card cases through the node kit: tests/helpers/node-app.js `createStockCard`), export-header-880-live, a new stock-card-890-live (desktop + phone) |
| T4 | Fusion: "Select in Fusion" on the Stock row = pick the stock sketch (fusion-bridge.js:794); the assign onto a Stock keeps ONE closed shape (the largest outer; its holes = a combined profile, as fusion-import.js:431-436) | apps/shaper: fusion-bridge.js, fusion-import.js | Fusion only | opselect-806-node / live, stockkeep-864-live, fusion-mode-663-node |
| T5 | SETUPS in the store: `setups`, `op.setupId`, the implicit setup; ONE Stock per setup (cut-plan.js setStock / changeOpType / stockKeyOf / the Roughing boundary); `resolveStock(state, setup)`; saved in the sidecar and the Fusion project | apps/shaper: operations-store.js, cut-plan.js, stock.js, shaper-doc.js, fusion-bridge.js | none (one implicit setup everywhere) | new setups-890-node (two setups: two Stocks, each resolves its own; parts overlapping in XY do not share loops or holes, 3.2); every Stock test above; perdesign-855; shell-smoke |
| T6 | Per-setup readers: the 3D board and simulation (`reviewInputs`), the export file / page / frame / file name (3.3), Fusion's live toolpaths per setup | apps/shaper: shaper-app.js, export-payload.js, fusion-toolpaths.js | none on the website: the SVG is byte-identical (oracle) | a byte-identity oracle over the existing export fixtures (implicit setup = today's bytes); setups-890-node (two setups -> two files, each page its own extent); fusion-toolpaths-799-node |
| T7 | Fusion palette: the setups list (Setup > Stock > operations), Export per setup (setup choice in the Export header) | apps/shaper (Fusion entry only: the website never shows setups) | Fusion only | new fusion-setups-890-live (Fusion stub, desktop + phone), fusion-panel-881-live |
| T8a | Add-in: each body's thickness in a multi-body selection (F5; e.g. `stock.thicknessMm` per body / region; the contract in docs/SELECTION-BRIDGE.md first) | shaper-addin | Fusion | the add-in's selection tests + a palette node test (two bodies -> max) |
| T8b | Add-in: native Setup command (pick bodies = the Model) and the operation dialogs limited to the setup's faces | shaper-addin (+ a `setup_data` message in apps/shaper fusion-bridge.js) | Fusion | add-in tests; a live Fusion check by the advisor |
| T8c | Add-in: native Stock dialog (4.2) | shaper-addin | Fusion | add-in tests; a live Fusion check |
| T9 (optional, owner) | Remove width / height (no writer since 459) | packages/core relief-model.js:23, :342-351 (SHARED: only Shaper imports relief-model) + stock.js | none | relief-model.test, board-extent-879-node |

Order: T1 -> T2 -> T3 -> T4 can ship before setups and already give Fusion "thickness from the part". T5 -> T6 -> T7 build the setups.
T8a can run in parallel with T1. T8b / T8c follow T5.

## 6. Open questions for the owner (max 3)

1. **Stock typed thicker than the part (Fusion): where is the part, and do its through cuts follow?** Recommended: the part's top = the
   stock's top (Shaper cuts from the surface; the viewport toolpaths already measure from the part's top, fusion-toolpaths.js:16). Cuts
   whose depth is "from model" keep the PART's depth, as in Fusion CAM. The 3D board shows that they do not go through, and Export says it
   ("Outside 38.1 mm: the stock is 50.8 mm"). Nothing is changed silently.
2. **Every Fusion design gets a Stock row from its first import (empty footprint = part bounds + 6 in, thickness from the part, T2)?**
   Recommended: yes. It is the setup's Stock item, as in Fusion CAM, and it is where the user picks the stock sketch. The margin is the
   same declared 6 in (task 879), with no field.
3. **On the website, clearing the stock thickness field = "from the part" when the design has a part with a height (an opened or inserted
   STL)?** Recommended: yes, so there is ONE card and ONE rule for both hosts. Today clearing the field does nothing, and an opened STL
   already sets the thickness to its height (stl-import.js:110-113).

# Operations model: operation first, and an Operations palette (task 811)

DESIGN ONLY, for the owner's approval before any building. Owner turns 2673-2675: "what is possible if we make every op
addable before geometry is assigned to it?", then "Lets make a pallette of ops". Every statement about today's code cites
`file:line` at commit `18d6e14` (task 809's head). Nothing under `apps/` or `packages/` changes with this note.

---

## 0. For the owner (one page, plain words)

**What you will see change**

- **Operations come first.** You can add an operation (say "Pocket") before it has any shape. It shows in the
  Operations list as *empty* ("no shapes yet: click shapes to add"). Then you click shapes on the drawing to put them in
  it, and click again to take them out. Later, in Fusion mode, "Select in Fusion" on that operation does the same from
  the model (task 806).
- **One shape can be in several operations.** Roughing, Contour and later a rest pass can all use the same part.
- **Contour is an operation of its own.** It is no longer a switch in the Roughing card, and adding or removing it no
  longer changes Roughing's wall allowance behind your back: the allowance is a plain Roughing setting.
- **An operations palette** *(S3 as built: the operations toolbar on Design's tool ribbon, across the top: 4.1)* sits at the top of the Operations card: one button per operation type. Click a button:
  an empty operation of that type appears, selected, ready for shapes. Drag a button onto a shape: the operation
  appears with that shape in it.
- **My lineups:** set up a few operations once (for example a 1/4 in Roughing + a 1/8 in ball-nose Contour + an
  Outside cut with tabs), save them as a lineup, and later apply the whole lineup to any part in one click (always as NEW operations). Your lineups
  follow you to your other devices through Google Drive, like your other settings.
- **The quick way is a standard shortcut (owner turns 2682-2684):** click geometry first, then pick an operation type.
  It ALWAYS creates a NEW operation of that type holding the selected shape(s) and leaves it selected, so further clicks
  on shapes add them to it. It never joins an operation you used before.
- **Editing an operation edits all its shapes.** The card says so ("Pocket 2 · 3 shapes: a change applies to all 3")
  and has a "Make its own operation" button for when one shape must differ. Today a changed depth quietly makes a new
  row; with this, the row stays where you put it in the list.
- **Your saved designs open unchanged:** the same operations in the same order, and the exported SVG byte for byte the
  same as before (this is tested on every kind of design before anything ships).
- **A shape in two operations = two identical paths in the file**, one per operation, each with its own depth, type
  and bit, never merged. Your test on the Origin (the overlapping squares and circles) decides one thing: if the Origin
  lets you reach and cut every copy, nothing more is needed; if it hides or merges copies, Export will say which ticked
  operations share shapes so you export them one at a time (section 8).

**What it looks like** (desktop: the Operations card top left, as today; phone: the same card in the bottom sheet)

```
 ┌ Operations (3) ────────────────────── ▾ ┐
 │ 2D  [▢ Outside][▣ Inside][▦ Pocket]      │   <- the palette: never moves,
 │     [╱ On line][┐ Guide]                 │      buttons grey out (with the reason
 │ 3D  [≋ Roughing][∿ Contour]  [My lineups▾]│      in a tooltip), never disappear
 ├──────────────────────────────────────────┤
 │ CHANGE TO 1/4″ END MILL                  │
 │ ☑ 1  Roughing · 0–19 mm · 1 mm step   🗑 │
 │       Relief · 1 shape                   │
 │ CHANGE TO 1/8″ BALL NOSE                 │
 │ ☑ 2  Contour · 0.25 mm step           🗑 │
 │       Relief · 1 shape                   │
 │ NO BIT YET                               │
 │ ☑ 3  Pocket · depth unset             🗑 │
 │       no shapes yet: click shapes to add │   <- an empty operation, selected
 └──────────────────────────────────────────┘
```

**Owner rulings since the first draft** (turns 2682-2684; they answer the two questions this note first asked)

1. **Quick way:** click geometry first, then an operation type = a NEW operation holding the selected shape(s), left
   selected; further shape clicks add to it. No "join the last-used operation".
2. **Lineups:** applying a lineup ALWAYS creates NEW operations (to a second part too). No joining, no "as new
   operations" variant.

Everything else has a default I chose that is easy to change later; section 7 lists them.

---

## 1. The data model

### 1.1 Today (what is stored, what is derived)

- The stored fact is a **record per geometry**: `CUT_PLAN = new Map()`, key `loop:<id>` / `profile:<id>` / `chain:<id>`
  (`apps/shaper/src/cut-plan.js:22`, keys explained at `:1-5`); a record holds the cut type, every setting AND the
  geometry's own data (`slope`, `levels`: `apps/shaper/src/fusion-import.js:94-101`).
- A part's Contour is a second record keyed `contour:<the part's key>` (`cut-plan.js:27-36`) that borrows the part
  record's depth, type, slope and levels at derivation time (`resolveEntry`, `cut-plan.js:39-44`). Turning it on sets the
  part's Roughing allowance; turning it off puts it back to 0 (`setContour`, `cut-plan.js:54-66`, lines 60 and 63): one
  setting silently changes another.
- **Operations are derived** every time: records with the same tool + cut type + settings are one operation
  (`apps/shaper/src/operations.js:1-8`, `opKeyOf` `:95-98`, `settingsOf` `:70-92`, `planOperations` `:214-238`). The only
  stored operation fact is the ORDER, a list of operation keys (`operations.js:33-37`), saved and undone with the plan
  (`apps/shaper/src/shaper-doc.js:31`, `:44`).
- Consequences: an operation cannot exist without a shape (empty = gone); one geometry key holds one record, so a shape
  can be in only one operation (plus the special Contour); editing a depth makes a NEW operation that loses its place in
  the list (WORK-LOG TURN 743, FOUND (1)); a tick or a "Select in Fusion" per operation has nothing stable to hang on.
- The exporter takes `entries` = `[{ target, rec }]` in PLAN order (the Map's insertion order: `cutPlanEntries`,
  `cut-plan.js:385-391`) and writes the elements in that order (`packages/core/shaper-export.js:176`, loop at `:220`);
  operations never change the file (TURN 743 send-back: "display groups only").

### 1.2 Proposed: three stores

| Store | Lives in | Holds |
|---|---|---|
| **operations** | the document (Shaper sidecar `doc.hosts.shaper`, version 3) | the user's operations, in list order |
| **regions** | the document (same sidecar) | the data that belongs to a GEOMETRY whatever operations use it |
| **lineups** | the user's settings (synced to Drive per lineup) | saved sets of configured operations, no geometry |

```jsonc
// doc.hosts.shaper, version 3 (stock / stl / selections unchanged)
{
  "version": 3,
  "operations": [                         // array order = the Operations list order (no separate opOrder)
    {
      "id": "op-7",                       // stable for life: ticks (798), Select in Fusion (806), the preview's data-op
      "type": "roughing",                 // a CUT_TYPES id
      "on": true,                         // the tick (task 798); true for every migrated / new operation
      "settings": {                       // ONLY this type's declared fields (1.5), base mm, exactly today's field names
        "cutDepth": "model", "toolDia": 6.35, "cutterShape": "endmill", "stepDepth": 1, "finishAllowance": 0.5,
        "roughLayout": "terraces", "smoothing": 0.1
      },
      "geometry": [                       // the shapes it cuts
        { "key": "loop:loop_a-b-c", "seq": 1 }   // seq = the file order (1.6); "tabsAt" = its dragged tabs (TASK 822; TASK 836: the lead-in "at" is gone)
      ]
    }
  ],
  "regions": {                            // per geometry key; written only when there is something to keep
    "loop:loop_a-b-c": {
      "levels": [ /* the STL / payload sections, as today's record.levels */ ],
      "slope": null,                      // a Fusion region's rings, as today's record.slope
      "source": { "cutType": "roughing", "cutDepth": 19.05 }   // what the import said (today: selection entry `base`)
    }
  },
  "nextSeq": 2,
  "listOrder": "default",               // "default" | "stored" (task S1, advisor turn 2702): see below
  "stock": { }, "selections": [ ], "stl": { }
}
```

**`listOrder`** (task S1, advisor ruling turn 2702): the default operation order is a safety rule (the cut that frees the part comes last, after the
holes). `"default"` = the user has never reordered the list: the operations are kept in the default order (`defaultOpOrder`, `operations.js:10-20`),
re-sorted after EVERY change (as before S1); `"stored"` = the user reordered (the list's drag / arrows), or a version 2 document stored an `opOrder`:
the array order is the user's, and a new operation is slotted in once by the 743 rule. Saved, undone and synced with the operations. S2 keeps it (a new
operation is placed by the default rule while `"default"`).

### 1.3 Where each field of today's record goes

| Today's record field (cited where it is read) | Goes to | Why |
|---|---|---|
| `cutType` | operation `type` | the operation IS a type |
| `cutDepth`, `cutOffset`, `toolDia`, `cutterShape`, `cutterAngle` | operation `settings` | machining settings |
| `stepDepth`, `adaptiveSteps`, `stepDeviation`, `finishAllowance`, `roughLayout`, `minTerraceWidth`, `smoothing` (`operations.js:77-84`) | operation `settings` | |
| `holdPart`, `tabCount`, `tabWidth`, `holdThickness` (`operations.js:85-87`) | operation `settings` | |
| `clearing`, `stepover`, `rasterAngle`, `loop`, `loopPitch` (`operations.js:88-89`, `packages/core/pocket-clearing.js:152-161`) | operation `settings` | |
| `leadIn`, `leadInSide`, `leadInRadius`, `leadInSweep`, `leadInLength`, `leadInAt` | none (TASK 836: lead-ins removed; dropped on load, `apps/shaper/src/shaper-doc.js` dropLeadIn) | |
| `slope` (`fusion-import.js:99`), `levels` (`:100`) | `regions[key]` | the shape's own geometry by height; every operation on it reads the same |
| Fusion's `cutType` / `cutDepth` as the payload gave them (selection entry `base`, `apps/shaper/src/selection-edit.js:43-47`) | `regions[key].source` | lets "Depth: from model" follow a Fusion edit (1.4) |
| `contour:<key>` record (`cut-plan.js:27-36`) | an ordinary `contour` operation whose geometry is the part's key | Contour is its own operation (owner decision c) |
| the Contour's borrowed `baseDepth` / `baseType` (`cut-plan.js:43`, read at `packages/core/stepped-cut.js:402`, `:578`, `:588-589`, `:888`, `:908`) | Contour settings `cutDepth` (`"model"` or a value), `wallSide`, `walls` | explicit settings instead of reading another record (owner decision c, 1.4) |
| `opOrder` (`operations.js:33-37`) | the array order of `operations` | |

### 1.4 Shapes whose settings differ inside one operation: the proposal

**Proposal: no hidden per-shape overrides.** An operation's card shows its settings and they ARE what every one of its
shapes is cut with. Where shapes really need different values there are exactly three honest mechanisms:

1. **"From model" for the depth** (Fusion regions and STL reliefs). `cutDepth` may be the value `"model"`: each shape is
   cut to its own imported depth (`regions[key].source.cutDepth`). The card's Depth row reads "From model: 3 depths,
   4–8 mm" and offers a typed value instead. This is how CAM programs do it (Fusion CAM's "bottom: selected contour"),
   it follows a Fusion edit by itself (today that needs the `base` bookkeeping in `selection-edit.js:58-69`), and a shape
   without a model depth (drawn by hand) shows as "no model depth: type one" in the operation's note: a fact, not a
   guess. Contour's depth works the same way and replaces the borrowed `baseDepth`.
2. **Per-shape placement** that only means something on one outline: the dragged lead-in position (`leadInAt`; TASK 836: removed, the dragged tabs `tabsAt` are the mechanism's one user). It is
   stored on the geometry ref and drawn as the handle on that shape, so it is visible where it applies; it is not a
   machining setting. (Today it is part of the operation key, so every dragged handle makes its own operation:
   `operations.js:90`; probe below.) *(Task 822: the dragged TABS are the second such placement: `tabsAt` on the geometry ref, section 10.)*
3. **"Make its own operation"**: the shape leaves the operation into a new one with the same settings, then the user
   changes what differs. Two rows, two honest cards.

Why not overrides: an override makes the card lie ("6 mm" while one shape is cut at 8 mm), every derivation and every
queued task (798 ticks, 801 simulation, 806 Select in Fusion) would have to merge two layers of settings, and the owner's
rule is plain settings, honest hints, no guessing.

**Contour, explicit instead of borrowed.** *(S2: see 9.3 / 9.4: the Contour is a plain operation with its own Depth (the one depth row; no Bottom), Walls and Wall side; no part link.)* Today the Contour reads its part record's type to decide which side its walls
are and whether to skip the full-depth wall that a plain Outside / Inside cut already makes (`stepped-cut.js:573-581`,
`:906-911`). In this model those are two Contour settings: `wallSide` (Inside the shape: a pocket's wall | Outside the
shape: a part's outline; used only when the region's own `slope.kind` or `levels` do not already say it, as today) and
`walls` (All levels | Sloped only = skip the level whose outline IS the shape's own wall, exactly today's
`sameOutline` filter at `stepped-cut.js:909-911`). Task 810's planned "which walls: All | Sloped only" row is this same
setting (section 5).

### 1.5 One declaration: each cut type's settings fields

Which fields belong to which type is today spread over `settingsOf` (`operations.js:70-92`), the card's row rules
(`apps/shaper/src/cut-panel.js:21`, `declaresOf` at `:82`) and the cut types' `params` (`apps/shaper/src/shaper.js:119-124`).
The model needs it in ONE place: `CUT_TYPES[i].fields` (shaper.js), read by the card (which rows), by the operation
settings (what is stored), by the migration (what must be equal for two records to share an operation) and by
lineups (what is saved). DECLARE over hand-roll.

It closes a real gap: `loopPitch` changes a pocket's cuts (`pocket-clearing.js:158-160`) but is not in today's operation
key. Probe (`.evidence/811/probe-opkey.mjs`, output verbatim):

```
loopPitch 1 vs 2 (Loop-on Spiral pocket): same operation key = true
cutDepth 6 vs 8: same operation key = false
slope present vs absent: same operation key = true
leadInAt 0.1 vs 0.6 (On line, lead-in on): same operation key = false
```

No card row sets `loopPitch` today (`grep loopPitch apps/shaper/src` finds nothing), so no user meets it yet; task 810
adds a "Loop pitch" row (its PASSES tab), which would make two different pockets one row. With the declared table
the field is in the operation's settings by construction.

### 1.6 Invariants

- An operation may have no geometry (empty). It derives no cuts, is skipped by the export, the 3D Review, Paths and the
  simulation, and is listed with "no shapes yet".
- A geometry key appears at most once in one operation; it may appear in any number of operations.
- **File order** = the geometry refs of every operation sorted by `seq` (one counter per document, `nextSeq`). A NEW
  membership takes the next number (today: a new record is appended to the Map); a membership that MOVES (type
  change, "Make its own operation", the stage-1 regrouping in section 6) keeps its number (today: editing a record keeps
  its place in the Map). The file never follows the list order (TURN 743 ruling kept).
- `regions` entries are never mutated, only replaced (they hold the large `levels`: undo snapshots share them by
  reference, as records share them today: `shaper-doc.js:23`).
- Renaming a geometry key (the bezier chain-to-loop move `cut-plan.js:527-551`, the old-hole-rule profile move
  `:568-598`) renames it in `regions` and in every operation's refs and in any setting that holds a key (task 810's
  "Boundary: Shape"): one function, `renameGeometry(old, new)`.
- One Stock per document stays (today `stockKeyOf`, `cut-plan.js:685-688`): a `stock` operation with exactly one shape,
  listed under "Not cut" as today.

---

## 2. Every derivation reads operations, not geometry records

THE one reader: `planEntries({ ticked })` replaces `cutPlanEntries` (`cut-plan.js:385-391`) and `resolveEntry`
(`:39-44`). It walks the operations, makes one entry per geometry ref, sorts them by `seq`, and returns today's entry
shape plus the operation id:

```
{ key: '<op id>|<geometry key>', opId, target: parseKey(geometry key), rec: recordOf(op, ref) }
recordOf(op, ref) = { cutType: op.type, ...op.settings, ...regionData(ref.key), tabsAt: ref.tabsAt,
                      cutDepth resolved ("model" -> regions[key].source.cutDepth), Contour: baseDepth / baseType from its settings }
```

`recordOf` rebuilds exactly the record today's derivation receives, so `#core` keeps its interfaces: `deriveCuts`
(`stepped-cut.js:467`), `exportShaperSVG` (`shaper-export.js:176`) and `ownedLoopIds` (`packages/core/profile-model.js:669`,
"a hole with its own entry is cut by that entry only") take the same entries as today.

| Module | Today | Change |
|---|---|---|
| `apps/shaper/src/cut-plan.js` | `CUT_PLAN` Map (`:22`), `getCutRecord` / `setFieldFor` (`:24-25`), Contour helpers (`:27-66`), `cutPlanEntries` (`:385`), the plan-wide notes `planHoldNotes` / `planLeadInNotes` / `planClearingNotes` / `planSteppedNotes` / `planLevelsNotes` (`:160`, `:222`, `:331`, `:377`, `:436`), `deriveKeyFootprints` (`:623`), `planOwnedLoops` (`:635`), `planReliefItems` (`:663`), `stockKeyOf` / `planStockProfile` (`:685`, `:696`), `assignImportedCuts` (`:723`) | the store becomes `OPERATIONS` + `REGIONS` (a new `operations-store.js`, the one writer: `addOperation`, `removeOperation`, `setOpField`, `addShapes`, `removeShapes`, `moveShapes`, `renameGeometry`); every `plan`-walking function iterates `planEntries()` instead of the Map (same per-entry calls); the Contour key helpers (`contourKeyOf`, `isContourKey`, `partKeyOf`, `contourOf`, `setContour`, `resolveEntry`) go; `stockKeyOf` = the Stock operation's shape; `assignImportedCuts` makes operations grouped as today's derivation groups records |
| `cut-plan.js` reconciliation (`:454-598`) | renames / drops keys in the Map | renames through `renameGeometry`; `migrateEdgeRecords` runs inside the v2 migration only |
| `apps/shaper/src/operations.js` | groups records into operations (`planOperations` `:214`), order by keys (`:33-37`, `orderOps` `:121`) | `planOperations` becomes `describeOperations(state)`: the STORED operations, in array order, each with its entries' cuts and today's words (`describe`, `:155-203`, unchanged); `opKeyOf` / `settingsOf` / `orderOps` stay for the migration and for placing a NEW operation in the list (the 743 default-order rule, `:10-20`, applied once at creation while `listOrder` is `"stored"`; while it is `"default"` the whole list is re-sorted by `defaultOpOrder` after every change: task S1, advisor turn 2702); `assignIds` (`:142`) is replaced by the stored id; `opIdsByPlanKey` (`:241`) = `entry.opId` |
| `apps/shaper/src/op-list.js` | rows of derived operations, bin = unassign the regions (`:13`, `:161-163`) | rows of stored operations; an empty row ("no shapes yet: click shapes to add"); the palette strip in the header (section 4); bin = delete the operation (its shapes stay in their other operations); drag reorders the array (one undo step, as `prepare-stage.js:67`) |
| `apps/shaper/src/prepare-stage.js` | card edits go to the selected records (`:56-58`), a row tap selects its regions (`:68`), the bin unassigns (`:73-77`) | the ACTIVE operation (one at a time) is the card's subject; a row tap makes it active and selects its shapes; the bin deletes the operation; `cutEdit` (`:45-54`) unchanged (one undo step) but compares the operations store only, not the large `regions` (today it stringifies the whole plan, levels included, twice per edit: `:48`, `:52`) |
| `apps/shaper/src/prepare-view.js` | selection = plan keys incl. `contour:` targets (`:276`, `:813-816`); `applyCutTypeToSelected` (`:825-856`), `setFieldOnSelected` (`:858-903`) write records; the look walks `CUT_PLAN` (`:503`, `:508`, `:530`, `:562`, `:594`, `:624`) | selection = geometry keys only; "Add shapes" mode for the active operation (a click toggles a shape in / out of it); the quick flow (4.4) replaces `applyCutTypeToSelected`; `setFieldOnSelected` becomes `setOpField(activeOp, ...)` with today's remembered-defaults rules (`:860-898`) kept; the look walks `planEntries()`; the Roughing allowance write on Contour (`:849`) goes |
| `apps/shaper/src/cut-panel.js` | one card for the selected records; the Contour row + "Edit contour" (`:133-137`, `:559-563`) | the card edits the active operation's settings; a header line "Pocket 2 · 3 shapes" and a Geometry row (Add / Remove shapes, Make its own operation); the shape card (4.3) when a shape is clicked with no operation active; the Contour row goes (Contour is a palette / menu type) |
| `apps/shaper/src/shaper-doc.js` | captures `cutPlan` + `opOrder` (`:23`, `:31`, `:44`), maps old values on read (`:54-76`), reconciles (`:84-94`) | captures `operations` + `regions` + `nextSeq`; `applyShaperDoc` runs the v2 to v3 migration (section 3) after today's value mapping (`withClearingNow`, `opKeyNow` are reused unchanged) |
| `apps/shaper/src/fusion-import.js` | `plan.set(key, buildCutRecord(...))` per region / chain (`:341`, `:363`), operation order reset on a fresh start (`:377`) | region data to `REGIONS` (`slope`, `levels`, `source`); regions with a payload cut type go into operations made by this import (grouped as today's derivation groups them, Depth "From model"); a fresh start empties the operations store instead of resetting the order |
| `apps/shaper/src/selection-edit.js` / `selection-list.js` | `priorRecords` / `keepSettings` keep a matching region's record (`selection-edit.js:30-69`), `dropSelectionGeometry` deletes its plan keys (`:74-79`) | an update keeps a matching region's MEMBERSHIPS (same signature = same shape: its refs are renamed to the new key); a removed region leaves every operation (operations stay, possibly empty: SA-15); `cutKeys` keeps naming geometry keys |
| `apps/shaper/src/export-payload.js` | `shaperSvgOf(state, entries)` (`:168`), `shaperPreviewOf` tags entries with derived op ids (`:180-186`) | unchanged interface; the preview's `data-op` = `entry.opId` |
| `apps/shaper/src/main.js` | `cutPlanEntries()` (`:101`, `:454`), `planReliefItems` + `reviewSig` with `opOrder()` (`:698-700`) | `planEntries({ ticked: true })` (798); `reviewSig` uses the operations store |
| `apps/shaper/src/export-preview.js` | groups the preview's elements by `data-op` in the derived operations' order (TURN 743) | same, with stored operations |
| `apps/shaper/src/stock.js` / `stock-card.js` | `resolveStock(state, CUT_PLAN)` (`stock.js:29`, `stock-card.js:19`) | `resolveStock(state)` reads the Stock operation |
| `apps/shaper/src/cut-import.js` | `assignImportedCuts(state, ..., CUT_PLAN)` (`:44`) | through the store |
| `packages/core/stepped-cut.js` | Contour infers its side and the own-wall skip from `baseType` (`:578`, `:908`) | reads `wallSide` and `walls` (explicit; 1.4); `baseDepth` stays (filled by `recordOf` from the Contour's Depth). The only `#core` change, byte-identical by the migration test |
| `packages/core/shaper-export.js`, `profile-model.js`, `relief-model.js`, `hold-part.js`, `pocket-clearing.js`, `lead-in.js`, `level-smooth.js` | read entries / records / footprints | unchanged |

---

## 3. Migration of saved documents (v2 records to v3 operations)

Where: `applyShaperDoc` (`shaper-doc.js:84`), the one read of a stored Shaper document, after today's value mapping
(`withClearingNow` `:62-69`, `opKeyNow` `:70-76`) and the reconciliation (`:91-93`). The file changes only when the user
next saves (as today).

**Steps**

1. Today's reconciled Map, in its order: index `i` of each record = its `seq` (so the file order is kept exactly).
2. Region data out of each record: `slope`, `levels` to `regions[key]`; `source` from the selection entry's `base[key]`
   when there is one.
3. Group the records by today's operation key `opKeyOf` (`operations.js:95`): the operations the user sees today.
   A `contour:<key>` record joins a Contour operation whose ref is `<key>`, with `cutDepth` = the part's depth at the
   moment of migration (`"model"` when it equals the region's source depth), `wallSide` / `walls` from the part's type as
   `stepped-cut.js:578` / `:908` read it today.
4. Inside a group, compare each record's DECLARED fields (1.5). Records equal in all of them share one operation;
   a record that differs in a declared field (today only possible through `loopPitch`, 1.5) becomes its own operation
   right after it: lossless by construction, and counted in the migration report (expected 0 on every real document).
5. `leadInAt` moves to the ref; Depth becomes `"model"` where the record's depth equals `base.cutDepth` (Fusion /
   STL regions the user did not retype), else stays the typed value.
6. List order = `orderOps(derived, storedOrder)` (`operations.js:121`) on today's operations: the exact list the
   user had (a stored order of old keys is first mapped by `opKeyNow`, as today).
7. Ids `op-1 ... op-n` in list order; `on: true`; `version: 3`.

Unassigned records (cut type null: left by a bin or a Stock move, `prepare-stage.js:75`, `prepare-view.js:834`) are not
migrated: they derive nothing today and a geometry needs no record to exist.

**Test plan (all must pass before stage 1 ships)**

- *Baseline corpus, frozen from `origin/main` before stage 1* (as TURN 792 froze the stepped cases with
  `.evidence/792/stepped-md5.mjs`): a v2 sidecar per case + the md5 of (a) the downloaded SVG, (b) the 2D preview copy
  minus `data-op`, (c) the Paths view's `written` list (`export-payload.js:173`), (d) `planReliefItems` signatures,
  (e) the Operations list's `inspect()` items (`op-list.js:172-176`). Committed as `tests/fixtures/opfirst/` (sidecars +
  `baseline.json`). Cases:
  - every design the node tests build today with a plan (about 100 test files touch it: `grep -l "CUT_PLAN\|cutPlan\|setFieldFor\|contour:\|opOrder" tests` = 100), saved through `captureShaperDoc`;
  - the fixtures `real-solid-plate-711`, `hole-rule-774`, `bezier-loops-761`, `sa7-slope/*`, `leadin-775-before`,
    `pocket-clearing-749-main`, `pocket-clearing-750-before`, `pocket-804-morphed-main`;
  - the owner's STLs (rose, Green Man, floral) as reliefs: Roughing Terraces and Nested, + Contour 1/8 in ball, smoothing
    default and 0;
  - a generated matrix: every cut type x every settings branch (tabs, onion skin, refused hold; each clearing pattern,
    Loop on / off; lead-in calculated / dragged; adaptive steps; allowance; Stock loop; combined profile; chain; guide)
    x Contour on / off, two shapes per operation, plus a stored reordered `opOrder` and an old-value document (stepped
    types, `wallAllowance`, `passDepth`, `concentric`).
- *Assertions on the branch:* for every case, `applyShaperDoc(v2)` then (a)-(e) have the baseline md5s; the migration
  report has 0 splits (the designed `loopPitch` case: exactly 1, and its export still equal); v3 saved, reloaded = the
  same v3 JSON; Undo right after loading is a no-op; the selection list's rows unchanged.
- *Live:* open a migrated rose document on desktop and phone 390: the same list, the same 3D Review, the same download
  (md5).
- *Old app safety:* stage 0 (section 6) ships first, so an app that does not know version 3 refuses to save over it.

---

## 4. The UI

### 4.1 Where the operation buttons live: the OPERATIONS TOOLBAR on Design's tool ribbon (task S3, owner turns 2944-2950 and the placement choice)

*Owner ruling (task S3): "a tool bar with all the ops as buttons", "ok lets start with the design tool ribbon as a base"; of two placements shown side by side (a
ribbon across the top, or a compact icon deck inside the Operations card) the owner chose the RIBBON ("Ok ribbon"), its section names kept as Design's, and "the
checkbox and reorder feature" of Design's sections. The palette strip in the Operations card of the first draft (section 0's picture) is NOT built.*

- **One component, its own instance.** Prepare's toolbar is Design's shared tool ribbon (`packages/ui/tool-ribbon.js`, the one all four apps' Design tabs use),
  created by `apps/shaper/src/prepare-stage.js` with Prepare's own buttons (`sketchTools: false`: none of the sketcher's sections; Design's ribbon is byte-identical,
  before / after screenshots md5-equal). Shaper only.
- **Its buttons, ONE declaration.** One button per operation type of `CUT_TYPES` (`apps/shaper/src/shaper.js`), in the declaration's order (Outside, Inside, Pocket,
  On line, Guide, Stock, Roughing, Contour): the type's own icon, its name and its tooltip from the type's entry in `param-hints.js` (the type menu's words), in
  a section named OPERATIONS; then RECALCULATE (section 11) in a fixed section of its own (the divider; always shown, no dropdown, as Design's Select).
- **Place and style: Design's.** A bar across the top of the Prepare view, right below the document tabs, where Design's ribbon is; icon over name on a
  desktop, icons only (44 px targets, names in the tooltip on a long press) on a phone held upright, the vertical rail at the left on the short viewport (a phone
  in landscape), all the ribbon's own layouts. It lies over the canvas (the canvas never moves); the Operations card starts 12 px below it (desktop 1280 x 800:
  its top 169 px, 89 px before) and the notice too; the cut card's column only where the bar's buttons reach under it (a phone held upright: 89 px lower; on a
  desktop it keeps its place and height over the bar's empty end); on the short viewport the Operations card starts right of the rail. Prepare's document tab
  joins the toolbar below it, as Design's.
- **The sections' dropdown (TASK 647, as Design's).** The OPERATIONS name opens the section's dropdown: every type with its "in the bar" box, the type itself (it
  runs, also when it is not in the bar), and its hold-drag grip (reorder); Reset. What does not fit (a phone held upright: 7 of the 8) is in the dropdown,
  never lost. The user's layout is saved per user like Design's (`#ui/ribbon-layout.js`, the RIBBON_LAYOUT setting) under Prepare's OWN app key
  `RIBBON_LAYOUT.apps['shaper-prepare'].operations` (Shaper's Design is `apps.shaper`): neither ever reads or writes the other's. Default: every type in the bar,
  the declaration's order.
- **Keyboard:** the buttons are the ribbon's native buttons (Tab, Enter / Space); no shortcut keys are declared for the operation types.

### 4.2 A toolbar button (task S3; S2's open / OK / Cancel model, 9.1)

- **With shapes selected** = a NEW operation of that type holding them, created OPEN (OK keeps it, Cancel removes it): the quick flow (4.4).
- **With nothing selected** = a NEW EMPTY operation, created open; a click on a shape then puts it in (S2).
- **An operation open** = OK on it first (as any other action, 9.1); its shapes are the selection, so the new operation holds them.
- **Never greyed** (9.2): a pick none of the selected shapes can take creates NOTHING and the one plain line says why, in Prepare's one-line notice (no card
  shows for a selection); some cannot: they are left out and the open card's line names them.
- **The Stock** keeps the one-Stock move (the last closed shape picked); with nothing selected an EMPTY Stock replaces the Stock (as a type change to the Stock).
- **No card for a selection** (owner: "dont understand why there a window with cut type when i select a path"): a shape click, a row tap (desktop and phone), a
  Ctrl-click on a row show NO card; the selected shapes are highlighted and their operations' rows lit (S2). The selection-only "type menu" card of S2 is gone;
  the card's type menu only changes the type of the OPEN operation.
- (The drag of a button onto a shape and the greyed buttons of earlier drafts are not built: the owner's rulings above replace them.)

### 4.3 The cards

- *(S2: the cards as built are 9.1: the open operation's card with its Shapes, Duplicate, OK / Cancel; a selection shows the type menu only; no chips.)*
- **Operation card** (an operation is active): the same cut card as today (task 810's tabs when they land), its subject
  the operation: header "Pocket 2 · 3 shapes: a change applies to all 3", the type's rows, and a Geometry row with
  Add shapes / Remove / Make its own operation. Changing the type is allowed when every shape can take the new type
  (greyed with the reason otherwise).
- **Shape card** (a shape clicked, no operation active): a row of chips, one per operation the shape is in
  ("1 Roughing", "2 Contour"): a chip makes that operation active; below them the quick flow's type menu (4.4).
  With no operation yet, the card looks like today's (type menu first).

### 4.4 The quick flow: the standard shortcut "geometry first, then a type" (owner turns 2682-2684)

*(S2: the new operation is created OPEN, 9.1; Cancel removes it. S3: the type is the toolbar's button, 4.2; a selection shows no card.)* Click a shape (or several), then pick a type in the card's menu (or a palette button, 4.1): **a NEW operation of that
type is created, holding the selected shape(s), and it is left selected (the active operation)**. Clicking more shapes
then adds them to it (Add shapes mode, 4.2); there is no "join the type's last-used operation" and no search for an
existing operation to reuse. The card shows the new operation ("Pocket 2 · 1 shape"). If the shape is already in an
operation of that type, picking the type still makes a new one (a shape may be in several operations, 1.2); the
bin and "Make its own operation" are how the user cleans up. A Stock pick keeps today's one-Stock move
(`prepare-view.js:829-838`).

### 4.5 My lineups

- **Store: per user**, synced to Drive like the other settings (task 773: `packages/ui/cloud/settings-sync.js:1-20`),
  as a key synced BY PART, one part per lineup (`SHAPER_LINEUPS:<lineup id>`, the mechanism the ribbon layout uses:
  `packages/core/settings-manager.js:151`), so editing lineup A on the laptop and lineup B on the phone never lose one.
  Not per document: the owner's words are "apply it to any part". A lineup = `{ id, name, ops: [{ type, settings }] }`,
  settings base mm, declared fields only (1.5), no geometry. A setting that names geometry (task 810's Boundary = Shape)
  is saved as "Shape (pick when applied)": the applied operation shows its existing refusal note until a shape is picked.
- **Save:** in the Operations list, select the rows (or none = all), `My lineups ▾ > Save these as a lineup…`, a name.
- **Apply:** select the shape(s), `My lineups ▾ > <name>`: one NEW operation per lineup entry, in the lineup's order, each with
  the selected shapes, placed by the default-order rule (owner turns 2682-2684: applying ALWAYS creates new operations,
  to a second part too; nothing is joined, so an operation stores no link to the lineup that made it). With no shape
  selected: the operations appear empty. Applying a lineup is ONE undo step.
- **Manage:** rename, delete, re-save (overwrite) in the same menu. No other settings screen.

---

## 5. How it serves the queued tasks (and what their briefs must change)

| Task | What the model gives it | Brief change needed |
|---|---|---|
| **810** tabbed Roughing / Contour cards, machining boundary | its new fields are operation settings (record fields today, same names); the tabs are the operation card's | (1) Contour's "which walls: All / Sloped only" IS `walls` (1.4): "Sloped only" must be exactly today's own-wall skip (`stepped-cut.js:909-911`) so the migration maps to it; (2) its "Bottom: Part depth" for the Contour = Depth "From model"; (3) "Boundary: Shape" stores a geometry key: it must go through `renameGeometry`; (4) its new "Loop pitch" row must be in `settingsOf` (`operations.js:89`) or the declared table (1.5), else two different pockets show as one row. 810 can run BEFORE stage 1 (independent of storage), but conflicts with stage 2 in `cut-panel.js`: run 810 first, or after stage 2, never in parallel |
| **798** operation checkboxes | the tick is `op.on`, stable through any settings edit; group tick = the operations of one bit run; `planEntries({ ticked: true })` is the one filter for Prepare, 3D, Paths, 2D and the export | "saved with the document; part of undo" = the `on` field; run 798 AFTER stage 1 (before it, a tick keyed by today's operation key would be lost whenever a setting changes) |
| **806** Select in Fusion per operation | an operation exists with no shapes and has a stable id; its shapes -> regions -> tokens (`regions[key].sources`) | `opKey` in the contract becomes `opId`; `assign: { opId, tokens }` adds / removes refs of that operation only; regions named by an `assign` go nowhere else; "an operation whose entities all disappeared empties" is native. Run after stages 1-2 and SA-15 |
| **801** simulation | the list order and ticks are stored; "Preview selected" = the active operation; empty operations are skipped | none, beyond reading `describeOperations` (stored) instead of `planOperations` (derived) |
| **SA-15** persistent selection (palette follow-up) | removing entities removes their regions from EVERY operation (operations stay, possibly empty); Undo restores the refs (the operations store is in the undo snapshot) | (1) "re-added regions arrive unassigned with default settings": make precise as: never put back into an existing operation; a region new to the document that carries a payload cut type goes into a NEW operation made by that import (as a first import does), one without a cut type stays in none; (2) the 795 gap remains: a palette Undo after an X restores the regions but the add-in's remembered set is not told (`WORK-LOG TURN 795`, "Contract gap"): the follow-up contract needs a `restore_selection { selectionId, tokens }` event |

---

## 6. Build plan (each stage shippable on its own, tested, gate green)

| Stage | What | Tests | Size |
|---|---|---|---|
| **S0** | (a) the version guard: an app that reads a Shaper sidecar with a `version` above its own opens it but never saves over it, with one notice ("made by a newer version of the app: reload to edit"); (b) the declared settings table `CUT_TYPES[].fields` (1.5), read by `settingsOf` and the card (`loopPitch` joins the key: no user-visible change today, no card row sets it) | node: a v3 sidecar is not overwritten by autosave / save; settingsOf = the table; every existing test unchanged | S: ~150 lines, 2 test files; deploy at least a few days before S1 |
| **S1** | the operations + regions store, the migration, `planEntries` and every reader of section 2 switched; the UI behaves EXACTLY as today: a field edit on selected shapes moves them into the operation with the resulting settings (found or new, keeping their `seq`), so the list and the files are today's | the migration corpus of section 3 (byte-identical (a)-(e)); every existing test passes, adjusted only where it pokes `CUT_PLAN` directly (they load a v2 sidecar through `applyShaperDoc` instead: the real migration path, no test-only code) | L: ~1,000 lines app, ~60 test files adjusted, 1 new corpus test |
| **S2** | *(as built: section 9)* operation first: empty operations, the active operation, Add shapes mode, the operation card (edits all its shapes) and the shape card (chips, Make its own operation), multi-membership, Contour as its own type in the menus (the Contour row and the allowance coupling removed), the quick flow (4.4), the bin deletes the operation | node + live (desktop 1280, phone 390): add empty, add / remove shapes, a shape in Roughing + Contour, edit = all shapes, make its own, undo / redo of each, save + reload | L: ~700 lines, 2 new test files |
| **S3** | *(as built: 4.1-4.2, section 11)* the operations toolbar on Design's tool ribbon (a bar across the top), its sections' boxes and reorder; no card for a selection; out of date + Recalculate (Fusion style) | node (tests/opbar-s3-node) + live (tests/opbar-s3-live: desktop 1280, phone 390 upright, 844 x 390): each button with a selection / nothing / an impossible pick, no card on a shape click or a row tap, the 805 probe (0 px), 44 px targets, the dropdown's boxes and reorder (saved under Prepare's key, survives a reload, Design's layout untouched), out of date / Recalculate / the Export line | as built |
| **S4** | My lineups (4.5): store synced by part, save / apply (always new operations) / rename / delete | node: save, apply to 1 and 2 parts (new operations each time), units, sync merge per lineup; live: menu on desktop + phone | M: ~400 lines, 2 test files |

Order with the queue: S0 now (small); 810 when dispatched (before S2); S1; 798; S2; S3; S4; then 801 and 806 / SA-15
follow-up as briefed. Each stage ends with the AGENTS.md gate (quick + its live tests; the advisor's merge gate).

**Behaviour changes for existing users** (each stage's REPORT repeats its own)

- S0: none visible (a newer document is protected from an older app).
- S1: byte-identical files and lists for every saved document (asserted on the corpus), except as ruled by the advisor
  (task S1, turn 2701): (ruling 1) a Guide declares its Depth / Offset / Bit, so a document whose Guides hold different
  values lists one Guide operation per value set (its file is unchanged); (ruling 2) a shape that is binned or moved off the
  Stock leaves its operation with nothing kept: assigned again it takes the settings of the operation it joins (a fresh
  default record when it makes a new one) and moves to the end of the FILE order (before S1 its record kept its settings
  and its place; the elements are the same); (ruling 4) a value that is not part of the operation key (for example a
  Freehand pocket's stored stepover) is the operation's: after switching a pattern back, the number shown can differ.
  Contour: its depth and wall side are read LIVE from its part, as before (ruling 3); S2 keeps this as the Contour's
  "From part" default, and the explicit `cutDepth` / `wallSide` / `walls` of section 3 apply only where the user set them.
  The list order is kept as before S1 by `listOrder` (advisor ruling, turn 2702; sections 1.2 and 2): while the user has never
  reordered, the list is re-sorted by the default rule after every change.
- S2: the full list as built is 9.6. Editing an operation's setting changes ALL its shapes (today: only the selected shapes, which then regroup); an
  edited operation keeps its place in the list (today it moves); the bin deletes the operation, and its shapes stay in
  their other operations (today: unassigns the regions); Contour is a type in the menus, the Roughing card loses its
  Contour row and "Edit contour"; adding / removing a Contour no longer sets Roughing's allowance.
- S3 (as built): the operations toolbar across the top of Prepare (Design's ribbon; the Operations card, the cut card and the notice start below it; on the short
  viewport the rail at the left, the Operations card right of it); a click on a shape or a row shows no card (the selection-only type menu card is gone); a new
  operation is made from the toolbar (with nothing selected: an empty one); every Design edit marks EVERY operation out of date (section 11; the paths signature
  covers the whole sketch) instead of regenerating it, with Recalculate on the toolbar and the Export step's "n operations are out of date" line; Prepare's
  document tab takes the toolbar's colour.
- S4: the lineups menu; a new synced settings key.

---

## 7. Risks and decided defaults

**Risks**

1. *An older app overwriting a version 3 document* (an old tab still open, or another device not yet reloaded): its
   save would write a sidecar without `operations`, losing the plan. Mitigation: S0's guard ships first; the window left
   is a tab opened before S0 and still open after S1.
2. *Test churn:* about 100 test files touch the plan (count in section 3). S1 keeps the entry interface and moves tests
   to the real migration path; still the largest stage.
3. *(Fixed, TASK 814)* A Guide on a hole no longer counts as "its own entry": CUT_TYPES declares the Guide `drawnOnly`, `ownedLoopIds`
   skips it, so the enclosing Outside / Inside / On line profile still cuts the hole and the guide element is written besides.
4. *810 and S2 both rewrite `cut-panel.js`:* never in parallel (section 5).
5. *Undo snapshot cost:* the snapshots already hold the plan; moving `levels` into `regions` (shared, never mutated) and
   comparing only the operations store in `cutEdit` removes today's double stringify of the rose's ~1.6 MB levels per edit.
6. *Identical paths on the Origin:* how the machine treats exact copies is not known yet; section 8 gives the design
   for each outcome of the owner's test.

**Decided defaults (reversible; tell me if any is wrong)**

- No per-shape overrides; Depth "From model"; dragged lead-in on the shape; "Make its own operation" (1.4).
- File order = the order memberships were made; the list order never changes the file (TURN 743 ruling).
- Lineups per user, synced to Drive per lineup; not per document (4.5).
- The quick way (geometry first, then a type) and applying a lineup ALWAYS create new operations (owner turns 2682-2684, 4.4 / 4.5).
- A Fusion import groups its regions into operations as today's derivation does, with Depth "From model"; an update
  never puts a region back into an existing operation (SA-15).
- *(S3: the Stock is a toolbar button, the declaration's; 4.1.)* Stock stays a one-shape "Not cut" operation, reachable from the card's type menu, not in the palette (the owner's
  palette list has no Stock).

---

## 8. Identical paths in one file (owner turn 2678)

With operations first, two operations can hold the SAME shape, so the file can hold IDENTICAL paths (the same `d`)
with a different depth, type or bit. Today this already happens for one pair only: a part and its Contour (both cut the
part's target: `cut-plan.js:43`). The owner is testing the machine with exactly overlapping paths (3 identical squares:
On line 1 mm, On line 2 mm, Inside 3 mm; 2 identical circles: On line 1.5 mm, Pocket 4 mm): does Switch reach every
copy, does the Origin merge or hide any, does cutting one leave the others cuttable.

**How the model writes them**

- **Never merged.** One element per operation per shape, each with its own fill / stroke and every `shaper:*` attribute
  ON the element (the exporter's one way to write an element since TASK 802: `packages/core/shaper-export.js:260-263`);
  the exporter has no de-duplication of equal geometry (its loop writes every derived cut: `:220-251`), and this design
  adds none. Silently dropping a copy would drop a depth: not an option.
- **Order of the copies:** in the FILE order of 1.6 (the order the memberships were made, `seq`), not the Operations list
  order. The advisor's note asked for the operation order; the reason it is not: the file order follows the list nowhere
  else (TURN 743 send-back: "the file never changes"), and the migration's byte identity needs today's order. If the
  machine test shows that the ORDER of copies matters (for example Switch offers the last-written copy first), the change
  is one sort in `planEntries` (operations' list position, then `seq`) and its own decision, because it changes the files
  of existing designs whose list was reordered.
- With 798's ticks, an unticked operation's copy is simply not in the file.

**What the app shows when operations share a shape**

- *Prepare:* each operation draws its own tool path (as a part and its Contour do today); the depth chips of one shape
  (today one chip per record: `apps/shaper/src/prepare-view.js:120-143`) are combined into ONE chip listing the depths
  in list order, "↓ 1 · 2 · 3 mm", so chips never stack on top of each other; the shape card's chips (4.3) name the
  operations ("1 On line", "2 On line", "3 Inside").
- *Operations list:* each row's sub-line counts its shapes as today; a row whose shapes are also in another TICKED
  operation adds "shares 1 shape with 2, 3" (a fact; it is what the machine will see as overlapping paths).
- *Export Paths / 2D:* one row per element as today (the copies are separate rows under their own operation, TURN 743
  grouping); picking a row highlights that element only; overlapping elements are drawn in file order, so the last one is
  on top (the same rule the machine screen will follow, to be checked by the test).

**The decision that depends on the owner's machine result**

| Outcome on the Origin | What the design does |
|---|---|
| **A. Every copy is reachable and cuttable on its own** (Switch cycles through the overlapping paths, cutting one leaves the others) | Nothing more: the file has one copy per operation, the list's "shares a shape" line stays as information, no warning in Export. |
| **B. The Origin merges, hides or marks copies as cut** (only one copy reachable, or cutting one counts for all) | Still never merged by the app (a merge would lose a depth). Export shows ONE line when ticked operations share a shape: "On line 1 mm, On line 2 mm and Inside 3 mm share 1 shape: the Origin shows only one copy. Untick all but one and export them one at a time (same anchor)." The owner's 798 rule stays (one SVG = the ticked operations, no per-operation file option); unticking is the user's action. If the machine shows exactly which copy it keeps (first or last written), the line names that one. |

Until the result is known, stages S0-S1 are unaffected (S1 writes exactly today's files); the Export line of outcome B,
if needed, belongs to stage S2 (where shapes can first be in several operations) and needs 798's ticks.

---

## 9. Stage S2 as built: the owner's rulings (turns 2709-2734) and the decisions they set

These rulings came while S2 was being built. Where they differ from sections 1.4, 4.2-4.4 and 6, **this section wins** (those
sections carry a pointer here). Code: `apps/shaper/src/prepare-stage.js` (the edit session, the card model, the list's hooks),
`prepare-view.js` (selection, the open operation, canvas clicks), `cut-panel.js` (the card), `op-list.js` (the row actions),
`cut-plan.js` (the operation writers, `typeRefusal`), `shaper-doc.js` (`migrateContours`, `migrateHeights`), `#core/stepped-cut.js`
(`wallSide`).

### 9.1 Editing is deliberate: open, edit, confirm (turns 2716-2719)

- **A click on a shape only SELECTS it** (shift adds / removes, as before). The card then shows ONLY the quick flow's type
  menu: no settings, no depth / offset / bit rows, no "in 1 Roughing" text (turn 2717). The Operations list rows of every
  operation the selected shape(s) are in get the list's selected-row style, and the first of them is scrolled into view
  while the list is open; nothing opens (turn 2718; on a phone, nothing more while the sheet is folded). With nothing
  selected and nothing open the card is hidden, as before S2 (the card is an overlay: hiding it moves nothing outside it).
- **An operation is OPENED** from the list: a tap on a row SELECTS it (its shapes are selected, nothing opens); the
  selected row alone shows its actions beside its text, in this order: **Edit, Duplicate, X** (turns 2719-2720; 44 px on a
  phone; the row's text is one line each, its full words in its tooltip, so the actions appearing never change its height).
  A double-click on a row opens it too. The quick flow and Duplicate also open the operation they make.
- **The OPEN operation** = its card: a header "Pocket 2 · 3 shapes" with **Duplicate**, its **Shapes** (one row per shape,
  its words "Shape 40 × 40 mm", with an X that takes it out; a row under the pointer shows its shape on the canvas), its
  rows (810's tabs, 813's layout), the note area, **OK** and **Cancel**. While it is open, a click on a shape puts it in, or
  takes it out when it is in it; a press on empty canvas pans. Every change PREVIEWS live (Prepare, the 3D Review, the file).
- **OK** = the whole session is ONE undo step, then the card closes. **Cancel / Esc** = the operation exactly as it was
  when opened, nothing in the undo stack. The session's undo point is taken at its FIRST change (opening and cancelling
  with no change touch no history and keep Redo).
- **One operation open at a time.** Anything else = OK on it first: another row's Edit or Duplicate, a tap on another row,
  a tick, a reorder, another row's X, leaving Prepare, a Fusion / STL import (advisor turn 2722: an import is its own
  deliberate step and never lands inside a session). The open operation's own X = Cancel, then the delete. **Undo while
  it is open**: with changes = Cancel (its undo point is undone); with none = the plain Undo of the step before, and the
  operation stays open (gone: the card closes). A document switch drops an open session (the document's history goes with it).
- **The quick flow** (4.4): shapes selected + a type = a NEW operation holding the shapes, created OPEN; OK keeps it,
  Cancel removes it entirely. The Stock keeps the one-Stock move (the last closed shape picked).
- **Duplicate** (turns 2710-2712, as Fusion's): a new operation with the same type, settings, tick and shapes (new file
  places, the dragged lead-in positions kept), right after the original while the list order is the user's ('stored'),
  else by the default rule; it opens; Cancel removes the copy.
- The bin of before is the row's **X**: it deletes the operation, ONE undo step; its shapes stay in their other operations.
- There is NO "Make its own operation", NO Remove button, NO Add shapes mode button, NO shape card with chips: they were
  built on the way and replaced by the rulings above (Duplicate + the X per shape cover "make its own").

### 9.2 Type buttons are never greyed; a refusal is told (turn 2716)

Every type is offered in every menu (and the S3 toolbar). A pick the shapes cannot take is told in ONE plain line at the top
of the card's note area (813's fixed area), e.g. "This open line can't be a Pocket: a pocket needs a closed shape". The
rule is ONE function, `cut-plan.js typeRefusal(type, keys)` (the type's declared `targetKind`: a 'path' type on any shape,
every other type on a closed one; the Stock one shape). What happens: a shape clicked into an open operation is NOT added;
a quick-flow pick none of whose shapes fits creates NOTHING; one where some fit creates the operation with those and the
line names the ones left out; a type change of the open operation that one of its shapes cannot take changes nothing; a
boundary Pick on an open line is refused with its line.

### 9.3 The Contour is a plain operation (turns 2709-2713)

- Contour is always in the type menus, never greyed, linked to NO other operation: it has its OWN settings. Its Depth is
  its own Depth row (9.4); Walls is 810's row; **Wall side** (`wallSide`: Inside | Outside, a new Contour setting, #core
  `levelsCutAs`) decides the side for a shape whose model does not say it (a drawn shape: no slope, no levels; a Fusion
  slope always carries its `kind`, an STL's levels are outlines). Unset = Inside (what a drawn shape's Contour cut before S2:
  its part could only be a Roughing). Its Walls default is All (the default no longer reads a part's type).
- S1's live borrowing (a Contour read its part's depth, type, walls default) is REMOVED, and with it every "first in list"
  rule. Editing a Roughing's depth no longer moves a Contour.
- Adding / removing a Contour no longer touches the Roughing's allowance. A new Roughing's allowance starts at 0 (the value
  a Roughing got before S2 when no Contour was involved).

### 9.4 A Roughing's / Contour's ONE depth: the Depth row; 810's Bottom row is gone (turns 2730-2740)

- ONE stored setting, `cutDepth`, edited in the normal, LIVE Depth row (the Heights tab of these two cards, with Top and Floor
  allowance): empty = **From model** ('model' where every shape has an imported depth, else unset): each shape to its own
  model depth; a value = the cut **STOPS** at that depth: it follows the model's slope above it and is flat where the model
  goes deeper; it never scales the slope (#core already worked so: every level / terrace is cut down to the band's depth,
  levelsBand). 810's separate Bottom row (`bottomDepth`) is REMOVED (owner turn 2740: "why have two depth fields?"); a
  stored bottom is mapped into the Depth (9.5). The hint (the table: `levelsDepth`, CUT_TYPES `depthParam`): "From model:
  each shape to its own model depth. A typed depth: the cut follows the model's slope and stops flat at that depth." The
  refusal note of an empty band reads "no level between the Top and the Depth (less the floor allowance)". (Turns 2731-2734's
  greyed Depth row showing a Bottom value were built and replaced by this.)
- Flat types (Pocket, Inside, Outside, On line, Guide) keep their Depth row: "One flat depth for every shape. From model:
  each shape's own model depth (the deepest point of a sloped shape)." (empty = unset, as before).

### 9.5 The document: version 4 (S2)

A version 3 document is read into version 4 once (shaper-doc.js, after the v2 -> v3 migration for an older one):
1. `migrateContours`: each Contour membership gets the values S1 read live from its part at load: `cutDepth` ('model'
   where the part's was), `walls` (the choice in effect), `wallSide` ('outside' where the part was an Outside cut). One
   settings set per operation: shapes reading different values would be split into a new Contour right after it
   (`splits`); a membership with no part (it cut nothing) leaves the Contour (`noPart`).
2. `migrateHeights`: a Roughing's / Contour's stored `bottomDepth` becomes its `cutDepth` = the depth its cuts were made to
   (levelsBand: min(depth, bottom)); where the bottom changed nothing the depth is kept as stored. Shapes ending at
   different depths would be split (`splits`). Where depth and bottom disagree (the bottom above the depth) the cuts were
   made to the smaller one, so that is the Depth: the file is the same, the Depth shown is the depth the part is cut to.
On the 909-case corpus: 35 Contours, 0 splits, 0 without a part; 9 operations with a bottom merged, 0 splits; every
download, preview, Paths view, Review item and list row byte-identical to the baseline (tests/opfirst-corpus-*-node). A
version 4 document is protected from a version 2 or 3 app by S0's guard (tested: both open it, neither writes over it).
An empty operation is saved and read back as it is; renameGeometry drops only an operation it empties itself.

### 9.6 Behaviour changes for existing users (S2)

1. A click on a shape only selects it: settings show only after the operation is opened (the row's Edit / double-click).
2. Editing an operation changes ALL its shapes, previewed, and is confirmed with OK (one undo step) or Cancel.
3. An edited operation keeps its place in the list (in the user's order; the default order still re-sorts).
4. Picking a type for selected shapes ALWAYS makes a new operation (never changes the type of the operation they are in).
5. The list's bin is the selected row's X; it deletes the operation (its shapes stay in their other operations); Edit and
   Duplicate beside it; the row text is one line each (ellipsis; full words in its tooltip).
6. A shape can be in several operations (two identical paths in the file, one per operation, each with its own settings).
7. Contour: a type of its own in the menus; the Roughing card's Contour row and "Edit contour" are gone; adding / removing
   a Contour no longer sets the Roughing's allowance; a Contour's depth, walls and wall side are its own (editing the
   Roughing no longer moves it).
8. Roughing / Contour: ONE depth, the Depth row (From model, or a typed depth the cut stops at); the Heights' Bottom row is
   gone (a stored bottom becomes the Depth, the file unchanged).
9. Type buttons are never greyed; an incompatible pick says why in the card's note area.
10. The Depth hints read as in 9.4 (flat types, and Roughing / Contour); a migrated Contour whose walls were "Sloped only" next to an
    Outside / Inside cut now shows its Geometry tab's dot (All is a Contour's own default now).
11. The document is saved as version 4 (an app of version 2 or 3 opens it read-only).
12. Every operation is in Prepare's list, an empty one ("no shapes yet: click shapes to add") and one whose shapes cut nothing
    ("n shapes: nothing to cut"), so it can be opened from its row; the export's 2D / Paths lists still show only what is cut.
13. The open operation's card lists its shapes first in its scrolling rows (under the STL card on a short screen the rows stay reachable).
14. A document tab put aside and shown again (and Drive's version loaded, TASK 766) opens again the operation that was open in it.
15. Esc: with a hint tooltip showing, Esc only hides the tooltip; otherwise, with an operation open, Esc is Cancel.
16. A Fusion import while an operation is open confirms it first (OK, its own undo step); the import is its own step.

## 10. Task 822: dragged tabs, a per-shape placement (owner turn 2771)

- **The field.** A geometry ref may carry `tabsAt`: the shape's TAB CENTRES, each a perimeter fraction (0..1) of that shape's outline walk
  (`#core/hold-part loopWalk`, the measure of the lead-in's `at`). It is section 1.4's mechanism 2 (a per-shape placement, drawn as handles on
  that shape), not a machining setting: it is in neither the operation key nor the settings, and two shapes of one operation keep their own.
  `recordOf` puts it on the shape's record (`rec.tabsAt`); `#core/hold-part tabLayout` (`at`) uses it instead of the even spread (count = its
  length, each centre snapped to the nearest point where its gap strips fit: a stale one after a design edit moves there). Saved with the store
  (an optional array on a ref of the version 4 document), copied by Duplicate, kept by the import's regrouping (`fileShape`).
- **Set** by dragging a tab handle of the OPEN operation (`prepare-view.js`: the lead-in handle's drag path and style, 44 px target): the drop
  stores EVERY tab centre of that shape (`cut-plan.js setShapeTabsAt`, an edit of the session: Cancel restores, OK = one undo step). A spot where
  the tab cannot be (its strips do not fit, too near a corner or another tab) shows the handle refused and stores nothing.
- **Cleared** by a tab count set on the operation (Auto, or a typed / stepped number: `setOpFields`): the tabs are laid out again on every shape.
  While a shape has `tabsAt`, the count row shows their number (not Auto).
- **Tabs only where the strips fit** (with or without a drag): a tab is never placed where its gap strips cannot be built (`stripFit`). When the even
  spread puts one there, the tabs are spread along the stretches where they fit (the hold's `narrow`; the note: "placed where a gap strip fits: part
  of the outline is too narrow for one", or "only n of m tabs fit: part of the outline is too narrow for a gap strip"). Only when no stretch fits is
  the hold refused (the line of before). On the 909-case corpus: 907 cases unchanged; the 2 cases of one drawing
  (`tests/fixtures/report/midpoint-move.json`, a 3077.8 mm Outside outline) whose tabs were refused get 21 tabs now.

## 11. Task 817: toolpaths are generated on OK, in the background (owner turns 2745-2748)

"In fusion a toolpath generate is on ok and allow to work still, spin wheel on item only" / "i guess we can adjust lead in only before and show path on ok" /
"Or with toolpath open add a refresh button so we voluntarily calculate it?" / "Button in the op edit panel". Code: `apps/shaper/src/op-derive.js` (THE
derivation of an operation's paths and of the file, worker-safe), `paths-worker.js` (the module worker), `op-paths.js` (the generated results on the main
thread), `prepare-stage.js` (the session, the Preview, the row spinner), `prepare-view.js` (the open operation's look), `export-payload.js` (the export waits).

- **One derivation, two places.** The main thread and the worker import the same module (op-derive.js: deriveFootprints / deriveItem, svgOf, bitCentrePaths;
  #core by relative path, no DOM). The node tests run it in-process (op-paths.js localPort: the worker's server on structured copies) and in a real worker
  thread (tests/helpers/node-paths-worker.js runs paths-worker.js). The page's arcs are sampled with its SVG DOM (#core curve-kinds sampleArc); a worker has
  none, so a job carries the page's samples (arcSamplesOf) and the worker derives with exactly those (withArcSamples).
- **Content-addressed.** A result is filed under the signature of everything it reads (target, effective record with its levels / slope by content hash,
  owned loops, sketch geometry). A view reads the signature of its inputs NOW, so a stale result is never shown; an Undo back to earlier inputs finds their
  result at once. A newer edit drops the queued jobs of older inputs (retain); a job already running finishes and is filed by its own inputs.
- **The open operation** asks for nothing while it is open: its paths as opened are drawn FAINT (no arrows, no depth chip), its tab handles where the
  current settings put them (#core hold-part tabHandles, light; task 836 removed the lead-in and its handle). The card's levels / clearing notes show for the settings as opened, or after a Preview of the
  current ones. OK = the session's one undo step, then the generation; the row spins after 150 ms (a quick derivation never flickers).
- **Preview** (the card's action bar: Preview, Cancel, OK) asks for the open operation's paths with the card's settings now (the same job OK makes: OK
  then generates nothing new). A later change fades them and the button says Preview again. Never in the file, never in Undo; Cancel drops it.
- **Export and the 3D Review wait** ("Waiting for 2 operations to finish"), then read finished paths; the page's file is made in the worker (svgOf).
- **OUT OF DATE (task S3 addition, owner turns 3046-3047: "a recalculate button along the op buttons", "Fusion style"; this REPLACES the automatic regeneration
  of a closed operation after its inputs changed).** Each membership remembers the signature it was last generated for (`op-paths.js` `generated`). A DESIGN
  EDIT (or an Undo / Redo across one) generates nothing: the operations whose inputs changed are OUT OF DATE (with today's signature, which covers the whole
  sketch, that is every operation after any Design edit): their row shows the out-of-date mark (`op-list.js` OUT_OF_DATE_SVG, a warning triangle; tooltip
  "Out of date: press Recalculate.") and their last paths stay drawn FAINT (the open operation's look: no depth chip), never as current. A shape a Design edit
  renamed (cut-plan.js followDesign) keeps its membership's generation: out of date, not new. A result already filed for the inputs now (an Undo back) is up
  to date at once. UNCHANGED: OK of an edit session generates that operation; Preview; opening / reading a document, an import and an operation never
  generated before are generated as before; a Prepare edit (a new operation, OK, a tick, a reorder, a delete) never leaves ANOTHER operation out of date (the
  ones whose inputs it changed through the plan they share, e.g. a hole's new Inside and its plate's Outside, are generated as 817 did).
- **RECALCULATE** (the toolbar's button after the operation types): the selected row's operation, else the rows the selection lights, else every out-of-date
  operation (an open operation is confirmed first); their rows spin as above. Nothing to do: the plain line "All toolpaths are up to date." (a selection that
  is up to date while others are not: "The selected toolpaths are up to date.").
- **Export / 3D Review never use out-of-date paths**: while a ticked operation is out of date, the export area (the Generate status, the 2D view's line, the
  3D info) says "n operations are out of date" with a Recalculate button (the same function as the toolbar's) and waits; the file is made after it.
- **The default order** ranks a Roughing / Contour by its generated cuts: while they are generating (or it is open) it keeps the rank its last cuts gave and
  is sorted again when they arrive; a new operation of unknown rank in a user-ordered list is placed again by the rule once, if nothing moved meanwhile. A
  version 2 document being read is still ordered at once (derived on the main thread).

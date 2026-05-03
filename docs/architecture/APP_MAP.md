# Sketch Studio - Application Map

> **Purpose:** Logical map of features and their implementations across files.  
> Functions often share meaning but have divergent implementations depending on context.

---

## 🎯 Core Concepts

### Joints (Points)
Joints are the fundamental building blocks - endpoints of shapes.

| Context | Location | Notes |
|---------|----------|-------|
| Data storage | `8-main.js` → `state.joints` (Map) | `Map<id, {x, y}>` |
| Creation | `5-engine.js` → `genJ()` | Generates unique ID `j_xxx` |
| Origin joint | `5-engine.js` → `init()` | Special `j_origin` at (0,0), immovable |
| Rendering | `4-render.js` → "draw joints" section | White circles with blue stroke |
| Selection | `6-input.js` → pointerdown in SELECT | Adds to `state.selectedJoints` Set |
| Cluster selection | `3-snap.js` → `findCoincidentCluster()` | Finds all transitively connected joints |
| Dragging | `6-input.js` → `state.drag` with `type:'joint'` | Moves entire cluster together |

### Shapes
Shapes are defined by their joints (not by coordinates).

| Type | Joints | Rendering |
|------|--------|-----------|
| Line | `[startId, endId]` | `4-render.js` → `<line>` |
| Circle | `[centerId, radiusPointId]` | `4-render.js` → `<circle>` |
| Rectangle | 4 lines (compound shape) | Created as 4 separate lines |

### Constraints
Rules that the solver enforces on joints/shapes.

| Type | Applies To | Data Structure |
|------|------------|----------------|
| `coincident` | 2 joints | `{ type, joints: [id1, id2] }` |
| `pointOnLine` | 1 joint + 1 line | `{ type, joint: id, shape: lineId }` |
| `horizontal` | 2 joints (line) | `{ type, joints: [id1, id2] }` |
| `vertical` | 2 joints (line) | `{ type, joints: [id1, id2] }` |
| `parallel` | 2 lines | `{ type, shapes: [id1, id2] }` |
| `perpendicular` | 2 lines | `{ type, shapes: [id1, id2] }` |
| `collinear` | 3+ joints | `{ type, joints: [id1, id2, id3...] }` |
| `tangent` | 1 line + 1 circle | `{ type, line: id, circle: id }` |
| `distance` | 2 joints | `{ type, joints, value, offset?, isRadius? }` |

**Preview contract:** Preview glyphs are represented by synthetic, constraint-shaped objects created by the tools and marked with `__isPreview: true`. The renderer (`4-render.js`) draws these previews via `drawConstraintGlyph` and treats them as visual-only (semi-transparent, `pointer-events:none`). Optionally a preview can include `__pos` to explicitly place the glyph (instead of deriving placement from joints or shapes). The `addConstraint` function in `1-utils.js` now ignores objects with `__isPreview` to ensure previews are never persisted.

---

## 🔧 Constraint Creation - DETAILED

> **The Core Problem:** Same constraint can be created via toolbar OR inference, with completely different code paths.

### Coincident Constraint

| Entry Point | File | Line Range | Trigger | Creates |
|-------------|------|------------|---------|---------|
| **Toolbar: Sequential clicks** | `6-input.js` | ~645-695 | `currentTool==='coincident'` | Joint-to-joint OR point-on-line |
| **Toolbar: First click = joint** | `6-input.js` | ~648-655 | `coincidentSnap.type==='joint'` | Sets `active.j1`, waits |
| **Toolbar: First click = line** | `6-input.js` | ~656-660 | `coincidentLine` exists | Sets `active.line1`, waits |
| **Toolbar: Second click = joint** | `6-input.js` | ~663-670 | `active.j1` + joint clicked | `{type:'coincident', joints:[j1,j2]}` |
| **Toolbar: Second click = line** | `6-input.js` | ~671-680 | `active.j1` + line clicked | `{type:'pointOnLine', joint, shape}` |
| **Line drawing snap** | `6-input.js` | ~917-920 | Snap to joint on pointerup | `{type:'coincident', joints:[endId, snapId]}` |
| **Circle drawing snap** | `6-input.js` | ~1015-1018 | Snap to joint on pointerup | `{type:'coincident', joints:[endId, snapId]}` |
| **Rect drawing snap** | `6-input.js` | ~1042-1080 | Snap to joint on pointerup | Per-corner coincident |
| **Origin snap** | `6-input.js` | ~888-895 | Snap to origin | `{type:'coincident', joints:[endId, 'j_origin']}` |
| **Drag joint onto joint** | `6-input.js` | ~1095-1100 | Drag ends on another joint | `{type:'coincident', joints:[dragId, targetId]}` |
| **Preview glyph** | `4-render.js` | ~150-195 | `active.mode==='coincident'` | Rendered as a synthetic preview constraint (`__isPreview`) via `drawConstraintGlyph` (semi-transparent, non-interactive) |

### Horizontal/Vertical Constraint

| Entry Point | File | Line Range | Trigger | Creates |
|-------------|------|------------|---------|---------|
| **Toolbar: Click line** | `6-input.js` | ~698-750 | `currentTool==='hv'` + click line | Auto-picks H or V based on angle |
| **Inference while drawing** | `3-snap.js` | ~85-100 | `findInference()` detects H/V angle | Returns `{type:'horizontal'}` or `{type:'vertical'}` |
| **Inference visual** | `4-render.js` | ~425-440 | Renders hint icon | Green circle with H or V line |
| **Inference application** | `6-input.js` | ~920-940 | On pointerup if inference active | `{type:'horizontal'/'vertical', joints:[start,end]}` |

**Note:** Toolbar creates constraint on EXISTING line. Inference creates on NEW line being drawn.

### Parallel Constraint

| Entry Point | File | Line Range | Trigger | Creates |
|-------------|------|------------|---------|---------|
| **Toolbar: First line** | `6-input.js` | ~755-765 | `currentTool==='parallel'` + click line | Sets `active.shape1` |
| **Toolbar: Second line** | `6-input.js` | ~766-780 | Click second line | `{type:'parallel', shapes:[id1, id2]}` |
| **Preview glyph** | `4-render.js` | ~160-175 | Rendered as a synthetic preview constraint (`__isPreview`, optional `__pos`) and drawn by `drawConstraintGlyph` (semi‑transparent and non‑interactive) |

### Perpendicular Constraint

| Entry Point | File | Line Range | Trigger | Creates |
|-------------|------|------------|---------|---------|
| **Toolbar: First line** | `6-input.js` | ~785-795 | `currentTool==='perp'` + click line | Sets `active.shape1` |
| **Toolbar: Second line** | `6-input.js` | ~796-810 | Click second line | `{type:'perpendicular', shapes:[id1, id2]}` |
| **Inference while drawing** | `3-snap.js` | ~105-130 | `findInference()` detects 90° to existing line | Returns `{type:'perpendicular', refLine}` |
| **Inference visual** | `4-render.js` | ~441-448 | Renders hint icon | Purple circle with ⊥ symbol |
| **Inference application** | `6-input.js` | ~940-960 | On pointerup if inference active | `{type:'perpendicular', shapes:[newLine, refLine]}` |
| **Preview glyph** | `4-render.js` | ~176-195 | Rendered as a synthetic preview constraint (`__isPreview`, optional `__pos`) and drawn by `drawConstraintGlyph` (semi‑transparent and non‑interactive) |

### Collinear Constraint

| Entry Point | File | Line Range | Trigger | Creates |
|-------------|------|------------|---------|---------|
| **Toolbar: Click joints** | `6-input.js` | ~815-860 | `currentTool==='collinear'` | Needs 3+ joints |
| **First joint** | `6-input.js` | ~820 | Click joint | Adds to `active.joints[]` |
| **Second joint** | `6-input.js` | ~825 | Click joint | Adds to array |
| **Third+ joint** | `6-input.js` | ~830-850 | Click joint | Creates `{type:'collinear', joints:[...]}` |
| **Preview glyph** | `4-render.js` | ~200-220 | Rendered as a synthetic preview constraint (`__isPreview`, optional `__pos`) and drawn by `drawConstraintGlyph` (semi‑transparent and non‑interactive) |

### Tangent Constraint

| Entry Point | File | Line Range | Trigger | Creates |
|-------------|------|------------|---------|---------|
| **Toolbar: Click line** | `6-input.js` | ~865-875 | `currentTool==='tangent'` + click line | Sets `active.line` |
| **Toolbar: Click circle** | `6-input.js` | ~876-890 | Click circle | `{type:'tangent', line, circle}` |
| **Preview glyph** | `4-render.js` | ~225-245 | Rendered as a synthetic preview constraint (`__isPreview`, optional `__pos`) and drawn by `drawConstraintGlyph` (semi‑transparent and non‑interactive) |

### Distance Constraint

| Entry Point | File | Line Range | Trigger | Creates |
|-------------|------|------------|---------|---------|
| **Toolbar: Click line** | `6-input.js` | ~895-920 | `currentTool==='dim'` + click line | `{type:'distance', joints, value}` |
| **Toolbar: Click circle** | `6-input.js` | ~921-940 | Click circle | `{type:'distance', joints, value, isRadius:true}` |
| **Edit existing** | `6-input.js` | `showDimInput()` | Click dim label | Opens input dialog |

---

## 🎯 Inference System Deep Dive

### Where Inference is Computed
```
3-snap.js → findInference(startPt, endPt, shapes, joints, snapTarget)
```

### Inference Detection Logic

| Type | Condition | Tolerance |
|------|-----------|-----------|
| Horizontal | Angle within 5° of 0° or 180° | `ANGLE_THRESHOLD = 5` |
| Vertical | Angle within 5° of 90° or -90° | `ANGLE_THRESHOLD = 5` |
| Perpendicular | Angle within 5° of ±90° from any existing line | Checks all lines |

### Inference Data Flow

```
1. pointermove in 6-input.js
   ↓
2. findInference() called with current drawing points
   ↓
3. Returns {type, pt, refLine?} or null
   ↓
4. Stored in state.inference
   ↓
5. 4-render.js draws inference hint icon
   ↓
6. pointerup checks state.inference
   ↓
7. If active: creates constraint + uses snapped endpoint
```

### Inference vs Toolbar - Key Differences

| Aspect | Inference | Toolbar |
|--------|-----------|---------|
| When | While drawing NEW shape | On EXISTING shapes |
| User action | Automatic detection | Explicit clicks |
| Visual feedback | Small hint icon | Preview glyph on shape |
| Constraint created | On pointerup (end of draw) | Immediately on 2nd click |
| Can be ignored | Yes, move away from snap angle | No, explicit action |

---

## 🐛 Common Constraint Bugs & Where to Look

| Bug | Check These Locations |
|-----|----------------------|
| Constraint not created | Tool handler in `6-input.js`, check conditions |
| Wrong constraint type | Inference detection in `3-snap.js` |
| Glyph not showing | Glyph render conditions in `4-render.js` |
| Glyph wrong color | Color constants in glyph rendering section |
| Solver not working | Constraint case in `2-solver.js` |
| Preview not showing | Preview glyph section in `4-render.js` |
| Click not registering | Hit detection in `3-snap.js`, thresholds in `1-utils.js` |

---

## 🔗 Constraint Data Flow Summary

```
USER CLICK/DRAW
      │
      ├─── Toolbar Click ──→ 6-input.js tool handler
      │                              │
      │                              ▼
      │                      state.active updated
      │                              │
      │                              ▼
      │                      Second click → constraint pushed
      │
      └─── Drawing + Inference ──→ 3-snap.js findInference()
                                         │
                                         ▼
                                  state.inference updated
                                         │
                                         ▼
                               4-render.js shows hint
                                         │
                                         ▼
                               pointerup → constraint pushed
                                         │
                                         ▼
                              state.constraints array
                                         │
                                         ▼
                              2-solver.js enforces it
                                         │
                                         ▼
                              4-render.js draws glyph
```

---

## 🖱️ Input Handling Contexts

### `state.currentTool` Values
Controls which pointerdown/move/up branch executes.

| Tool | Drawing Mode | File Location |
|------|--------------|---------------|
| `select` | Selection/dragging | `6-input.js` → multiple branches |
| `line` | Line drawing | `6-input.js` → `currentTool==='line'` |
| `rect` | Rectangle drawing | `6-input.js` → `currentTool==='rect'` |
| `circle` | Circle drawing | `6-input.js` → `currentTool==='circle'` |
| `coincident` | Constraint tool | `6-input.js` → `currentTool==='coincident'` |
| `hv` | H/V constraint | `6-input.js` → `currentTool==='hv'` |
| `parallel` | Parallel constraint | `6-input.js` → `currentTool==='parallel'` |
| `perp` | Perpendicular constraint | `6-input.js` → `currentTool==='perp'` |
| `collinear` | Collinear constraint | `6-input.js` → `currentTool==='collinear'` |
| `tangent` | Tangent constraint | `6-input.js` → `currentTool==='tangent'` |
| `dim` | Dimension tool | `6-input.js` → `currentTool==='dim'` |

### `state.active` Object
Tracks in-progress operations within a tool.

| Active State | Meaning | Structure |
|--------------|---------|-----------|
| `{ mode:'coincident', j1, firstType:'joint' }` | First joint selected | Waiting for 2nd element |
| `{ mode:'coincident', line1, firstType:'line' }` | First line selected | Waiting for joint |
| `{ start, preview }` | Drawing shape | Has start joint and preview coords |
| `{ mode:'parallel', shape1 }` | First line selected | Waiting for 2nd line |

### `state.drag` Object
Tracks active drag operations.

| Drag Type | Structure | Behavior |
|-----------|-----------|----------|
| `type:'joint'` | `{ jointIds, initial }` | Moves all joints in cluster |
| `type:'line'` | `{ jointIds, initial }` | Moves both line endpoints |
| `type:'pan'` | `{ start, initialPan }` | Pans the view |

---

## 👁️ Rendering Layers

Render order (bottom to top) in `4-render.js`:

1. **Grid** - Background grid lines
2. **Shapes** - Lines and circles (with selection/constraint highlighting)
3. **Origin** - Red crosshair at (0,0)
4. **Joints** - White circles (with hover/selection/constraint highlighting)
5. **Preview shapes** - Dashed green preview while drawing
6. **Preview glyphs** - Semi-transparent constraint glyph previews drawn via `drawConstraintGlyph` using synthetic preview constraint objects (`__isPreview`, optional `__pos`). The renderer sets `data-preview="1"` on preview groups and disables pointer-events; these previews are visual-only and are ignored by `addConstraint`.
7. **Snap indicators** - Blue rings when snapping
8. **Inference hints** - H/V/Perp indicators while drawing
9. **Constraint Glyphs** - Final constraint icons (ON TOP)

### Glyph Colors

| Constraint | Fill | Stroke |
|------------|------|--------|
| Coincident | `#ef4444` (red) | `#dc2626` |
| Horizontal | `#22c55e` (green) | `#15803d` |
| Vertical | `#22c55e` (green) | `#0369a1` |
| Parallel | `#3b82f6` (blue) | `#ca8a04` |
| Perpendicular | `#a855f7` (purple) | `#7c3aed` |
| Collinear | `#14b8a6` (teal) | `#0d9488` |
| Tangent | `#fbbf24` (yellow) | white |
| Point-on-Line | `#fb923c` (orange) | `#ea580c` |

---

## 🔍 Hit Detection

### Finding Elements at Click Position

| Function | File | Returns | Used For |
|----------|------|---------|----------|
| `findSnap()` | `3-snap.js` | `{type:'joint', id, pt}` or `{type:'line', shape, pt}` | General snap detection |
| `hitJointAtScreen()` | `3-snap.js` | `{id, j}` or null | Direct joint hit test |
| `hitLineAtScreen()` | `3-snap.js` | `{shape, pt}` or null | Direct line hit test |
| Glyph click | `6-input.js` | Via `e.target.closest('.constraint-glyph')` | Constraint selection |

### Snap Thresholds (`1-utils.js`)

| Constant | Value | Purpose |
|----------|-------|---------|
| `SNAP_PX` | 50 | General joint snap |
| `INFERENCE_SNAP_PX` | 15 | Inference hint snap (tighter) |
| `LINE_SNAP_PX` | 20 | Line snap |

---

## ⚙️ Solver (`2-solver.js`)

Iterative relaxation solver - runs multiple passes to satisfy constraints.

| Constraint | Solving Strategy |
|------------|------------------|
| Coincident | Move both joints toward midpoint |
| Horizontal | Average Y coordinates |
| Vertical | Average X coordinates |
| Parallel | Rotate second line to match first's angle |
| Perpendicular | Rotate to closest ±90° option |
| Collinear | Project middle joints onto line through endpoints |
| Tangent | Move circle center to distance=radius from line |
| Distance | Scale joint positions to achieve target length |
| Point-on-Line | Project point onto line segment |

---

## 🔑 Key State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `state.joints` | Map | All joints `{id → {x,y}}` |
| `state.shapes` | Array | All shapes `[{type, id, joints}]` |
| `state.constraints` | Array | All constraints |
| `state.selectedJoints` | Set | Currently selected joint IDs |
| `state.selectedShape` | Object | Currently selected shape |
| `state.selectedConstraint` | Object | Currently selected constraint |
| `state.currentTool` | String | Active tool name |
| `state.active` | Object | In-progress tool operation |
| `state.drag` | Object | Active drag operation |
| `state.snapTarget` | Object | Current snap target for rendering |
| `state.inference` | Object | Current inference hint |
| `state.hoveredJoint` | Object | Joint under cursor |
| `state.hoveredShape` | Object | Shape under cursor |
| `state.hoveredConstraint` | Object | Constraint glyph under cursor |

---

## 📁 File Responsibilities

| File | Primary Responsibility |
|------|------------------------|
| `1-utils.js` | Coordinate transforms, constants, geometry helpers; `hasConstraint` dedup + `addConstraint` preview guard (ignores `__isPreview`) |
| `2-solver.js` | Constraint solving (relaxation iterations) |
| `3-snap.js` | Hit detection, snap finding, inference detection |
| `4-render.js` | All SVG rendering; includes `drawConstraintGlyph` and rendering of synthetic preview constraints (`__isPreview`) |
| `5-engine.js` | State management, ID generation, solve loop wrapper |
| `6-input.js` | All pointer/keyboard event handling |
| `7-ui.js` | Toolbar button handlers, tool switching |
| `8-main.js` | Bootstrap, state initialization, render loop |

---

## 🔄 Common Patterns

### Adding a New Constraint Type

1. **Data structure** - Define in constraints array format
2. **Solver** - Add case in `2-solver.js` → `solve()`
3. **Tool handler** - Add in `6-input.js` for toolbar application
4. **Auto-creation** - Add to snap handling in drawing tools if needed
5. **Glyph rendering** - Add in `4-render.js` constraint glyph section
6. **Preview glyph** - Add in `4-render.js` preview glyph section
7. **Selection highlighting** - Add case in `4-render.js` highlight logic
8. **Deletion** - Works automatically via constraint array

### Finding "All Places That Do X"

| Task | Search For |
|------|------------|
| Create coincident | `type: 'coincident'` or `type:'coincident'` |
| Handle joint click | `hitJoint` or `hitSnap.*joint` |
| Handle line click | `hitLine` or `hitSnap.*line` |
| Render a glyph | `constraint-glyph` or `svg.insertAdjacentHTML` |
| Tool activation | `currentTool===` or `setTool(` |
| Drag handling | `state.drag` |
| Selection handling | `selectedJoints` or `selectedShape` |

# AI Agent Quick Guide - Sketch Studio

## 🚀 Essential Workflow for Code Changes

### BEFORE ANY CODE CHANGE:
1. **Check APP_MAP.md** - Find where functionality lives
2. **Check EXPORT_HANDLING_GUIDE.md** - Understand safe edit workflow
3. **Check SKETCH STUDIO TERMINOLOGY.md** - Use correct terms

### EDITING RULES:
- ✅ Edit source files in ``
- ❌ Never edit `output/` files directly
- ✅ Test modular version first (`index.html`)
- ✅ Sync to export only after source works

## 📁 File Responsibilities (From APP_MAP.md)

| File | What It Does | Common Changes |
|------|--------------|----------------|
| `1-utils.js` | Geometry helpers, constants | New math functions, constants |
| `2-solver.js` | Constraint solving | New constraint types |
| `3-snap.js` | Hit detection, snapping | Snap thresholds, hit logic |
| `4-render.js` | SVG rendering | Visual changes, glyph styles |
| `5-engine.js` | State facade | Getter/setter methods |
| `6-input.js` | Input handling | UI interaction, pointer events |
| `7-ui.js` | Toolbar, shortcuts | Tool buttons, keyboard bindings |
| `8-main.js` | Initialization | App setup, engine creation |

## 🔑 Key Terminology (Quick Reference)

### Core Concepts:
- **Joint**: Point vertex (x,y coordinates)
- **Shape**: Geometry defined by joints (line, circle, rectangle)
- **Constraint**: Rule between joints/shapes (coincident, parallel, etc.)
- **Snap**: Cursor "magnet" to existing geometry
- **Inference**: Automatic constraint detection while drawing

### Constraint Types:
1. Coincident (X) - Points share same position
2. Horizontal (-) - Line parallel to X-axis
3. Vertical (|) - Line parallel to Y-axis
4. Distance (D) - Specific length between points
5. Parallel (//) - Two lines same angle
6. Perpendicular (⊥) - Two lines 90° angle
7. Point-on-Line - Point lies on line segment
8. Collinear - 3+ points on same line
9. Tangent - Line touches circle at one point

## ⚠️ Critical Warnings

1. **Export Files**: `output/sketch-studio-unified-v1.0.html` is GENERATED, not source
2. **Source Truth**: `src/` files are PRIMARY
3. **Sync Direction**: Source → Export (one-way)
4. **Test Order**: 1) Modular version, 2) Export version

## 🛠️ Common Tasks & Where to Look

### Add New Constraint:
1. `2-solver.js` - Add solving logic
2. `6-input.js` - Add tool handler
3. `4-render.js` - Add glyph rendering
4. `1-utils.js` - Add to CONSTRAINT_COLORS

### Modify UI:
1. `7-ui.js` - Toolbar buttons
2. `6-input.js` - Input handling
3. `index.html` - HTML structure

### Fix Performance:
1. Check `PERFORMANCE_ANALYSIS.md` first
2. Known bottlenecks marked with 🔴 CRITICAL

## 📞 Quick Reference Table

| Need to... | Check This Guide First |
|------------|-----------------------|
| Find where code lives | APP_MAP.md |
| Edit files safely | EXPORT_HANDLING_GUIDE.md |
| Understand terms | SKETCH STUDIO TERMINOLOGY.md |
| Work with constraints | constraints.md |
| Understand features | sketch guide.md |
| Optimize performance | PERFORMANCE_ANALYSIS.md |
| Understand solver | solver categories.md |
| General CAD context | cad dev tech guide.md |

## 🎯 AI Agent Best Practices

1. **Always preserve modular structure** - Don't inline code that should be modular
2. **Use existing patterns** - Follow same style as surrounding code
3. **Add JSDoc comments** - Document new functions
4. **Test incrementally** - Small changes, frequent testing
5. **Reference guides** - Don't guess, check documentation

## 🔍 When You're Stuck

1. **Can't find function?** → APP_MAP.md "Find All Places That Do X"
2. **Don't understand term?** → SKETCH STUDIO TERMINOLOGY.md
3. **Unsafe edit workflow?** → EXPORT_HANDLING_GUIDE.md
4. **Constraint not working?** → constraints.md + APP_MAP.md constraint paths

---

*Last verified: All guides current with codebase*
*Use this as quick reference during development tasks*
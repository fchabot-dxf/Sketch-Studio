# Sketch Studio Documentation

## 📁 Organized Documentation Structure

### 🏗️ **Architecture** (`docs/architecture/`)
*Essential for understanding the codebase*

| File | Purpose | When to Use |
|------|---------|-------------|
| [APP_MAP.md](./architecture/APP_MAP.md) | Complete application architecture map | **Before ANY code change** - find where functionality lives |
| [EXPORT_HANDLING_GUIDE.md](./architecture/EXPORT_HANDLING_GUIDE.md) | Safe source/export workflow | When editing files - prevents breaking project structure |
| [EXPORT_GUIDE.md](./architecture/EXPORT_GUIDE.md) | Export wizard & DXF/SVG behavior | How to use the export UI and options |
| [SKETCH STUDIO TERMINOLOGY.md](./architecture/SKETCH_STUDIO_TERMINOLOGY.md) | Domain-specific vocabulary | When reading/writing code - ensures correct terminology |

### 🎯 **Features** (`docs/features/`)
*User-facing functionality documentation*

| File | Purpose | When to Use |
|------|---------|-------------|
| [sketch guide.md](./features/sketch%20guide.md) | Core feature overview | Understanding what the application does |
| [constraints.md](./features/constraints.md) | Constraint system details | Working with or modifying constraints |

### 🔧 **Development** (`docs/development/`)
*Development and optimization guidance*

| File | Purpose | When to Use |
|------|---------|-------------|
| [PERFORMANCE_ANALYSIS.md](./development/PERFORMANCE_ANALYSIS.md) | Performance bottlenecks & optimizations | When addressing performance issues |
| [solver categories.md](./development/solver%20categories.md) | Solver theory and strategies | Advanced solver modifications |

### 🤖 **AI** (`docs/ai/`)
*AI agent-specific guidance*

| File | Purpose | When to Use |
|------|---------|-------------|
| [AI_AGENT_GUIDE.md](./ai/AI_AGENT_GUIDE.md) | Quick reference for AI agents | **AI agents: Start here** for workflow |
| [REFACTOR_SUGGESTIONS.md](./ai/REFACTOR_SUGGESTIONS.md) | Safe refactoring suggestions | Considering code improvements |
| [IMMEDIATE_REFACTORS.md](./ai/IMMEDIATE_REFACTORS.md) | Quick, safe changes | Making minimal-risk improvements |
| [MD_GUIDES_ORGANIZATION.md](./ai/MD_GUIDES_ORGANIZATION.md) | Guide organization analysis | Understanding documentation structure |

### 📦 **Archive** (`docs/archive/`)
*Background/less critical documentation*

| File | Purpose |
|------|---------|
| [cad dev tech guide.md](./archive/cad%20dev%20tech%20guide.md) | General CAD development challenges |

## 🚀 Quick Start for AI Agents

### **Essential Workflow:**
1. **Before code changes**: Read `AI_AGENT_GUIDE.md` for workflow
2. **Find code location**: Check `APP_MAP.md`
3. **Understand safe editing**: Check `EXPORT_HANDLING_GUIDE.md`
4. **Use correct terms**: Check `SKETCH STUDIO TERMINOLOGY.md`

### **Critical Rules:**
- ✅ **Source files are primary**: `src/`
- ❌ **Export files are derivative**: `output/` (never edit directly)
- 🔄 **Sync direction**: Source → Export only
- 🧪 **Test order**: Modular version first, then export

## 📋 File Responsibilities (Quick Reference)

| Module | Responsibility | Key Exports |
|--------|----------------|-------------|
| `core-utils.js` | DEPRECATED (use `./core/*`) | re-exports previously provided constants & helper shims |
| `constraint-solver.js` | Constraint solving engine | `createEngine` factory, solver facade |
| `snap-detection.js` | Hit detection, snapping | `findSnap`, `findInference`, hit detection functions |
| `svg-renderer.js` | SVG rendering | `draw` function, rendering logic |
| `ui-manager.js` | Toolbar, shortcuts | `setupUI`, tool switching |
| `input-handler.js` | Input handling | `setupInput`, mouse/touch events |
| `main.js` | Initialization | App bootstrap, render loop |
| `solver-core.js` | Core solver algorithms | `solveConstraints` |

## 🔗 Project Structure

```
     # SOURCE - Primary development
├── index.html             # Main app entry point
├── src/                   # Modular JavaScript
│   ├── main.js             # App bootstrap and render loop
│   ├── ui-manager.js       # UI orchestration, toolbar, tool switching
│   ├── ui-manager-fixed.js # Alternate UI manager with fixes/patches
│   ├── svg-renderer.js     # SVG drawing and rendering utilities
│   ├── input-handler.js    # Mouse/touch input normalization & handlers
│   ├── snap-detection.js   # Hit detection, snapping and inference
│   ├── constraint-solver.js# High-level solver facade and orchestration
│   ├── solver-core.js      # Core solver algorithms and iterations
│   ├── core-utils.js       # Shared utilities, constants, geometry helpers
│   ├── app/                # App-level modules (currently empty)
│   │
│   ├── core/               # Domain models: shapes, joints, geometry
│   │   ├── constants.js    # Project constants and colors
│   │   ├── geometry.js     # Geometry primitives and helpers
│   │   ├── constraints.js  # Constraint model definitions
│   │   ├── shapes.js       # Shape data structures and helpers
│   │   └── joints.js       # Joint representations and utilities
│   ├── ui/                 # UI-specific handlers and input modules
│   │   ├── input-manager.js    # High-level input manager for UI
│   │   └── input-handlers/     # Individual tool/input handlers
│   │       ├── drawing-tools.js
│   │       ├── selection-tools.js
│   │       ├── constraint-tools.js
│   │       ├── pan-zoom.js
│   │       ├── dimension-input.js
│   │       ├── linetool.js # LEGACY - compatibility re-export (deprecated)
│   │       ├── line-tool.js
│   │       ├── rect-tool.js
│   │       ├── circle-tool.js
│   │       ├── polygon-tool.js
│   │       └── arc-tool.js
│   └── utils/              # Small helper libraries and utilities (currently empty)
└── config.json             # Configuration (read-only)

output/                   # EXPORT - Generated files
└── sketch-studio-unified-v1.0.html  # Single-file export

docs/                     # DOCUMENTATION (this folder)
├── architecture/         # Core architecture docs
├── features/            # Feature documentation
├── development/         # Development guides
├── ai/                  # AI agent guidance
└── archive/             # Background/less critical
```
## 🔧 Cleanup & Repo Rules

- **Output is generated:** Treat `output/` as build artifacts; do not edit files there. Publish official single-file exports to a `releases/` folder instead of leaving them in `output/`.
- **Source is canonical:** Make code changes in `src/` and keep `config.json` as the authoritative config.
- **Avoid nested repos:** Remove or convert `.git` (use a submodule if the nested repo is intentional) to prevent nested Git issues.
- **Tests & diagnostics:** Move pages like `diagnostic-test.html` and `test-import.html` into `docs/tests/` for discoverability.
- **Update `.gitignore`:** Add common patterns such as `output/`, `node_modules/`, `*.log`, and OS temp files (`Thumbs.db`, `.DS_Store`).
- **Docs canonicalization:** Use `docs/README.md` as the primary project documentation; merge or link `README.md` to avoid duplication.
```

## 🎯 When You Need Help

### **Can't find where code lives?**
→ Check `APP_MAP.md` "Find All Places That Do X" section

### **Unsure about safe editing?**
→ Read `EXPORT_HANDLING_GUIDE.md` workflow

### **Don't understand a term?**
→ Search `SKETCH STUDIO TERMINOLOGY.md`

### **Adding a new feature?**
→ Check `APP_MAP.md` for patterns, then relevant module

## 📝 Update Notes

- **Last reorganization**: January 2026
- **All guides verified** against current codebase
- **AI agent guidance** added for efficient development
- **Archive created** for less critical background material

---

*This documentation structure is optimized for both human developers and AI agents working on the Sketch Studio project.*

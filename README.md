"# Sketch Studio Unified

A CAD-style 2D sketch application with constraint solving.

## Where this is heading

SketchStudio is becoming the **first shell of a parametric-CAD platform** — *one shared, headless
"brain" (model · constraint solver · geometry · units · interaction) with many thin app shells*
over it: SketchStudio itself, a **Shaper Origin** cut-path editor, and future apps
(laser / 3D-print / other CNC). The constraint solver in this repo *is* that brain and is being
**reused, not rewritten**. Browser-native ESM + import map, **no build step**. See **`ROADMAP.md`**
for the full plan and **`NEXT-SESSION.md`** for the current work in flight.

## Fundamental Design Principle

**Every shape has unique joints at each endpoint.** Connections between shapes are made via explicit **coincident constraints**, not by sharing joint objects.

Example:
- **Line 1:** `joint_A` → `joint_B`
- **Line 2:** `joint_C` → `joint_D`
- **Connection:** Coincident constraint between `joint_B` and `joint_C`

This applies to all shapes (polylines, rectangles, circles, etc.). When drawing and snapping to an existing joint, a coincident constraint is automatically created to maintain the connection while keeping each shape's joints independent.

## Quick Start

Open `index.html` in a modern browser (Chrome/Edge/Firefox).

> **Note:** ES modules require a web server. Use VS Code's \"Live Preview\" extension, or run a local server.

### Styling

The app uses Tailwind CSS via the official CDN (`<script src="https://cdn.tailwindcss.com">` in `index.html`). Tailwind compiles in the browser at page load — no local build step is required to develop or deploy.

### Single-file offline build (optional)

To produce a self-contained HTML file with all JS bundled inline (e.g. for emailing or running offline):

```
npm install
npm run build:inline
```

Output: `output/sketch-studio-unified-v1.0.html`.
## File Structure

```

├── index.html          # Main app
├── config.json         # Configuration values
├── apply-config.ps1    # Script to apply config to source files
├── config.html         # Visual config editor (optional)
├── diagnostic-test.html # Diagnostic testing page
├── test-import.html    # Module import testing
├── server.js           # Local development server
├── package.json        # Node.js dependencies
├── TAILWIND.md         # Tailwind CSS documentation
└── src/
    ├── main.js         # App initialization & render loop
    ├── ui-manager.js   # Toolbar & keyboard shortcuts
    ├── svg-renderer.js # SVG rendering
    ├── input-handler.js # Mouse/touch input handling
    ├── snap-detection.js # Snap detection (joints, lines)
    ├── constraint-solver.js # Constraint solver (Newton–Raphson / Levenberg–Marquardt)
    ├── core-utils.js   # DEPRECATED - previously a re-export shim (use ./core/* modules directly)
    ├── solver-core.js  # Core solver algorithms
    ├── ui-manager-fixed.js # LEGACY - alternate UI manager (do not use)
    └── ui/
        ├── input-manager.js # Input management
        └── input-handlers/
            ├── drawing-tools.js # Drawing tool implementations
            ├── selection-tools.js # Selection tools
            ├── constraint-tools.js # Constraint tools
            ├── pan-zoom.js # Pan & zoom controls
            ├── dimension-input.js # Dimension input
            ├── line-tool.js # Line drawing tool
            ├── rect-tool.js # Rectangle drawing tool
            ├── circle-tool.js # Circle drawing tool
            ├── arc-tool.js # Arc drawing tool
            └── linetool.js # LEGACY compatibility re-export (not used)
    └── core/
        ├── constants.js # Constants & configuration
        ├── geometry.js # Geometry helpers
        ├── constraints.js # Constraint definitions
        ├── shapes.js # Shape definitions
        └── joints.js # Joint definitions
```

## Configuration

Edit `config.json` to customize colors, sizes, and behavior:

```json
{
  \"snapping\": { \"snapPx\": 30, \"jointHitRadius\": 14 },
  \"joints\": { \"radius\": 6, \"fillColor\": \"#ffffff\", ... },
  \"shapes\": { \"strokeColor\": \"#2563eb\", ... },
  ...
}
```

Then run `apply-config.ps1` (right-click → Run with PowerShell) to apply changes.

## Keyboard Shortcuts

| Key | Tool |
|-----|------|
| L | Line |
| R | Rectangle |
| C | Circle |
| S / V | Select |
| O | Coincident constraint |
| H | Horizontal/Vertical constraint |
| P | Parallel constraint |
| T | Perpendicular constraint |
| D | Dimension |
| Escape | Cancel current action |
| Delete | Delete selected constraint (or clear all) |
| Ctrl+Z | Undo last shape |

## Features

- **Drawing:** Line, rectangle, circle with polyline continuation
- **Snapping:** Point-to-point, point-to-line with visual feedback
- **Constraints:** Coincident, horizontal, vertical, parallel, perpendicular, distance, point-on-line
- **Solver:** Newton–Raphson (Levenberg–Marquardt) maintains constraint satisfaction (default)
- **Selection:** Click joints to select, shift-click for multi-select
- **Constraint glyphs:** Visual indicators appear when selecting constrained joints
- **Pan & Zoom:** Drag empty space to pan, scroll wheel to zoom

## Notes

- Origin is at (0,0) with red X-axis and green Y-axis
- Right-click cancels polyline mode
- Background turns light orange when snapping is active"
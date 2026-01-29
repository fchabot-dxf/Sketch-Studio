# Sketch Studio Unified

A CAD-style 2D sketch application with constraint solving.

## Fundamental Design Principle

**Every shape has unique joints at each endpoint.** Connections between shapes are made via explicit **coincident constraints**, not by sharing joint objects.

Example:
- **Line 1:** `joint_A` → `joint_B`
- **Line 2:** `joint_C` → `joint_D`
- **Connection:** Coincident constraint between `joint_B` and `joint_C`

This applies to all shapes (polylines, rectangles, circles, etc.). When drawing and snapping to an existing joint, a coincident constraint is automatically created to maintain the connection while keeping each shape's joints independent.

## Quick Start

Open `index.html` in a modern browser (Chrome/Edge/Firefox).

> **Note:** ES modules require a web server. Use VS Code's "Live Preview" extension, or run a local server.

## File Structure

```
sketch-studio-unified/
├── index.html          # Main app
├── config.json         # Configuration values
├── apply-config.ps1    # Script to apply config to source files
├── config.html         # Visual config editor (optional)
└── src/
    ├── 1-utils.js      # Constants & helper functions
    ├── 2-solver.js     # Constraint solver (relaxation)
    ├── 3-snap.js       # Snap detection (joints, lines)
    ├── 4-render.js     # SVG rendering
    ├── 5-engine.js     # Engine facade (store + solver)
    ├── 6-input.js      # Mouse/touch input handling
    ├── 7-ui.js         # Toolbar & keyboard shortcuts
    └── 8-main.js       # App initialization & render loop
```

## Configuration

Edit `config.json` to customize colors, sizes, and behavior:

```json
{
  "snapping": { "snapPx": 30, "jointHitRadius": 14 },
  "joints": { "radius": 6, "fillColor": "#ffffff", ... },
  "shapes": { "strokeColor": "#2563eb", ... },
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
- **Solver:** Iterative relaxation maintains constraint satisfaction
- **Selection:** Click joints to select, shift-click for multi-select
- **Constraint glyphs:** Visual indicators appear when selecting constrained joints
- **Pan & Zoom:** Drag empty space to pan, scroll wheel to zoom

## Notes

- Origin is at (0,0) with red X-axis and green Y-axis
- Right-click cancels polyline mode
- Background turns light orange when snapping is active


# Export Guide (SVG & DXF) 🔧

This document explains the built-in **Export** wizard and the options available when exporting sketch geometry to **SVG** and **DXF (R12)**.

## What is exported
- Only **lines** and **arcs** are exported. Joints, glyphs, UI elements, and constraints are not included.
- By default arcs are exported as native arc entities (SVG `<path>` with `A` or DXF `ARC`). You can ask the exporter to approximate arcs as polylines if your target CAD doesn't support arcs well.

## Options available in the wizard
- **File name**: base name for the downloaded file (extension appended automatically).
- **File type**: `svg` or `dxf` (R12 compatible text DXF).
- **Export lines & arcs only**: when checked, other shapes are ignored.
- **Precision (decimals)**: number of decimal places for numeric coordinates (0–8).
- **Approximate arcs**: when enabled, arcs are tessellated into a polyline with `Arc segments` subdivisions.
- **Arc segments**: number of segments used when approximating arcs (default 32).
- **Scale & units**: apply a scale multiplier to coordinates; units are informational only and not embedded in R12 DXF.
- **Invert Y axis**: option helpful when exporting DXF for some CAD systems with different coordinate origins.
- **DXF version**: R12 is exported by default (widely compatible). Future versions may be added if needed.

## Limitations & notes
- DXF R12 doesn't include an explicit units tag used consistently by all CAD systems; use scale + units to control dimensional output.
- Arc approximation uses a fixed segment count. If you need tolerance-based tessellation, consider adding a "tolerance" option.
- The exporter runs client-side and triggers a download via a Blob URL. If you want server-side generation, extract the builder functions (`buildSVG`, `buildDXF`) into a server module.

## Testing
- Unit tests for the exporter are placed under `tests/export.test.js` and verify basic line & arc output, precision, and approximation behavior.

If you'd like I can add tolerance-based arc tessellation, embed unit metadata into DXF, or add more DXF version support. 💡

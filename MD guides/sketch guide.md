Sketch Studio Pro: Comprehensive Feature Guide
This guide covers the core features found across the various iterations of the Sketch Studio and Fusion 360 Sketch Master applications. These tools are designed as lightweight, browser-based CAD (Computer-Aided Design) sketchers utilizing iterative geometric constraint solvers.
1. Core Geometric Creation
These tools allow for the creation of basic 2D geometric entities.
 * Line (L): Standard point-to-point line segments.
 * Rectangle (R): Supports multiple modes:
   * Normal: Two-corner definition.
   * Midpoint: Center-to-corner definition.
   * 3-Point: Three points defining width, height, and orientation.
 * Circle (C): Center-point to radius-point definition.
 * Arc (A): * 3-Point Arc: Start, end, and a point on the curve.
   * Center-Radius: Center point followed by start and end angles.
   * Tangent Arc: Creates an arc tangent to an existing line.
 * Advanced Shapes: (Found in "Sketch Master" versions)
   * Polygon: N-sided regular shapes.
   * Ellipse: Center with major/minor axes.
   * Slot: Rectangle with semi-circular ends.
   * Spline: Multi-point curved paths.
2. Geometric Constraint System
The "intelligence" of the app lies in its iterative solver, which maintains relationships between entities even when they are moved.
 * Coincident (X): Bonds two points together or pins a point to a curve (Line/Circle).
 * Horizontal / Vertical (H/V): Forces lines to be perfectly parallel to the X or Y axis.
 * Parallel (//): Ensures two lines maintain the same angle relative to each other.
 * Perpendicular (T / ⊥): Ensures two lines maintain a 90-degree angle.
 * Tangent (○): Ensures a smooth transition between a curve and a line or another curve.
 * Midpoint (•): Pins a point exactly to the center of a line segment.
 * Colinear (—): Forces two line segments to lie on the same infinite line.
3. Precision & Snapping Engine
 * Joint Merging: Dragging one endpoint onto another automatically merges them into a single "Joint," creating an implicit coincident constraint.
 * Inference System: While drawing, the app provides visual "guides" (dashed lines) to snap to horizontal, vertical, or perpendicular alignments automatically.
 * Snap Feedback: Visual cues (colored boxes or background pulses) indicate when the cursor is close enough to a point or line to trigger a snap.
 * Origin Datum: A fixed (0,0) point that serves as the anchor for the entire sketch.
4. Dimensional Inspection
 * Dimension (D): Allows the user to set a specific length for a line or a distance between two points.
 * Floating Input: When a dimension is placed, a text box appears to allow precise numerical entry.
 * Constraint Preservation: Changing a dimension triggers the solver to move other connected parts of the sketch to accommodate the new value.
5. Navigation & UI Features
 * Infinite Pan: Space + Drag or Middle-Mouse Button to move the view.
 * Dynamic Zoom: Mouse wheel or Pinch-to-zoom (on mobile) centered on the cursor position.
 * Grid System: Synchronized background grid that scales and pans 1:1 with geometry.
 * Undo/Clear: Quick buttons to revert the last action or wipe the canvas.
 * Solver Status: Visual indicator showing if the current geometric configuration has successfully "converged" (solved).
6. Persistence & Export
 * Local Storage: Auto-saves the current sketch so it persists after a browser refresh.
 * JSON Export/Import: (Advanced version) Allows users to download their sketch as a .json file and upload it later or share it with others.

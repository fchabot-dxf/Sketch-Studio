# Sketch Studio - Complete Terminology Guide

## GEOMETRY ELEMENTS

### Joints (Points)
- **Joint** - A point vertex in the sketch with x,y coordinates
- **Origin Joint** - The fixed point at (0,0), ID: `j_origin`, renders as 6px red circle
- **Regular Joint** - Standard movable point, renders as 18px white circle with blue stroke
- **Selected Joint** - Joint in selection set, renders as 18px yellow circle with orange stroke
- **Coincident to Origin** - Joint with coincident constraint to origin, renders as regular point with 8px red center overlay

### Shapes
- **Line** - Straight segment between two joints
- **Circle** - Defined by center joint and radius joint
- **Rectangle** - Four lines with perpendicular and parallel constraints
- **Shape ID** - Unique identifier for each shape (e.g., `s1738095847123`)

## CONSTRAINTS

### Constraint Types
- **Coincident** - Forces multiple joints to same position
- **Horizontal** - Forces line to be parallel to X-axis (±5° tolerance)
- **Vertical** - Forces line to be parallel to Y-axis (±5° tolerance)
- **Perpendicular** - Forces two lines to 90° angle (±5° tolerance)
- **Parallel** - Forces two lines to same angle
- **Distance/Dimension** - Maintains specific distance between joints
- **Point-on-Line** - Constrains joint to lie on a line

### Constraint Glyphs (Visual Indicators)
- **Coincident Glyph** - Small red X symbol offset from joint position
- **Horizontal Glyph** - Small horizontal line with arrows `←→`
- **Vertical Glyph** - Small vertical line with arrows `↑↓`
- **Perpendicular Glyph** - Small square symbol `⊥`
- **Dimension Label** - Rectangle with distance value, draggable perpendicular to line

## SNAPPING SYSTEM

### Snap Targets
- **Joint Snap** - Cursor locks to existing joint within tolerance
- **Line Snap** - Cursor locks to nearest point on a line
- **Snap Tolerance** - Detection radius in pixels:
  - Regular snap: 50px (joints), 20px (lines)
  - Inference snap: 15px (tighter for precision during drawing)

### Snap Feedback (Visual Indicators)
- **Joint Snap Highlight** - Three-layer visual:
  - 32px orange glow (outer, 15% opacity)
  - 24px orange circle stroke (middle, 3px width)
  - 3px solid orange dot (center)
- **Line Snap Diamond** - Orange rotated square at snap point (12x12px)
- **Line Snap Highlight** - Orange line overlay (4px width, 50% opacity)
- **Line Snap X Mark** - Small X indicating coincident will be created

## INFERENCE SYSTEM

### Inference Types
- **Horizontal Inference** - Detects line within ±5° of horizontal
- **Vertical Inference** - Detects line within ±5° of vertical (±90°)
- **Perpendicular Inference** - Detects line perpendicular to reference line (±5°)

### Inference Feedback
- **Inference Line** - Dashed construction line showing inferred direction (gray, 1px)
- **Horizontal Icon** - Yellow "H" badge at midpoint
- **Vertical Icon** - Green "V" badge at midpoint
- **Perpendicular Icon** - Cyan "⊥" badge at midpoint with orange dot indicator
- **Reference Indicator** - Small orange circle on the reference line being perpendicular to

## DRAWING TOOLS

### Tool Modes
- **Select Tool** - Default mode for selecting and dragging
- **Line Tool** - Single-click polyline mode
- **Rectangle Tool** - Three modes:
  - **2-Point Mode** - Diagonal corners
  - **Center Mode** - Center + corner
  - **3-Point Mode** - Base + width + height
- **Circle Tool** - Center + radius point
- **Coincident Tool** - Two-click to create coincident constraint
- **Dimension Tool** - Click line or two points to add distance constraint

### Drawing States
- **Active** - Tool has started an operation (e.g., first click placed)
- **Preview** - Ghost visualization of shape before completion
- **Continue From** - Endpoint ready for next polyline segment
- **Polyline Origin** - First point of a polyline chain
- **Just Created Active** - Flag to prevent duplicate processing on first click

## VISUAL FEEDBACK ELEMENTS

### Point Rendering
- **Standard Point** - 18px radius white fill, blue stroke (2px)
- **Selected Point** - 18px radius yellow fill (#fbbf24), orange stroke (#f59e0b, 3px)
- **Origin Point** - 6px radius red fill (#ef4444), no stroke
- **Origin-Coincident Point** - Standard point with 8px red center overlay
- **Preview Point** - Semi-transparent point during drawing

### Line Rendering
- **Shape Line** - 6px width, blue stroke (#2563eb), round linecap
- **Preview Line** - Dashed line during drawing (gray, 2px)
- **Inference Guide** - Thin dashed line for H/V/perpendicular hints (1px)
- **Dimension Extension** - Dashed perpendicular lines from joints to dimension (1px, green)

### Highlight States
- **Snapping Background** - Canvas background changes when snap is active
- **Glow Effect** - Large semi-transparent circle for snap indication
- **Stroke Highlight** - Thicker stroke on selected/hovered elements

## INTERACTION STATES

### Mouse/Touch Input
- **Pointer Down** - Mouse/finger presses down
- **Pointer Move** - Cursor/finger movement (updates preview and snap)
- **Pointer Up** - Mouse/finger releases (completes action)
- **Drag Start** - Movement begins after pointer down
- **Drag Threshold** - 2px minimum movement to register as drag vs click
- **Long Press** - 400ms hold to trigger dropdown menus

### Drag Types
- **Joint Drag** - Moving a single joint
- **Cluster Drag** - Moving all joints in coincident cluster together
- **Line Drag** - Moving entire line (both endpoints)
- **Pan Drag** - Middle mouse or background drag to pan viewport
- **Dimension Drag** - Moving dimension label perpendicular to line

### Hit Detection
- **Hit Joint** - Finding joint under cursor (30px radius for touch)
- **Hit Line** - Finding line under cursor (8px tolerance)
- **Hit Glyph** - Clicking on constraint glyph (uses closest('.constraint-glyph'))
- **Hit Dimension** - Clicking dimension label (traverses parent chain)

## SYSTEM COMPONENTS

### Solver
- **Constraint Solver** - Iterative relaxation system that adjusts joints
- **Solve Iteration** - Single pass adjusting all constraints
- **Solver Passes** - 8 iterations per frame for convergence
- **Constraint Priority** - All constraints have equal weight

### State Management
- **State** - Central object holding all app data
- **History** - Array of previous states (max 5)
- **Snapshot** - Deep copy of joints, shapes, constraints for undo
- **Save State** - Creating snapshot after modifications
- **Undo** - Restoring previous snapshot from history

### Coordinate Systems
- **World Space** - Actual geometric coordinates (units)
- **Screen Space** - Pixel coordinates on display
- **ViewBox** - SVG viewBox defining visible world region
- **View Transform** - Conversion between world ↔ screen coordinates

## UI ELEMENTS

### Toolbar
- **Tool Button** - Clickable button to activate tool (48x48px touch target)
- **Active Tool** - Currently selected tool (highlighted)
- **Tool Dropdown** - Long-press menu for tool variants (e.g., rect modes)
- **Mode Text** - Header showing current tool name

### Canvas
- **SVG Canvas** - Main drawing surface
- **Grid** - 50-unit grid lines (light gray, 0.5px)
- **Axis Lines** - Red X-axis and green Y-axis through origin (1.5px, 60% opacity)
- **Background** - Beige color (#faf8f5), changes when snapping active

### Input Fields
- **Dimension Input** - Floating text field for editing dimension values
- **Input Focus** - Active state when editing dimension
- **Input Blur** - Losing focus commits value

## COLOR CODING

### Functional Colors
- **Blue (#2563eb)** - Primary geometry (lines, joints)
- **Orange (#ea580c)** - Snap feedback and selection
- **Yellow (#fbbf24)** - Selected joints, horizontal inference
- **Green (#22c55e)** - Y-axis, vertical inference, dimension preview
- **Red (#ef4444)** - Origin point, X-axis, coincident glyphs
- **Cyan (#06b6d4)** - Perpendicular inference
- **Gray (#94a3b8)** - Preview lines, grid, disabled elements

### State Colors
- **Active Orange (#f59e0b)** - Selected stroke color
- **Inference Yellow** - Horizontal hint background
- **Inference Green** - Vertical hint background  
- **Inference Cyan** - Perpendicular hint background

## KEYBOARD SHORTCUTS

### Commands
- **Escape** - Exit current tool, return to select mode
- **Delete** - Remove selected constraint
- **Enter** - Confirm dimension value edit
- **Undo Button** - Restore previous state (last 5 actions)

## TOUCH OPTIMIZATION

### Touch Targets
- **Enlarged Hit Areas** - 30px radius for joint selection (vs 14px mouse)
- **Bigger Points** - 18px radius (3x original 6px)
- **Wider Lines** - 6px width (vs 2px originally)
- **Larger Highlights** - 32px glow for snap feedback

### Touch Gestures
- **Tap** - Single quick touch (2px movement tolerance)
- **Drag** - Touch and move (>2px movement)
- **Long Press** - 400ms hold for secondary actions
- **Middle Touch** - Two-finger pan (simulates middle mouse)

## ADVANCED CONCEPTS

### Coincident Clustering
- **Cluster** - Set of joints connected by coincident constraints
- **Cluster Traversal** - Finding all joints in coincident network
- **Cluster Drag** - Moving entire cluster as single unit

### Polyline Chaining
- **Sequential Clicks** - Each click creates new segment from previous endpoint
- **Chain Continuation** - Using `continueFrom` to track endpoint
- **Chain Termination** - Ending on origin or existing joint closes polyline
- **Tool Persistence** - Line tool stays active after segment completion

### Inference Priority
- **Point Priority** - Joint snaps always override line snaps
- **Snap Before Inference** - Snap target determines inference reference
- **Inference Guides Preview** - Dashed line shows where point will be placed

### Rendering Order (Z-index)
1. **Grid** - Background grid lines
2. **Axes** - Origin X/Y axes
3. **Shapes** - Lines, circles, rectangles
4. **Constraint Glyphs** - Visual constraint indicators
5. **Origin** - Small red circle at 0,0
6. **Joints** - Regular points
7. **Origin Overlays** - Red centers for origin-coincident points
8. **Previews** - Ghost shapes during drawing
9. **Snap Highlights** - Orange feedback
10. **Inference Hints** - H/V/⊥ icons
11. **Dimension Labels** - Floating text and extension lines

---

*This lexicon covers all terminology used in Sketch Studio. Use these terms for clear communication about features and bug reports.*

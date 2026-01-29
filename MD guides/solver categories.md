2D Sketching Architecture: Graph-Based Design
Unlike a drawing app that stores a list of pixels, a 2D constraint-based sketcher stores a Directed Acyclic Graph (DAG) of relationships. For HTML/JS environments, this architecture must be lightweight to ensure 60fps performance on the main thread.
1. Data Structure: The "Truth" Hierarchy
A robust sketch is built from three distinct layers of data. In an HTML app, these are typically managed as simple JavaScript Objects or Maps for fast lookup.
Layer 1: The Joint Map (The World State)
{
  "j_origin": { "x": 0, "y": 0, "fixed": true },
  "j_123": { "x": 100, "y": 50, "fixed": false }
}

HTML Context: This is the only place raw coordinates live. In JS, using a Map() is faster than an object for frequent additions/deletions during sketching.
Layer 2: The Geometry List (Topology)
[
  { "id": "l_1", "type": "line", "joints": ["j_origin", "j_123"] }
]

HTML Context: Geometry objects should only store "pointers" (IDs) to joints. This allows the SVG to render by looking up coordinates in the Joint Map.
Layer 3: The Constraint List (Logic)
[
  { "type": "horizontal", "joints": ["j_origin", "j_123"] },
  { "type": "distance", "joints": ["j_origin", "j_123"], "value": 100 }
]

HTML Context: Constraints are "listeners" that the solver iterates over.
2. Fundamental Solver Logic Strategies for HTML/JS
When building for the web, the solver must be efficient and "interruptible" to prevent freezing the UI.
Strategy A: Iterative Relaxation (PBD/XPBD)
 * Mechanism: Loops through constraints and applies local "corrections" to joint positions.
 * Why it works for HTML: It is perfectly suited for JS because it doesn't require heavy libraries. If the sketch is too complex, you can simply reduce the iteration count to maintain frame rate.
Strategy B: Localized Numerical Solvers (Newton-Raphson)
 * Mechanism: Solves equations using a Jacobian matrix.
 * Why it works for HTML: By limiting the matrix size to small clusters (2x2), the math stays instantaneous without blocking the main thread.
Strategy C: Logic-Based / DOF Reduction
 * Mechanism: Uses "If-This-Then-That" geometry rules.
 * Best For: Changing the color of SVG elements (e.g., Blue for under-defined, Black for fixed).
Strategy D: Sequential Propagation (Simple System Choice)
 * Mechanism: One-way dependency. Moving the "Parent" moves the "Child," but not vice-versa.
 * Pros: zero mathematical complexity; perfect for tools like "Mirror."
Strategy E: Geometric Construction (Ruler & Compass)
 * Mechanism: Finds intersections of virtual circles and lines using trigonometry.
 * Best For: Snapping logic. It allows the cursor to feel "locked" before a constraint is even created.
Strategy F: Soft-Constraint Optimization (Least Squares)
 * Mechanism: Minimizes the sum of errors.
 * Pros: Prevents "Math Error" messages; finds the "best fit" for fuzzy intent.
3. Hybrid Architectures: Mixing Solver Functions
Robust CAD apps rarely use just one solver. Mixing strategies allows you to handle different "phases" of sketching effectively.
Pattern 1: Snap Engine (Analytical) + Movement Solver (Iterative)
 * The Mix: Use Strategy E (Construction) for the cursor snap and Strategy A (Relaxation) for the background geometry.
 * Why: The snap engine must be perfectly precise and instantaneous to provide visual feedback. Once the user clicks, the iterative solver takes over to "relax" the rest of the connected graph into place.
Pattern 2: Diagnostic Engine (Logic) + Core Solver (Numerical)
 * The Mix: Use Strategy C (DOF Reduction) to calculate which parts of the sketch are "locked" and Strategy B (Numerical) to move the parts that are still free.
 * Why: Numerical solvers are great at moving points, but terrible at explaining why a point is stuck. Logic-based solvers provide the "reasoning" (e.g., "This line is black because it's Horizontal and tied to Origin").
Pattern 3: Primitive Macros (Kinematic) + Free-form Sketching (PBD)
 * The Mix: Use Strategy I (Analytical Kinematic) for standard shapes like Rectangles or Slots to keep them perfectly rigid, while using Strategy A (Relaxation) for lines drawn by hand.
 * Why: It ensures that a "Rectangle" always behaves like a rectangle, even if the solver iterations are low.
The Technical Requirement for Mixing
To mix solvers, every engine must speak the same language: The Joint Map.
 * Solvers must never store their own private coordinates.
 * They must read from Layer 1, calculate a "Suggested Delta," and write back to Layer 1.
 * This prevents "fighting" between solvers where one engine moves a point to X=10 and the other moves it to X=11 in the same frame.
4. Coordinate Space in HTML/SVG
 * Inverse Transform: Use svg.getScreenCTM().inverse() to map a mouse click to CAD world coordinates.
 * Zoom-Independent Snapping: Snapping thresholds should be defined in pixels (e.g., 20px) to ensure the "magnet" feel is consistent across zoom levels.
5. Persistence and Scaling
 * JSON Serialization: Sketches are stored as a flat JSON Graph.
 * Garbage Collection: Manually prune "orphaned joints" (joints with no geometry attached).
 * Boot-Up Resolve: Always run the solver once on window.onload to clean up rounding errors from JSON stringification.

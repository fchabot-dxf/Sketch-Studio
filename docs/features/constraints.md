Geometric Constraints Reference
In Sketch Studio Pro, constraints are the "rules" that govern how geometry behaves. When you move a point, the Iterative Solver runs a series of calculations to ensure these rules are never broken.
1. Coincident Constraint (X)
Description: Forces two independent points to share the exact same (x, y) coordinate, or pins a point to lie anywhere along a line or curve. It is the "glue" of CAD that turns individual lines into connected shapes.
 * Example: Snapping the end of a line to the center origin or joining two line segments to create a corner.
 * Solver Logic: Calculates the average position between two points and moves both to that midpoint.
2. Horizontal Constraint (-)
Description: Locks a line segment so that its start and end points always share the same Y-coordinate. This ensures the line is perfectly parallel to the top and bottom of your screen.
 * Example: Drawing the base of a house or the flat top of a mechanical bracket.
 * Solver Logic: Identifies the vertical midpoint between the two endpoints and forces both points to that Y-value.
3. Vertical Constraint (|)
Description: Locks a line segment so that its start and end points always share the same X-coordinate. This ensures the line is perfectly "up and down," parallel to the sides of your screen.
 * Example: Creating the side walls of a rectangle or the vertical axis of a symmetrical part.
 * Solver Logic: Identifies the horizontal midpoint between the two endpoints and forces both points to that X-value.
4. Distance / Dimension Constraint (D)
Description: Maintains a specific mathematical length between two points or the length of a line segment, regardless of its angle. It is the primary tool for defining the scale of a design.
 * Example: Setting a line to be exactly 100 units long or ensuring two holes are precisely 50 units apart.
 * Solver Logic: Calculates the current distance vs. the target value; it then "pushes" or "pulls" the points along their connecting vector to eliminate the error.
5. Parallel Constraint (//)
Description: Ensures that two separate line segments maintain the exact same angle relative to the world, meaning they will never intersect even if extended to infinity.
 * Example: Creating the two opposite sides of a parallelogram or the railings of a ladder.
 * Solver Logic: Samples the angle of the "Reference" line and rotates the "Target" line around its own center until their slopes match perfectly.
6. Perpendicular Constraint (⊥)
Description: Forces two lines to maintain a strict 90-degree angle relative to one another. If one line rotates, the other must rotate to stay "square."
 * Example: Ensuring the corner of a custom frame is perfectly square or creating a T-junction for a pipe.
 * Solver Logic: Takes the angle of the first line, adds 90 degrees (\pi/2 radians), and forces the second line to match that target orientation.
7. Tangent Constraint (○)
Description: Creates a smooth, seamless transition between a line and a circle (or two circles). The line will touch the circle at exactly one point without crossing into its interior.
 * Example: Creating a smooth "fillet" corner or a belt running around a pulley wheel.
 * Solver Logic: Moves the line perpendicular to itself until its distance from the circle's center equals the circle's radius.
8. Midpoint Constraint (•)
Description: Pins a specific point (usually the end of another line) exactly halfway between the start and end points of a target line segment.
 * Example: Attaching a vertical support beam exactly in the center of a horizontal floor joist.
 * Solver Logic: Constantly recalculates the center of the target line and teleports the constrained point to that dynamic (x, y) location.

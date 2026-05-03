# Immediate, Safe Refactors for Sketch Studio

## Quick Wins (Under 2 hours total)

### 1. Add Debug Flag (5 minutes)
**File**: `src/1-utils.js`
```javascript
// Add at top:
export const DEBUG = false;

// Update all console.log statements:
if (DEBUG) console.log('[addConstraint] Adding:', constraint);
```

### 2. Extract Common Constants (15 minutes)
**File**: `src/1-utils.js`
```javascript
// Add near existing constants:
export const DRAG_THRESHOLD = 2;          // pixels
export const LONG_PRESS_MS = 400;         // milliseconds
export const HIT_RADIUS = 14;             // pixels (touch target)
export const ANGLE_TOLERANCE = 5;         // degrees for inference
```

### 3. Add Basic JSDoc to Engine (30 minutes)
**File**: `src/5-engine.js`
```javascript
/**
 * Sketch Studio Engine - Core geometry and constraint management
 * @module engine
 */

/**
 * Creates a new engine instance
 * @param {SVGElement} svg - SVG canvas element
 * @returns {Object} Engine API
 */
export function createEngine(svg) {
  // ... existing code ...
}
```

### 4. Local shapeById Cache (10 minutes)
**File**: `src/2-solver.js`
```javascript
export function solveConstraints(joints, shapes, constraints, iter=20) {
  // Add at function start:
  const shapeById = new Map(shapes.map(s => [s.id, s]));
  
  // Replace any: shapes.find(s => s.id === someId)
  // With: shapeById.get(someId)
  // ... rest of function unchanged
}
```

## Why These Changes Are Safe

1. **No architectural changes** - All modifications are additive or local
2. **No breaking changes** - Public API remains identical
3. **Easy to roll back** - Each change is isolated
4. **Immediate benefit** - Better code clarity
5. **Zero performance risk** - Only adds readability

## Testing After Changes

1. Open `index.html` in browser
2. Test basic drawing (line, rectangle, circle)
3. Test constraint tools (coincident, parallel, dimension)
4. Test drag operations
5. If everything works, update export (optional)

## What to Avoid

- Don't change data structures (Map vs Array)
- Don't modify rendering logic
- Don't add complex caching systems
- Don't "optimize" without measuring first

## Done Checklist

After making any changes:

- [ ] Modular version still works
- [ ] All tools functional
- [ ] No console errors
- [ ] Export updated if needed (follow EXPORT_HANDLING_GUIDE.md)
- [ ] Changes are minimal and focused

---

*Remember: Performance is fine. Focus on code clarity, not optimization.*
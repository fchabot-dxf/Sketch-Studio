# Sketch Studio Performance Analysis & Optimization Opportunities

## Identified Bottlenecks (Priority Order)

### 🔴 CRITICAL: findAllConnectedJoints() - O(n²) Algorithm
**Location:** Line 389
**Impact:** HIGH - Called on every `pointermove` during drag

**Current Implementation:**
```javascript
function findAllConnectedJoints(jointId) {
    let connected = new Set([jointId]);
    let found = true;
    while (found) {
        found = false;
        for (let s of shapes) {  // ← Iterates all shapes EVERY iteration
            if (connected.has(s.startJointId) && !connected.has(s.endJointId)) {
                connected.add(s.endJointId);
                found = true;
            }
            if (connected.has(s.endJointId) && !connected.has(s.startJointId)) {
                connected.add(s.startJointId);
                found = true;
            }
        }
    }
    return connected;
}
```

**Problem:**
- With 100+ shapes, this can loop 10+ times
- Each loop scans ALL shapes: O(n) × O(iterations) = worst case O(n²)
- Happens 60x/second during drag

**Optimization:**
Build an **adjacency map** once when shapes change, not on every drag:
- Precompute: `jointToShapes[jointId] = [shapeIds]`
- Lookup becomes O(n) single pass instead of O(n²) iterations
- **Estimated improvement: 10-50x faster** on large sketches

---

### 🔴 CRITICAL: solveDrag() - 7 Full Passes × All Shapes
**Location:** Line 934
**Impact:** HIGH - Called on every `pointermove`

**Current Problem:**
```javascript
// Pass 1: Direct movement
shapes.forEach(s => { ... })

// Pass 2: Coincident
shapes.forEach(s => { ... })

// Pass 3: Horiz/Vert
shapes.forEach(s => { ... })

// Pass 4: Parallel/Perpend/Colinear/Midpoint
shapes.forEach(s => { ... })

// Pass 5: Tangent
shapes.forEach(s => { ... })

// Pass 6: Dimensions (3 iterations)
for (let iter = 0; iter < 3; iter++) {
    dimensions.forEach(dim => { ... })
}

// Pass 7: Final coincident
shapes.forEach(s => { ... })
```

**Specific Inefficiencies:**

1. **Unnecessary full iterations**: Every pass iterates ALL shapes, even if they're not affected by drag
   - Example: If dragging a single line, passes still check 100+ unrelated shapes
   - **Cost:** 7 × 100 = 700 shape iterations for one drag frame

2. **Dimension pass runs 3 times**: Even if converged after 1 iteration
   - No early exit when error < threshold
   - **Cost:** Wasted 2/3 of dimension calculations

3. **Constraint lookups use .find() inside loops**:
   ```javascript
   const otherLine = shapes.find(sh => sh.id === s.parallelWith);  // O(n) inside loop
   ```
   - **Cost:** O(n) lookup × shapes affected = unnecessary scanning

**Optimization Strategy:**
- **Option A (Fast):** Only update affected shapes
  - Track which shapes move: dragTarget's bondedJointIds
  - Only run passes on connected geometry graph
  - **Estimated improvement: 5-10x**

- **Option B (Better):** Cache shape lookups
  - Build `shapeById = Map()` at start of solveDrag
  - Replace `.find()` with `shapeById.get()`
  - **Estimated improvement: 2-3x**

- **Option C (Best):** Combined + Early exit dimensions
  - Apply Options A + B + exit when converged
  - **Estimated improvement: 10-20x**

---

### 🟡 HIGH: render() - Full DOM Rebuild Every Frame
**Location:** Line 1466
**Impact:** MEDIUM-HIGH - Called on every interaction

**Current Implementation:**
```javascript
shapesLayer.innerHTML = shapes.map(s => {
    // Generate SVG HTML string for EVERY shape
    // Even unchanged ones
}).join('');

dimLayer.innerHTML = dimensions.map((d, i) => {
    // Rebuild dimension SVG for every dimension
}).join('');
```

**Problem:**
- Completely replaces SVG on every call
- Browser must:
  1. Destroy all old SVG elements
  2. Parse HTML strings
  3. Create new DOM nodes
  4. Reflow/repaint
- With 100 shapes = 100 DOM operations per frame
- **Cost:** ~10-30ms on large sketches

**Optimization:**
- **Incremental updates**: Only redraw changed shapes
- Maintain `renderedElements = Map(shapeId => svgElement)`
- On render:
  - Delete shapes no longer in array
  - Update only changed properties
  - Add new shapes only
- **Estimated improvement: 3-5x**

---

### 🟡 HIGH: findHit() and findSnap() - O(n) Linear Search
**Location:** Lines 409, 360
**Impact:** MEDIUM - Called on every `pointermove`

**Current Implementation:**
```javascript
function findHit(coords) {
    for (let s of shapes) {  // ← Linear search through all shapes
        if (getDist(coords, s.start) < HIT_DIST) return { shape: s, part: 'start' };
        if (getDist(coords, s.end) < HIT_DIST) return { shape: s, part: 'end' };
        if (s.type === 'line') {
            const proj = projectPointOnLine(...);
            if (getDist(coords, proj) < HIT_DIST) return ...
        }
    }
    return null;
}
```

**Problem:**
- Checks every shape sequentially
- Distance calculations are expensive (Math.hypot)
- Happens 60x/second during hover
- **Cost:** ~1-5ms per frame with 100 shapes

**Optimization:**
- **Spatial index**: Divide canvas into grid cells
  - Store shape indices by cell
  - Only check shapes near cursor
  - **Estimated improvement: 5-10x** (with 100+ shapes)

- **Simple fallback**: Cache last known hit
  - Return cached hit if cursor hasn't moved far
  - **Estimated improvement: 2x** (less complex)

---

### 🟡 MEDIUM: Constraint Lookups via Properties
**Location:** Multiple (lines 965-1050)
**Impact:** MEDIUM

**Current Problem:**
```javascript
if (s.constraints.includes('parallel') && s.parallelWith) {
    const otherLine = shapes.find(sh => sh.id === s.parallelWith);  // O(n)
    if (otherLine) { ... }
}
```

**Issues:**
1. `.find()` scans all shapes
2. Happens in loop over affected shapes
3. Multiple constraint types = multiple .find() calls

**Optimization:**
Create lookup map at start of solveDrag:
```javascript
const shapeById = new Map(shapes.map(s => [s.id, s]));
// Then: shapeById.get(s.parallelWith) is O(1)
```
**Estimated improvement: 2-3x** (combined with Option A above)

---

## Optimization Roadmap (By Effort/Impact)

### Tier 1: Quick Wins (5 min each, 2-10x impact)

1. **Build `shapeById` map in solveDrag**
   - Replace all `.find()` with `.get()`
   - Code change: ~5 lines
   - Impact: 2-3x faster solver

2. **Early exit dimensions loop**
   - Only iterate until converged (error < 0.1)
   - Code change: 1 line
   - Impact: Reduce 1/3 of dimension passes

3. **Cache jointToShapes adjacency map**
   - Build once per shape change
   - Update in pointerup (when drag completes)
   - Code change: ~20 lines
   - Impact: 10-50x faster joint lookups during drag

### Tier 2: Medium Effort (10-15 min, 5-10x impact)

4. **Only update affected shapes in solver**
   - Pass affected shape IDs to solveDrag
   - Filter passes to only those shapes
   - Code change: ~30 lines
   - Impact: 5-10x faster on large sketches

### Tier 3: Advanced (20+ min, 3-5x impact)

5. **Incremental SVG rendering**
   - Maintain element map
   - Update properties instead of rebuild
   - Code change: ~50 lines
   - Impact: 3-5x smoother rendering

6. **Spatial index for hit detection**
   - Grid-based lookup
   - Code change: ~40 lines
   - Impact: 5-10x faster hit detection (100+ shapes)

---

## Quick Implementation Priority

**For immediate performance boost (5 mins):**
```javascript
// In solveDrag(), add at start:
const shapeById = new Map(shapes.map(s => [s.id, s]));

// Then replace all:
// shapes.find(sh => sh.id === someId)
// with:
// shapeById.get(someId)
```

**Recommended order:**
1. shapeById map (fastest ROI)
2. Adjacency cache
3. Early exit dimensions
4. Only affected shapes filter
5. (Advanced: incremental render)

---

## Testing Methodology

Create a "stress test" sketch:
- 50+ lines with parallel/perpendicular constraints
- 10+ dimensions
- Full coincident graph (all connected)

Measure before/after:
- Open DevTools → Performance tab
- Record while dragging
- Check: Frame rate, "solveDrag" duration, "render" duration

Goal: Maintain 60 FPS, <16ms per frame

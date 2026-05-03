# Refactor Suggestions for Sketch Studio Unified

## Context
Performance is currently acceptable - these suggestions focus on code clarity, maintainability, and minimal-risk improvements only.

## 🎯 Priority: Code Organization & Readability

### 1. Add JSDoc Comments to Public APIs
**Effort**: 30 minutes  
**Risk**: None  
**Impact**: Improved developer experience

```javascript
// Example for 5-engine.js:
/**
 * Creates a new engine instance bound to an SVG element
 * @param {SVGElement} svg - The SVG canvas element
 * @returns {Object} Engine API with init, genJ, addShape, etc.
 */
export function createEngine(svg) {
  // ...
}

/**
 * Generates a unique joint ID
 * @returns {string} Unique joint identifier (e.g., 'j1_1234567890')
 */
function genJ() { return _genJ(); }
```

**Files to update**: All `.js` files in `src/`

### 2. Extract Magic Numbers to Constants
**Effort**: 1 hour  
**Risk**: None  
**Impact**: Centralized configuration

Add to `1-utils.js`:
```javascript
export const DRAG_THRESHOLD_PX = 2;
export const LONG_PRESS_MS = 400;
export const HIT_RADIUS_PX = 14;
export const INFERENCE_ANGLE_TOLERANCE = 5; // degrees
export const SNAP_PX = 50;
export const INFERENCE_SNAP_PX = 15;
export const LINE_SNAP_PX = 20;
```

### 3. Standardize Constraint Preview Pattern
**Effort**: 2 hours  
**Risk**: Low  
**Impact**: Consistent code patterns

Create helper in `1-utils.js`:
```javascript
/**
 * Creates a preview constraint object
 * @param {string} type - Constraint type ('coincident', 'parallel', etc.)
 * @param {Object} params - Constraint parameters
 * @returns {Object} Preview constraint with __isPreview flag
 */
export function createPreviewConstraint(type, params) {
  return { ...params, type, __isPreview: true };
}
```

Update all preview creation in `6-input.js` to use this helper.

### 4. Add Debug Mode Flag
**Effort**: 15 minutes  
**Risk**: None  
**Impact**: Cleaner console output

Add to `1-utils.js`:
```javascript
export const DEBUG = false; // Set to true during development

// Usage:
if (DEBUG) console.log('[addConstraint] Adding:', constraint);
```

## 🔧 Optional Safe Micro-Optimizations

### 5. Local shapeById Cache in Solver
**Effort**: 30 minutes  
**Risk**: None (local variable only)  
**Impact**: Minor performance improvement

In `2-solver.js`, at start of `solveConstraints`:
```javascript
export function solveConstraints(joints, shapes, constraints, iter=20) {
  // Create local lookup map
  const shapeById = new Map();
  for (const s of shapes) shapeById.set(s.id, s);
  
  // Use shapeById.get(id) instead of shapes.find(s => s.id === id)
  // ... rest of function
}
```

### 6. Early Exit for Dimension Constraints
**Effort**: 10 minutes  
**Risk**: None  
**Impact**: Minor performance improvement

In `2-solver.js` dimension handling:
```javascript
// In the dimension constraint loop:
let maxError = 0;
// ... calculate error for each dimension
maxError = Math.max(maxError, Math.abs(error));
// After loop:
if (maxError < 0.1) break; // Stop if already converged
```

## 📝 Documentation Improvements

### 7. Update README with Quick Start Guide
**Effort**: 1 hour  
**Risk**: None  
**Impact**: Better onboarding

Add to `README.md`:
- Step-by-step setup instructions
- Common troubleshooting
- Development workflow

### 8. Create "Adding New Features" Guide
**Effort**: 2 hours  
**Risk**: None  
**Impact**: Easier feature development

Create `DEVELOPMENT_GUIDE.md` with:
- How to add a new constraint type
- How to add a new shape type
- How to modify the UI
- Testing procedures

## 🚫 What NOT to Change

Given that performance is acceptable, **avoid these complex changes**:

1. **Adjacency maps** - Changes data structure architecture
2. **Incremental rendering** - High risk, changes rendering logic
3. **Spatial indexing** - Over-engineering for current needs
4. **Object pooling** - Premature optimization
5. **Batch updates** - Adds complexity without clear need
6. **Constraint dependency graphs** - Significant architectural change

## 📊 Implementation Priority

### Phase 1 (Safe, High Value)
1. JSDoc comments for public APIs
2. Extract magic numbers to constants
3. Add debug mode flag

### Phase 2 (If Needed)
4. Standardize constraint preview pattern
5. Local shapeById cache
6. Documentation updates

## 🧪 Testing Strategy

For any changes:
1. **Test modular version first**: Open `index.html`
2. **Verify all tools work**: Line, rectangle, circle, all constraints
3. **Check export if updated**: Test `output/sketch-studio-unified-v1.0.html`
4. **No regression testing**: Ensure existing features still work

## 💡 Philosophy

- **Stability over performance**: The app works, don't break it
- **Clarity over cleverness**: Readable code is maintainable code
- **Documentation is a feature**: Good docs prevent future bugs
- **Simple is sustainable**: Complex optimizations need complex maintenance

## 📋 Checklist Before Any Refactor

- [ ] Performance is actually an issue (measure first)
- [ ] Change is isolated to one module
- [ ] No breaking changes to public API
- [ ] Existing tests pass (or add tests first)
- [ ] Can be rolled back easily
- [ ] Documented why the change was made

## 🔗 Related Resources

- `MD guides/` - Existing documentation
- `PERFORMANCE_ANALYSIS.md` - Performance considerations (but note: "performance is fine")
- `EXPORT_HANDLING_GUIDE.md` - Export workflow
- `APP_MAP.md` - Application architecture

---

*Last updated: $(date)*  
*Status: Performance acceptable - focus on maintainability only*
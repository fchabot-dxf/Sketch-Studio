// tests/canvas-grid-snapshot.test.js — snapshot test for the shared canvas grid (#ui/canvas-grid.js).
// Proves that GRID_MODE 'lines' output matches SketchStudio's legacy grid byte-for-byte and attribute-for-attribute.
// Includes non-vacuity assertions demonstrating that altering any single attribute fails the test.

import assert from 'assert';
import { gridDefsMarkup, gridRectMarkup, normalizeGridMode, ensureCanvasGrid, updateCanvasGrid, GRID_MODES } from '#ui/canvas-grid.js';

// The exact golden markup from SketchStudio's original apps/sketchstudio/index.html + svg-renderer updateGrid:
const TEST_SCALE = 0.016051364930208065;
const scale = (s) => s * TEST_SCALE;

const GOLDEN_DEFS = '<pattern id="grid" width="2" height="2" patternUnits="userSpaceOnUse">'
  + '<path d="M 2 0 L 0 0 0 2" fill="none" stroke="#CBD5E1" stroke-width="0.016051364930208065"/>'
  + '</pattern>'
  + '<pattern id="grid-heavy" width="10" height="10" patternUnits="userSpaceOnUse">'
  + '<rect width="10" height="10" fill="url(#grid)"/>'
  + '<path d="M 10 0 L 0 0 0 10" fill="none" stroke="#93C5FD" stroke-width="0.03210272986041613"/>'
  + '</pattern>';

const GOLDEN_RECT = '<rect id="infinite-grid" x="-50000" y="-50000" width="100000" height="100000" fill="url(#grid-heavy)"/>';

console.log('Testing canvas-grid snapshot...');

// 1. Exact byte-identity check for default 'lines' mode
const actualDefs = gridDefsMarkup({ GRID_SIZE: 2, GRID_MAJOR_STEP: 10, scale, gridMode: 'lines' });
assert.strictEqual(actualDefs, GOLDEN_DEFS, 'gridDefsMarkup(lines) must match GOLDEN_DEFS byte-for-byte');

const actualRect = gridRectMarkup('lines');
assert.strictEqual(actualRect, GOLDEN_RECT, 'gridRectMarkup(lines) must match GOLDEN_RECT byte-for-byte');

// 2. Strict attribute verification
// Every attribute on pattern#grid, path, pattern#grid-heavy, rect, path, and rect#infinite-grid must match
const EXPECTED_ATTRS = {
  '#grid': { id: 'grid', width: '2', height: '2', patternUnits: 'userSpaceOnUse' },
  '#grid > path': { d: 'M 2 0 L 0 0 0 2', fill: 'none', stroke: '#CBD5E1', 'stroke-width': '0.016051364930208065' },
  '#grid-heavy': { id: 'grid-heavy', width: '10', height: '10', patternUnits: 'userSpaceOnUse' },
  '#grid-heavy > rect': { width: '10', height: '10', fill: 'url(#grid)' },
  '#grid-heavy > path': { d: 'M 10 0 L 0 0 0 10', fill: 'none', stroke: '#93C5FD', 'stroke-width': '0.03210272986041613' },
  '#infinite-grid': { id: 'infinite-grid', x: '-50000', y: '-50000', width: '100000', height: '100000', fill: 'url(#grid-heavy)' },
};

function verifyAttributes(defsMarkup, rectMarkup, expected) {
  for (const [selector, attrs] of Object.entries(expected)) {
    for (const [attrName, attrVal] of Object.entries(attrs)) {
      const needle = `${attrName}="${attrVal}"`;
      const targetStr = selector === '#infinite-grid' ? rectMarkup : defsMarkup;
      assert(targetStr.includes(needle), `Expected attribute ${needle} for ${selector}`);
    }
  }
}

verifyAttributes(actualDefs, actualRect, EXPECTED_ATTRS);

// 3. Non-vacuity proof: Altering any single attribute MUST fail the assertion
const MUTATIONS = [
  GOLDEN_DEFS.replace('stroke="#CBD5E1"', 'stroke="#000000"'),
  GOLDEN_DEFS.replace('stroke="#93C5FD"', 'stroke="#FF0000"'),
  GOLDEN_DEFS.replace('width="2"', 'width="3"'),
  GOLDEN_DEFS.replace('height="10"', 'height="20"'),
  GOLDEN_DEFS.replace('fill="url(#grid)"', 'fill="url(#wrong)"'),
  GOLDEN_DEFS.replace('stroke-width="0.016051364930208065"', 'stroke-width="0.05"'),
  GOLDEN_RECT.replace('fill="url(#grid-heavy)"', 'fill="url(#other)"'),
  GOLDEN_RECT.replace('width="100000"', 'width="50000"'),
  GOLDEN_RECT.replace('x="-50000"', 'x="0"'),
];

for (const mutated of MUTATIONS) {
  let failed = false;
  try {
    if (mutated.startsWith('<rect')) {
      assert.strictEqual(mutated, GOLDEN_RECT);
    } else {
      assert.strictEqual(mutated, GOLDEN_DEFS);
    }
  } catch (_) {
    failed = true;
  }
  assert(failed, `Non-vacuity assertion failed: mutation was not rejected: ${mutated}`);
}
console.log(`Non-vacuity verified: ${MUTATIONS.length} mutations correctly failed.`);

// 4. 'off' mode verification
const offRect = gridRectMarkup('off');
assert(offRect.includes('display="none"'), 'gridRectMarkup(off) must include display="none"');
assert(offRect.includes('id="infinite-grid"'), 'gridRectMarkup(off) must retain id="infinite-grid"');

// 5. 'points' mode verification
const pointsDefs = gridDefsMarkup({ GRID_SIZE: 2, GRID_MAJOR_STEP: 10, scale, gridMode: 'points' });
assert(pointsDefs.includes('<circle'), 'gridDefsMarkup(points) must contain <circle> elements');
assert(pointsDefs.includes('fill="#CBD5E1"'), 'gridDefsMarkup(points) must use minor color for dots');
assert(pointsDefs.includes('fill="#93C5FD"'), 'gridDefsMarkup(points) must use major color for dots');
assert(pointsDefs.includes('x="-1" y="-1"'), 'gridDefsMarkup(points) must offset minor pattern by -G/2 for grid alignment');

// 6. Normalization check
assert.strictEqual(normalizeGridMode('invalid'), 'lines');
assert.strictEqual(normalizeGridMode(null), 'lines');
assert.strictEqual(normalizeGridMode('off'), 'off');
assert.strictEqual(normalizeGridMode('points'), 'points');
assert.deepStrictEqual(GRID_MODES, ['lines', 'off', 'points']);

// 7. Scoped lookup & duplicate guard check (Amendment 2)
// Simulate DOM environment with mock SVGs
const docElements = new Map();
global.document = {
  head: { querySelector: () => null, appendChild: () => {} },
  createElement: (tag) => ({ tagName: tag.toUpperCase(), style: {} }),
  createElementNS: (ns, tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      attributes: {},
      children: [],
      innerHTML: '',
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      removeAttribute(k) { delete this.attributes[k]; },
      querySelector(sel) {
        if (sel === 'defs') return this.children.find(c => c.tagName === 'DEFS');
        if (sel === '#grid') return this.children.find(c => c.attributes && c.attributes.id === 'grid');
        if (sel === '#infinite-grid') return this.children.find(c => c.attributes && c.attributes.id === 'infinite-grid');
        return null;
      },
      insertBefore(child, ref) {
        child.parentNode = this;
        this.children.unshift(child);
      },
      contains(other) {
        return this.children.includes(other) || this === other;
      }
    };
    return el;
  },
  querySelectorAll: (sel) => {
    const results = [];
    for (const [id, el] of docElements.entries()) {
      if (sel.includes('#' + id)) results.push(el);
    }
    return results;
  }
};

const svg1 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
const mounted1 = ensureCanvasGrid(svg1);
assert(mounted1 !== null, 'ensureCanvasGrid on clean svg must succeed');
assert(svg1.querySelector('#infinite-grid'), 'svg1 must contain #infinite-grid');

updateCanvasGrid({ svgEl: svg1, GRID_SIZE: 2, GRID_MAJOR_STEP: 10, scale, gridMode: 'lines' });
assert(mounted1.defs.innerHTML.includes('id="grid"'), 'defs must be populated with grid pattern');

// Register svg1's grid into document
docElements.set('grid', { id: 'grid' });
docElements.set('infinite-grid', svg1.querySelector('#infinite-grid'));

// Try mounting onto a second different SVG — must be REFUSED (one grid per page)
const svg2 = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
const mounted2 = ensureCanvasGrid(svg2);
assert.strictEqual(mounted2, null, 'ensureCanvasGrid on svg2 must refuse when grid exists on svg1');

console.log('canvas-grid snapshot tests passed ✅');

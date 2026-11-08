// tests/design-info-panel-units.test.js — TASK 439
// Tests that the sketch tree shows dimension values in document units exactly as the canvas label does,
// using the shared formatter formatConstraintValue from #ui/svg-renderer.js.
// Covers every valued type: distance (aligned), H distance, V distance, radius, diameter, angle.
// Angles are never unit-converted. Tested in both DOC_UNIT = 'in' and 'mm'.

import SettingsManager from '#core/settings-manager.js';
import { CONSTRAINT_TYPES } from '#core/constants.js';
import { formatConstraintValue, formatLenLabel, draw } from '#ui/svg-renderer.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

// Setup minimal mock DOM environment for Node testing
function setupDOM() {
  const elements = new Map();
  class MockNode {
    constructor(tagName = 'div') {
      this.tagName = tagName.toUpperCase();
      this.id = '';
      this._className = '';
      this.classList = {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        contains(c) { return this._classes.has(c); },
        toggle(c, force) {
          if (force === true) this._classes.add(c);
          else if (force === false) this._classes.delete(c);
          else if (this._classes.has(c)) this._classes.delete(c);
          else this._classes.add(c);
        }
      };
      this.style = {};
      this.children = [];
      this.parentNode = null;
      this.attrs = new Map();
      this.listeners = new Map();
      this._innerHTML = '';
      this.textContent = '';
      this.title = '';
      this.type = '';
      this.value = '';
    }
    set className(val) {
      this._className = val;
      this.classList._classes.clear();
      String(val || '').split(/\s+/).filter(Boolean).forEach(c => this.classList.add(c));
    }
    get className() { return this._className || ''; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') { this.id = v; elements.set(v, this); } }
    getAttribute(k) { return this.attrs.get(k) || null; }
    appendChild(child) {
      if (child.parentNode && child.parentNode !== this) {
        const idx = child.parentNode.children.indexOf(child);
        if (idx !== -1) child.parentNode.children.splice(idx, 1);
      }
      child.parentNode = this;
      this.children.push(child);
      if (child.id) elements.set(child.id, child);
      return child;
    }
    append(...nodes) {
      for (const n of nodes) {
        if (typeof n === 'string') {
          const textNode = new MockNode('#text');
          textNode.textContent = n;
          this.appendChild(textNode);
        } else if (n && n.appendChild) {
          this.appendChild(n);
        }
      }
    }
    addEventListener(ev, cb) {
      if (!this.listeners.has(ev)) this.listeners.set(ev, []);
      this.listeners.get(ev).push(cb);
    }
    querySelector(sel) {
      for (const child of this.children) {
        if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) return child;
        if (sel.startsWith('#') && child.id === sel.slice(1)) return child;
        if (child.tagName.toLowerCase() === sel.toLowerCase()) return child;
        const sub = child.querySelector(sel);
        if (sub) return sub;
      }
      return null;
    }
    querySelectorAll(sel) {
      const results = [];
      for (const child of this.children) {
        if (sel.startsWith('.') && child.classList.contains(sel.slice(1))) results.push(child);
        else if (sel.startsWith('#') && child.id === sel.slice(1)) results.push(child);
        else if (child.tagName.toLowerCase() === sel.toLowerCase()) results.push(child);
        results.push(...child.querySelectorAll(sel));
      }
      return results;
    }
    set innerHTML(html) {
      this._innerHTML = html;
      this.children = [];
      // Parse child spans / tags
      const tagRegex = /<([a-z0-9]+)([^>]*)>([\s\S]*?)<\/\1>/gi;
      let match;
      while ((match = tagRegex.exec(html)) !== null) {
        const [, tagName, attrStr, content] = match;
        const child = new MockNode(tagName);
        const classMatch = attrStr.match(/class=["']([^"']+)["']/i);
        if (classMatch) {
          child.className = classMatch[1];
          classMatch[1].split(/\s+/).filter(Boolean).forEach(c => child.classList.add(c));
        }
        child.textContent = content.replace(/<[^>]*>/g, '');
        this.appendChild(child);
      }
      this.textContent = html.replace(/<[^>]*>/g, '');
    }
    get innerHTML() { return this._innerHTML; }
  }

  global.document = {
    head: new MockNode('head'),
    body: new MockNode('body'),
    createElement: (tag) => new MockNode(tag),
    getElementById: (id) => elements.get(id) || null,
  };
}

setupDOM();

(async () => {
  console.log('Testing TASK 439: Sketch tree dimension values in document units...');

  const initialUnit = SettingsManager.get('DOC_UNIT') || 'mm';

  try {
    // 1. Direct formatter tests for every valued type in inches and mm
    // Raw value = 76.2 mm (exactly 3.0 inches)
    const VAL_76_2 = 76.2;
    const ANGLE_45 = 45;

    const testCases = [
      { name: 'distance (aligned)', constraint: { type: CONSTRAINT_TYPES.DISTANCE, value: VAL_76_2 }, inExpected: '3.0', mmExpected: '76.2' },
      { name: 'H distance', constraint: { type: CONSTRAINT_TYPES.DISTANCE, dimMode: 'horizontal', value: VAL_76_2 }, inExpected: '3.0', mmExpected: '76.2' },
      { name: 'V distance', constraint: { type: CONSTRAINT_TYPES.DISTANCE, dimMode: 'vertical', value: VAL_76_2 }, inExpected: '3.0', mmExpected: '76.2' },
      { name: 'radius (isRadius: true)', constraint: { type: CONSTRAINT_TYPES.DISTANCE, isRadius: true, value: VAL_76_2 }, inExpected: 'R 3.0', mmExpected: 'R 76.2' },
      { name: 'radius (type: radius)', constraint: { type: 'radius', value: VAL_76_2 }, inExpected: 'R 3.0', mmExpected: 'R 76.2' },
      { name: 'diameter (isDiameter: true)', constraint: { type: CONSTRAINT_TYPES.DISTANCE, isDiameter: true, value: VAL_76_2 }, inExpected: 'Ø 3.0', mmExpected: 'Ø 76.2' },
      { name: 'diameter (dimMode: diameter)', constraint: { type: CONSTRAINT_TYPES.DISTANCE, dimMode: 'diameter', value: VAL_76_2 }, inExpected: 'Ø 3.0', mmExpected: 'Ø 76.2' },
      { name: 'diameter (type: diameter)', constraint: { type: 'diameter', value: VAL_76_2 }, inExpected: 'Ø 3.0', mmExpected: 'Ø 76.2' },
      { name: 'angle (never unit-converted)', constraint: { type: CONSTRAINT_TYPES.ANGLE, value: ANGLE_45 }, inExpected: '45.0°', mmExpected: '45.0°' },
    ];

    // Test DOC_UNIT = 'in'
    SettingsManager.set('DOC_UNIT', 'in');
    for (const tc of testCases) {
      const formatted = formatConstraintValue(tc.constraint);
      assert(formatted === tc.inExpected, `[DOC_UNIT=in] ${tc.name}: expected "${tc.inExpected}", got "${formatted}"`);
    }
    console.log('✓ All valued types formatted correctly in inches (DOC_UNIT=in)');

    // Test DOC_UNIT = 'mm'
    SettingsManager.set('DOC_UNIT', 'mm');
    for (const tc of testCases) {
      const formatted = formatConstraintValue(tc.constraint);
      assert(formatted === tc.mmExpected, `[DOC_UNIT=mm] ${tc.name}: expected "${tc.mmExpected}", got "${formatted}"`);
    }
    console.log('✓ All valued types formatted correctly in mm (DOC_UNIT=mm)');

    // 2. Driven / reference dimensions (parenthesized)
    SettingsManager.set('DOC_UNIT', 'in');
    assert(formatConstraintValue({ type: CONSTRAINT_TYPES.DISTANCE, value: VAL_76_2, isDriven: true }) === '(3.0)', 'driven distance in inches');
    assert(formatConstraintValue({ type: CONSTRAINT_TYPES.DISTANCE, isRadius: true, value: VAL_76_2, isDriven: true }) === 'R (3.0)', 'driven radius in inches');
    assert(formatConstraintValue({ type: CONSTRAINT_TYPES.ANGLE, value: ANGLE_45, isDriven: true }) === '(45.0°)', 'driven angle in inches');

    SettingsManager.set('DOC_UNIT', 'mm');
    assert(formatConstraintValue({ type: CONSTRAINT_TYPES.DISTANCE, value: VAL_76_2, isDriven: true }) === '(76.2)', 'driven distance in mm');
    assert(formatConstraintValue({ type: CONSTRAINT_TYPES.DISTANCE, isRadius: true, value: VAL_76_2, isDriven: true }) === 'R (76.2)', 'driven radius in mm');
    assert(formatConstraintValue({ type: CONSTRAINT_TYPES.ANGLE, value: ANGLE_45, isDriven: true }) === '(45.0°)', 'driven angle in mm');
    console.log('✓ Driven / reference dimensions format with parentheses in both units');

    // 3. Tree text vs Canvas Label Text Parity
    // For each unit ('in' and 'mm'), create a sketch with constraints and render BOTH the canvas and the design-info-panel tree.
    // Assert tree text equals canvas label text.
    for (const unit of ['in', 'mm']) {
      SettingsManager.set('DOC_UNIT', unit);

      // Geometry for canvas rendering
      const joints = new Map();
      joints.set('j1', { x: 0, y: 0 });
      joints.set('j2', { x: VAL_76_2, y: 0 });
      joints.set('j3', { x: 0, y: VAL_76_2 });
      joints.set('j4', { x: VAL_76_2, y: VAL_76_2 });

      // Arc/circle joints for radius
      joints.set('jc', { x: 100, y: 100 });
      joints.set('jr', { x: 100 + VAL_76_2, y: 100 });

      // Angle joints (two intersecting lines)
      joints.set('ja1', { x: 200, y: 200 });
      joints.set('ja2', { x: 250, y: 200 });
      joints.set('ja3', { x: 200, y: 200 });
      joints.set('ja4', { x: 200 + 50 * Math.cos(Math.PI / 4), y: 200 + 50 * Math.sin(Math.PI / 4) });

      const shapes = [
        { id: 's_line_aligned', type: 'line', joints: ['j1', 'j2'] },
        { id: 's_line_h', type: 'line', joints: ['j1', 'j2'] },
        { id: 's_line_v', type: 'line', joints: ['j1', 'j3'] },
        { id: 's_circle', type: 'circle', joints: ['jc'], radius: VAL_76_2 },
        { id: 's_ang1', type: 'line', joints: ['ja1', 'ja2'] },
        { id: 's_ang2', type: 'line', joints: ['ja3', 'ja4'] },
      ];

      const cAligned = { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j1', 'j2'], shape: 's_line_aligned', value: VAL_76_2 };
      const cH = { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j1', 'j2'], shape: 's_line_h', dimMode: 'horizontal', value: VAL_76_2 };
      const cV = { type: CONSTRAINT_TYPES.DISTANCE, joints: ['j1', 'j3'], shape: 's_line_v', dimMode: 'vertical', value: VAL_76_2 };
      const cRadius = { type: CONSTRAINT_TYPES.DISTANCE, shape: 's_circle', isRadius: true, value: VAL_76_2 };
      const cAngle = { type: CONSTRAINT_TYPES.ANGLE, shapes: ['s_ang1', 's_ang2'], value: ANGLE_45, offset: 40 };

      const allConstraints = [cAligned, cH, cV, cRadius, cAngle];

      // A. Render via shared canvas renderer (svg-renderer.js draw)
      const mockSvg = {
        viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } },
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
        innerHTML: ''
      };
      draw(joints, shapes, mockSvg, null, null, allConstraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, false, null);

      // Extract all canvas label texts (<text ...>...</text> inside .dim-label)
      const canvasHtml = mockSvg.innerHTML;
      const canvasLabelMatches = [...canvasHtml.matchAll(/<g class="dim-label"[^>]*>[\s\S]*?<text[^>]*>([\s\S]*?)<\/text>/gi)].map(m => m[1].trim());

      assert(canvasLabelMatches.length >= 5, `Canvas should render at least 5 dim labels in ${unit}, got ${canvasLabelMatches.length}`);

      // B. Render via Design Info Panel (both flat list and sketch tree)
      const state = {
        joints,
        shapes,
        constraints: allConstraints,
        selectedConstraints: new Set(),
      };

      // B1. Flat panel mode (showSketchTree: false) — renders all constraints
      const panelFlat = createDesignInfoPanel({ state, showSketchTree: false });
      const containerFlat = document.createElement('div');
      panelFlat.render(containerFlat);

      const rowsFlat = containerFlat.querySelectorAll('.sk-info-row');
      assert(rowsFlat.length === allConstraints.length, `Flat panel should have ${allConstraints.length} rows, got ${rowsFlat.length}`);

      for (let i = 0; i < allConstraints.length; i++) {
        const c = allConstraints[i];
        const row = rowsFlat[i];
        const valSpan = row.querySelector('.sk-info-val');
        assert(valSpan, `Row ${i} must have .sk-info-val`);
        const treeValText = valSpan.textContent.trim();
        const canvasText = canvasLabelMatches[i];

        assert(treeValText === canvasText,
          `[DOC_UNIT=${unit}] Type "${c.type}" (dimMode=${c.dimMode}, isRadius=${c.isRadius}): tree text "${treeValText}" must equal canvas label text "${canvasText}"`);

        const expected = formatConstraintValue(c);
        assert(treeValText === expected, `Tree text "${treeValText}" must match formatConstraintValue "${expected}"`);
      }

      // B2. Tree panel mode (showSketchTree: true) — checks tree rows for joint-based constraints
      const panelTree = createDesignInfoPanel({ state, showSketchTree: true });
      const containerTree = document.createElement('div');
      panelTree.render(containerTree);

      const rowsTree = containerTree.querySelectorAll('.sk-info-row');
      // Joint-based constraints (cAligned, cH, cV) resolve via constraintSketch to Sketch 1
      assert(rowsTree.length >= 3, `Tree should have at least 3 joint-based rows, got ${rowsTree.length}`);
      for (let i = 0; i < rowsTree.length; i++) {
        const row = rowsTree[i];
        const valSpan = row.querySelector('.sk-info-val');
        assert(valSpan, `Tree row ${i} must have .sk-info-val`);
        const treeValText = valSpan.textContent.trim();
        const canvasText = canvasLabelMatches[i];
        assert(treeValText === canvasText, `Tree row ${i}: "${treeValText}" must equal canvas "${canvasText}"`);
      }
      console.log(`✓ [DOC_UNIT=${unit}] Tree text equals canvas label text for all types!`);
    }

    // 4. Non-valued constraints (coincident, horizontal, vertical, tangent, parallel)
    const cCoincident = { type: CONSTRAINT_TYPES.COINCIDENT, joints: ['j1', 'j2'] };
    assert(formatConstraintValue(cCoincident) === '', 'non-valued constraint returns empty string');

    const stateNonValued = {
      joints: new Map([['j1', { x: 0, y: 0 }], ['j2', { x: 0, y: 0 }]]),
      shapes: [],
      constraints: [cCoincident],
      selectedConstraints: new Set(),
    };
    const panelNonValued = createDesignInfoPanel({ state: stateNonValued, showSketchTree: true });
    const contNonValued = document.createElement('div');
    panelNonValued.render(contNonValued);
    const rowNonValued = contNonValued.querySelector('.sk-info-row');
    const valSpanNonValued = rowNonValued.querySelector('.sk-info-val');
    assert(valSpanNonValued === null, 'non-valued constraint row has no .sk-info-val');
    console.log('✓ Non-valued constraints produce no value span in the tree');

    console.log('All TASK 439 unit tests passed ✅');
  } finally {
    SettingsManager.set('DOC_UNIT', initialUnit);
  }
})().catch(e => {
  console.error('TASK 439 tests failed ❌', e);
  process.exit(1);
});

// tests/shaper-prepare-pan-zoom.test.js — unit tests for Shaper Prepare & Vcarve pan/zoom (TASK 436)

import assert from 'node:assert';

// Minimal DOM mock for Node environment
function setupMockDom() {
  const elements = new Map();

  function makeElement(tag, ns = null) {
    const attrs = new Map();
    const listeners = new Map();
    const children = [];
    let styleObj = {};

    const el = {
      tagName: tag.toUpperCase(),
      namespaceURI: ns,
      style: styleObj,
      innerHTML: '',
      children,
      dataset: {},
      viewBox: {
        baseVal: {
          x: -60, y: -45, width: 120, height: 90,
        }
      },
      getAttribute(k) { return attrs.get(k) || null; },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'viewBox') {
          const parts = String(v).trim().split(/[\s,]+/).map(Number);
          if (parts.length === 4 && parts.every(Number.isFinite)) {
            el.viewBox.baseVal = { x: parts[0], y: parts[1], width: parts[2], height: parts[3] };
          }
        }
      },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      appendChild(c) { children.push(c); c.parentNode = el; return c; },
      insertBefore(newNode, refNode) {
        const idx = children.indexOf(refNode);
        if (idx === -1) children.push(newNode);
        else children.splice(idx, 0, newNode);
        newNode.parentNode = el;
        return newNode;
      },
      removeChild(c) {
        const idx = children.indexOf(c);
        if (idx !== -1) children.splice(idx, 1);
        c.parentNode = null;
        return c;
      },
      querySelector(sel) {
        if (sel.startsWith('#')) {
          const id = sel.slice(1);
          if (attrs.get('id') === id) return el;
          for (const c of children) {
            if (c.querySelector) {
              const hit = c.querySelector(sel);
              if (hit) return hit;
            }
          }
        }
        return null;
      },
      querySelectorAll(sel) {
        const results = [];
        if (sel.startsWith('#')) {
          const id = sel.slice(1);
          if (attrs.get('id') === id) results.push(el);
        }
        for (const c of children) {
          if (c.querySelectorAll) results.push(...c.querySelectorAll(sel));
        }
        return results;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      removeEventListener(type, fn) {
        if (listeners.has(type)) {
          const arr = listeners.get(type).filter((f) => f !== fn);
          listeners.set(type, arr);
        }
      },
      dispatchEvent(event) {
        const arr = listeners.get(event.type) || [];
        for (const fn of arr) fn(event);
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
      },
      setPointerCapture() {},
      releasePointerCapture() {},
      createSVGPoint() {
        return {
          x: 0,
          y: 0,
          matrixTransform(matrix) {
            return {
              x: matrix.a * this.x + matrix.c * this.y + matrix.e,
              y: matrix.b * this.x + matrix.d * this.y + matrix.f,
            };
          }
        };
      },
      getScreenCTM() {
        const vb = el.viewBox.baseVal;
        const rect = el.getBoundingClientRect();
        const sx = rect.width / vb.width;
        const sy = rect.height / vb.height;
        const s = Math.min(sx, sy);
        const tx = rect.left - vb.x * s;
        const ty = rect.top - vb.y * s;
        return {
          a: s, b: 0, c: 0, d: s, e: tx, f: ty,
          inverse() {
            return {
              a: 1 / s, b: 0, c: 0, d: 1 / s,
              e: -tx / s, f: -ty / s,
            };
          }
        };
      }
    };
    return el;
  }

  global.window = global;
  global.document = {
    createElement(tag) { return makeElement(tag); },
    createElementNS(ns, tag) { return makeElement(tag, ns); },
    getElementById(id) {
      return elements.get(id) || null;
    },
    registerElement(id, el) {
      el.setAttribute('id', id);
      elements.set(id, el);
    },
    dispatchEvent(event) {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  global.CustomEvent = class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  };

  return { makeElement, register: (id, el) => global.document.registerElement(id, el) };
}

(async () => {
  const dom = setupMockDom();

  const { mountPrepareView } = await import('../apps/shaper/src/prepare-view.js');
  const { mountVcarveView } = await import('../apps/shaper/src/vcarve-view.js');
  const { computeGeometryBounds } = await import('#core/geometry-bounds.js');
  const { fitViewToExtents } = await import('#ui/input-handlers/pan-zoom.js');

  console.log('Testing TASK 436: Shaper Prepare & Vcarve pan/zoom...');

  // Setup sample sketch state: 40x20 rectangle at (10, 10) -> (50, 30)
  const joints = new Map([
    ['j1', { x: 10, y: 10 }],
    ['j2', { x: 50, y: 10 }],
    ['j3', { x: 50, y: 30 }],
    ['j4', { x: 10, y: 30 }],
    ['j_origin', { x: 0, y: 0, fixed: true }],
  ]);
  const shapes = [
    { id: 'l1', type: 'line', joints: ['j1', 'j2'] },
    { id: 'l2', type: 'line', joints: ['j2', 'j3'] },
    { id: 'l3', type: 'line', joints: ['j3', 'j4'] },
    { id: 'l4', type: 'line', joints: ['j4', 'j1'] },
  ];
  const state = { joints, shapes, vcarves: [] };

  // --- Check 1: computeGeometryBounds & fitViewToExtents ---
  const bounds = computeGeometryBounds(state);
  assert(bounds !== null, 'bounds should not be null');
  assert.strictEqual(bounds.minX, 10, 'bounds minX must be 10');
  assert.strictEqual(bounds.maxX, 50, 'bounds maxX must be 50');
  assert.strictEqual(bounds.minY, 10, 'bounds minY must be 10');
  assert.strictEqual(bounds.maxY, 30, 'bounds maxY must be 30');
  assert.strictEqual(bounds.w, 40, 'bounds w must be 40');
  assert.strictEqual(bounds.h, 20, 'bounds h must be 20');
  console.log('Check 1 passed: bounds computed accurately from shapes (ignoring unused j_origin) ✅');

  // --- Check 2: Auto-fit on entering Prepare (mountPrepareView) ---
  const prepareSvg = dom.makeElement('svg');
  dom.register('prepare-canvas', prepareSvg);

  const prepare = mountPrepareView(state, prepareSvg, {});
  assert(prepare.view, 'mountPrepareView must return view');
  assert.strictEqual(prepare.view.x, 30, 'view.x must be centered at 30');
  assert.strictEqual(prepare.view.y, 20, 'view.y must be centered at 20');
  assert(prepare.view.w >= 40 * 1.2, 'view.w must encompass geometry with padding');
  assert(prepare.view.h >= 20 * 1.2, 'view.h must encompass geometry with padding');

  const vbInit = prepareSvg.getAttribute('viewBox').split(' ').map(Number);
  assert(Math.abs(vbInit[0] - (prepare.view.x - prepare.view.w / 2)) < 1e-4, 'viewBox X aligns with view');
  assert(Math.abs(vbInit[1] - (prepare.view.y - prepare.view.h / 2)) < 1e-4, 'viewBox Y aligns with view');
  console.log('Check 2 passed: Prepare canvas auto-fits view to sketch extents on mount ✅');

  // --- Check 3: Wheel zoom about cursor ---
  // Screen center is (400, 300) in 800x600 rect.
  // With view centered at (30, 20), world point at (400, 300) is (30, 20).
  const ptPre = prepareSvg.createSVGPoint();
  ptPre.x = 400; ptPre.y = 300;
  const worldPre = ptPre.matrixTransform(prepareSvg.getScreenCTM().inverse());
  assert(Math.abs(worldPre.x - 30) < 1e-4, 'screen center maps to view center');
  assert(Math.abs(worldPre.y - 20) < 1e-4, 'screen center maps to view center');

  const wBeforeZoom = prepare.view.w;
  // Wheel up (zoom in)
  prepareSvg.dispatchEvent({
    type: 'wheel',
    clientX: 400,
    clientY: 300,
    deltaY: -100,
    preventDefault() {},
  });
  const wAfterZoom = prepare.view.w;
  assert(wAfterZoom < wBeforeZoom, 'wheel up must zoom in (reduce view.w)');

  // Verify world point under cursor (400, 300) remained stationary
  const ptPost = prepareSvg.createSVGPoint();
  ptPost.x = 400; ptPost.y = 300;
  const worldPost = ptPost.matrixTransform(prepareSvg.getScreenCTM().inverse());
  assert(Math.abs(worldPost.x - worldPre.x) < 1e-4, 'world X under cursor must stay stationary');
  assert(Math.abs(worldPost.y - worldPre.y) < 1e-4, 'world Y under cursor must stay stationary');

  // Wheel down (zoom out)
  prepareSvg.dispatchEvent({
    type: 'wheel',
    clientX: 400,
    clientY: 300,
    deltaY: 100,
    preventDefault() {},
  });
  assert(prepare.view.w > wAfterZoom, 'wheel down must zoom out (increase view.w)');
  console.log('Check 3 passed: wheel zoom changes viewBox about cursor keeping focus point stationary ✅');

  // --- Check 4: Drag pans Prepare canvas ---
  // Left drag on empty space (e.g. at clientX 50, clientY 50 which is far outside the rect)
  const viewXBeforePan = prepare.view.x;
  const viewYBeforePan = prepare.view.y;

  prepareSvg.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    clientX: 50,
    clientY: 50,
    pointerId: 1,
    preventDefault() {},
  });
  prepareSvg.dispatchEvent({
    type: 'pointermove',
    clientX: 80, // moved +30px right
    clientY: 70, // moved +20px down
    pointerId: 1,
    preventDefault() {},
  });
  prepareSvg.dispatchEvent({
    type: 'pointerup',
    button: 0,
    clientX: 80,
    clientY: 70,
    pointerId: 1,
    preventDefault() {},
  });

  assert(prepare.view.x < viewXBeforePan, 'dragging right must pan view left');
  assert(prepare.view.y < viewYBeforePan, 'dragging down must pan view up');
  console.log('Check 4 passed: empty-canvas drag pans the Prepare viewBox ✅');

  // --- Check 5: Middle-button drag pans anywhere ---
  const viewXBeforeMMB = prepare.view.x;
  prepareSvg.dispatchEvent({
    type: 'pointerdown',
    button: 1,
    clientX: 400,
    clientY: 300,
    pointerId: 2,
    preventDefault() {},
  });
  prepareSvg.dispatchEvent({
    type: 'pointermove',
    clientX: 370, // moved -30px left
    clientY: 300,
    pointerId: 2,
    preventDefault() {},
  });
  prepareSvg.dispatchEvent({
    type: 'pointerup',
    button: 1,
    clientX: 370,
    clientY: 300,
    pointerId: 2,
    preventDefault() {},
  });
  assert(prepare.view.x > viewXBeforeMMB, 'middle-drag left must pan view right');
  console.log('Check 5 passed: middle-button drag pans anywhere ✅');

  // --- Check 6: Loop selection hits the right target after zoom + pan ---
  // In our sketch, the rectangle interior contains point (30, 20).
  // Find where (30, 20) world is currently located on screen:
  const ctm = prepareSvg.getScreenCTM();
  const screenPtX = ctm.a * 30 + ctm.c * 20 + ctm.e;
  const screenPtY = ctm.b * 30 + ctm.d * 20 + ctm.f;

  prepareSvg.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    clientX: screenPtX,
    clientY: screenPtY,
    pointerId: 3,
    preventDefault() {},
  });
  const selected = prepare.selectedTarget();
  assert(selected !== null, 'loop should be selected after zoom and pan');
  assert.strictEqual(selected.kind, 'loop', 'selected target must be a loop');
  console.log('Check 6 passed: loop selected correctly after zooming and panning ✅');

  // --- Check 7: Vcarve canvas zoom and pan ---
  const vcarveSvg = dom.makeElement('svg');
  dom.register('vcarve-canvas', vcarveSvg);
  dom.register('vcarve-region', dom.makeElement('select'));
  dom.register('vcarve-vbit', dom.makeElement('select'));
  dom.register('vcarve-dstep', dom.makeElement('input'));
  dom.register('vcarve-maxdepth', dom.makeElement('input'));
  dom.register('vcarve-recompute', dom.makeElement('button'));
  dom.register('vcarve-readout', dom.makeElement('p'));

  const vcarve = mountVcarveView(state);
  assert(vcarve.viewState, 'mountVcarveView must provide viewState');

  // Set region to the loop and refresh
  const loopId = prepare.loops[0].id;
  state.vcarves.push({ id: 'vcarve-1', region: loopId, vbit: { angle: 90 }, dStep: 0.5, maxDepth: 6 }); // the record a user's pick creates (mounting the view no longer creates one: TASK 609)
  vcarve.refresh();

  assert(vcarve.viewState.view, 'vcarve view must be initialized after refresh');
  const vcarveW0 = vcarve.viewState.view.w;

  // Zoom in on Vcarve
  vcarveSvg.dispatchEvent({
    type: 'wheel',
    clientX: 400,
    clientY: 300,
    deltaY: -100,
    preventDefault() {},
  });
  assert(vcarve.viewState.view.w < vcarveW0, 'Vcarve wheel zoom in must reduce view.w');

  // Pan on Vcarve
  const vcarveX0 = vcarve.viewState.view.x;
  vcarveSvg.dispatchEvent({
    type: 'pointerdown',
    button: 0,
    clientX: 100,
    clientY: 100,
    pointerId: 4,
    preventDefault() {},
  });
  vcarveSvg.dispatchEvent({
    type: 'pointermove',
    clientX: 150,
    clientY: 100,
    pointerId: 4,
    preventDefault() {},
  });
  vcarveSvg.dispatchEvent({
    type: 'pointerup',
    button: 0,
    clientX: 150,
    clientY: 100,
    pointerId: 4,
    preventDefault() {},
  });
  assert(vcarve.viewState.view.x < vcarveX0, 'Vcarve drag must pan view');
  console.log('Check 7 passed: Vcarve canvas supports shared wheel zoom and pan ✅');

  // --- Check 8: View stays preserved across cut-plan edits while in Prepare ---
  const keptView = { ...prepare.view };
  prepare.applyCutTypeToSelected('exterior');
  prepare.setFieldOnSelected('toolDia', 3.175);
  assert.strictEqual(prepare.view.x, keptView.x, 'Prepare view.x kept while editing cut settings');
  assert.strictEqual(prepare.view.y, keptView.y, 'Prepare view.y kept while editing cut settings');
  assert.strictEqual(prepare.view.w, keptView.w, 'Prepare view.w kept while editing cut settings');
  console.log('Check 8 passed: Prepare keeps zoomed/panned view while staying in the tab ✅');

  // --- Check 9: Arc sweep bounds exclude unrendered center joint and include cardinal bulge ---
  const arcJoints = new Map([
    ['jc', { x: 0, y: -100 }],   // center far outside
    ['js', { x: -60, y: -20 }],  // start (r = 100)
    ['je', { x: 60, y: -20 }],   // end (r = 100), short sweep crosses +pi/2 at (0, 0)
  ]);
  const arcBounds = computeGeometryBounds({
    joints: arcJoints,
    shapes: [{ id: 'a1', type: 'arc', subType: 'CENTER', joints: ['jc', 'js', 'je'] }],
  });
  assert(arcBounds !== null, 'arc bounds should not be null');
  assert(Math.abs(arcBounds.minX - (-60)) < 1e-6, 'arc minX must be -60');
  assert(Math.abs(arcBounds.maxX - 60) < 1e-6, 'arc maxX must be 60');
  assert(Math.abs(arcBounds.minY - (-20)) < 1e-6, 'arc minY must be -20 (center y=-100 excluded)');
  assert(Math.abs(arcBounds.maxY - 0) < 1e-6, 'arc maxY must be 0 (cardinal bulge apex included)');

  // Also check explicit largeArc: true (270° arc around (0,0) from (10,0) to (0,10) with sweep=false crosses -pi/2 and pi)
  const largeArcBounds = computeGeometryBounds({
    joints: new Map([
      ['jc', { x: 0, y: 0 }],
      ['js', { x: 10, y: 0 }],
      ['je', { x: 0, y: 10 }],
    ]),
    shapes: [{ id: 'a2', type: 'arc', subType: 'CENTER', joints: ['jc', 'js', 'je'], largeArc: true, sweep: false }],
  });
  assert(Math.abs(largeArcBounds.minX - (-10)) < 1e-6, '270° arc minX must be -10');
  assert(Math.abs(largeArcBounds.maxX - 10) < 1e-6, '270° arc maxX must be 10');
  assert(Math.abs(largeArcBounds.minY - (-10)) < 1e-6, '270° arc minY must be -10');
  assert(Math.abs(largeArcBounds.maxY - 10) < 1e-6, '270° arc maxY must be 10');
  console.log('Check 9 passed: #core/geometry-bounds computeGeometryBounds uses analytical arc sweep extrema ✅');

  // --- Check 10: SketchStudio setupUI #btn-recenter-view delegates to shared fitViewToExtents ---
  const { setupUI } = await import('../apps/sketchstudio/ui/ui-manager.js');
  const ssSvg = dom.makeElement('svg');
  dom.register('svgCanvas', ssSvg);
  const recenterBtn = dom.makeElement('button');
  dom.register('btn-recenter-view', recenterBtn);
  const ssState = {
    view: { x: 0, y: 0, w: 20, h: 15 },
    joints: new Map([
      ['j_origin', { x: 0, y: 0, fixed: true }],
      ['j_c', { x: 70, y: -20 }],
      ['j_s', { x: 40, y: 20 }],
      ['j_e', { x: 100, y: 20 }],
    ]),
    shapes: [
      { id: 's_chord', type: 'line', joints: ['j_s', 'j_e'] },
      { id: 's_arc', type: 'arc', subType: 'CENTER', joints: ['j_c', 'j_s', 'j_e'], largeArc: false, sweep: false },
    ],
    constraints: [],
    selectedJoints: new Set(),
    selectedShapes: new Set(),
    selectedConstraints: new Set(),
  };
  setupUI(ssState);
  recenterBtn.dispatchEvent({ type: 'click' });
  assert.strictEqual(ssState.view.x, 70, 'SketchStudio recenter centers X on rendered [40..100] (ignoring j_origin)');
  assert.strictEqual(ssState.view.y, 25, 'SketchStudio recenter centers Y on rendered [20..30] (ignoring arc center -20, including bulge +30)');
  assert.strictEqual(ssState.view.w, 72, 'SketchStudio recenter sets view.w = 60 * 1.2 = 72');
  console.log('Check 10 passed: SketchStudio #btn-recenter-view delegates to shared fitViewToExtents ✅');

  // Clean up
  prepare.destroy();
  vcarve.destroy();

  console.log('All TASK 436 pan/zoom unit tests passed ✅');
})().catch((err) => {
  console.error('Test failed ❌', err);
  process.exit(1);
});

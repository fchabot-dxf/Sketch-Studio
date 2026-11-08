import { state, initLayers, makeToolpath } from '../apps/penplotter/src/state.js';
import { enterTargetEditing, exitTargetEditing, syncTargetEditingSelection } from '../apps/penplotter/src/toolpath-layers-panel.js';
import { mountToolpathStage } from '../apps/penplotter/src/toolpath-stage.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };

  // Setup minimal DOM mock
  const classListSet = new Set();
  const banner = { hidden: true, textContent: '' };
  const dummyEl = () => ({
    disabled: false,
    checked: false,
    value: '',
    textContent: '',
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    setAttribute() {},
    appendChild() {},
    append() {},
    addEventListener() {},
    onclick: null,
    onchange: null,
  });

  const elements = new Map([
    ['#targetEditBanner', banner],
  ]);

  const getEl = (sel) => {
    if (elements.has(sel)) return elements.get(sel);
    const el = dummyEl();
    elements.set(sel, el);
    return el;
  };

  global.document = {
    body: {
      classList: {
        add: (c) => classListSet.add(c),
        remove: (c) => classListSet.delete(c),
        contains: (c) => classListSet.has(c),
      },
      addEventListener() {},
      removeEventListener() {},
    },
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll: () => [],
    querySelector: (sel) => getEl(sel),
    getElementById: (id) => getEl('#' + id),
    createElement: () => dummyEl(),
    createElementNS: () => dummyEl(),
  };

  initLayers();
  const tp = makeToolpath('Fill 1', 'fill');
  state.toolpaths.push(tp);

  // 1. Enter target editing on tp
  enterTargetEditing(tp);
  assert(state.targetEditingToolpathId === tp.id, 'targetEditingToolpathId is set');
  assert(document.body.classList.contains('target-editing'), 'body has target-editing class');
  assert(banner.hidden === false, 'banner is visible');
  assert(banner.textContent.includes('Fill 1'), 'banner mentions toolpath name');

  // 2. Select shapes and sync selection
  state.selectedShapeIds = new Set(['shape_a', 'shape_b']);
  syncTargetEditingSelection();
  assert(tp.targetShapeIds.length === 2, 'targetShapeIds synced');
  assert(tp.targetShapeIds.includes('shape_a') && tp.targetShapeIds.includes('shape_b'), 'targets contain selected shapes');

  // 3. Mount toolpath stage and verify onLeave hook
  const viewMock = { innerHTML: '' };
  const mounted = mountToolpathStage(viewMock);
  assert(typeof mounted.onLeave === 'function', 'mountToolpathStage returns onLeave hook');

  // 4. Trigger onLeave (simulating stage router switching away from toolpath)
  mounted.onLeave();

  // 5. Verify mode off, banner gone, targets kept
  assert(state.targetEditingToolpathId === null, 'targetEditingToolpathId is cleared (mode off)');
  assert(!document.body.classList.contains('target-editing'), 'body target-editing class removed (dashed border gone)');
  assert(banner.hidden === true, 'banner is hidden (banner gone)');
  assert(tp.targetShapeIds.length === 2, 'toolpath targetShapeIds preserved (targets kept)');
  assert(tp.targetShapeIds.includes('shape_a') && tp.targetShapeIds.includes('shape_b'), 'target shape ids intact');

  // 6. Verify identical behavior with direct exitTargetEditing (as called by Esc)
  enterTargetEditing(tp);
  assert(state.targetEditingToolpathId === tp.id, 're-entered target editing');
  assert(banner.hidden === false, 'banner visible again');
  assert(document.body.classList.contains('target-editing'), 'body class active again');
  exitTargetEditing();
  assert(state.targetEditingToolpathId === null, 'exitTargetEditing cleared mode');
  assert(banner.hidden === true, 'exitTargetEditing hid banner');
  assert(!document.body.classList.contains('target-editing'), 'exitTargetEditing removed body class');
  assert(tp.targetShapeIds.length === 2, 'targets still kept');

  console.log('penplotter-target-editing.test.js: all assertions passed');
})();

// tests/place-anchored-box-688-node.test.js -- TASK 688 (node, no browser):
// Unit tests for shared placeAnchoredBox (packages/ui/numeric-input-manager.js) used by fillet-tool.js and offset-tool.js.
import assert from 'node:assert';
import { placeAnchoredBox } from '../packages/ui/numeric-input-manager.js';

const mockSvg = (rect) => ({
  viewBox: { baseVal: { x: rect.left, y: rect.top, width: rect.width, height: rect.height } },
  getBoundingClientRect: () => rect,
});

const mockBox = (w = 90, h = 20) => ({
  offsetWidth: w,
  offsetHeight: h,
  style: { left: '', top: '' },
});

const pos = (el) => [parseInt(el.style.left, 10), parseInt(el.style.top, 10)];
const bounds = { left: 0, top: 100, right: 400, bottom: 700, width: 400, height: 600 };
const svg = mockSvg(bounds);

// 1. Middle with no obstacles -> below-right (+14, +14)
{
  const el = mockBox();
  placeAnchoredBox({ el, svg, world: { x: 200, y: 400 } });
  assert.deepStrictEqual(pos(el), [214, 414], 'middle free -> below-right');
}

// 2. Near right edge -> below-left
{
  const el = mockBox();
  placeAnchoredBox({ el, svg, world: { x: 380, y: 400 } });
  assert.deepStrictEqual(pos(el), [380 - 14 - 90, 414], 'right edge -> below-left');
}

// 3. Near bottom edge -> above-right
{
  const el = mockBox();
  placeAnchoredBox({ el, svg, world: { x: 200, y: 690 } });
  assert.deepStrictEqual(pos(el), [214, 690 - 14 - 20], 'bottom edge -> above-right');
}

// 4. Near bottom-right corner -> above-left
{
  const el = mockBox();
  placeAnchoredBox({ el, svg, world: { x: 380, y: 690 } });
  assert.deepStrictEqual(pos(el), [380 - 14 - 90, 690 - 14 - 20], 'bottom-right corner -> above-left');
}

// 5. Drag-arrow obstacle blocks below-right -> falls through to below-left
{
  const el = mockBox();
  const arrow = { left: 210, top: 410, right: 240, bottom: 432, width: 30, height: 22 };
  placeAnchoredBox({ el, svg, world: { x: 200, y: 400 }, obstacles: [arrow] });
  assert.deepStrictEqual(pos(el), [200 - 14 - 90, 414], 'below-right blocked -> below-left');
}

// 6. Offset case: world anchor extends slightly past right edge while picked curve (panAnchor) is inside canvas -> clamped inside canvas & clear of arrow
{
  const el = mockBox(90, 36);
  const arrow = { left: 375, top: 380, right: 405, bottom: 402, width: 30, height: 22 };
  placeAnchoredBox({ el, svg, world: { x: 410, y: 390 }, panAnchor: { x: 388, y: 390 }, obstacles: [arrow] });
  const [x, y] = pos(el);
  assert(x >= bounds.left && x + 90 <= bounds.right && y >= bounds.top && y + 36 <= bounds.bottom, `outward offset stays inside canvas: [${x},${y}]`);
  assert(!(x < arrow.right && x + 90 > arrow.left && y < arrow.bottom && y + 36 > arrow.top), `clamped slot avoids arrow: [${x},${y}]`);
}

// 7. Panned off canvas (panAnchor outside bounds) -> moves off-canvas with anchor (+14, +14)
{
  const el = mockBox();
  placeAnchoredBox({ el, svg, world: { x: 450, y: 400 } });
  assert.deepStrictEqual(pos(el), [464, 414], 'panned off canvas -> moves with anchor');
}

console.log('place-anchored-box-688-node: ok');

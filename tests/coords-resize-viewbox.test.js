// GRIEVANCE-1 regression: the Design cursor offset. When the canvas ELEMENT resizes but the viewBox is
// NOT re-synced, the render (preserveAspectRatio=meet: uniform scale + centering) and screenToWorld
// (#ui/coords.js: independent scaleX/scaleY, no centering) disagree -> the world point under the cursor
// != where it visually points. The FIX re-syncs the viewBox aspect to the element (updateViewBox, invoked
// live by a ResizeObserver in setupInput). This oracle locks the invariant with a stubbed svg (like the
// other coords tests): (1) the stale state genuinely drifts [positive control], (2) after the production
// updateViewBox resync the viewBox aspect == the element aspect, (3) screenToWorld then matches the meet
// render. Demonstrated RED before the fix (updateViewBox not exported / no resync) and GREEN after.
import { screenToWorld } from '#ui/coords.js';
import { updateViewBox } from '#ui/input-manager.js';

(async () => {
  const assert = (c, m) => { if (!c) throw new Error(m || 'Assertion failed'); };
  const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

  // A stub svg: getBoundingClientRect + a live viewBox.baseVal that setAttribute('viewBox',...) updates.
  function makeSvg(rect, vb) {
    return {
      _rect: rect,
      _vb: { x: vb.x, y: vb.y, width: vb.w, height: vb.h },
      getBoundingClientRect() { return this._rect; },
      get viewBox() { return { baseVal: this._vb }; },
      setAttribute(name, val) {
        if (name === 'viewBox') {
          const p = String(val).trim().split(/\s+/).map(Number);
          this._vb = { x: p[0], y: p[1], width: p[2], height: p[3] };
        }
      },
    };
  }

  // Ground truth: the ACTUAL render mapping (preserveAspectRatio="xMidYMid meet"): a uniform scale = the
  // smaller of the two axis ratios, then centered. This is where the cursor VISUALLY points.
  function meetScreenToWorld(rect, vb, sx, sy) {
    const s = Math.min(rect.width / vb.width, rect.height / vb.height);
    const offX = (rect.width - vb.width * s) / 2, offY = (rect.height - vb.height * s) / 2;
    const left = rect.left || 0, top = rect.top || 0;
    return { x: vb.x + (sx - left - offX) / s, y: vb.y + (sy - top - offY) / s };
  }

  // Element was square then WIDENED to 200x100 (aspect 2); the viewBox is still square (aspect 1) = STALE.
  const rect = { left: 0, top: 0, width: 200, height: 100 };
  const svg = makeSvg(rect, { x: -50, y: -50, w: 100, h: 100 });
  const view = { x: 0, y: 0, w: 100, h: 100 };
  const sx = 170, sy = 20; // OFF-center (the exact center never drifts)

  // 1. POSITIVE CONTROL — the stale viewBox genuinely drifts (the bug reproduces; test is non-vacuous).
  {
    const truth = meetScreenToWorld(rect, svg.viewBox.baseVal, sx, sy);
    const got = screenToWorld(svg, sx, sy);
    const drift = Math.hypot(truth.x - got.x, truth.y - got.y);
    assert(drift > 1, 'stale viewBox MUST produce a cursor offset (bug reproduced); drift=' + drift);
  }

  // 2. THE FIX — re-sync the viewBox to the element (exactly what the ResizeObserver calls on resize).
  updateViewBox(svg, view);

  // 3. INVARIANT — after resync, the viewBox aspect equals the element aspect.
  {
    const vb = svg.viewBox.baseVal;
    assert(near(vb.width / vb.height, rect.width / rect.height), 'viewBox aspect == element aspect after resync');
  }

  // 4. CORRECTNESS — screenToWorld now matches the visual (meet) render: no offset.
  {
    const vb = svg.viewBox.baseVal;
    const truth = meetScreenToWorld(rect, vb, sx, sy);
    const got = screenToWorld(svg, sx, sy);
    assert(near(got.x, truth.x) && near(got.y, truth.y),
      'screenToWorld matches the render after resync: got ' + JSON.stringify(got) + ' vs truth ' + JSON.stringify(truth));
    // sanity: rect-center maps to viewBox-center, a corner to the viewBox corner
    const c = screenToWorld(svg, rect.left + rect.width / 2, rect.top + rect.height / 2);
    assert(near(c.x, vb.x + vb.width / 2) && near(c.y, vb.y + vb.height / 2), 'rect-center maps to viewBox-center');
    const corner = screenToWorld(svg, rect.left, rect.top);
    assert(near(corner.x, vb.x) && near(corner.y, vb.y), 'rect top-left maps to the viewBox corner');
  }

  console.log('coords-resize-viewbox test passed ✅');
})().catch((e) => { console.error('coords-resize-viewbox test failed ❌', e); process.exit(1); });

// tests/profile-fill.test.js — TASK 502: Fusion white canvas, PROFILE_FILL tint of closed loops, locked-line green.
import assert from 'node:assert';

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };

const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { draw } = await import('../packages/ui/svg-renderer.js');
const { applyStyleTemplate, getStyleTemplate } = await import('../packages/ui/style-templates.js');

const mk = () => ({ joints: new Map(), shapes: [], constraints: [] });
const addRect = (m, id, x, y, w, h, extra = {}, fixed = false) => {
  const ids = [0, 1, 2, 3].map((i) => `${id}${i}`);
  [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].forEach(([px, py], i) => m.joints.set(ids[i], { x: px, y: py, ...(fixed ? { fixed: true } : {}) }));
  ids.forEach((j, i) => m.shapes.push({ id: `${id}l${i}`, type: 'line', joints: [j, ids[(i + 1) % 4]], ...extra }));
};
const addCircle = (m, id, cx, cy, r) => { m.joints.set(id, { x: cx, y: cy }); m.shapes.push({ id, type: 'circle', joints: [id], radius: r }); };
const render = (m, constraints = m.constraints) => {
  const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 800, height: 600 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 600 }), innerHTML: '' };
  draw(m.joints, m.shapes, svg, null, null, constraints, new Set(), new Set(), null, null, new Set(), null, null, null, null, null, false, null);
  return svg.innerHTML;
};
const fills = (html) => (html.match(/class="profile-fill"/g) || []).length;

const sk = mk(); addRect(sk, 'a', 100, 100, 200, 100); addCircle(sk, 'c', 500, 300, 50);
applyStyleTemplate('default');
assert.strictEqual(fills(render(sk)), 0, 'Default draws no profile fill');

applyStyleTemplate('fusion');
const html = render(sk);
assert.strictEqual(fills(html), 2, 'Fusion: a rectangle and a circle give two fill paths');
assert(html.indexOf('profile-fill') < html.indexOf('shape-elem'), 'fills are drawn behind the lines');
assert(/class="profile-fill"[^>]*pointer-events="none"/.test(html) && /class="profile-fill"[^>]*stroke="none"/.test(html), 'no stroke, no pointer events');

const open = mk(); open.joints.set('p', { x: 0, y: 0 }); open.joints.set('q', { x: 50, y: 0 }); open.joints.set('r', { x: 50, y: 50 });
open.shapes.push({ id: 'o1', type: 'line', joints: ['p', 'q'] }, { id: 'o2', type: 'line', joints: ['q', 'r'] });
assert.strictEqual(fills(render(open)), 0, 'Fusion: an open polyline gets no fill');

const cons = mk(); addRect(cons, 'k', 100, 100, 100, 100, { isConstruction: true });
assert.strictEqual(fills(render(cons)), 0, 'Fusion: a construction rectangle gets no fill');

const t = getStyleTemplate('fusion').tokens;
assert.strictEqual(t['--sk-canvas-bg'], '#FFFFFF', 'Fusion canvas is white');
assert.strictEqual(t['--sk-geo-fixed'], '#000000', 'fully constrained (DOF 0) lines are black');

// Overlapping rectangles: one fill per loop, so the overlap is darker.
const two = mk(); addRect(two, 'a', 0, 0, 100, 100); addRect(two, 'b', 50, 50, 100, 100);
assert.strictEqual(fills(render(two)), 2, 'two separate (overlapping) rectangles are two profiles');

// Locked vs free: a locked rectangle (all joints fixed) is green, a free one the Fusion blue.
const lk = mk(); addRect(lk, 'L', 0, 0, 100, 100, {}, true); addRect(lk, 'F', 300, 0, 100, 100);
const lh = render(lk);
assert(/data-shape-id="Ll0"[^>]*style="[^"]*#8DB84A/.test(lh), 'locked line is Fusion green');
assert(/data-shape-id="Fl0"[^>]*style="[^"]*--sk-constraint-fill/.test(lh), 'free line uses the blue constraint token');
applyStyleTemplate('default');
assert(!/#8DB84A/.test(render(lk)), 'Default never uses the locked colour');

// Performance: 300 shapes, steady geometry (cached loops) -- extra cost per frame of PROFILE_FILL on vs off.
const big = mk(); for (let i = 0; i < 75; i++) addRect(big, 'r' + i, (i % 10) * 60, Math.floor(i / 10) * 60, 40, 40);
const time = (n) => { const s = process.hrtime.bigint(); for (let i = 0; i < n; i++) render(big); return Number(process.hrtime.bigint() - s) / 1e6 / n; };
applyStyleTemplate('default'); time(5); const off = time(30);
SettingsManager.set('PROFILE_FILL', 'on'); time(5); const on = time(30);
console.log(`perf: 300 shapes, per frame off=${off.toFixed(2)}ms on=${on.toFixed(2)}ms delta=${(on - off).toFixed(2)}ms`);
assert(on - off < 3, 'PROFILE_FILL adds under 3 ms per frame at 300 shapes');

console.log('profile-fill.test.js passed');

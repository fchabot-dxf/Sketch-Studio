// tests/inactive-sketch-dim-661.test.js — TASK 661: everything that belongs to a sketch other than the active one is drawn inside a
// <g class="sketch-inactive"> (the CSS token --sk-inactive-sketch-opacity dims the group), the active sketch's markup is untouched, a lit
// (selected / hovered) element of an inactive sketch stays outside it, and a one-sketch drawing renders byte-identically.
import assert from 'node:assert';
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.document = { head: { appendChild() {} }, getElementById: () => null, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
const { default: SettingsManager } = await import('../packages/core/settings-manager.js');
const { draw, defaultRenderCtx } = await import('../packages/ui/svg-renderer.js');
SettingsManager.set('PROFILE_FILL', 'on');

const mk = () => ({ viewBox: { baseVal: { x: -100, y: -100, width: 200, height: 200 } }, getBoundingClientRect: () => ({ x: 0, y: 0, width: 200, height: 200 }), innerHTML: '' });
// A triangle (closed: profile fill), its length dimension + horizontal glyph, all in sketch `sk`, ids prefixed `p`.
const addSketch = (sc, sk, p, ox) => {
  [[ox, 0], [ox + 40, 0], [ox + 20, 30]].forEach(([x, y], i) => sc.J.set(`${p}j${i}`, { x, y, sketchId: sk }));
  for (let i = 0; i < 3; i++) sc.S.push({ id: `${p}s${i}`, type: 'line', joints: [`${p}j${i}`, `${p}j${(i + 1) % 3}`], groupId: p + 'g', sketchId: sk });
  sc.C.push({ type: 'distance', joints: [`${p}j0`, `${p}j1`], value: 40, offset: 20 }, { type: 'horizontal', joints: [`${p}j0`, `${p}j1`] });
};
const scene = (sketches) => {
  const sc = { J: new Map([['j_origin', { x: 0, y: 0, sketchId: 'sketch-1', fixed: true }]]), S: [], C: [] };
  for (const [sk, p, ox] of sketches) addSketch(sc, sk, p, ox);
  return sc;
};
const render = (sc, activeId, { sel = new Set(), selC = new Set(), hovS = null, provider = true } = {}) => {
  const svg = mk();
  const ctx = provider ? { ...defaultRenderCtx, getActiveSketchId: () => activeId } : defaultRenderCtx;
  draw(sc.J, sc.S, svg, null, null, sc.C, new Set(), selC, 'select', null, sel, hovS, null, null, null, null, false, null, ctx);
  return svg.innerHTML;
};
// Split the markup into what sits inside a <g class="sketch-inactive"> (per sketch id) and what is outside, balancing <g> depth.
const split = (html) => {
  const inside = {}; let outside = '', depth = 0, cur = null, buf = '';
  for (const tok of html.split(/(<g[\s>][^>]*>|<\/g>)/)) {
    const open = /^<g[\s>]/.test(tok), close = tok === '</g>';
    if (cur === null) {
      const m = open && tok.match(/class="sketch-inactive" data-sketch-id="([^"]+)"/);
      if (m) { cur = m[1]; depth = 1; buf = ''; } else outside += tok;
    } else {
      if (open) depth++; else if (close) depth--;
      if (depth === 0) { inside[cur] = (inside[cur] || '') + buf; cur = null; } else buf += tok;
    }
  }
  assert.strictEqual(cur, null, 'every group is closed');
  return { inside, outside };
};
const has = (s, re) => re.test(s);
const shapeRe = (id) => new RegExp(`data-shape-id="${id}"`);

const sc = scene([['sketch-1', 'a', -50], ['sketch-2', 'b', -30]]);
// a lone point in each sketch (a point with no curve is always drawn)
sc.J.set('lone2', { x: 60, y: 60, sketchId: 'sketch-2' }); sc.J.set('lone1', { x: -60, y: 60, sketchId: 'sketch-1' });

// 1. sketch 1 active: every sketch-2 element is inside the dimmed group, none of sketch 1's.
let { inside, outside } = split(render(sc, 'sketch-1'));
assert.deepStrictEqual(Object.keys(inside), ['sketch-2'], 'only sketch-2 is dimmed: ' + Object.keys(inside));
const in2 = inside['sketch-2'];
for (const id of ['bs0', 'bs1', 'bs2']) assert.ok(has(in2, shapeRe(id)) && !has(outside, shapeRe(id)), id + ' (curve) is dimmed');
for (const id of ['as0', 'as1', 'as2']) assert.ok(has(outside, shapeRe(id)) && !has(in2, shapeRe(id)), id + ' (active curve) is not');
assert.ok(has(in2, /cx="60" cy="60"/) && !has(outside, /cx="60" cy="60"/), 'sketch-2 point is dimmed');
assert.ok(has(outside, /cx="-60" cy="60"/) && !has(in2, /cx="-60" cy="60"/), 'sketch-1 point is not');
assert.ok(has(in2, /data-ctype="horizontal"[^>]*data-cj0="bj0"/) && !has(outside, /data-cj0="bj0"/), 'sketch-2 constraint glyph is dimmed');
assert.ok(has(outside, /data-ctype="horizontal"[^>]*data-cj0="aj0"/) && !has(in2, /data-cj0="aj0"/), 'sketch-1 glyph is not');
const texts = (s) => (s.match(/<text\b/g) || []).length;
assert.ok(texts(in2) >= 1 && texts(in2) === texts(outside), 'one dimension value label in each: ' + texts(in2) + ' / ' + texts(outside));
assert.ok(has(in2, /<line\b[^>]*stroke-opacity=/), 'sketch-2 dimension lines are dimmed');
assert.strictEqual(((in2 + outside).match(/class="profile-fill"/g) || []).length, 2, 'two profile fills drawn');
assert.strictEqual((in2.match(/class="profile-fill"/g) || []).length, 1, "the sketch-2 profile fill is dimmed, sketch 1's is not");
assert.ok(has(outside, /stroke="#ef4444"[^>]*stroke-opacity="0.6"/) && !has(in2, /stroke="#ef4444"[^>]*stroke-opacity="0.6"/), 'the axes are never dimmed');

// 2. switch the active sketch: the dimming swaps.
({ inside, outside } = split(render(sc, 'sketch-2')));
assert.deepStrictEqual(Object.keys(inside), ['sketch-1'], 'now sketch-1 is dimmed: ' + Object.keys(inside));
assert.ok(has(inside['sketch-1'], shapeRe('as0')) && !has(inside['sketch-1'], shapeRe('bs0')) && has(outside, shapeRe('bs0')), 'curves swapped');

// 3. an inactive sketch's selected / hovered curve and selected constraint glyph stay fully visible (outside the group); its others stay dimmed.
({ inside, outside } = split(render(sc, 'sketch-1', { sel: new Set(['bs0']) })));
assert.ok(has(outside, shapeRe('bs0')) && has(inside['sketch-2'], shapeRe('bs1')), 'selected inactive curve is lit, its neighbour stays dimmed');
({ inside, outside } = split(render(sc, 'sketch-1', { hovS: 'bs1' })));
assert.ok(has(outside, shapeRe('bs1')) && has(inside['sketch-2'], shapeRe('bs0')), 'hovered inactive curve is lit');
const hor2 = sc.C.find((c) => c.type === 'horizontal' && c.joints[0] === 'bj0');
({ inside, outside } = split(render(sc, 'sketch-1', { selC: new Set([hor2]) })));
assert.ok(has(outside, /data-cj0="bj0"/) && !has(inside['sketch-2'], /data-ctype="horizontal"/), 'selected inactive glyph is lit');

// 5. a pattern's label (task 658) belongs to the sketch of its source shapes: dimmed with it, full when that sketch is active.
const { patternConstraintRecord } = await import('../packages/core/pattern.js');
const pat = patternConstraintRecord({ type: 'circularPattern', sources: { shapes: ['bs0'], points: ['bj0', 'bj1'], shapeJoints: [[0, 1]] }, centre: 'j_origin', quantity: 3, angle: 90, instances: [] });
assert.ok(pat, 'a pattern record');
sc.C.push(pat);
let r = split(render(sc, 'sketch-1'));
assert.ok((r.inside['sketch-2'].match(/pattern-label/g) || []).length >= 1 && !has(r.outside, /pattern-label/), 'the pattern label of a sketch-2 pattern is dimmed with sketch 2');
r = split(render(sc, 'sketch-2'));
assert.ok(has(r.outside, /pattern-label/) && !has(r.inside['sketch-1'] || '', /pattern-label/), 'and full when sketch 2 is active');
sc.C.pop();

// 4. a one-sketch drawing is byte-identical to the markup of a host that does not dim (no group, no wrapper).
const one = scene([['sketch-1', 'a', -50]]);
const withProvider = render(one, 'sketch-1'), without = render(one, 'sketch-1', { provider: false });
assert.strictEqual(withProvider, without, 'one-sketch markup is identical with and without the active-sketch provider');
assert.ok(!/sketch-inactive/.test(withProvider), 'no dimmed group in a one-sketch drawing');
assert.ok(!/sketch-inactive/.test(render(sc, 'sketch-1', { provider: false })), 'a host that names no active sketch never dims');
console.log('inactive-sketch-dim-661.test.js passed');

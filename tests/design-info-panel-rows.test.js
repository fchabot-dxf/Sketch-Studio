// tests/design-info-panel-rows.test.js — TASK 475
// Design panel constraint list: collapsed by default, rows name their geometry, hovering a row highlights that
// constraint's geometry on the canvas, rows grouped by type with counts, solver-reported failures first.

import { draw } from '#ui/svg-renderer.js';
import { createDesignInfoPanel } from '#ui/design-info-panel.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

class MockNode {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = new Map(); this.textContent = ''; this.title = '';
    this._cls = new Set(); this._html = ''; this.dataset = {}; this.options = []; // TASK 577: the sketch rows use dataset / setAttribute
    this.classList = { add: (c) => this._cls.add(c), remove: (c) => this._cls.delete(c), contains: (c) => this._cls.has(c) };
  }
  setAttribute() {}
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  appendChild(c) { this.children.push(c); return c; }
  append(...ns) { ns.forEach((n) => n && n.appendChild && this.appendChild(n)); }
  addEventListener(ev, cb) { if (!this.listeners.has(ev)) this.listeners.set(ev, []); this.listeners.get(ev).push(cb); }
  fire(ev) { (this.listeners.get(ev) || []).forEach((cb) => cb({ stopPropagation() {} })); }
  querySelectorAll(sel) {
    const out = [];
    for (const c of this.children) { if (c.classList.contains(sel.slice(1))) out.push(c); out.push(...c.querySelectorAll(sel)); }
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  set innerHTML(html) {
    this._html = html; this.children = [];
    const re = /<([a-z0-9]+)([^>]*)>([\s\S]*?)<\/\1>/gi; let m;
    while ((m = re.exec(html)) !== null) {
      const c = new MockNode(m[1]); const cm = m[2].match(/class=["']([^"']+)["']/i);
      if (cm) c.className = cm[1];
      c.textContent = m[3].replace(/<[^>]*>/g, ''); this.appendChild(c);
    }
    this.textContent = html.replace(/<[^>]*>/g, '');
  }
  get innerHTML() { return this._html; }
}
global.document = { head: new MockNode('head'), body: new MockNode('body'), createElement: (t) => new MockNode(t), getElementById: () => null };

const J = (x, y) => ({ x, y });
function makeState() {
  const joints = new Map([
    ['j1', J(0, 0)], ['j2', J(100, 0)], ['j3', J(100, 0)], ['j4', J(100, 80)], ['j5', J(100, 80)], ['j6', J(0, 80)],
    ['jc', J(300, 300)], ['js', J(340, 300)], ['je', J(300, 340)],
  ]);
  const shapes = [
    { id: 's1', type: 'line', joints: ['j1', 'j2'] },
    { id: 's2', type: 'line', joints: ['j3', 'j4'] },
    { id: 's3', type: 'line', joints: ['j5', 'j6'] },
    { id: 'sa', type: 'arc', subType: 'CENTER', joints: ['jc', 'js', 'je'] },
  ];
  const constraints = [
    { type: 'coincident', joints: ['j2', 'j3'] },
    { type: 'horizontal', joints: ['j1', 'j2'] },
    { type: 'coincident', joints: ['j4', 'j5'] },
    { type: 'distance', joints: ['j1', 'j2'], value: 3.9 },
    { type: 'equal', shapes: ['s1', 's3'] },
    { type: 'pointOnLine', joint: 'j6', shape: 's1' },
    { type: 'coincident', joints: ['je', 'j6'] },
  ];
  return { joints, shapes, constraints, selectedConstraints: new Set(), hoveredConstraint: null, engine: null };
}
const textOf = (row) => `${row.querySelector('.sk-info-lbl').textContent} · ${row.querySelector('.sk-info-geo').textContent}`;
const expand = (container) => container.querySelector('.sk-sketch-tw').fire('click');

(async () => {
  // 1. collapsed by default: head shows name + count, no rows until the caret is clicked
  {
    const state = makeState();
    const panel = createDesignInfoPanel({ state, showSketchTree: true });
    const host = new MockNode(); panel.render(host);
    assert(host.querySelectorAll('.sk-info-row').length === 0, 'rows must be hidden by default');
    assert(host.querySelector('.sk-sketch-name').textContent === 'Sketch 1', 'sketch name shown');
    assert(host.querySelector('.sk-sketch-tw').classList.contains('is-collapsed'), 'collapsed caret (a chevron icon, TASK 577: marked by class)');
    expand(host);
    assert(host.querySelectorAll('.sk-info-row').length === 7, 'caret click shows the rows');
    expand(host);
    assert(host.querySelectorAll('.sk-info-row').length === 0, 'second click collapses again');
    console.log('✓ collapsed by default; caret toggles');
  }

  // 2. rows name their geometry
  {
    const state = makeState();
    const panel = createDesignInfoPanel({ state, showSketchTree: true });
    const host = new MockNode(); panel.render(host); expand(host);
    const byC = new Map(); const rows = host.querySelectorAll('.sk-info-row');
    // rows are grouped by type, so find each by its text
    const texts = rows.map(textOf);
    const has = (t) => assert(texts.includes(t), `expected row "${t}" in:\n  ${texts.join('\n  ')}`);
    has('Horizontal · Line 1');
    has('Coincident · Line 1 end – Line 2 start');
    has('Coincident · Line 2 end – Line 3 start');
    has('Coincident · Arc 1 end – Line 3 end');
    has('Distance · Line 1');
    has('Equal · Line 1 = Line 3');
    has('Point on line · Line 3 end on Line 1');
    assert(rows.find((r) => r.querySelector('.sk-info-lbl').textContent === 'Distance').querySelector('.sk-info-val').textContent === '3.9', 'distance keeps its value');
    void byC;
    // numbering is stable across re-renders
    panel.refresh();
    assert(host.querySelectorAll('.sk-info-row').map(textOf).join('|') === texts.join('|'), 'labels stable while the sketch is unchanged');
    console.log('✓ rows name their geometry (horizontal, coincident, distance, equal, pointOnLine)');
  }

  // 3. hover a row → state.hoveredConstraint → the renderer highlights exactly that constraint's shapes
  {
    const state = makeState();
    const panel = createDesignInfoPanel({ state, showSketchTree: true });
    const host = new MockNode(); panel.render(host); expand(host);
    const row = host.querySelectorAll('.sk-info-row').find((r) => textOf(r) === 'Equal · Line 1 = Line 3');
    const eq = state.constraints.find((c) => c.type === 'equal');
    const render = () => {
      const svg = { viewBox: { baseVal: { x: 0, y: 0, width: 1000, height: 1000 } }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), innerHTML: '' };
      draw(state.joints, state.shapes, svg, null, null, state.constraints, new Set(), state.selectedConstraints, null, null, new Set(), null, null, state.hoveredConstraint, null, null, false, null);
      const m = new Map();
      for (const x of svg.innerHTML.matchAll(/<(?:line|path|circle)[^>]*data-shape-id="([^"]+)"[^>]*>/g)) m.set(x[1], x[0]);
      return m;
    };
    const before = render();
    row.fire('mouseenter');
    assert(state.hoveredConstraint === eq, 'mouseenter sets state.hoveredConstraint to that constraint');
    const during = render();
    const changed = [...during.keys()].filter((id) => during.get(id) !== before.get(id)).sort();
    assert(changed.join(',') === 's1,s3', `exactly Line 1 and Line 3 highlighted, got [${changed}]`);
    row.fire('mouseleave');
    assert(state.hoveredConstraint === null, 'mouseleave clears the hover');
    const after = render();
    assert([...after.keys()].every((id) => after.get(id) === before.get(id)), 'highlight gone after mouseleave');
    console.log('✓ hovering a row highlights exactly its constraint geometry');
  }

  // 4. grouping: sorted by type, with "<Type> · <count>" sub-headers
  {
    const state = makeState();
    const panel = createDesignInfoPanel({ state, showSketchTree: true });
    const host = new MockNode(); panel.render(host); expand(host);
    const heads = host.querySelectorAll('.sk-info-grp').map((h) => h.textContent);
    assert(heads.join('|') === 'Coincident · 3|Horizontal · 1|Point on line · 1|Distance · 1|Equal · 1', `group order/counts: ${heads.join('|')}`);
    const kids = host.querySelector('.sk-sketch-children').children.map((c) => (c.classList.contains('sk-info-grp') ? 'G' : 'R')).join('');
    assert(kids === 'GRRRGRGRGRGR', `each header precedes its rows: ${kids}`);
    console.log('✓ rows grouped by type with counts');
  }

  // 5. problems first: the solver's per-constraint failures (engine.getSolveStats().constraintErrors) on top, in the error colour
  {
    const state = makeState();
    const bad = state.constraints[1]; // the horizontal on j1-j2
    const engine = { getSolveStats: () => ({ converged: false, constraintErrors: [{ type: 'horizontal', joints: ['j1', 'j2'], shapes: [], residual: 5 }] }) };
    const panel = createDesignInfoPanel({ state, engine, showSketchTree: true });
    const host = new MockNode(); panel.render(host); expand(host);
    const heads = host.querySelectorAll('.sk-info-grp');
    assert(heads[0].textContent === 'Problems · 1' && heads[0].classList.contains('err'), `Problems group first: ${heads[0].textContent}`);
    const first = host.querySelector('.sk-sketch-children').children[1];
    assert(first.classList.contains('err') && textOf(first) === 'Horizontal · Line 1', 'failing row shown first in the error style');
    assert(host.querySelectorAll('.sk-info-row').filter((r) => r.classList.contains('err')).length === 1, 'only the failing constraint is flagged');
    void bad;
    console.log('✓ solver-reported failing constraints listed first');
  }

  console.log('All TASK 475 design-info-panel row tests passed ✅');
})().catch((e) => { console.error('TASK 475 tests failed ❌', e); process.exit(1); });

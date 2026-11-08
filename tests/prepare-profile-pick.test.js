// tests/prepare-profile-pick.test.js — TASK 432 unit tests (P1-P8, E1-E2)
import assert from 'node:assert';
import { findLoops, findOpenChains } from '#core/loop-finder.js';
import { loopPolygon, polyArea, sampleArc } from '#core/loop-geometry.js';
import { makeProfile, resolveProfileViews, resolveProfileForLoop, derivedProfileForLoop, resolveTargetKey, listSketchProfiles } from '#core/profile-model.js';
import { mountPrepareView } from '../apps/shaper/src/prepare-view.js';
import { keyOf, parseKey, CUT_PLAN, migrateEdgeRecords } from '../apps/shaper/src/cut-plan.js';
import { exportShaperSVG } from '#core/shaper-export.js';

// Minimal mock DOM for Node environment
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
      get id() { return attrs.get('id') || this._id || ''; },
      set id(v) { this._id = String(v); attrs.set('id', String(v)); },
      viewBox: { baseVal: { x: -60, y: -45, width: 120, height: 90 } },
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
      removeChild(c) {
        const idx = children.indexOf(c);
        if (idx !== -1) children.splice(idx, 1);
        c.parentNode = null;
        return c;
      },
      querySelector(sel) {
        if (sel.startsWith('#')) {
          const id = sel.slice(1);
          if (el.id === id || attrs.get('id') === id) return el;
          for (const c of children) {
            if (c.id === id || c.getAttribute?.('id') === id) return c;
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
        if (sel.startsWith('#') && attrs.get('id') === sel.slice(1)) results.push(el);
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
          listeners.set(type, listeners.get(type).filter((f) => f !== fn));
        }
      },
      dispatchEvent(event) {
        if (!event.preventDefault) event.preventDefault = () => {};
        const arr = listeners.get(event.type) || [];
        for (const fn of arr) fn(event);
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 };
      },
      setPointerCapture() {},
      releasePointerCapture() {},
      getTotalLength() {
        const d = attrs.get('d') || '';
        const m = d.match(/M\s+([-\d.]+)\s+([-\d.]+)\s+A\s+([-\d.]+)\s+([-\d.]+)\s+0\s+(\d)\s+(\d)\s+([-\d.]+)\s+([-\d.]+)/);
        if (m) {
          const sx = Number(m[1]), sy = Number(m[2]), rx = Number(m[3]), ry = Number(m[4]);
          const la = Number(m[5]), sw = Number(m[6]), ex = Number(m[7]), ey = Number(m[8]);
          const mx = (sx + ex) / 2, my = (sy + ey) / 2;
          const dx = (sx - ex) / 2, dy = (sy - ey) / 2;
          const d2 = dx * dx + dy * dy;
          const h2 = Math.max(0, rx * rx - d2);
          let h = d2 > 0 ? Math.sqrt(h2) / Math.sqrt(d2) : 0;
          if (la === sw) h = -h;
          const cx = mx - h * dy, cy = my + h * dx;
          let a1 = Math.atan2(sy - cy, sx - cx);
          let a2 = Math.atan2(ey - cy, ex - cx);
          if (sw === 1 && a2 <= a1) a2 += 2 * Math.PI;
          if (sw === 0 && a2 >= a1) a2 -= 2 * Math.PI;
          return rx * Math.abs(a2 - a1);
        }
        return 0;
      },
      getPointAtLength(l) {
        const d = attrs.get('d') || '';
        const m = d.match(/M\s+([-\d.]+)\s+([-\d.]+)\s+A\s+([-\d.]+)\s+([-\d.]+)\s+0\s+(\d)\s+(\d)\s+([-\d.]+)\s+([-\d.]+)/);
        if (m) {
          const sx = Number(m[1]), sy = Number(m[2]), rx = Number(m[3]), ry = Number(m[4]);
          const la = Number(m[5]), sw = Number(m[6]), ex = Number(m[7]), ey = Number(m[8]);
          const mx = (sx + ex) / 2, my = (sy + ey) / 2;
          const dx = (sx - ex) / 2, dy = (sy - ey) / 2;
          const d2 = dx * dx + dy * dy;
          const h2 = Math.max(0, rx * rx - d2);
          let h = d2 > 0 ? Math.sqrt(h2) / Math.sqrt(d2) : 0;
          if (la === sw) h = -h;
          const cx = mx - h * dy, cy = my + h * dx;
          let a1 = Math.atan2(sy - cy, sx - cx);
          let a2 = Math.atan2(ey - cy, ex - cx);
          if (sw === 1 && a2 <= a1) a2 += 2 * Math.PI;
          if (sw === 0 && a2 >= a1) a2 -= 2 * Math.PI;
          const totalLen = rx * Math.abs(a2 - a1);
          const t = totalLen > 0 ? l / totalLen : 0;
          const a = a1 + t * (a2 - a1);
          return { x: cx + rx * Math.cos(a), y: cy + rx * Math.sin(a) };
        }
        return { x: 0, y: 0 };
      },
      createSVGPoint() {
        return {
          x: 0, y: 0,
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

  globalThis.document = {
    createElement(tag) { return makeElement(tag); },
    createElementNS(ns, tag) { return makeElement(tag, ns); },
    getElementById(id) { return elements.get(id) || null; },
  };

  return { makeElement };
}

const ENC5 = [
  { id: 'exterior', cutType: 'outside', fill: '#000000', stroke: 'none' },
  { id: 'interior', cutType: 'inside', fill: '#FFFFFF', stroke: '#000000' },
  { id: 'pocket', cutType: 'pocket', fill: '#7F7F7F', stroke: 'none' },
  { id: 'online', cutType: 'online', fill: 'none', stroke: '#7F7F7F' },
  { id: 'guide', cutType: 'guide', fill: '#0068FF', stroke: '#0068FF' },
];

(async () => {
  setupMockDom();

  // ── Fixture A: Frame (Outer 60×60, Inner 30×30 at center 15..45) ──
  const makeFrameState = () => ({
    joints: new Map([
      ['O0', { x: 0, y: 0 }], ['O1', { x: 60, y: 0 }], ['O2', { x: 60, y: 60 }], ['O3', { x: 0, y: 60 }],
      ['I0', { x: 15, y: 15 }], ['I1', { x: 45, y: 15 }], ['I2', { x: 45, y: 45 }], ['I3', { x: 15, y: 45 }],
    ]),
    constraints: [],
    shapes: [
      { id: 'so1', type: 'line', joints: ['O0', 'O1'] }, { id: 'so2', type: 'line', joints: ['O1', 'O2'] },
      { id: 'so3', type: 'line', joints: ['O2', 'O3'] }, { id: 'so4', type: 'line', joints: ['O3', 'O0'] },
      { id: 'si1', type: 'line', joints: ['I0', 'I1'] }, { id: 'si2', type: 'line', joints: ['I1', 'I2'] },
      { id: 'si3', type: 'line', joints: ['I2', 'I3'] }, { id: 'si4', type: 'line', joints: ['I3', 'I0'] },
    ],
    groups: [],
    profiles: [],
  });

  const worldToClient = (svg, wx, wy) => {
    const ctm = svg.getScreenCTM();
    return { clientX: wx * ctm.a + ctm.e, clientY: wy * ctm.d + ctm.f };
  };

  // P1: interior click of a frame (outer + hole) → kind 'loop' with outer's id; its highlight d has 2 subpaths.
  {
    const state = makeFrameState();
    const loops = findLoops(state);
    const outerLoop = loops.find((l) => l.edges.includes('so1'));
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const view = mountPrepareView(state, svgEl);

    const target = view.resolveTarget({ x: 5, y: 5 }); // in outer ring
    assert.strictEqual(target.kind, 'loop', 'P1: target kind must be loop');
    assert.strictEqual(target.id, outerLoop.id, 'P1: target id must match outer loop');

    // Dispatch click at world (5, 5)
    const pt = worldToClient(svgEl, 5, 5);
    svgEl.dispatchEvent({ type: 'pointerdown', clientX: pt.clientX, clientY: pt.clientY, button: 0 });
    const selectG = svgEl.querySelector('#prepare-select-group');
    const pathMatch = selectG.innerHTML.match(/d="([^"]+)"/);
    assert(pathMatch, 'P1: selection group must have path d');
    const d = pathMatch[1];
    const subpathCount = (d.match(/M /g) || []).length;
    assert.strictEqual(subpathCount, 2, `P1: highlight d must have 2 subpaths (outer + hole open), got ${subpathCount}: ${d}`);
    assert(selectG.innerHTML.includes('fill-rule="evenodd"'), 'P1: highlight must be evenodd');
  }

  // P2: click inside the hole → the hole's loop.
  {
    const state = makeFrameState();
    const loops = findLoops(state);
    const holeLoop = loops.find((l) => l.edges.includes('si1'));
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const view = mountPrepareView(state, svgEl);

    const target = view.resolveTarget({ x: 25, y: 25 }); // inside hole
    assert.strictEqual(target.kind, 'loop', 'P2: hole target kind must be loop');
    assert.strictEqual(target.id, holeLoop.id, 'P2: hole target id must match hole loop');
  }

  // P3: bullseye (3 circles, NO group): click the ring → the ring's profile, whose inners are only the dot.
  {
    const state = {
      joints: new Map([['C', { x: 0, y: 0 }]]),
      constraints: [],
      shapes: [
        { id: 'c_out', type: 'circle', joints: ['C'], radius: 30 },
        { id: 'c_ring', type: 'circle', joints: ['C'], radius: 20 },
        { id: 'c_dot', type: 'circle', joints: ['C'], radius: 10 },
      ],
      groups: [],
      profiles: [],
    };
    const loops = findLoops(state);
    const ringLoop = loops.find((l) => l.edges.includes('c_ring'));
    const dotLoop = loops.find((l) => l.edges.includes('c_dot'));
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const view = mountPrepareView(state, svgEl);

    const target = view.resolveTarget({ x: 15, y: 0 }); // between r=10 and r=20
    assert.strictEqual(target.kind, 'loop', 'P3: target kind must be loop');
    assert.strictEqual(target.id, ringLoop.id, 'P3: target id must match ring loop');

    const shapeById = new Map(state.shapes.map((s) => [s.id, s]));
    const loopPolys = Object.fromEntries(loops.map((l) => [l.id, loopPolygon(l, state, shapeById)]));
    const prof = derivedProfileForLoop(ringLoop.id, loops, loopPolys, state);
    assert.strictEqual(prof.inners.length, 1, 'P3: ring profile must have exactly 1 direct hole');
    assert.strictEqual(prof.inners[0], dotLoop.id, 'P3: ring profile direct hole must be dot');
  }

  // P4: click the ink of a filleted rect's ARC → the rect's loop, NOT kind 'edge'.
  {
    // A rectangle with top-right corner replaced by an arc from (40,50) to (50,40) center (40,40)
    const state = {
      joints: new Map([
        ['A', { x: 0, y: 0 }], ['B', { x: 50, y: 0 }], ['C', { x: 50, y: 40 }],
        ['Carc', { x: 40, y: 40 }], ['Darc', { x: 40, y: 50 }],
        ['E', { x: 0, y: 50 }],
      ]),
      constraints: [],
      shapes: [
        { id: 'bottom', type: 'line', joints: ['A', 'B'] },
        { id: 'right', type: 'line', joints: ['B', 'C'] },
        { id: 'fillet', type: 'arc', joints: ['Carc', 'C', 'Darc'], subType: 'CENTER', sweep: true },
        { id: 'top', type: 'line', joints: ['Darc', 'E'] },
        { id: 'left', type: 'line', joints: ['E', 'A'] },
      ],
      groups: [],
      profiles: [],
    };
    const loops = findLoops(state);
    assert.strictEqual(loops.length, 1, 'P4: 1 closed filleted loop');
    const rectLoop = loops[0];

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const view = mountPrepareView(state, svgEl);

    // Pick directly on the fillet arc's ink (e.g. at 45°: x = 40 + 10*cos(45°) ≈ 47.07, y = 40 + 10*sin(45°) ≈ 47.07)
    const target = view.resolveTarget({ x: 47.07, y: 47.07 });
    assert(target, 'P4: target resolved on fillet arc ink');
    assert.strictEqual(target.kind, 'loop', 'P4: target kind must be loop, NOT edge');
    assert.strictEqual(target.id, rectLoop.id, 'P4: target id must match rect loop');
  }

  // P5: an open 3-segment polyline → kind 'chain', the same id from each segment.
  {
    const state = {
      joints: new Map([
        ['P0', { x: 0, y: 0 }], ['P1', { x: 10, y: 0 }], ['P2', { x: 10, y: 10 }], ['P3', { x: 20, y: 10 }],
      ]),
      constraints: [],
      shapes: [
        { id: 'seg1', type: 'line', joints: ['P0', 'P1'] },
        { id: 'seg2', type: 'line', joints: ['P1', 'P2'] },
        { id: 'seg3', type: 'line', joints: ['P2', 'P3'] },
      ],
      groups: [],
      profiles: [],
    };
    const loops = findLoops(state);
    assert.strictEqual(loops.length, 0, 'P5: no closed loops');

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const view = mountPrepareView(state, svgEl);

    const t1 = view.resolveTarget({ x: 5, y: 0 });  // middle of seg1
    const t2 = view.resolveTarget({ x: 10, y: 5 }); // middle of seg2
    const t3 = view.resolveTarget({ x: 15, y: 10 });// middle of seg3

    assert(t1 && t1.kind === 'chain', 'P5: t1 kind is chain');
    assert(t2 && t2.kind === 'chain', 'P5: t2 kind is chain');
    assert(t3 && t3.kind === 'chain', 'P5: t3 kind is chain');
    assert.strictEqual(t1.id, t2.id, 'P5: seg1 and seg2 resolve to same chain id');
    assert.strictEqual(t2.id, t3.id, 'P5: seg2 and seg3 resolve to same chain id');
    assert.strictEqual(t1.id, 'chain_seg1-seg2-seg3', 'P5: chain id is chain_seg1-seg2-seg3');
  }

  // P6: combined profile beats derived.
  {
    const state = makeFrameState();
    const loops = findLoops(state);
    const outerLoop = loops.find((l) => l.edges.includes('so1'));
    const holeLoop = loops.find((l) => l.edges.includes('si1'));

    const comb = makeProfile(state, outerLoop, [holeLoop], 'Custom Combined Frame');
    assert(comb, 'P6: combined profile created');

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const view = mountPrepareView(state, svgEl);

    const target = view.resolveTarget({ x: 5, y: 5 });
    assert.strictEqual(target.kind, 'profile', 'P6: target kind must be profile');
    assert.strictEqual(target.id, comb.id, 'P6: target id must match combined profile id');
  }

  // P7: shift+click adds; shift+click again removes.
  {
    const state = makeFrameState();
    const loops = findLoops(state);
    const outerLoop = loops.find((l) => l.edges.includes('so1'));
    const holeLoop = loops.find((l) => l.edges.includes('si1'));

    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    let lastNotified = null;
    const view = mountPrepareView(state, svgEl, {
      onSelectionChange: (t) => { lastNotified = t; },
    });

    // 1. Plain click in outer ring
    const ptOuter = worldToClient(svgEl, 5, 5);
    svgEl.dispatchEvent({ type: 'pointerdown', clientX: ptOuter.clientX, clientY: ptOuter.clientY, shiftKey: false, button: 0 });
    assert.strictEqual(view.selection.size, 1, 'P7: 1 target selected after plain click');
    assert(view.selection.has(keyOf('loop', outerLoop.id)), 'P7: outer loop selected');
    assert.strictEqual(lastNotified.id, outerLoop.id, 'P7: onSelectionChange received outer');

    // 2. Shift+click in hole (world 25, 25)
    const ptHole = worldToClient(svgEl, 25, 25);
    svgEl.dispatchEvent({ type: 'pointerdown', clientX: ptHole.clientX, clientY: ptHole.clientY, shiftKey: true, button: 0 });
    assert.strictEqual(view.selection.size, 2, 'P7: 2 targets selected after shift+click');
    assert(view.selection.has(keyOf('loop', outerLoop.id)), 'P7: outer loop still selected');
    assert(view.selection.has(keyOf('loop', holeLoop.id)), 'P7: hole loop added');
    assert.strictEqual(lastNotified.id, holeLoop.id, 'P7: onSelectionChange received hole');

    // 3. Shift+click in hole again -> toggles off
    svgEl.dispatchEvent({ type: 'pointerdown', clientX: ptHole.clientX, clientY: ptHole.clientY, shiftKey: true, button: 0 });
    assert.strictEqual(view.selection.size, 1, 'P7: 1 target selected after shift+click toggle off');
    assert(view.selection.has(keyOf('loop', outerLoop.id)), 'P7: outer loop still selected');
    assert(!view.selection.has(keyOf('loop', holeLoop.id)), 'P7: hole loop removed');
  }

  // P8: migrateEdgeRecords on a plan with one loop-edge record and one chain-edge record → { dropped: 1, moved: 1 }.
  {
    const state = {
      joints: new Map([
        ['A', { x: 0, y: 0 }], ['B', { x: 50, y: 0 }], ['C', { x: 50, y: 50 }], ['D', { x: 0, y: 50 }],
        ['P', { x: 100, y: 0 }], ['Q', { x: 120, y: 0 }],
      ]),
      constraints: [],
      shapes: [
        { id: 'l1', type: 'line', joints: ['A', 'B'] },
        { id: 'l2', type: 'line', joints: ['B', 'C'] },
        { id: 'l3', type: 'line', joints: ['C', 'D'] },
        { id: 'l4', type: 'line', joints: ['D', 'A'] },
        { id: 'open_line', type: 'line', joints: ['P', 'Q'] },
      ],
      groups: [],
    };
    const loops = findLoops(state);
    const chains = findOpenChains(state, loops);

    const testPlan = new Map([
      ['edge:l1', { cutType: 'online', toolDia: 3.175 }],       // on closed loop -> must be dropped
      ['edge:open_line', { cutType: 'online', toolDia: 3.175 }],// on open chain -> must be moved to chain:chain_open_line
    ]);

    const res = migrateEdgeRecords(loops, chains, testPlan);
    assert.strictEqual(res.dropped, 1, 'P8: 1 record dropped');
    assert.strictEqual(res.moved, 1, 'P8: 1 record moved');
    assert(!testPlan.has('edge:l1'), 'P8: edge:l1 deleted');
    assert(!testPlan.has('edge:open_line'), 'P8: edge:open_line deleted');
    const chainKey = keyOf('chain', 'chain_open_line');
    assert(testPlan.has(chainKey), `P8: plan has ${chainKey}`);
    assert.strictEqual(testPlan.get(chainKey).cutType, 'online', 'P8: moved cutType preserved');
  }

  // P8b: migrateEdgeRecords converts bare loop/profile ids in vcarves to 'loop:<id>' / 'profile:<id>'.
  {
    const state = makeFrameState();
    const loops = findLoops(state);
    const chains = findOpenChains(state, loops);
    const outerLoop = loops.find((l) => l.edges.includes('so1'));
    const testVcarves = [
      { id: 'vc1', region: outerLoop.id, vbit: { angle: 90 } },
      { id: 'vc2', region: 'profile-1', vbit: { angle: 60 } },
      { id: 'vc3', region: 'loop:' + outerLoop.id, vbit: { angle: 90 } }, // already canonical -> not changed
    ];
    const res = migrateEdgeRecords(loops, chains, new Map(), testVcarves);
    assert.strictEqual(res.vcarveUpdated, 2, 'P8b: 2 vcarves migrated to canonical form');
    assert.strictEqual(testVcarves[0].region, `loop:${outerLoop.id}`, 'P8b: bare loop id converted to loop:<id>');
    assert.strictEqual(testVcarves[1].region, 'profile:profile-1', 'P8b: bare profile-1 converted to profile:profile-1');
    assert.strictEqual(testVcarves[2].region, `loop:${outerLoop.id}`, 'P8b: canonical key unchanged');
  }

  // P9: resolveTargetKey resolves loop, profile, and chain keys cleanly; rejects invalid keys.
  {
    const state = makeFrameState();
    const loops = findLoops(state);
    const outerLoop = loops.find((l) => l.edges.includes('so1'));
    const holeLoop = loops.find((l) => l.edges.includes('si1'));

    // Derived loop
    const derivedSpec = resolveTargetKey(`loop:${outerLoop.id}`, state, loops);
    assert(derivedSpec && !derivedSpec.invalid, 'P9: derived loop spec resolved');
    assert.strictEqual(derivedSpec.outer, outerLoop.id, 'P9: outer loop id matches');
    assert.deepStrictEqual(derivedSpec.inners, [holeLoop.id], 'P9: inners has hole loop id');
    assert.strictEqual(derivedSpec.isDerived, true, 'P9: isDerived is true');

    // Combined profile
    makeProfile(state, outerLoop, [holeLoop], 'Combined Frame');
    const profSpec = resolveTargetKey('profile:profile-1', state, loops);
    assert(profSpec && !profSpec.invalid, 'P9: combined profile resolved');
    assert.strictEqual(profSpec.profileId, 'profile-1', 'P9: profileId matches');
    assert.strictEqual(profSpec.outer, outerLoop.id, 'P9: combined outer matches');
    assert.deepStrictEqual(profSpec.inners, [holeLoop.id], 'P9: combined inners matches');
    assert.strictEqual(profSpec.isCombined, true, 'P9: isCombined is true');

    // Chain
    const openState = {
      joints: new Map([['X0', { x: 0, y: 0 }], ['X1', { x: 10, y: 0 }]]),
      shapes: [{ id: 'xline', type: 'line', joints: ['X0', 'X1'] }],
      constraints: [],
    };
    const openChains = findOpenChains(openState, []);
    const chainSpec = resolveTargetKey(`chain:${openChains[0].id}`, openState, []);
    assert(chainSpec && !chainSpec.invalid, 'P9: chain spec resolved');
    assert.strictEqual(chainSpec.kind, 'chain', 'P9: kind is chain');
    assert.strictEqual(chainSpec.chain.id, 'chain_xline', 'P9: chain id matches');

    // Invalid / unknown
    assert.strictEqual(resolveTargetKey('unknown:123', state), null, 'P9: unknown prefix returns null');
    assert.strictEqual(resolveTargetKey('bare_id_no_colon', state), null, 'P9: bare id without colon returns null');
    const missingLoop = resolveTargetKey('loop:nonexistent', state, loops);
    assert(missingLoop.invalid, 'P9: nonexistent loop key marked invalid');
  }

  // P10: listSketchProfiles returns combined profiles first (sorted descending by area), then derived profiles for uncovered loops.
  {
    const state = makeFrameState();
    const loops = findLoops(state);
    const outerLoop = loops.find((l) => l.edges.includes('so1'));
    const holeLoop = loops.find((l) => l.edges.includes('si1'));

    // Before combine: 2 derived profiles (outer frame minus hole, and hole loop)
    const beforeList = listSketchProfiles(state);
    assert.strictEqual(beforeList.length, 2, 'P10: 2 profiles before combine');
    assert.strictEqual(beforeList[0].key, `loop:${outerLoop.id}`, 'P10: largest loop first');
    assert.deepStrictEqual(beforeList[0].holeIds, [holeLoop.id], 'P10: hole loop in holeIds');
    assert.strictEqual(beforeList[1].key, `loop:${holeLoop.id}`, 'P10: hole loop profile second');

    // After combine: 1 combined profile covering both loops
    makeProfile(state, outerLoop, [holeLoop], 'My Frame');
    const afterList = listSketchProfiles(state);
    assert.strictEqual(afterList.length, 1, 'P10: 1 combined profile covering both loops');
    assert.strictEqual(afterList[0].key, 'profile:profile-1', 'P10: key is profile:profile-1');
    assert.strictEqual(afterList[0].title, 'My Frame', 'P10: title is My Frame');
    assert.strictEqual(afterList[0].isCombined, true, 'P10: isCombined is true');
  }

  // E1: export a frame with Pocket on the outer: one compound path (no fill-rule), 2 subpaths, no group anywhere.
  {
    const state = makeFrameState();
    const loops = findLoops(state);
    const outerLoop = loops.find((l) => l.edges.includes('so1'));

    const svg = exportShaperSVG({
      state,
      entries: [{ target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'pocket' } }],
      encoding: ENC5,
      docUnit: 'mm',
    });

    assert(!svg.includes('<g '), 'E1: no <g> group in export');
    assert(!svg.includes('fill-rule'), 'E1: compound path has NO fill-rule (holes wound opposite, Studio parity)');
    assert(svg.includes('shaper:cutType="pocket"'), 'E1: shaper:cutType is pocket');
    const pathMatch = svg.match(/<path d="([^"]+)"/);
    assert(pathMatch, 'E1: path element emitted');
    const d = pathMatch[1];
    const subpathCount = (d.match(/M /g) || []).length;
    assert.strictEqual(subpathCount, 2, `E1: path must have 2 subpaths (outer + hole), got ${subpathCount}: ${d}`);
  }

  // E2: export a bullseye with Pocket on the outer + On line on the dot: the compound (outer + ring) plus a separate dot path.
  {
    const state = {
      joints: new Map([['C', { x: 0, y: 0 }]]),
      constraints: [],
      shapes: [
        { id: 'c_out', type: 'circle', joints: ['C'], radius: 30 },
        { id: 'c_ring', type: 'circle', joints: ['C'], radius: 20 },
        { id: 'c_dot', type: 'circle', joints: ['C'], radius: 10 },
      ],
      groups: [],
      profiles: [],
    };
    const loops = findLoops(state);
    const outerLoop = loops.find((l) => l.edges.includes('c_out'));
    const dotLoop = loops.find((l) => l.edges.includes('c_dot'));

    const svg = exportShaperSVG({
      state,
      entries: [
        { target: { kind: 'loop', id: outerLoop.id }, rec: { cutType: 'pocket' } },
        { target: { kind: 'loop', id: dotLoop.id }, rec: { cutType: 'online' } },
      ],
      encoding: ENC5,
      docUnit: 'mm',
    });

    // Outer pocket path: outer + ring hole (hole wound opposite, no fill-rule)
    assert(!svg.includes('fill-rule'), 'E2: outer pocket has NO fill-rule');
    assert(svg.includes('shaper:cutType="pocket"'), 'E2: pocket cut attr present');
    assert(svg.includes('shaper:cutType="online"'), 'E2: dot online cut attr present');

    // Dot is exported as its own element (circle or path) with shaper:cutType="online"
    const hasDotCut = svg.includes('shaper:cutType="online"');
    assert(hasDotCut, 'E2: dot path exported as separate element with online cut');
  }

  // P9: TASK 433b: Frame with Outside (exterior) cut → toolpath layer has kerf on BOTH boundaries
  {
    const state = makeFrameState();
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const view = mountPrepareView(state, svgEl);

    // Select the frame (click at 5, 5 in outer ring)
    const pt = worldToClient(svgEl, 5, 5);
    svgEl.dispatchEvent({ type: 'pointerdown', clientX: pt.clientX, clientY: pt.clientY, button: 0 });

    // Apply Outside cut with 3.175mm tool
    view.applyCutTypeToSelected('exterior');
    const toolpathG = svgEl.querySelector('#prepare-toolpath-group');
    const polyMatches = toolpathG.innerHTML.match(/points="([^"]+)"/g) || [];
    assert(polyMatches.length >= 2, `P9: outside cut on frame must render toolpaths for both boundaries, got ${polyMatches.length}`);

    // Verify outer toolpath expands outward (-1.5875) and hole toolpath shrinks inward into hole void (16.5875)
    assert(toolpathG.innerHTML.includes('-1.5875'), 'P9: outer toolpath expands outward by +toolDia/2');
    assert(toolpathG.innerHTML.includes('16.5875'), 'P9: hole toolpath shrinks inward into hole void by -toolDia/2');
    view.destroy();
  }

  // P10: TASK 433b: Frame with Inside (interior) cut → toolpath layer has kerf on BOTH boundaries (duality)
  {
    const state = makeFrameState();
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const view = mountPrepareView(state, svgEl);

    // Select the frame (click at 5, 5 in outer ring)
    const pt = worldToClient(svgEl, 5, 5);
    svgEl.dispatchEvent({ type: 'pointerdown', clientX: pt.clientX, clientY: pt.clientY, button: 0 });

    // Apply Inside cut with 3.175mm tool
    view.applyCutTypeToSelected('interior');
    const toolpathG = svgEl.querySelector('#prepare-toolpath-group');
    const polyMatches = toolpathG.innerHTML.match(/points="([^"]+)"/g) || [];
    assert(polyMatches.length >= 2, `P10: inside cut on frame must render toolpaths for both boundaries, got ${polyMatches.length}`);

    // Verify outer toolpath shrinks inward into face (1.5875) and hole toolpath expands outward into face (13.4125)
    assert(toolpathG.innerHTML.includes('1.5875'), 'P10: outer toolpath shrinks inward into face by -toolDia/2');
    assert(toolpathG.innerHTML.includes('13.4125'), 'P10: hole toolpath expands outward into face by +toolDia/2');
    view.destroy();
  }

  console.log('prepare-profile-pick (P1-P10, E1-E2) tests passed ✅');
})().catch((e) => {
  console.error('prepare-profile-pick tests failed ❌', e);
  process.exit(1);
});

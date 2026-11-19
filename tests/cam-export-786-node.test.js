// tests/cam-export-786-node.test.js — TASK 786 (Shaper CAM EXPORT fixes from bug hunt 785). Pure: the downloaded Shaper SVG of small drawings.
//  0. #core/path-d (new: the signed area and the true bounds of a written path) against the independent reader of this file.
//  1. (hunt bug 1, CRITICAL) every exported COMPOUND path (a pocket with islands, an outline with holes, a stepped pocket's terraces) writes each hole
//     wound OPPOSITE to its outer loop, whatever the kinds of the loops (lines, a circle, arcs, a bezier): checked by an INDEPENDENT reading of the
//     written "d" (arcs from the SVG endpoint parameterisation, sampled; cubics sampled): each hole sub-path's signed area has the opposite sign to the
//     outer's, and under the default nonzero fill rule a point inside an island has winding 0 (not filled) while a point of the pocket has winding != 0.
//     No fill-rule attribute (Shaper Studio writes none: TASK 456).
//  2. (hunt bug 4, HIGH) the viewBox holds EVERY written element: arcs and cubics by their true extremes (sampled here), tabs' gap strips, a programmed
//     pocket's start mark near the edge, a stepped outside cut's deeper (larger) rings. A drawing whose elements were already inside keeps its header
//     byte for byte (the headers below were written by origin/main 7a217cb).
//  3. (hunt bug 6, MEDIUM) a programmed pocket's start mark is written as an UNFILLED guide (fill="none", the guide's blue stroke and attributes) and
//     comes AFTER its pocket's elements in the file, grouped (the download) or not, with a Stock guide in the file, with two pockets.
import assert from 'node:assert';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { makeProfile } from '#core/profile-model.js';
import { pathSignedArea, pathBounds } from '#core/path-d.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';

// every check runs; the failures are listed together at the end (so one run shows each bug)
let checks = 0;
const failures = [];
const ok = (c, m) => { checks++; if (!c) failures.push(m); };
const eq = (a, b, m) => { checks++; try { assert.deepStrictEqual(a, b); } catch { failures.push(`${m}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); } };

// ── drawing builders (base mm, y down) ──
let uid = 0;
const id = (p) => `${p}${++uid}`;
const newState = () => ({ joints: new Map(), shapes: [], constraints: [] });
const J = (st, x, y) => { const j = id('j'); st.joints.set(j, { x, y }); return j; };
function rect(st, x, y, w, h) {
  const js = [J(st, x, y), J(st, x + w, y), J(st, x + w, y + h), J(st, x, y + h)];
  const ids = js.map((a, i) => { const s = { id: id('l'), type: 'line', joints: [a, js[(i + 1) % 4]] }; st.shapes.push(s); return s.id; });
  return ids;
}
function circle(st, cx, cy, r) { const s = { id: id('c'), type: 'circle', joints: [J(st, cx, cy)], radius: r }; st.shapes.push(s); return [s.id]; }
function slot(st, x1, x2, cy, r) { // two lines + two half arcs (an arc loop: no circle shape)
  const c1 = J(st, x1, cy), c2 = J(st, x2, cy), tl = J(st, x1, cy - r), tr = J(st, x2, cy - r), br = J(st, x2, cy + r), bl = J(st, x1, cy + r);
  const ss = [{ id: id('l'), type: 'line', joints: [tl, tr] }, { id: id('a'), type: 'arc', joints: [c2, tr, br], sweep: true },
    { id: id('l'), type: 'line', joints: [br, bl] }, { id: id('a'), type: 'arc', joints: [c1, bl, tl], sweep: true }];
  st.shapes.push(...ss); return ss.map((s) => s.id);
}
function bezierBox(st, x, y, w, h, bulge) { // three lines + one cubic whose control points lie `bulge` above the top edge
  const a = J(st, x, y), b = J(st, x + w, y), c = J(st, x + w, y + h), d = J(st, x, y + h);
  const ss = [{ id: id('b'), type: 'bezier', joints: [a, b], c1: [x + w * 0.25, y - bulge], c2: [x + w * 0.75, y - bulge] },
    { id: id('l'), type: 'line', joints: [b, c] }, { id: id('l'), type: 'line', joints: [c, d] }, { id: id('l'), type: 'line', joints: [d, a] }];
  st.shapes.push(...ss); return ss.map((s) => s.id);
}
const loopOf = (st, shapeIds) => findLoops(st).find((l) => l.edges.length === shapeIds.length && shapeIds.every((s) => l.edges.includes(s)));
const svgOf = (st, entries, options = {}) => exportShaperSVG({ state: st, entries, encoding: exportEncoding(), docUnit: 'mm', options });
const POCKET = { cutType: 'pocket', cutDepth: 5, cutOffset: 0, toolDia: 6.35 };

// ── an INDEPENDENT reader of the written path data (absolute M L A C Z): sub-paths as dense polygons ──
function subpaths(d) {
  const t = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const out = []; let cur = null, i = 0, cmd = '', x = 0, y = 0;
  const n = () => Number(t[i++]);
  while (i < t.length) {
    if (/[A-Za-z]/.test(t[i])) { cmd = t[i++]; if (cmd === 'Z') { cur = null; } continue; }
    if (cmd === 'M') { x = n(); y = n(); cur = [{ x, y }]; out.push(cur); cmd = 'L'; continue; }
    if (cmd === 'L') { x = n(); y = n(); cur.push({ x, y }); continue; }
    if (cmd === 'A') {
      let r = n(); n(); n(); const fa = n(), fs = n(), ex = n(), ey = n();
      const dx = (x - ex) / 2, dy = (y - ey) / 2, d2 = dx * dx + dy * dy;
      if (d2 === 0) continue;
      if (r * r < d2) r = Math.sqrt(d2);
      const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - d2) / d2));
      const cx = co * dy + (x + ex) / 2, cy = -co * dx + (y + ey) / 2; // SVG 1.1 F.6.5 (rotation 0, rx = ry)
      const t1 = Math.atan2(y - cy, x - cx); let dt = Math.atan2(ey - cy, ex - cx) - t1;
      if (fs && dt < 0) dt += 2 * Math.PI; if (!fs && dt > 0) dt -= 2 * Math.PI;
      for (let k = 1; k <= 720; k++) cur.push({ x: cx + r * Math.cos(t1 + (dt * k) / 720), y: cy + r * Math.sin(t1 + (dt * k) / 720) });
      cur[cur.length - 1] = { x: ex, y: ey }; x = ex; y = ey; continue;
    }
    if (cmd === 'C') {
      const x1 = n(), y1 = n(), x2 = n(), y2 = n(), ex = n(), ey = n();
      for (let k = 1; k <= 400; k++) { const s = k / 400, u = 1 - s; cur.push({ x: u * u * u * x + 3 * u * u * s * x1 + 3 * u * s * s * x2 + s * s * s * ex, y: u * u * u * y + 3 * u * u * s * y1 + 3 * u * s * s * y2 + s * s * s * ey }); }
      x = ex; y = ey; continue;
    }
    throw new Error(`test reader: command ${cmd}`);
  }
  return out;
}
const area = (p) => { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j].x * p[i].y - p[i].x * p[j].y; return a / 2; };
function winding(polys, q) { // nonzero winding number of the point q over every closed sub-path
  let w = 0;
  for (const p of polys) for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[j], b = p[i];
    if (a.y <= q.y) { if (b.y > q.y && (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y) > 0) w++; }
    else if (b.y <= q.y && (b.x - a.x) * (q.y - a.y) - (q.x - a.x) * (b.y - a.y) < 0) w--;
  }
  return w;
}
const pocketD = (svg) => { const m = svg.match(/<path d="([^"]+)"[^>]*shaper:cutType="pocket"/) || svg.match(/<g[^>]*shaper:cutType="pocket"[^>]*>\s*<path d="([^"]+)"/); return m ? m[1] : null; };

// ── 0. #core/path-d (the exporter's reader of its own paths) agrees with the independent reader above ──
{
  const ds = [
    'M 0 0 L 100 0 L 100 80 L 0 80 Z', 'M 0 0 L 0 80 L 100 80 L 100 0 Z',
    'M 0 50 A 50 50 0 1 0 100 50 A 50 50 0 1 0 0 50 Z', 'M 0 50 A 50 50 0 1 1 100 50 A 50 50 0 1 1 0 50 Z',
    'M 40 10 L 120 10 A 40 40 0 0 1 120 90 L 40 90 A 40 40 0 0 1 40 10 Z', 'M 0 40 C 30 10 90 10 120 40 L 120 120 L 0 120 Z',
    'M 35 55 L 35 85 L 85 85 L 85 55 C 72.5 40 47.5 40 35 55 Z', 'M 10 10 A 30 30 0 0 0 50 20 L 60 60 Z', 'M 10 10 A 5 5 0 0 1 60 10 Z', // a radius too small for its chord (scaled up, as SVG)
  ];
  for (const d of ds) {
    const subs = subpaths(d), want = subs.reduce((t, p) => t + area(p), 0), got = pathSignedArea(d);
    ok(Math.abs(got - want) <= Math.abs(want) * 1e-4 + 1e-6, `pathSignedArea(${d}) = ${got}, sampled ${want}`);
    const pts = subs.flat(), b = pathBounds(d);
    const box = [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))];
    ok([b.minX, b.minY, b.maxX, b.maxY].every((v, i) => Math.abs(v - box[i]) < 1e-2), `pathBounds(${d}) = ${JSON.stringify(b)}, sampled ${box}`);
  }
  for (const bad of ['m 0 0 l 1 1', 'M 0 0 H 10', 'M 0 0 A 5 6 0 0 1 10 0', 'M 0 0 Q 1 1 2 2']) {
    let threw = false; try { pathSignedArea(bad); } catch { threw = true; }
    ok(threw, `path-d refuses a path #core does not write: ${bad}`);
  }
}

// ── 1. compound paths: each hole wound opposite to its outer, whatever the loop kinds ──
{
  // [name, build(st) -> { outer: shapeIds, islands: [[shapeIds, interior point]], wall: a point of the pocket outside every island }]
  const cases = [
    ['rect pocket + rect island', (st) => ({ outer: rect(st, 0, 0, 100, 80), islands: [[rect(st, 30, 20, 40, 30), [50, 35]]], wall: [10, 10] })],
    ['circle pocket + rect island', (st) => ({ outer: circle(st, 50, 50, 50), islands: [[rect(st, 35, 35, 30, 30), [50, 50]]], wall: [50, 10] })],
    ['rect pocket + circle island', (st) => ({ outer: rect(st, 0, 0, 100, 100), islands: [[circle(st, 50, 50, 20), [50, 50]]], wall: [10, 10] })],
    ['circle pocket + circle island', (st) => ({ outer: circle(st, 50, 50, 50), islands: [[circle(st, 50, 50, 20), [50, 50]]], wall: [50, 10] })],
    ['rect pocket + arc-slot island', (st) => ({ outer: rect(st, 0, 0, 140, 80), islands: [[slot(st, 40, 100, 40, 15), [70, 40]]], wall: [10, 10] })],
    ['circle pocket + arc-slot island', (st) => ({ outer: circle(st, 70, 70, 70), islands: [[slot(st, 40, 100, 70, 12), [70, 70]]], wall: [70, 10] })],
    ['rect pocket + bezier island', (st) => ({ outer: rect(st, 0, 0, 120, 120), islands: [[bezierBox(st, 30, 50, 60, 40, 20), [60, 45]]], wall: [10, 10] })],
    ['circle pocket + bezier island', (st) => ({ outer: circle(st, 60, 60, 60), islands: [[bezierBox(st, 35, 55, 50, 30, 15), [60, 50]]], wall: [60, 8] })],
    ['bezier pocket + circle island', (st) => ({ outer: bezierBox(st, 0, 40, 120, 80, 30), islands: [[circle(st, 60, 80, 20), [60, 80]]], wall: [10, 110] })],
    ['slot pocket + circle island', (st) => ({ outer: slot(st, 40, 120, 50, 40), islands: [[circle(st, 80, 50, 15), [80, 50]]], wall: [80, 20] })],
    ['rect pocket + two islands of different kinds (circle, rect)', (st) => ({ outer: rect(st, 0, 0, 160, 80), islands: [[circle(st, 40, 40, 20), [40, 40]], [rect(st, 90, 20, 50, 40), [115, 40]]], wall: [70, 10] })],
    ['circle pocket + two islands of different kinds (rect, arc slot)', (st) => ({ outer: circle(st, 100, 100, 100), islands: [[rect(st, 60, 40, 80, 30), [100, 55]], [slot(st, 70, 130, 140, 15), [100, 140]]], wall: [100, 100] })],
  ];
  for (const [name, build] of cases) {
    const st = newState();
    const c = build(st);
    const outer = loopOf(st, c.outer);
    const svg = svgOf(st, [{ target: { kind: 'loop', id: outer.id }, rec: POCKET }]);
    const d = pocketD(svg);
    ok(d, `${name}: a pocket path was written: ${svg}`);
    ok(!/fill-rule/.test(svg), `${name}: no fill-rule attribute (Studio parity, TASK 456)`);
    const subs = subpaths(d);
    eq(subs.length, 1 + c.islands.length, `${name}: one sub-path for the outer and one per island`);
    const a0 = area(subs[0]);
    for (let k = 1; k < subs.length; k++) ok(Math.sign(area(subs[k])) === -Math.sign(a0), `${name}: hole ${k} wound OPPOSITE to the outer (signed areas ${a0.toFixed(1)} / ${area(subs[k]).toFixed(1)}): ${d}`);
    for (const [, [x, y]] of c.islands) eq(winding(subs, { x, y }), 0, `${name}: the island at ${x},${y} is NOT filled under nonzero`);
    ok(winding(subs, { x: c.wall[0], y: c.wall[1] }) !== 0, `${name}: the pocket at ${c.wall} is filled`);
  }

  // an OUTLINE with holes: a combined profile (circle outer + rect hole, rect outer + circle and slot holes) cut as a pocket (an outside / inside cut
  // of a profile writes its holes as their own elements: not a compound path)
  for (const [name, build] of [
    ['combined profile: circle outer + rect hole', (st) => ({ outer: circle(st, 50, 50, 50), holes: [[rect(st, 35, 35, 30, 30), [50, 50]]] })],
    ['combined profile: rect outer + circle hole + slot hole', (st) => ({ outer: rect(st, 0, 0, 160, 100), holes: [[circle(st, 40, 50, 20), [40, 50]], [slot(st, 90, 130, 50, 12), [110, 50]]] })],
  ]) {
    const st = newState();
    const c = build(st);
    const p = makeProfile(st, loopOf(st, c.outer), c.holes.map(([ids]) => loopOf(st, ids)));
    for (const cutType of ['pocket']) {
      const svg = svgOf(st, [{ target: { kind: 'profile', id: p.id }, rec: { ...POCKET, cutType } }]);
      const d = (svg.match(/<path d="([^"]+)"/) || [])[1];
      const subs = subpaths(d);
      eq(subs.length, 1 + c.holes.length, `${name} (${cutType}): one compound path: ${svg}`);
      for (let k = 1; k < subs.length; k++) ok(Math.sign(area(subs[k])) === -Math.sign(area(subs[0])), `${name} (${cutType}): hole ${k} wound opposite: ${d}`);
      for (const [, [x, y]] of c.holes) eq(winding(subs, { x, y }), 0, `${name} (${cutType}): the hole at ${x},${y} is not filled`);
    }
  }

  // a STEPPED pocket's terraces keep the islands (#core/stepped-cut deriveCuts): each terrace's holes wound opposite to that terrace's outline
  const lines = (pts) => pts.map((p, i) => ({ type: 'line', x1: p[0], y1: p[1], x2: pts[(i + 1) % pts.length][0], y2: pts[(i + 1) % pts.length][1] }));
  for (const [name, build, rings] of [
    ['stepped pocket: rect terraces + circle island', (st) => ({ outer: rect(st, 0, 0, 100, 100), islands: [[circle(st, 50, 50, 15), [50, 50]]] }),
      [{ z: 0, segments: lines([[0, 0], [100, 0], [100, 100], [0, 100]]) }, { z: 4, segments: lines([[4, 4], [96, 4], [96, 96], [4, 96]]) }]],
    ['stepped pocket: rect terraces (other walk direction) + circle island', (st) => ({ outer: rect(st, 0, 0, 100, 100), islands: [[circle(st, 50, 50, 15), [50, 50]]] }),
      [{ z: 0, segments: lines([[0, 0], [0, 100], [100, 100], [100, 0]]) }, { z: 4, segments: lines([[4, 4], [4, 96], [96, 96], [96, 4]]) }]],
    ['stepped pocket: circle terraces + rect island', (st) => ({ outer: circle(st, 50, 50, 50), islands: [[rect(st, 40, 40, 20, 20), [50, 50]]] }),
      [{ z: 0, segments: [{ type: 'circle', cx: 50, cy: 50, r: 50 }] }, { z: 4, segments: [{ type: 'circle', cx: 50, cy: 50, r: 46 }] }]],
    ['stepped pocket: circle terraces + circle island', (st) => ({ outer: circle(st, 50, 50, 50), islands: [[circle(st, 50, 50, 10), [50, 50]]] }),
      [{ z: 0, segments: [{ type: 'circle', cx: 50, cy: 50, r: 50 }] }, { z: 4, segments: [{ type: 'circle', cx: 50, cy: 50, r: 46 }] }]],
  ]) {
    const st = newState();
    const c = build(st);
    const outer = loopOf(st, c.outer);
    const svg = svgOf(st, [{ target: { kind: 'loop', id: outer.id }, rec: { cutType: 'stepped-pocket', cutDepth: 4, stepDepth: 2, cutOffset: 0, toolDia: 6.35, slope: { kind: 'pocket', label: 'draft', rings } } }], {});
    const ds = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    ok(ds.length >= 2, `${name}: two terraces or more: ${svg}`);
    for (const d of ds) {
      const subs = subpaths(d);
      eq(subs.length, 2, `${name}: each terrace keeps its island: ${d}`);
      ok(Math.sign(area(subs[1])) === -Math.sign(area(subs[0])), `${name}: the island wound opposite to the terrace: ${d}`);
      eq(winding(subs, { x: c.islands[0][1][0], y: c.islands[0][1][1] }), 0, `${name}: the island is not filled`);
    }
  }
}

// ── 2. the viewBox holds every written element (true extremes) ──
function elementBox(tag, attrs) {
  if (tag === 'circle') { const [cx, cy, r] = ['cx', 'cy', 'r'].map((k) => Number(attrs.match(new RegExp(`\\b${k}="([^"]+)"`))[1])); return [cx - r, cy - r, cx + r, cy + r]; }
  if (tag === 'polygon') { const v = attrs.match(/points="([^"]+)"/)[1].split(/[ ,]+/).map(Number); const xs = v.filter((_, i) => i % 2 === 0), ys = v.filter((_, i) => i % 2); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; }
  const pts = subpaths(attrs.match(/(?:^|\s)d="([^"]+)"/)[1]).flat();
  return [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))];
}
function assertInsideViewBox(svg, name) {
  const [minX, minY, w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(' ').map(Number);
  const els = [...svg.matchAll(/<(path|circle|polygon)\b([^>]*)\/>/g)];
  ok(els.length > 0, `${name}: elements written`);
  const T = 2e-4; // the file's 4 decimals
  for (const [, tag, attrs] of els) {
    const [x0, y0, x1, y1] = elementBox(tag, attrs);
    ok(x0 >= minX - T && y0 >= minY - T && x1 <= minX + w + T && y1 <= minY + h + T, `${name}: <${tag}> box ${[x0, y0, x1, y1].map((v) => v.toFixed(4))} inside viewBox ${minX} ${minY} ${w} ${h}`);
  }
  return { minX, minY, w, h };
}
{
  // a slot outline (its half arcs bulge past every joint, no circle shape)
  { const st = newState(); const s = slot(st, 30, 100, 50, 20); const vb = assertInsideViewBox(svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, s).id }, rec: { ...POCKET, cutType: 'exterior' } }]), 'slot outline');
    eq([vb.minX, vb.w], [10, 110], 'slot outline: the viewBox spans the arcs (x 10..120), not the joints (30..100)'); }
  // a circle pocket with an island: the circle written as two half arcs inside a compound path; and an On line circle
  { const st = newState(); const o = circle(st, 50, 50, 40); rect(st, 40, 40, 20, 20); assertInsideViewBox(svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, o).id }, rec: POCKET }]), 'circle pocket + island'); }
  // a bezier whose control points lie far above its ends
  { const st = newState(); const b = bezierBox(st, 0, 50, 100, 50, 60); const vb = assertInsideViewBox(svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, b).id }, rec: { ...POCKET, cutType: 'exterior' } }]), 'bezier outline');
    ok(Math.abs(vb.minY - 5) < 1e-3, `bezier outline: the viewBox top is the curve's top (y 5 = 50 - 0.75 x 60), not its control points (-10) nor its ends (50): ${vb.minY}`); }
  // tabs on an OUTSIDE cut: the gap strips are cut outside the outline
  { const st = newState(); const r = rect(st, 0, 0, 100, 100); assertInsideViewBox(svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, r).id }, rec: { cutType: 'exterior', cutDepth: 10, cutOffset: 0, toolDia: 6.35, holdPart: 'tabs', tabCount: 4, tabWidth: 10, holdThickness: 2 } }]), 'outside cut with tabs'); }
  // a programmed pocket with its start mark near the edge (a narrow pocket: the mark spans 2 x the bit)
  { const st = newState(); const r = rect(st, 0, 0, 8, 50); const svg = svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, r).id }, rec: { ...POCKET, clearing: 'linked', stepover: 40, finishAllowance: 0.5 } }]);
    ok(/shaper:cutType="guide"/.test(svg), 'narrow programmed pocket: a start mark is written'); assertInsideViewBox(svg, 'narrow programmed pocket + start mark'); }
  // a stepped OUTSIDE cut whose deeper ring is larger than the drawing
  { const st = newState(); const c = circle(st, 50, 50, 20);
    const slope = { kind: 'outside', label: 'chamfer', rings: [{ z: 0, segments: [{ type: 'circle', cx: 50, cy: 50, r: 20 }] }, { z: 5, segments: [{ type: 'circle', cx: 50, cy: 50, r: 30 }] }] };
    const vb = assertInsideViewBox(svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, c).id }, rec: { cutType: 'stepped-outside', cutDepth: 5, stepDepth: 2.5, cutOffset: 0, toolDia: 6.35, slope } }]), 'stepped outside');
    eq([vb.minX, vb.w], [20, 60], 'stepped outside: the viewBox spans the deepest ring (x 20..80)'); }
  // with the datum triangle
  { const st = newState(); const s = slot(st, 30, 100, 50, 20); assertInsideViewBox(svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, s).id }, rec: { ...POCKET, cutType: 'exterior' } }], { datum: true }), 'slot + datum'); }

  // byte-identical headers where every element already lay inside the drawing's joints / circles (written by origin/main 7a217cb)
  const same = [
    ['rect outline', (st) => rect(st, 0, 0, 60, 40), { ...POCKET, cutType: 'exterior' }, {}, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="40mm" viewBox="0 0 60 40">'],
    ['circle pocket', (st) => circle(st, 10, 20, 7.5), POCKET, {}, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="15mm" height="15mm" viewBox="2.5 12.5 15 15">'],
    ['rect pocket with a circle island', (st) => { const r = rect(st, 0, 0, 100, 80); circle(st, 50, 40, 20); return r; }, POCKET, {}, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="100mm" height="80mm" viewBox="0 0 100 80">'],
    ['rect outline + datum', (st) => rect(st, 5, 5, 60, 40), { ...POCKET, cutType: 'exterior' }, { datum: true }, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="65mm" height="45mm" viewBox="0 0 65 45">'],
    ['rect programmed pocket (Spiral, Loop on: the start mark well inside)', (st) => rect(st, 0, 0, 60, 40), { ...POCKET, clearing: 'linked', loop: true, stepover: 40, finishAllowance: 0.5 }, {}, '<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper" width="60mm" height="40mm" viewBox="0 0 60 40">'],
  ];
  for (const [name, build, rec, options, header] of same) {
    const st = newState(); const ids = build(st);
    const svg = svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, ids).id }, rec }], options);
    eq(svg.split('\n')[0], header, `${name}: the header is byte-identical to origin/main's`);
    assertInsideViewBox(svg, name);
  }
}

// ── 3. the pocket start mark: an unfilled guide, after its pocket ──
{
  const PROG = { ...POCKET, clearing: 'linked', stepover: 40, finishAllowance: 0.5 };
  const isMark = (l) => /d="M [^"]+ A [^"]+ A [^"]+ Z M [^"]+ L [^"]+ M [^"]+ L [^"]+"/.test(l); // circle + cross (#core/pocket-clearing startMarkPathD)
  const elements = (svg) => svg.split('\n').filter((l) => /^\s*<(path|circle)\b/.test(l));
  const groupOf = (svg, el) => { const L = svg.split('\n'); const i = L.indexOf(el); const open = L.slice(0, i).reverse().find((l) => /^\s*<\/?g\b/.test(l)); return open && /^\s*<g\b/.test(open) ? open : null; };
  for (const [name, rec] of [['Spiral, Loop off', { ...PROG, loop: false }], ['Spiral, Loop on', { ...PROG, loop: true }], ['Raster', { ...PROG, clearing: 'raster' }]]) {
    for (const options of [{}]) {
      const st = newState(); const r = rect(st, 0, 0, 60, 40);
      const stock = rect(st, -10, -10, 80, 60);
      const svg = svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, stock).id }, rec: { cutType: 'stock', cutOffset: 0, toolDia: 6.35 } }, { target: { kind: 'loop', id: loopOf(st, r).id }, rec }], options);
      const tag = `${name}, flat`;
      const els = elements(svg);
      const marks = els.filter(isMark);
      eq(marks.length, 1, `${tag}: one start mark:\n${svg}`);
      const mark = marks[0] || '';
      ok(/fill="none"/.test(mark) && /stroke="#0068FF"/.test(mark) && /shaper:cutType="guide"/.test(mark), `${tag}: the start mark is a stroke-only guide on its own element (fill none, the guide's blue stroke and type): ${mark}\n${groupOf(svg, mark) || ''}`);
      eq(els.indexOf(mark), els.length - 1, `${tag}: the start mark is the last element (after its pocket's clearing paths and wall, after the Stock):\n${svg}`);
      ok(!/0068FF/.test(groupOf(svg, mark) || ''), `${tag}: the start mark is not hoisted into the Stock's guide group:\n${svg}`);
    }
  }
  // two programmed pockets (the same bit, Loop off): each mark comes after ITS pocket's wall
  {
    const st = newState(); const a = rect(st, 0, 0, 60, 40), b = rect(st, 100, 0, 60, 40);
    const svg = svgOf(st, [{ target: { kind: 'loop', id: loopOf(st, a).id }, rec: { ...PROG, loop: false } }, { target: { kind: 'loop', id: loopOf(st, b).id }, rec: { ...PROG, loop: false } }]);
    const els = elements(svg);
    const marks = els.map((l, i) => (isMark(l) ? i : -1)).filter((i) => i >= 0);
    const walls = els.map((l, i) => (/<path d="M (0|100) 0 L/.test(l) ? i : -1)).filter((i) => i >= 0);
    eq([marks.length, walls.length], [2, 2], `two pockets: two marks, two walls:\n${svg}`);
    ok(marks[0] > walls[0] && marks[1] > walls[1], `two pockets: each start mark after its own pocket's wall (marks ${marks}, walls ${walls}):\n${svg}`);
    ok(marks.every((i) => /fill="none"/.test(els[i]) && !groupOf(svg, els[i])), `two pockets: each mark written in place with its own fill="none" (never hoisted into a <g>):\n${svg}`);
  }
}

if (failures.length) {
  for (const f of failures) console.log('FAIL ' + f);
  assert.fail(`cam-export-786-node: ${failures.length} of ${checks} checks failed`);
}
console.log(`cam-export-786-node: ${checks} checks passed`);

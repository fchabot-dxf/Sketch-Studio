// tests/angle-label-beside-arc.test.js — TASK 634: with plain labels an angle value sits beside its arc (same gap as a linear
// value beside its line), never struck through by the arc; the label-box (Default) markup is unchanged.
import assert from 'node:assert';
import SettingsManager from '#core/settings-manager.js';
import { TOOL_MODES } from '#core/constants.js';
import { draw } from '#ui/svg-renderer.js';
import { dimTextWidth, DIM_TEXT_ASCENT } from '#ui/dim-placement.js';

const render = (joints, shapes, constraints, box) => {
  const prev = SettingsManager.get('DIM_LABEL_BOX');
  SettingsManager.set('DIM_LABEL_BOX', box);
  let html = '';
  const svg = {
    viewBox: { baseVal: { x: -400, y: -400, width: 1000, height: 1000 } },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    get innerHTML() { return html; }, set innerHTML(v) { html = v; }, style: {}, querySelectorAll: () => [], closest: () => null,
  };
  try { draw(joints, shapes, svg, null, null, constraints, new Set(), new Set(), TOOL_MODES.SELECT); return html; }
  finally { SettingsManager.set('DIM_LABEL_BOX', prev); }
};

// The oriented text box (baseline centre x,y; rotation; font size) of the value text, as sample points covering its area.
const textBoxPoints = (html, value) => {
  const m = html.match(new RegExp(`<text x="([-\\d.e]+)" y="([-\\d.e]+)"(?: transform="rotate\\(([-\\d.e]+) [^)]*\\)")? text-anchor="middle" font-size="([-\\d.e]+)"[^>]*>${value}</text>`));
  assert(m, `value text ${value} found`);
  const [x, y, deg, fs] = [+m[1], +m[2], +(m[3] || 0), +m[4]];
  const r = deg * Math.PI / 180, ux = Math.cos(r), uy = Math.sin(r), nx = Math.sin(r), ny = -Math.cos(r);
  const hw = dimTextWidth(value, fs) / 2, h = fs * DIM_TEXT_ASCENT, pts = [];
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 4; j++) {
    const a = -hw + (2 * hw * i) / 20, b = (h * j) / 4;
    pts.push({ x: x + ux * a + nx * b, y: y + uy * a + ny * b });
  }
  return pts;
};
const minGap = (pts, curve) => Math.min(...pts.map((p) => Math.min(...curve.map((q) => Math.hypot(p.x - q.x, p.y - q.y)))));

// Arc: centre o, radius 45 from the first joint to the second, sampled finely
const joints = new Map([['o', { id: 'o', x: 0, y: 0 }], ['a', { id: 'a', x: 100, y: 0 }], ['b', { id: 'b', x: 60, y: 80 }]]);
const shapes = [{ id: 'l1', type: 'line', joints: ['o', 'a'] }, { id: 'l2', type: 'line', joints: ['o', 'b'] }];
const angle = () => ({ id: 'dang', type: 'angle', shapes: ['l1', 'l2'], value: 53.130102, sector: { s1: 1, s2: 1 }, offset: 45 });
const sampleArc = (html) => {
  const m = html.match(/<path d="M ([-\d.e]+) ([-\d.e]+) A ([-\d.e]+) [-\d.e]+ 0 ([01]) 1 ([-\d.e]+) ([-\d.e]+)"/);
  const [sx, sy, r, ex, ey] = [+m[1], +m[2], +m[3], +m[5], +m[6]];
  const a0 = Math.atan2(sy, sx); let d = Math.atan2(ey, ex) - a0; while (d < 0) d += 2 * Math.PI;
  return Array.from({ length: 721 }, (_, i) => ({ x: Math.cos(a0 + d * i / 720) * r, y: Math.sin(a0 + d * i / 720) * r }));
};

const angleHtml = render(joints, shapes, [angle()], false);
const arc = sampleArc(angleHtml);
const angleGap = minGap(textBoxPoints(angleHtml, '53.1°'), arc);

// the linear gap: a horizontal distance dimension's value beside its line
const lj = new Map([['a', { id: 'a', x: 0, y: 0 }], ['b', { id: 'b', x: 100, y: 0 }]]);
const lineHtml = render(lj, [{ id: 'l', type: 'line', joints: ['a', 'b'] }], [{ id: 'dh', type: 'distance', joints: ['a', 'b'], dimMode: 'horizontal', value: 100, offset: 40 }], false);
const lineGap = minGap(textBoxPoints(lineHtml, '100.0'), Array.from({ length: 1001 }, (_, i) => ({ x: i / 10, y: 40 })));

assert(angleGap > 0.5, `angle text clear of the arc (gap ${angleGap})`);
assert(Math.abs(angleGap - lineGap) <= 0.5, `angle gap ${angleGap} equals linear gap ${lineGap} within 0.5`);

// Default (label box): the value is centred on the arc anchor, exactly as before
const boxHtml = render(joints, shapes, [angle()], true);
assert(/<rect[^>]*\/>\s*<text x="[-\d.e]+" y="[-\d.e]+" text-anchor="middle"/.test(boxHtml), 'label box keeps the plain centred <text> after its <rect>');
assert(!/<text [^>]*transform=/.test(boxHtml), 'label box angle text is not rotated');

console.log('angle-label-beside-arc OK, gaps', angleGap.toFixed(2), lineGap.toFixed(2));

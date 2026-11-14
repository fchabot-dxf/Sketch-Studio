// tests/radius-diameter-label-beside-leader.test.js — TASK 636: with plain labels a radius / diameter value sits beside its
// leader line (same gap as a linear value beside its line), never struck through by it; label-box (Default) markup unchanged.
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
const segment = (x1, y1, x2, y2) => Array.from({ length: 1001 }, (_, i) => ({ x: x1 + (x2 - x1) * i / 1000, y: y1 + (y2 - y1) * i / 1000 }));

// The leader: the thick (1.5) <line> whose end is the label anchor
const leaderOf = (html) => {
  const m = [...html.matchAll(/<line x1="([-\d.e]+)" y1="([-\d.e]+)" x2="([-\d.e]+)" y2="([-\d.e]+)" style="stroke:[^"]*" stroke-width="1.5"/g)];
  assert(m.length, 'leader line found');
  return m[0].slice(1).map(Number);
};

const joints = new Map([['o', { id: 'o', x: 0, y: 0 }], ['r', { id: 'r', x: 50, y: 0 }]]);
const shapes = [{ id: 'c1', type: 'circle', joints: ['o', 'r'], radius: 50 }];
const radiusC = (extra) => ({ id: 'dr', type: 'distance', isRadius: true, shape: 'c1', joints: ['o', 'r'], value: 50, offset: 90, labelAngle: Math.PI / 6, ...extra });

const lj = new Map([['a', { id: 'a', x: 0, y: 0 }], ['b', { id: 'b', x: 100, y: 0 }]]);
const lineHtml = render(lj, [{ id: 'l', type: 'line', joints: ['a', 'b'] }], [{ id: 'dh', type: 'distance', joints: ['a', 'b'], dimMode: 'horizontal', value: 100, offset: 40 }], false);
const lineGap = minGap(textBoxPoints(lineHtml, '100.0'), segment(0, 40, 100, 40));

// A diameter dimension (dimMode 'diameter') has no leader branch of its own: it is drawn by the linear dimension code
const dj = new Map([['a', { id: 'a', x: -50, y: 0 }], ['b', { id: 'b', x: 50, y: 0 }]]);
const diaHtml = render(dj, [{ id: 'l', type: 'line', joints: ['a', 'b'] }], [{ id: 'dd', type: 'distance', joints: ['a', 'b'], dimMode: 'diameter', value: 100, offset: 40 }], false);
const diaM = diaHtml.match(/<text x="([-\d.e]+)" y="([-\d.e]+)"[^>]*>([^<]*)<\/text>/);
assert(diaM, 'diameter value drawn');
const diaGap = minGap(textBoxPoints(diaHtml, diaM[3]), segment(-50, 40, 50, 40));
console.log('diameter gap', diaGap.toFixed(2), 'linear', lineGap.toFixed(2));
assert(Math.abs(diaGap - lineGap) <= 0.5, `diameter gap ${diaGap} equals linear gap ${lineGap}`);

for (const [name, extra, value] of [['radius', {}, 'R 50.0']]) {
  const html = render(joints, shapes, [radiusC(extra)], false);
  const [x1, y1, x2, y2] = leaderOf(html);
  const gap = minGap(textBoxPoints(html, value), segment(x1, y1, x2, y2));
  console.log(name, 'gap', gap.toFixed(2), 'linear', lineGap.toFixed(2));
  assert(gap > 0.5, `${name} text clear of its leader (gap ${gap})`);
  assert(Math.abs(gap - lineGap) <= 0.5, `${name} gap ${gap} equals linear gap ${lineGap} within 0.5`);

  const boxHtml = render(joints, shapes, [radiusC(extra)], true);
  assert(/<rect[^>]*\/>\s*<text x="[-\d.e]+" y="[-\d.e]+" text-anchor="middle"/.test(boxHtml), `${name} label box keeps the plain centred <text> after its <rect>`);
  assert(!/<text [^>]*transform=/.test(boxHtml), `${name} label box text is not rotated`);
}
console.log('radius-diameter-label-beside-leader OK');

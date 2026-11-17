// tests/bezier-pick-762-node.test.js — TASK 762: a BEZIER body is picked by THE shared pick (#ui/snap-detection.js findSnap), from its geometry as
// #core/curve-kinds.js CURVE_KINDS declares it; lines, arcs and circles are picked exactly as before.
//  1. LINE / ARC / CIRCLE PICK UNCHANGED: a scene of lines, arcs (both windings), circles, free joints and the origin, at 4 zooms (0.2, 1, 5 and 78 px
//     per world unit) and both reaches (mouse, touch boost): findSnap at every point of a 4 px screen grid, hashed per zoom and reach, equals the
//     digest written on origin/main 09ecfb3 BEFORE this task (tests/fixtures/bezier-pick-762/pick-digest.json; `node tests/bezier-pick-762-node.test.js
//     --write-digest` rewrites it, only ever on the base).
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findSnap, snapBoostFor } from '#ui/snap-detection.js';

const DIGEST_FILE = path.resolve('tests/fixtures/bezier-pick-762/pick-digest.json');
const WRITE = process.argv.includes('--write-digest');
const ZOOMS = [0.2, 1, 5, 78];
// a canvas whose centre (500, 500) is the world origin at `ppu` px per world unit
const svgAt = (ppu) => { const w = 1000 / ppu; return { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }), viewBox: { baseVal: { x: -w / 2, y: -w / 2, width: w, height: w } } }; };

// ── 1. the line / arc / circle scene (screen px / ppu = world), deterministic ──
let seed = 762;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
function lineArcScene(ppu) {
  seed = 762;
  const joints = new Map([['j_origin', { x: 0, y: 0, fixed: true }]]);
  const shapes = [];
  let n = 0;
  const J = (px, py) => { const id = 'j' + (++n); joints.set(id, { x: px / ppu, y: py / ppu }); return id; };
  for (let i = 0; i < 14; i++) shapes.push({ id: 'l' + i, type: 'line', joints: [J(rnd() * 800 - 400, rnd() * 800 - 400), J(rnd() * 800 - 400, rnd() * 800 - 400)] });
  for (let i = 0; i < 8; i++) {
    const cx = rnd() * 700 - 350, cy = rnd() * 700 - 350, r = 30 + rnd() * 120, a0 = rnd() * 2 * Math.PI, a1 = a0 + 0.4 + rnd() * 4.5;
    shapes.push({ id: 'a' + i, type: 'arc', subType: 'CENTER', sweep: i % 2 === 0, joints: [J(cx, cy), J(cx + r * Math.cos(a0), cy + r * Math.sin(a0)), J(cx + r * Math.cos(a1), cy + r * Math.sin(a1))] });
  }
  for (let i = 0; i < 4; i++) shapes.push({ id: 'c' + i, type: 'circle', joints: [J(rnd() * 700 - 350, rnd() * 700 - 350)], radius: (20 + rnd() * 100) / ppu });
  for (let i = 0; i < 6; i++) J(rnd() * 800 - 400, rnd() * 800 - 400); // free points
  return { joints, shapes };
}
const fmt = (r) => (r ? `${r.type}:${r.targetId}:${Number(r.x).toPrecision(12)}:${Number(r.y).toPrecision(12)}` : '-');
function pickDigest() {
  const out = {};
  for (const ppu of ZOOMS) {
    const svg = svgAt(ppu), { joints, shapes } = lineArcScene(ppu);
    for (const touch of [false, true]) {
      const h = crypto.createHash('sha256'), counts = {};
      for (let y = 100; y <= 900; y += 4) for (let x = 100; x <= 900; x += 4) {
        const r = findSnap(joints, shapes, svg, { x, y }, [], false, false, snapBoostFor(touch));
        const k = r ? r.type : 'none'; counts[k] = (counts[k] || 0) + 1;
        h.update(fmt(r) + '\n');
      }
      out[`${ppu}px/${touch ? 'touch' : 'mouse'}`] = { hash: h.digest('hex').slice(0, 24), counts };
    }
  }
  return out;
}

const digest = pickDigest();
if (WRITE) {
  fs.mkdirSync(path.dirname(DIGEST_FILE), { recursive: true });
  fs.writeFileSync(DIGEST_FILE, JSON.stringify(digest, null, 1) + '\n');
  console.log('wrote ' + DIGEST_FILE);
} else {
  const want = JSON.parse(fs.readFileSync(DIGEST_FILE, 'utf8'));
  assert.deepStrictEqual(digest, want, '1: line / arc / circle picks identical to the digest written before task 762');
}
console.log('bezier-pick-762-node: ALL CHECKS PASSED');

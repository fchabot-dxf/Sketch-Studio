// tests/stl-orient-808-node.test.js — TASK 808: ORIENT an STL by CLICKING ITS FLOOR FACE (owner turn 2641). Every mesh is BUILT IN THE TEST.
//  1. THE ROTATION FOR A FACE NORMAL: axis-aligned (an Up side's preset: the same rotation) and tilted 30 degrees (the shortest arc): a proper rotation
//     (orthonormal, determinant +1) that takes the normal to straight DOWN (0, 0, -1); a normal of any length / direction; no direction = null.
//  2. THE FLOOR FACE: the picked triangle widened to the connected triangles within 2 degrees of ITS normal (the block's big face = one face of many
//     triangles; a dome's face does not creep round the curve); the normal is the area-weighted mean, outward.
//  3. A BLOCK TILTED 30 DEGREES (about x, about y, about a slanted axis): click its big face -> the rotated mesh sits on z 0 and sliceStl gives the
//     SAME size and levels as the un-rotated block (within the grid tolerance); a face that cannot be a floor (a curved one) is accepted, its height computed.
//  4. THE UP PRESETS = THE CLICKED FACES: for every Up side the block's face on that side's bed, clicked, gives the Up preset's rotation and the very same
//     oriented mesh; the stored rotation round-trips through the document (clicked floor: up null + the picked normal; a preset; a document before 808).
//  5. THE APP: the importer's reslice({ orient }) replaces the design with the new orientation (one undo step), reslice({ up }) is the same stored rotation set
//     the other way, the card has the Orient row.
import assert from 'node:assert';
import { sliceStl, orientMesh, orientedBounds, floorFaceAt, rotationForFloor, orientationForUp, UP_ROTATIONS, STL_UP_SIDES, STL_ORIENT } from '#core/stl-slice.js';
import SettingsManager from '#core/settings-manager.js';
import * as M from './helpers/stl-mesh.js';
import { setStlSource, getStlSource, rememberMesh, captureStlDoc, applyStlDoc } from '../apps/shaper/src/stl-source.js';
import { open } from './helpers/node-app.js';
import { V2_PLAN } from './helpers/plan-v2.js'; // TASK S1: the test's v2 document of the plan, loaded through applyShaperDoc


let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
SettingsManager.set('DOC_UNIT', 'mm');

const mulV = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
const det = (R) => R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
const properRotation = (R, m) => {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) near(R[3 * i] * R[3 * j] + R[3 * i + 1] * R[3 * j + 1] + R[3 * i + 2] * R[3 * j + 2], i === j ? 1 : 0, 1e-12, `${m}: orthonormal ${i}${j}`);
  near(det(R), 1, 1e-12, `${m}: determinant +1`);
};
// the turn by `deg` about the unit axis `a` (Rodrigues), as a function on points: the test's way to tilt a mesh
const turn = (a, deg) => {
  const L = Math.hypot(...a), [x, y, z] = a.map((v) => v / L), c = Math.cos((deg * Math.PI) / 180), s = Math.sin((deg * Math.PI) / 180), t = 1 - c;
  const R = [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  return { R, fn: (px, py, pz) => mulV(R, [px, py, pz]) };
};
// the triangle of `tris` with the biggest area whose plane is perpendicular to `n` (either way round: the test helper's caps are wound by earcut, not by the
// outside), and the face round it seen FROM the side `n` points to (what a click on that side of the mesh gives the app: its `facing`)
const faceTriangle = (tris, n) => {
  let best = -1, area = 0;
  for (let t = 0; t < tris.length / 9; t++) {
    const o = 9 * t, u = [tris[o + 3] - tris[o], tris[o + 4] - tris[o + 1], tris[o + 5] - tris[o + 2]], v = [tris[o + 6] - tris[o], tris[o + 7] - tris[o + 1], tris[o + 8] - tris[o + 2]];
    const c = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], L = Math.hypot(...c);
    if (L > 0 && Math.abs(Math.abs(c[0] * n[0] + c[1] * n[1] + c[2] * n[2]) / L - 1) < 1e-6 && L > area) { area = L; best = t; }
  }
  return best;
};

const faceOf = (tris, n) => floorFaceAt(tris, faceTriangle(tris, n), { facing: n });
const block = M.blockPocketHole(); // 120 x 80 x 19, a pocket and a through hole; its bed is the -Z face
const flatBlock = M.lofted({ outer: [{ z: 19, pts: M.rect(0, 0, 120, 80) }, { z: 0, pts: M.rect(0, 0, 120, 80) }] });
const slice = (tris, o = {}) => { const r = sliceStl(tris, { name: 'part.stl', ...o }); assert.ok(r.ok, r.message); return r; };

// ── 1. THE ROTATION FOR A FACE NORMAL ────────────────────────────────────────────────────────
{
  const UP_FLOOR = { '+Z': [0, 0, -1], '-Z': [0, 0, 1], '+Y': [0, -1, 0], '-Y': [0, 1, 0], '+X': [-1, 0, 0], '-X': [1, 0, 0] };
  for (const id of STL_UP_SIDES) {
    const o = rotationForFloor(UP_FLOOR[id]);
    eq([o.up, o.rotation, o.floor], [id, [...UP_ROTATIONS[id]], UP_FLOOR[id]], `${id}: the axis-aligned floor face is the Up preset`);
    properRotation(o.rotation, id);
    eq(mulV(o.rotation, UP_FLOOR[id]).map((v) => Math.round(v * 1e9) / 1e9 + 0), [0, 0, -1], `${id}: its floor normal points straight down`);
    eq(orientationForUp(id), { up: id, rotation: [...UP_ROTATIONS[id]], floor: null }, `${id}: orientationForUp`);
  }
  // 30 degrees: the +Z face tilted by 30 degrees about x, and about a slanted axis; a normal of any length
  for (const [axis, label] of [[[1, 0, 0], 'x'], [[0, 1, 0], 'y'], [[1, 1, 0], 'x+y'], [[Math.cos(0.4), Math.sin(0.4), 0], 'slanted']]) {
    const n = turn(axis, 30).fn(0, 0, -1); // the bed's normal after the tilt
    for (const scale of [1, 7.5]) {
      const o = rotationForFloor(n.map((v) => v * scale));
      properRotation(o.rotation, `tilted ${label}`);
      const d = mulV(o.rotation, n);
      near(d[0], 0, 1e-12, `tilted ${label}: x`); near(d[1], 0, 1e-12, `tilted ${label}: y`); near(d[2], -1, 1e-12, `tilted ${label}: straight down`);
      eq(o.up, null, `tilted ${label}: not an Up side`);
      near(Math.hypot(...o.floor), 1, 1e-12, `tilted ${label}: the picked normal is kept, unit`);
    }
  }
  // any direction, not only a tilt about a horizontal axis: a normal 30 degrees off -Z toward a direction in plane
  for (const n of [[0.3, -0.4, -0.5], [-1, 2, 0.5], [0, 0.1, 1], [0.001, 0, 1]]) {
    const o = rotationForFloor(n), L = Math.hypot(...n), d = mulV(o.rotation, n.map((v) => v / L));
    properRotation(o.rotation, `normal ${n}`);
    near(d[0], 0, 1e-9, `normal ${n}: x`); near(d[1], 0, 1e-9, `normal ${n}: y`); near(d[2], -1, 1e-9, `normal ${n}: down`);
  }
  eq(rotationForFloor([0, 0, 0]), null, 'no direction: no rotation');
}

// ── 2. THE FLOOR FACE: connected, within 2 degrees of the picked triangle ──────────────────────
{
  const f = faceOf(block, [0, 0, -1]);
  ok(f && f.normal.every((v, i) => Math.abs(v - [0, 0, -1][i]) < 1e-9), 'the block\'s bed: its normal is -Z, outward');
  const bedTris = (() => { let k = 0; for (let t = 0; t < block.length / 9; t++) if (block[9 * t + 2] === 0 && block[9 * t + 5] === 0 && block[9 * t + 8] === 0) k++; return k; })();
  eq(f.triangles, bedTris, 'the whole bed (every triangle on z 0) is the face');
  const top = faceOf(block, [0, 0, 1]);
  ok(top.normal[2] > 0.999999, 'the top face is outward +Z');
  ok(top.triangles < block.length / 9, 'a face is not the whole mesh');
  // a dome: the picked triangle's face does not creep round the curve (neighbours differ by more than 2 degrees beyond the first rings)
  const dome = M.dome(30, 48, 64);
  const cap = faceOf(dome, [0, 0, -1]);
  ok(cap && cap.normal[2] < -0.999, 'the dome\'s base is a face');
  let side = -1;
  for (let t = 0; t < dome.length / 9 && side < 0; t++) { // a triangle on the curve, half way up
    const zc = (dome[9 * t + 2] + dome[9 * t + 5] + dome[9 * t + 8]) / 3;
    if (zc > 12 && zc < 18) side = t;
  }
  const curve = floorFaceAt(dome, side, { facing: [0.3, 0.3, 1] });
  ok(curve.triangles >= 1 && curve.triangles < 40, `a curved face stays small: ${curve.triangles} triangles`);
  eq(STL_ORIENT.coplanarDeg, 2, 'the declared band is 2 degrees');
  // a tilted neighbour inside the band is merged, outside it is not: two quads sharing an edge, 1 and 3 degrees apart
  const quad = (deg) => { const a = (deg * Math.PI) / 180; return new Float32Array([0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 0, 0, 10, 10, 0, 0, 10, 0,
    10, 0, 0, 20, 0, 10 * Math.sin(a), 20, 10, 10 * Math.sin(a), 10, 0, 0, 20, 10, 10 * Math.sin(a), 10, 10, 0]); };
  eq(floorFaceAt(quad(1), 0).triangles, 4, 'a neighbour 1 degree off is the same face');
  eq(floorFaceAt(quad(3), 0).triangles, 2, 'a neighbour 3 degrees off is not');
}

// ── 3. A BLOCK TILTED 30 DEGREES: click its big face ─────────────────────────────────────────────
{
  const straight = slice(block), shape = (r) => ({ size: r.info.sizeMm, n: r.payload.regions[0].levels.length, z: r.payload.regions[0].levels.map((l) => l.zFromTopMm), loops: r.payload.regions[0].levels.map((l) => l.loops.length) });
  for (const [axis, label] of [[[1, 0, 0], 'about x'], [[0, 1, 0], 'about y'], [[Math.cos(0.4), Math.sin(0.4), 0], 'about a slanted axis']]) {
    const { fn } = turn(axis, 30);
    const tilted = M.transformMesh(block, (x, y, z) => fn(x + 7, y - 3, z + 11)); // tilted and moved away from the origin
    const face = faceOf(tilted, fn(0, 0, -1));
    ok(face, `${label}: the tilted bed is found`);
    const o = rotationForFloor(face.normal);
    // the bed's outward normal points straight down after the turn, and the mesh sits on z 0
    const b = orientedBounds(tilted, { rotation: o.rotation });
    near(b.minZ, b.minZ, 0, 'bounds');
    const P = orientMesh(tilted, { rotation: o.rotation }).P;
    let lo = Infinity, hi = -Infinity, minX = Infinity, minY = Infinity;
    for (let i = 0; i < P.length; i += 3) { lo = Math.min(lo, P[i + 2]); hi = Math.max(hi, P[i + 2]); minX = Math.min(minX, P[i]); minY = Math.min(minY, P[i + 1]); }
    near(lo, 0, 1e-9, `${label}: the floor is at z 0`); near(hi, 19, 1e-3, `${label}: the part is 19 mm tall`); near(minX, 0, 1e-9, `${label}: min x 0`); near(minY, 0, 1e-9, `${label}: min y 0`);
    const r = slice(tilted, { rotation: o.rotation });
    const want = shape(straight), got = shape(r);
    near(got.size.x, want.size.x, 1e-3, `${label}: width`); near(got.size.y, want.size.y, 1e-3, `${label}: length`); near(got.size.z, want.size.z, 1e-3, `${label}: height`);
    eq(got.n, want.n, `${label}: the same number of levels`);
    got.z.forEach((z, i) => near(z, want.z[i], 0.011, `${label}: level ${i} depth`));
    eq(got.loops, want.loops, `${label}: the same loops at every level`);
    near(r.payload.stock.thicknessMm, straight.payload.stock.thicknessMm, 1e-3, `${label}: the same board`);
    near(r.payload.regions[0].depthMm, 19, 1e-3, `${label}: depth`);
  }
  // a face that cannot be a floor (a curved one): accepted, the height is simply computed (the dome on its side: the cap's rim)
  const dome = M.dome(30, 48, 64);
  let side = -1;
  for (let t = 0; t < dome.length / 9 && side < 0; t++) { const zc = (dome[9 * t + 2] + dome[9 * t + 5] + dome[9 * t + 8]) / 3; if (zc > 12 && zc < 18) side = t; }
  const o = rotationForFloor(floorFaceAt(dome, side, { facing: [0.3, 0.3, 1] }).normal);
  const r = slice(dome, { rotation: o.rotation });
  ok(r.ok && r.info.sizeMm.z > 0, 'a curved face is a floor all the same');
  const b = orientedBounds(dome, { rotation: o.rotation });
  near(r.info.sizeMm.z, b.maxZ - b.minZ, 1e-6, 'its height is simply computed from the rotated mesh');
}

// ── 4. THE UP PRESETS = THE CLICKED FACES; THE ROTATION ROUND-TRIPS ──────────────────────────────
{
  const UP_FLOOR = { '+Z': [0, 0, -1], '-Z': [0, 0, 1], '+Y': [0, -1, 0], '-Y': [0, 1, 0], '+X': [-1, 0, 0], '-X': [1, 0, 0] };
  for (const id of STL_UP_SIDES) {
    const f = faceOf(flatBlock, UP_FLOOR[id]), o = rotationForFloor(f.normal);
    eq([o.up, o.rotation], [id, [...UP_ROTATIONS[id]]], `${id}: clicking that bed face is the preset`);
    eq(orientMesh(flatBlock, { rotation: o.rotation }), orientMesh(flatBlock, { up: id }), `${id}: the same oriented mesh`);
    const a = slice(flatBlock, { rotation: o.rotation }), b = slice(flatBlock, { up: id });
    eq(a.payload, b.payload, `${id}: the same payload`);
  }
  // the stored rotation round-trips through the document
  const tilted = M.transformMesh(block, turn([1, 0.3, 0], 30).fn);
  const o = rotationForFloor(faceOf(tilted, turn([1, 0.3, 0], 30).fn(0, 0, -1)).normal);
  const key = rememberMesh(tilted);
  setStlSource({ name: 'tilted.stl', up: o.up, rotation: o.rotation, floor: o.floor, unit: 'mm', triangles: tilted.length / 9, sizeMm: { x: 120, y: 80, z: 19 }, key });
  const [doc] = JSON.parse(JSON.stringify(captureStlDoc())); // TASK 841: the document keeps a list (one source per relief part)
  eq([doc.up, doc.rotation, doc.floor], [null, o.rotation, o.floor], 'the document keeps the rotation, the picked normal, and no Up side');
  setStlSource(null);
  applyStlDoc([doc]);
  const back = getStlSource();
  eq([back.up, back.rotation, back.floor], [null, o.rotation, o.floor], 'the stored rotation round-trips');
  eq(getStlSource().rotation === back.rotation, false, 'getStlSource hands out a copy');
  // a preset: the document says its Up side and the rotation is the preset's
  setStlSource({ name: 'p.stl', up: '+Y', unit: 'mm', triangles: 12, sizeMm: { x: 1, y: 1, z: 1 }, key: rememberMesh(flatBlock) });
  const [d2] = JSON.parse(JSON.stringify(captureStlDoc()));
  eq([d2.up, d2.rotation, 'floor' in d2], ['+Y', [...UP_ROTATIONS['+Y']], false], 'a preset: its Up side, its rotation, no picked normal');
  // a document before 808: `up` only
  const old = { name: 'old.stl', up: '-X', unit: 'in', sizeMm: { x: 1, y: 2, z: 3 }, mesh: d2.mesh, relief: true };
  applyStlDoc(old);
  eq([getStlSource().up, getStlSource().rotation, getStlSource().floor], ['-X', [...UP_ROTATIONS['-X']], null], 'a document before 808 opens with its Up side\'s rotation');
  applyStlDoc({ ...old, up: 'sideways', rotation: [1, 2, 3] });
  eq(getStlSource(), null, 'an unreadable orientation: no STL source (the design opens without its card)');
  setStlSource(null);
}

// ── 5. THE APP ──────────────────────────────────────────────────────────────────────────────────
{
  V2_PLAN.clear();
  const app = await open({ host: 'shaper' });
  try {
    const tilt = turn([1, 0, 0], 30);
    const tilted = M.transformMesh(block, tilt.fn);
    const res = app.stl.openFile(M.binaryStl(tilted), 'tilted.stl');
    ok(res.ok, 'Open STL: the tilted block opens as it is');
    const asOpened = getStlSource();
    ok(asOpened.sizeMm.z < 19 + 69.3 + 1 && asOpened.sizeMm.z > 50, `as opened: the tilted size (${asOpened.sizeMm.z.toFixed(1)} mm tall)`);
    eq(asOpened.up, '+Z', 'as opened: +Z up');
    eq([...app.document.querySelectorAll('.stl-card [data-row]')].map((r) => r.dataset.row), ['stlUp', 'stlOrient', 'stlUnits', 'stlSize'], 'the STL card: Up, Orient, Units, Size');
    eq(app.document.querySelector('.stl-card .stl-orient').textContent, 'Orient…', 'the Orient button');
    // the floor face clicked in the Orient view: Done -> reslice({ orient })
    const o = rotationForFloor(faceOf(tilted, tilt.fn(0, 0, -1)).normal);
    const r1 = app.stl.reslice({ orient: o });
    ok(r1.ok, 'Done: the design is sliced again');
    const s1 = getStlSource();
    eq([s1.up, s1.rotation, s1.floor], [null, o.rotation, o.floor], 'the source holds the rotation and the picked normal');
    near(s1.sizeMm.x, 120, 1e-3, 'width back to the block\'s'); near(s1.sizeMm.y, 80, 1e-3, 'length'); near(s1.sizeMm.z, 19, 1e-3, 'height');
    eq([...V2_PLAN.values()].map((r) => r.cutType), ['roughing'], 'the relief: one Roughing');
    near([...V2_PLAN.values()][0].cutDepth, 19, 1e-3, 'depth 19 mm (float noise under a micron)');
    eq(app.document.querySelectorAll('.stl-card .stl-ups .is-active').length, 0, 'no Up side is lit for a clicked floor');
    // undo restores the tilted import (one step)
    app.document.getElementById('btn-undo').click();
    const u = getStlSource();
    eq([u.up, u.rotation, u.sizeMm.z.toFixed(3)], ['+Z', [...UP_ROTATIONS['+Z']], asOpened.sizeMm.z.toFixed(3)], 'Undo restores it as it was: ONE step');
    // the Up buttons set the same stored rotation
    const r2 = app.stl.reslice({ up: '-Y' });
    ok(r2.ok, 'an Up preset slices again');
    eq([getStlSource().up, getStlSource().rotation, getStlSource().floor], ['-Y', [...UP_ROTATIONS['-Y']], null], 'the Up preset sets the same stored rotation');
    eq(app.document.querySelector('.stl-card .stl-ups .is-active').textContent, '−Y', 'the card lights it');
    // Units keeps the picked rotation
    app.stl.reslice({ orient: o });
    app.stl.reslice({ unit: 'in' });
    eq([getStlSource().rotation, getStlSource().unit], [o.rotation, 'in'], 'Units keeps the orientation');
  } finally { await app.close(); }
}

console.log(`stl-orient-808-node: ${checks} checks passed`);

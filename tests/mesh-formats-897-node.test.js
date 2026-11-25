// tests/mesh-formats-897-node.test.js — TASK 897 (owner turn 3690: native mesh formats): Shaper's website opens and inserts OBJ and 3MF meshes exactly like an
// STL (apps/shaper/src/mesh-formats.js readMesh: ONE reading step by the file's extension, then the STL path unchanged). The meshes: the cube and the 1 x 1 x 0.5 in
// block of tests/fixtures/mesh-897/ (written by tests/fixtures/mesh-writers-897.js from the SAME triangles as the fixture STLs), and the synthetic relief of task 889
// (tests/fixtures/relief-terrain-889.js: 14 304 triangles, written here as STL, OBJ and 3MF in memory: too big to commit as three files).
//  1. the reading step, pure: OBJ and 3MF give EXACTLY the STL's triangles (bit for bit: every coordinate is a float32 written as its shortest text), so they slice to
//     EXACTLY the STL's levels, grid, work area and size (#core/stl-slice.js sliceStl, compared as JSON); several objects are merged into one mesh (counted);
//     a 3MF in inches reads as Units in (the same slice as the STL with Units in; = the STL scaled to mm within float rounding); a 3MF in centimetres is scaled to
//     mm; an unknown extension is refused with a plain message; a broken OBJ / 3MF is refused with one.
//  2. the app (Shaper on the node kit, tests/helpers/node-app.js): Open an OBJ (its reader loads first: a Promise) -> the relief and its Roughing, the same region
//     levels as the STL's; the card shows the file name and its format; Insert a 3MF (one more relief part); a 3MF in inches: Units in, its size; a file of
//     several objects: one part, the notice says so; an unknown extension changes nothing.
//  3. saved designs: an STL design's stored source has the pre-897 fields only (no `format`); an OBJ's says `format: 'obj'` and opens again with its card (OBJ).
//  4. the pick offers .stl, .obj, .3mf; the loaders are not loaded by a static import (the site's first load does not grow by them).
import assert from 'node:assert';
import fs from 'node:fs';
import { register } from 'node:module';
// the page maps 'three' and 'three/addons/' with its import map; node gets the same mapping from a resolve hook (the vendored copy, r170), as orbit-pivot-823-node
const vendor = new URL('../packages/ui/vendor/three/', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: ${JSON.stringify(vendor + 'three.module.js')}, shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: ${JSON.stringify(vendor + 'addons/')} + s.slice('three/addons/'.length), shortCircuit: true };
  return next(s, c); }`));
const { sliceStl, parseStl } = await import('#core/stl-slice.js');
const SettingsManager = (await import('#core/settings-manager.js')).default;
const M = await import('./helpers/stl-mesh.js');
const { objText, threeMfBytes } = await import('./fixtures/mesh-writers-897.js');
const { reliefTerrain } = await import('./fixtures/relief-terrain-889.js');
const { open, createProfile, createNamedDesign } = await import('./helpers/node-app.js');
const { readMesh, MESH_FILE_PICK, MESH_FORMATS } = await import('../apps/shaper/src/mesh-formats.js');
const { getStlSources, getStlSource } = await import('../apps/shaper/src/stl-source.js');
const { regionKeys, regionOf } = await import('../apps/shaper/src/operations-store.js');
const { getSelections } = await import('../apps/shaper/src/selection-list.js');

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
const FIX = (n) => fs.readFileSync(new URL(`./fixtures/mesh-897/${n}`, import.meta.url));
const sameTris = (a, b) => a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const untimed = ({ ms, grid: { ms: gridMs, ...grid }, ...info }) => ({ ...info, grid }); // the slice's info without its timings
const slice = (tris, o = {}) => { const r = sliceStl(tris, { name: 'p', ...o }); assert.ok(r.ok, r.message); return JSON.stringify({ payload: r.payload, info: untimed(r.info) }); };

// 4. the pick and the bundle (fail-first: before 897 the pick was STL_FILE_PICK, ['.stl'] only, and no OBJ / 3MF could be read)
eq(MESH_FILE_PICK.exts, ['.stl', '.obj', '.3mf'], 'the pick offers STL, OBJ and 3MF');
eq(MESH_FILE_PICK.binary, true, '... read as bytes');
eq(MESH_FORMATS.map((f) => f.label), ['STL', 'OBJ', '3MF'], 'the declared formats');
for (const f of ['apps/shaper/src/mesh-formats.js', 'apps/shaper/src/stl-import.js', 'apps/shaper/src/stl-card.js', 'apps/shaper/src/stl-source.js', 'apps/shaper/src/main.js']) {
  const src = fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  ok(!/^import [^;]*(mesh-loaders|OBJLoader|3MFLoader|fflate)/m.test(src), `${f}: no static import of the mesh loaders`);
}
ok(/import\('\.\/mesh-loaders\.js'\)/.test(fs.readFileSync(new URL('../apps/shaper/src/mesh-formats.js', import.meta.url), 'utf8')), 'mesh-formats.js loads them dynamically');

const app = await open({ host: 'shaper' }); // its page gives the DOMParser a 3MF's XML is read with (a browser has one)
try {
  // ── 1. the reading step, pure
  {
    const stl = readMesh(FIX('cube.stl'), 'cube.stl');
    ok(stl.ok && !(stl instanceof Promise), 'an STL is read at once (as before)');
    eq([stl.format, stl.unit, stl.objects, stl.triangles.length / 9], ['stl', null, 1, 12], 'the cube STL: 12 triangles, no unit');
    const obj = readMesh(FIX('cube.obj'), 'cube.obj');
    ok(obj instanceof Promise, 'an OBJ: its reader loads first (a Promise)');
    const o = await obj, t = await readMesh(FIX('cube.3mf'), 'cube.3mf');
    eq([o.ok, o.format, o.unit, o.objects], [true, 'obj', null, 1], 'the cube OBJ: no unit');
    eq([t.ok, t.message, t.format, t.unit, t.objects], [true, undefined, '3mf', 'mm', 1], 'the cube 3MF: millimetres');
    ok(sameTris(o.triangles, stl.triangles) && sameTris(t.triangles, stl.triangles), 'the cube: the OBJ and the 3MF give EXACTLY the STL triangles');
    eq([slice(o.triangles), slice(t.triangles)], [slice(stl.triangles), slice(stl.triangles)], 'the cube: the same slice (levels, grid, work area, size), exactly');

    const relief = reliefTerrain(), rStl = readMesh(M.binaryStl(relief), 'relief.stl');
    const rObj = await readMesh(Buffer.from(objText(relief)), 'relief.obj'), r3mf = await readMesh(threeMfBytes(relief), 'relief.3mf');
    eq([rStl.triangles.length / 9, rObj.triangles.length / 9, r3mf.triangles.length / 9], [14304, 14304, 14304], 'the relief: 14 304 triangles each');
    ok(sameTris(rObj.triangles, rStl.triangles) && sameTris(r3mf.triangles, rStl.triangles), 'the relief: EXACTLY the STL triangles');
    const want = slice(rStl.triangles);
    eq([slice(rObj.triangles), slice(r3mf.triangles)], [want, want], 'the relief: the same levels / grid / work area / size, exactly');
    ok(JSON.parse(want).info.sections > 20, 'the relief has its levels: ' + JSON.parse(want).info.sections);

    // several objects: merged into one mesh, counted
    const m3 = await readMesh(threeMfBytes(relief, { objects: 3 }), 'three.3mf'), mo = await readMesh(Buffer.from(objText(relief, { objects: 4 })), 'four.obj');
    eq([m3.objects, mo.objects], [3, 4], 'several objects are counted');
    ok(sameTris(m3.triangles, rStl.triangles) && sameTris(mo.triangles, rStl.triangles), '... and merged into ONE mesh (every triangle, in order)');

    // units: a 3MF in inches = Units in; in centimetres = scaled to mm
    const bi = readMesh(FIX('block-inch.stl'), 'block.stl'), b3 = await readMesh(FIX('block-inch.3mf'), 'block.3mf');
    eq([b3.ok, b3.unit], [true, 'in'], 'a 3MF declaring inches reads as Units in');
    ok(sameTris(b3.triangles, bi.triangles), '... its numbers as written (1 x 1 x 0.5)');
    eq(slice(b3.triangles, { unit: 'in' }), slice(bi.triangles, { unit: 'in' }), '... the same slice as the STL with Units in');
    const mmInfo = JSON.parse(slice(bi.triangles.map((v) => v * 25.4))).info.sizeMm, inInfo = JSON.parse(slice(b3.triangles, { unit: 'in' })).info.sizeMm;
    for (const k of ['x', 'y', 'z']) near(inInfo[k], mmInfo[k], 1e-4, `the 3MF in inches = the block in mm (${k})`);
    eq([inInfo.x, inInfo.y, inInfo.z], [25.4, 25.4, 12.7], 'the 1 x 1 x 0.5 in block is 25.4 x 25.4 x 12.7 mm');
    const cm = await readMesh(threeMfBytes(relief.map((v) => v / 10), { unit: 'centimeter' }), 'cm.3mf');
    eq(cm.unit, 'mm', 'a 3MF in centimetres reads as mm');
    let worst = 0;
    for (let i = 0; i < cm.triangles.length; i++) worst = Math.max(worst, Math.abs(cm.triangles[i] - rStl.triangles[i]));
    ok(worst <= 1e-5, `... scaled by 10 (worst ${worst} mm: float rounding)`);

    // refusals: an unknown extension, a broken file
    eq(readMesh(Buffer.from('ISO-10303-21;'), 'bracket.step'), { ok: false, message: 'bracket.step is not a file Shaper can open: it opens 3D meshes in STL, OBJ and 3MF files.' }, 'an unknown extension: refused, plainly');
    eq(await readMesh(Buffer.from('# nothing here\n'), 'empty.obj'), { ok: false, message: 'This OBJ has no triangles.' }, 'an OBJ without faces: refused');
    const bad = await readMesh(Buffer.from('not a zip'), 'bad.3mf');
    ok(!bad.ok && /^This 3MF could not be read: /.test(bad.message), 'a 3MF that is not a package: refused: ' + bad.message);
    eq(await readMesh(threeMfBytes(relief, { unit: 'parsec' }), 'odd.3mf'), { ok: false, message: 'This 3MF declares the unit "parsec", which is not a 3MF unit (micron, millimeter, centimeter, meter, inch, foot).' }, 'an unknown 3MF unit: refused');
    ok(parseStl(FIX('cube.stl')).ok, 'the STL parser is the one readMesh uses (unchanged)');
  }

  // ── 2. the app
  SettingsManager.set('DOC_UNIT', 'mm', { persist: false });
  const st = app.state, doc = app.document;
  const notice = () => doc.getElementById('prepare-notice').textContent;
  const card = () => { const c = doc.querySelector('#prepare-panel .stl-card'); return c && !c.hidden ? { name: c.querySelector('.stl-name').textContent, format: c.querySelector('.stl-format').textContent, unit: c.querySelector('.stl-units .is-active').textContent, size: c.querySelector('.stl-size').textContent } : null; };
  const levelsOf = () => regionKeys().map((k) => regionOf(k)).filter((r) => r && r.levels).map((r) => JSON.stringify(r.levels));
  const RELIEF = reliefTerrain();
  {
    const s = app.stl.openFile(M.binaryStl(RELIEF), 'relief.stl');
    ok(s.ok, 'Open the relief STL');
    const stlLevels = levelsOf(), stlInfo = untimed(s.info);
    eq(card(), { name: 'relief.stl', format: 'STL', unit: 'mm', size: '120 × 80 × 23.501 mm' }, 'the STL card: the file and its format (STL)');
    const pending = app.stl.openFile(Buffer.from(objText(RELIEF)), 'relief.obj');
    ok(pending instanceof Promise, 'Open an OBJ: a Promise (its reader loads)');
    const r = await pending;
    eq([r.ok, r.message], [true, `Replaced with relief.obj: a relief, ${s.info.sections} levels`], 'Open OBJ: the notice (the design replaced, as Open STL)');
    eq(notice(), r.message, "Prepare's notice says it");
    eq(untimed(r.info), stlInfo, 'the OBJ sliced to the same size / levels / grid as the STL');
    eq(levelsOf(), stlLevels, 'the relief region holds the same levels as the STL');
    eq(app.modes.current(), 'prepare', 'shown in Prepare');
    eq(getSelections().filter((e) => e.kind === 'stl').length, 1, 'one relief part');
    eq(card(), { name: 'relief.obj', format: 'OBJ', unit: 'mm', size: '120 × 80 × 23.501 mm' }, 'the card: relief.obj, OBJ');
    eq(getStlSource().format, 'obj', 'the source records the format');

    // Insert a 3MF: one more part, its own Roughing; the card names it
    const before = getStlSources().length;
    const ins = await app.stl.insertFile(FIX('cube.3mf'), 'cube.3mf');
    ok(ins.ok && /^Inserted cube\.3mf: a relief, \d+ levels/.test(ins.message), 'Insert a 3MF: ' + ins.message);
    eq(getStlSources().map((x) => [x.name, x.format || 'stl']), [['relief.obj', 'obj'], ['cube.3mf', '3mf']], 'two parts, each with its format');
    eq(getStlSources().length, before + 1, 'one more source');
    eq(card(), { name: 'cube.3mf', format: '3MF', unit: 'mm', size: '10 × 10 × 10 mm' }, 'the card: cube.3mf, 3MF');
    st.undo();
    eq(getStlSources().map((x) => x.name), ['relief.obj'], 'undo: the insert goes (one undo step)');

    // a 3MF in inches: Units in, its size in mm
    const inch = await app.stl.openFile(FIX('block-inch.3mf'), 'block.3mf');
    ok(inch.ok, 'Open the 3MF in inches');
    eq(card(), { name: 'block.3mf', format: '3MF', unit: 'in', size: '25.4 × 25.4 × 12.7 mm' }, 'the card: Units in (the 3MF said so), 25.4 x 25.4 x 12.7 mm');
    // several objects: one part, said
    const many = await app.stl.openFile(threeMfBytes(RELIEF, { objects: 3 }), 'three.3mf');
    eq(many.message, `Replaced with three.3mf: a relief, ${s.info.sections} levels · 3 objects in the file, sliced as one part`, 'several objects: one relief, the notice says so');
    eq(levelsOf(), stlLevels, '... the same levels as the one-object STL');
    // an unknown extension: nothing changes
    const shapes = st.shapes.length, steps = st.history.length;
    const no = app.stl.openFile(Buffer.from('ISO-10303-21;'), 'bracket.step');
    eq([no.ok, st.shapes.length, st.history.length, card().name], [false, shapes, steps, 'three.3mf'], 'an unknown extension: refused, the design unchanged');
  }
} finally { await app.close(); }

// ── 3. saved designs
{
  const profile = await createProfile();
  await createNamedDesign(profile, 'shaper', 'Mesh 897');
  {
    const app = await open({ host: 'shaper', profile });
    try {
      app.stl.openFile(FIX('cube.stl'), 'cube.stl');
      const [s] = (await app.storedDoc()).hosts.shaper.stl;
      eq(Object.keys(s), ['part', 'name', 'up', 'rotation', 'unit', 'triangles', 'sizeMm', 'mesh', 'relief', 'opened'], 'an STL source is stored as before 897 (no format)');
      await app.stl.openFile(FIX('cube.obj'), 'cube.obj');
      const [o] = (await app.storedDoc()).hosts.shaper.stl;
      eq([o.name, o.format, o.unit, o.triangles], ['cube.obj', 'obj', 'mm', 12], 'an OBJ source says its format');
      eq(Object.keys(o), ['part', 'name', 'up', 'rotation', 'unit', 'triangles', 'sizeMm', 'format', 'mesh', 'relief', 'opened'], '... next to the same fields');
    } finally { await app.close(); }
  }
  {
    const app = await open({ host: 'shaper', profile });
    try {
      const s = getStlSource();
      eq([s && s.name, s && s.format], ['cube.obj', 'obj'], 'reopened: the OBJ source and its format');
      app.modes.showMode('prepare');
      const c = app.document.querySelector('#prepare-panel .stl-card');
      eq([c.hidden, c.querySelector('.stl-name').textContent, c.querySelector('.stl-format').textContent], [false, 'cube.obj', 'OBJ'], 'reopened: the card shows cube.obj, OBJ');
      const res = app.stl.reslice({ up: '-Z' });
      ok(res.ok && getStlSource().format === 'obj', 'a re-slice of the reopened OBJ keeps its format');
    } finally { await app.close(); }
  }
}
console.log(`mesh-formats-897-node: ok (${checks} checks)`);

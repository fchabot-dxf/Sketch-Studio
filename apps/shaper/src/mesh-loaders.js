// apps/shaper/src/mesh-loaders.js — TASK 897: the OBJ and 3MF readers of mesh-formats.js, on three.js's own loaders (the vendored r170 copy:
// packages/ui/vendor/three/addons/loaders/OBJLoader.js, 3MFLoader.js and the fflate it unzips with, addons/libs/fflate.module.js). This module and the
// loaders are loaded only when an OBJ / 3MF is read (mesh-formats.js imports it dynamically; each reader imports its own loader).
// A loader gives a three.js scene (a Group); its MESHES (every object, each with its transform: a 3MF build item's / component's) are read into ONE flat triangle
// list, the one #core/stl-slice.js parseStl returns (Float32Array, 9 per triangle); lines and points (an OBJ's l / p) are not part of a solid and are left out.
// The same limit and the same refusals as an STL: no triangles, a coordinate that is not a number, more than STL_SLICE.maxTriangles.
import { STL_SLICE } from '#core/stl-slice.js';

/** What a 3MF's declared unit is in the card's units (the 3MF core spec's six): the mesh is scaled to that card unit. */
export const THREE_MF_UNITS = Object.freeze({
  micron: Object.freeze({ unit: 'mm', scale: 0.001 }), millimeter: Object.freeze({ unit: 'mm', scale: 1 }), centimeter: Object.freeze({ unit: 'mm', scale: 10 }),
  meter: Object.freeze({ unit: 'mm', scale: 1000 }), inch: Object.freeze({ unit: 'in', scale: 1 }), foot: Object.freeze({ unit: 'in', scale: 12 }),
});

const fail = (message) => ({ ok: false, message });
const toBytes = (input) => (input instanceof Uint8Array ? input : input instanceof ArrayBuffer ? new Uint8Array(input)
  : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : null);

// every mesh of a loaded scene, in world coordinates (times `scale`) -> { ok, triangles, objects } | a refusal naming the format
function trianglesOf(THREE, root, what, scale = 1) {
  root.updateMatrixWorld(true);
  const meshes = [];
  root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o); });
  const count = meshes.reduce((n, o) => n + Math.floor((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3), 0);
  if (!count) return fail(`This ${what} has no triangles.`);
  if (count > STL_SLICE.maxTriangles) return fail(`This ${what} has ${count.toLocaleString('en-US')} triangles; the limit is ${STL_SLICE.maxTriangles.toLocaleString('en-US')}.`);
  const tris = new Float32Array(9 * count), v = new THREE.Vector3();
  let k = 0;
  for (const o of meshes) {
    const pos = o.geometry.attributes.position, idx = o.geometry.index, n = 3 * Math.floor((idx ? idx.count : pos.count) / 3);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld);
      if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) return fail(`This ${what} is damaged: triangle ${Math.floor(k / 9) + 1} has a coordinate that is not a number.`);
      tris[k++] = v.x * scale; tris[k++] = v.y * scale; tris[k++] = v.z * scale;
    }
  }
  return { ok: true, triangles: tris, objects: meshes.length };
}

/** An OBJ file's bytes (or its text) -> { ok, triangles, objects } (OBJ has no unit) | { ok: false, message }. */
export async function readObj(input) {
  const bytes = typeof input === 'string' ? null : toBytes(input);
  const text = typeof input === 'string' ? input : bytes ? new TextDecoder().decode(bytes) : '';
  if (!text) return fail('The file is empty.');
  const [THREE, { OBJLoader }] = await Promise.all([import('three'), import('three/addons/loaders/OBJLoader.js')]);
  let root;
  try { root = new OBJLoader().parse(text); } catch (e) { return fail(`This OBJ could not be read: ${e.message}`); }
  return trianglesOf(THREE, root, 'OBJ');
}

// the unit the 3MF's root model part declares (its package's _rels/.rels names that part: the first relationship to a .model, as ThreeMFLoader picks it)
function declaredUnit(fflate, bytes) {
  const zip = fflate.unzipSync(bytes);
  const text = (p) => (zip[p] ? new TextDecoder().decode(zip[p]) : null);
  const xml = (p) => { const t = text(p); return t == null ? null : new DOMParser().parseFromString(t, 'application/xml'); };
  const rels = xml('_rels/.rels');
  if (!rels) throw new Error('it has no _rels/.rels (it is not a 3MF package)');
  const target = [...rels.querySelectorAll('Relationship')].map((r) => r.getAttribute('Target') || '').find((t) => t.toLowerCase().endsWith('.model'));
  const model = target ? xml(target.replace(/^\//, '')) : null;
  if (!model) throw new Error('its 3D model part is missing');
  return model.documentElement.getAttribute('unit') || 'millimeter'; // the 3MF core spec's default
}

/** A 3MF file's bytes -> { ok, triangles, unit, objects } (the mesh in the card's unit its declared unit maps to) | { ok: false, message }. */
export async function read3mf(input) {
  const bytes = toBytes(input);
  if (!bytes || !bytes.length) return fail('The file is empty.');
  const [THREE, { ThreeMFLoader }, fflate] = await Promise.all([import('three'), import('three/addons/loaders/3MFLoader.js'), import('three/addons/libs/fflate.module.js')]);
  let declared, root; // the loader is given a copy of the bytes as its own ArrayBuffer (a view's .buffer may hold more: a Node Buffer's pool)
  try { declared = declaredUnit(fflate, bytes); } catch (e) { return fail(`This 3MF could not be read: ${e.message}`); }
  const u = THREE_MF_UNITS[declared];
  if (!u) return fail(`This 3MF declares the unit "${declared}", which is not a 3MF unit (${Object.keys(THREE_MF_UNITS).join(', ')}).`);
  try { root = new ThreeMFLoader().parse(new Uint8Array(bytes).buffer); } catch (e) { return fail(`This 3MF could not be read: ${e.message}`); }
  const r = trianglesOf(THREE, root, '3MF', u.scale);
  return r.ok ? { ...r, unit: u.unit } : r;
}

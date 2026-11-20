// apps/shaper/src/orient-view.js — TASK 808 (owner turn 2641: "we just need to make sure the model is oriented right, if its not we click the floor face"):
// the STL ORIENT view. A full-screen 3D view of the RAW MESH on the Review's own three.js stage (orbit-stage.js: the same orbit / zoom / pan, one finger
// orbits on a phone), over the BUILD PLANE (the floor, z 0). A click (a tap on a phone: a press that did not drag) on the mesh picks the face under the
// pointer: the triangle the ray hits, widened to the connected triangles round it within STL_ORIENT.coplanarDeg (#core/stl-slice.js floorFaceAt: 2 degrees
// of the picked triangle's own normal); that face's outward normal is turned to point straight DOWN (rotationForFloor: any direction, not only the six axes)
// and the part sits on the floor at once. "Done" hands the orientation back ({ up, rotation, floor }: the importer re-imports, one undo step); "Cancel" (or
// Esc) leaves it as it was. A face that cannot be a floor (a curved one: material would hang below it) is accepted all the same: the height is computed.
import { floorFaceAt, rotationForFloor, orientedBounds, orientationOf, STL_UNITS } from '#core/stl-slice.js';
import { createOrbitStage } from './orbit-stage.js';

const CLICK = Object.freeze({ movePx: 6, ms: 700 }); // a press that moved less than this, for less than this long, is a pick, not an orbit

let OPEN = null;
/** The Orient view that is open (or null): its screenOf / orientation, read by the tests. */
export const currentOrientView = () => OPEN;

/**
 * openOrientView({ tris, unit, rotation, up, onDone, onCancel, doc }) -> Promise<{ screenOf, orientation, close }>
 *   tris, unit: the raw mesh (9 numbers per triangle) and what one unit of it is (STL_UNITS id); rotation / up: the orientation it has now.
 *   onDone({ up, rotation, floor }) after Done with a different orientation (up null: not an Up side); onCancel() after Cancel / Esc (and Done with no change).
 */
export async function openOrientView({ tris, unit, rotation = null, up = null, onDone = () => {}, onCancel = () => {}, doc = document }) {
  if (OPEN) OPEN.close(false);
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const mm = (STL_UNITS.find((u) => u.id === unit) || STL_UNITS[0]).mm;

  const root = doc.createElement('div');
  root.className = 'orient-view'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Orient the part');
  root.innerHTML = `<div class="orient-bar"><div class="orient-title">Orient</div><div class="orient-help">Click the face that sits on the bed.</div>
    <div class="orient-info" aria-live="polite"></div><button type="button" class="orient-btn orient-cancel">Cancel</button><button type="button" class="orient-btn orient-done">Done</button></div>
    <div class="orient-host"></div>`;
  doc.body.appendChild(root);
  const host = root.querySelector('.orient-host'), infoEl = root.querySelector('.orient-info');

  const { renderer, scene, sun, camera, controls, size, pivot } = createOrbitStage(THREE, OrbitControls, host);
  scene.background = new THREE.Color(0x0b1020);
  // the mesh in mm, in its own (raw) frame; the group maps the part's frame (x, y, z up) to the stage's (y up)
  const world = new THREE.Group();
  world.rotation.x = -Math.PI / 2; // part (x, y, z) -> stage (x, z, -y)
  scene.add(world);
  const pos = new Float32Array(tris.length);
  for (let i = 0; i < tris.length; i++) pos[i] = tris[i] * mm;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.computeVertexNormals(); // not indexed: one flat normal per triangle
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xd9c3a0, roughness: 0.8, metalness: 0, side: THREE.DoubleSide }));
  mesh.matrixAutoUpdate = false;
  world.add(mesh);
  // the floor: the build plane at z 0 under the mesh (a translucent plate and its outline, sized once from the mesh's reach)
  const span = [0, 1, 2].map((a) => { let lo = Infinity, hi = -Infinity; for (let i = a; i < pos.length; i += 3) { if (pos[i] < lo) lo = pos[i]; if (pos[i] > hi) hi = pos[i]; } return hi - lo; });
  const reach = Math.hypot(...span);
  const plateMat = new THREE.MeshBasicMaterial({ color: 0x4a74c9, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(2 * reach, 2 * reach), plateMat);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: 0x7fa3f0 }));
  world.add(plate, outline);

  let current = orientationOf({ rotation, up: up || undefined }); // { rotation, up }
  let floor = null, changed = false;
  const R4 = new THREE.Matrix4();
  function apply() {
    const R = current.rotation, b = orientedBounds(tris, { rotation: R, unit });
    R4.set(R[0], R[1], R[2], -b.minX, R[3], R[4], R[5], -b.minY, R[6], R[7], R[8], -b.minZ, 0, 0, 0, 1); // turned, then set on z 0 and the origin
    mesh.matrix.copy(R4); mesh.matrixWorldNeedsUpdate = true;
    const dx = b.maxX - b.minX, dy = b.maxY - b.minY, dz = b.maxZ - b.minZ;
    plate.position.set(dx / 2, dy / 2, -0.01 * reach); outline.position.copy(plate.position);
    infoEl.textContent = `${dx.toFixed(1)} × ${dy.toFixed(1)} × ${dz.toFixed(1)} mm` + (floor ? ` · floor normal ${floor.map((v) => v.toFixed(3)).join(', ')}` : '');
    return { dx, dy, dz };
  }
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);
  function place(ext) {
    const c = new THREE.Vector3(ext.dx / 2, ext.dz / 2, -ext.dy / 2);
    const R = Math.hypot(ext.dx, ext.dy, ext.dz) / 2, dist = (R / Math.sin((camera.fov * Math.PI) / 360)) * 1.1 * Math.max(1, 1 / camera.aspect); // a narrow (phone) screen: the width limits
    controls.target.copy(c);
    camera.position.copy(c).add(new THREE.Vector3(0.55, 0.85, 0.9).normalize().multiplyScalar(dist));
    camera.far = dist * 20; camera.updateProjectionMatrix();
    sun.position.set(c.x - dist * 0.5, c.y + dist, c.z + dist * 0.4); sun.target.position.copy(c);
    camera.lookAt(c); controls.update();
  }
  size();
  let ext = apply();
  place(ext);
  render();

  // PICK: a press that did not drag
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null;
  const el = renderer.domElement;
  const onDown = (e) => { down = e.isPrimary && (e.pointerType !== 'mouse' || e.button === 0) ? { x: e.clientX, y: e.clientY, t: e.timeStamp } : null; };
  const onUp = (e) => {
    const d = down; down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK.movePx || e.timeStamp - d.t > CLICK.ms) return;
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    mesh.updateMatrixWorld(true);
    const hit = ray.intersectObject(mesh, false)[0];
    if (!hit || hit.faceIndex == null) return;
    const toViewer = ray.ray.direction.clone().negate().transformDirection(mesh.matrixWorld.clone().invert()); // toward the viewer, in the mesh's own frame: the side that was clicked is the floor's outside
    const face = floorFaceAt(tris, hit.faceIndex, { facing: toViewer.toArray() });
    const o = face && rotationForFloor(face.normal);
    if (!o) return;
    current = { rotation: o.rotation, up: o.up }; floor = o.floor; changed = true;
    ext = apply(); render(); // the part sits on its new floor at once
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  const ro = new ResizeObserver(() => { size(); render(); });
  ro.observe(host);

  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close('cancel'); } };
  function close(finish) {
    if (OPEN !== api) return;
    OPEN = null;
    ro.disconnect(); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); doc.removeEventListener('keydown', onKey, true);
    controls.dispose(); geo.dispose(); mesh.material.dispose(); plate.geometry.dispose(); plateMat.dispose(); outline.geometry.dispose(); outline.material.dispose();
    renderer.dispose(); root.remove();
    if (finish === 'done') onDone({ up: current.up, rotation: current.rotation, floor }); else if (finish === 'cancel') onCancel();
  }
  doc.addEventListener('keydown', onKey, true);
  root.querySelector('.orient-cancel').addEventListener('click', () => close('cancel'));
  root.querySelector('.orient-done').addEventListener('click', () => close(changed ? 'done' : 'cancel'));
  const api = {
    /** TASK 823: the part's point (x, y, z in mm, as screenOf takes it) an orbit in progress turns round, or null. */
    pivot() { const p = pivot(); return p && [p.x, -p.z, p.y]; },
    /** CSS px of the page where the part's point (x, y, z in mm, as shown now: the floor at z 0) is drawn. */
    screenOf([x, y, z]) {
      const v = new THREE.Vector3(x, z, -y).project(camera), r = el.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    /** The orientation as shown now: { up, rotation, floor, size: { x, y, z } mm }. */
    orientation: () => ({ up: current.up, rotation: [...current.rotation], floor: floor && [...floor], size: { x: ext.dx, y: ext.dy, z: ext.dz } }),
    close: (finish = false) => close(finish ? 'done' : 'cancel'),
  };
  OPEN = api;
  root.querySelector('.orient-done').focus();
  return api;
}

// apps/shaper/src/review-view.js — TASK 459: the Review tab's 3D view of the FINISHED workpiece.
// All geometry comes from #core/relief-model (pure; built ONLY from the cut footprints + depths); this module only wraps the
// typed arrays in three.js BufferGeometry, lights it, and runs the orbit camera. three is imported DYNAMICALLY here, so it
// downloads only when the Review tab first opens (it is vendored under packages/ui/vendor/three, pinned 0.170.0).
// Render ON DEMAND (controls 'change' / rebuild / resize): no idle animation loop.
import { buildRelief, createReliefCache } from '#core/relief-model.js';

const BOARD = [0.85, 0.70, 0.50]; // warm board colour: the flat look (Wood off), and the plywood EDGE on the side / wall faces
export const TILE_MM = 400;        // one repeat of the birch image covers 400 x 400 mm of board (a plausible plywood grain scale)
export const WOOD_URL = new URL('../assets/birch-plywood.jpg', import.meta.url).href;
const FACE_MESHES = new Set(['top', 'floor', 'bottom']); // show the birch face grain; side / wall show the plywood edge image
export const PLY_PER_MM = 13 / 19.05; // 3/4 inch Baltic birch has 13 plies in 19.05 mm; the same density at any thickness
export const IMAGE_PLY_COUNT = 26;    // light/dark layers in one vertical repeat of birch-plywood-edge.jpg (luminance profile of the middle column, stable at smoothing windows 5 and 7)
export const EDGE_TILE_MM = IMAGE_PLY_COUNT / PLY_PER_MM; // 38.1 mm per image repeat
export const EDGE_URL = new URL('../assets/birch-plywood-edge.jpg', import.meta.url).href;

// Edge UVs from WORLD position: v = y / EDGE_TILE_MM (so the layers line up across the board edge and every cut wall); u runs along
// the face: walls are vertical, so the wall's own normal picks the horizontal axis (normal mostly along x -> the face runs along z).
export function edgeUVs(positions, normals, tile = EDGE_TILE_MM) {
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    uv[j] = (Math.abs(normals[i]) > Math.abs(normals[i + 2]) ? positions[i + 2] : positions[i]) / tile;
    uv[j + 1] = positions[i + 1] / tile;
  }
  return uv;
}

// TASK 497: planar UVs from WORLD x,z (the mesh plane is x/z, height is y). The image's grain runs along its v axis, so when the
// board's long side is X the axes swap (u = z, v = x) to keep the grain along the long side.
export function planarUVs(positions, tile = TILE_MM, grainAlongX = false) {
  const uv = new Float32Array((positions.length / 3) * 2);
  for (let i = 0, j = 0; i < positions.length; i += 3, j += 2) {
    const a = positions[i] / tile, b = positions[i + 2] / tile;
    uv[j] = grainAlongX ? b : a; uv[j + 1] = grainAlongX ? a : b;
  }
  return uv;
}

/**
 * mountReviewView({ host, info, getInputs, wood }) -> Promise<{ refresh, reset, top, fit, setWood, destroy, lastBuild, wood }>
 *   host       the element the canvas is appended to
 *   info       element receiving the one-line build summary (and the "not shown" notes)
 *   getInputs  () => { stock, items, bounds }  (see buildRelief)
 *   wood       initial state of the Wood texture (default true); setWood(bool) switches the face texture on / off
 */
export async function mountReviewView({ host, info, getInputs, wood = true }) {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161a);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6258, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; // on-demand rendering: no animation loop to drive damping

  // vertex colours are the grey DEPTH multiplier; material.color is the tint (BOARD flat, white under the wood map)
  const edgeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, color: new THREE.Color(...BOARD) });
  const faceMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, color: new THREE.Color(...BOARD) });
  let woodTexture = null, edgeTexture = null, woodOn = !!wood;
  const applyWood = () => {
    const textured = woodOn && !!woodTexture;
    faceMaterial.map = textured ? woodTexture : null;
    faceMaterial.color.set(textured ? 0xffffff : new THREE.Color(...BOARD));
    faceMaterial.needsUpdate = true;
    const edged = woodOn && !!edgeTexture;
    edgeMaterial.map = edged ? edgeTexture : null;
    edgeMaterial.color.set(edged ? 0xffffff : new THREE.Color(...BOARD));
    edgeMaterial.needsUpdate = true;
  };
  function setWood(on) { woodOn = !!on; applyWood(); render(); }
  // lazy + async: the board renders flat first, then picks up the textures when they arrive (same geometry, no layout change)
  const loadTexture = (url, assign) => new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    assign(tex); applyWood(); render();
  });
  loadTexture(WOOD_URL, (tex) => { woodTexture = tex; });
  loadTexture(EDGE_URL, (tex) => { edgeTexture = tex; });
  let group = null, box = null, lastBuild = null, lastSig = null;
  const reliefCache = createReliefCache();
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);

  // Shade by DEPTH (height is the position's Y): a cut floor reads clearly darker than the top (even a shallow groove, seen from
  // above), deeper = darker still; walls a little darker than the floor they meet. `base` = the group's own tone.
  const SHADE = { top: [1, 0], side: [1, 0.45], bottom: [0.7, 0], floor: [0.78, 0.4], wall: [0.7, 0.4] }; // [tone, extra darkening over the full thickness]
  function geometryOf(mesh, T, name, grainAlongX) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
    if (FACE_MESHES.has(name)) g.setAttribute('uv', new THREE.BufferAttribute(planarUVs(mesh.positions, TILE_MM, grainAlongX), 2));
    else g.setAttribute('uv', new THREE.BufferAttribute(edgeUVs(mesh.positions, mesh.normals), 2));
    // shade by DEPTH (height is the position's Y): deeper = darker, like Studio's depth shading
    const col = new Float32Array(mesh.positions.length);
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const [tone, gain] = SHADE[name];
      const k = tone * (1 - gain * Math.min(1, Math.max(0, -mesh.positions[i + 1] / T)));
      col[i] = col[i + 1] = col[i + 2] = k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    return g;
  }

  // A "depth unset" label ON the cut (an Outside/Inside shown through only because no depth was set): a screen-sized amber
  // sprite at the mark point from buildRelief, always on top.
  let labelTexture = null;
  function markSprite(mark) {
    if (!labelTexture) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 64;
      const g = c.getContext('2d');
      g.fillStyle = '#f59e0b'; g.beginPath(); g.roundRect(2, 2, 252, 60, 14); g.fill();
      g.fillStyle = '#1b1405'; g.font = 'bold 30px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('depth unset', 128, 34);
      labelTexture = new THREE.CanvasTexture(c);
      labelTexture.colorSpace = THREE.SRGBColorSpace;
    }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, depthTest: false, transparent: true, sizeAttenuation: false }));
    sp.scale.set(0.07, 0.0175, 1);
    sp.position.set(mark.point[0], 1, mark.point[1]); // X = sketch x, Y = just above the top face, Z = sketch y
    sp.renderOrder = 10; sp.userData.mark = mark.kind;
    return sp;
  }

  function disposeGroup() {
    if (!group) return;
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isSprite) o.material.dispose(); });
    scene.remove(group); group = null;
  }

  function size() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function place(dir, up) {
    if (!box) return;
    const cx = (box.minX + box.maxX) / 2, cz = (box.minY + box.maxY) / 2, cy = -box.thickness / 2;
    const R = Math.hypot(box.maxX - box.minX, box.maxY - box.minY, box.thickness) / 2;
    const dist = (R / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
    camera.up.set(0, 1, 0);
    controls.target.set(cx, cy, cz);
    const d = new THREE.Vector3(...dir).normalize().multiplyScalar(dist);
    camera.position.set(cx + d.x, cy + d.y, cz + d.z);
    camera.far = dist * 20; camera.updateProjectionMatrix();
    sun.position.set(cx - dist * 0.5, cy + dist, cz + dist * 0.4); sun.target.position.set(cx, cy, cz);
    camera.lookAt(controls.target);
    controls.update();
    render();
  }
  const reset = () => place([0.55, 0.85, 0.9]);        // 3/4 view from the front (+Z = down the screen in Prepare)
  const top = () => place([0, 1, 0.0005]);             // straight down; screen-up = -Z, the same orientation as Prepare
  const fit = () => place(camera.position.clone().sub(controls.target).toArray());

  function refresh(sig) {
    if (sig !== undefined && sig === lastSig) { size(); render(); return lastBuild; }
    const t0 = performance.now();
    const rel = buildRelief({ ...getInputs(), cache: reliefCache }); // the cache reuses the work of unchanged cuts / levels
    const T = rel.stockBox.thickness;
    disposeGroup();
    group = new THREE.Group();
    const grainAlongX = rel.stockBox.maxX - rel.stockBox.minX >= rel.stockBox.maxY - rel.stockBox.minY;
    for (const [name, m] of Object.entries(rel.meshes)) {
      if (!m.indices.length) continue;
      const mesh = new THREE.Mesh(geometryOf(m, T, name, grainAlongX), FACE_MESHES.has(name) ? faceMaterial : edgeMaterial);
      mesh.name = name;
      group.add(mesh);
    }
    for (const mk of rel.marks) group.add(markSprite(mk));
    scene.add(group);
    const firstBuild = !box;
    box = rel.stockBox;
    size();
    if (firstBuild) reset(); else render();
    const ms = performance.now() - t0;
    lastSig = sig;
    lastBuild = { ms, stages: rel.stats.ms, triangles: rel.stats.triangles, levels: rel.stats.levels, skipped: rel.stats.skipped, unsetThrough: rel.stats.unsetThrough, marks: rel.marks.length, outsideStock: rel.stats.outsideStock, partlyOutside: rel.stats.partlyOutside, board: rel.stats.board };
    const notShown = rel.stats.skipped.filter((s) => s.reason === 'no-depth').length;
    const lines = [`${rel.stats.triangles} triangles · ${rel.stats.levels} level${rel.stats.levels === 1 ? '' : 's'} · built in ${ms.toFixed(0)} ms`];
    if (rel.stats.board === 'profile') lines.push('Board: your Stock loop (any shape), extruded to its thickness');
    const nOut = rel.stats.outsideStock.length, nPart = rel.stats.partlyOutside.length;
    if (nOut) lines.push(`${nOut} cut${nOut === 1 ? '' : 's'} lie${nOut === 1 ? 's' : ''} wholly outside the stock: nothing is cut there`);
    if (nPart) lines.push(`${nPart} cut${nPart === 1 ? '' : 's'} extend${nPart === 1 ? 's' : ''} past the stock edge: only the part on the board is cut`);
    if (rel.stats.unsetThrough.length) lines.push(`${rel.stats.unsetThrough.length} Outside/Inside cut${rel.stats.unsetThrough.length === 1 ? '' : 's'} with depth unset shown cut through (amber label)`);
    if (notShown) lines.push(`${notShown} cut${notShown === 1 ? '' : 's'} not shown (Pocket or On Line with no depth)`);
    info.innerHTML = lines.map((l) => `<div>${l}</div>`).join('');
    return lastBuild;
  }

  const ro = new ResizeObserver(() => { size(); render(); });
  ro.observe(host);
  renderer.domElement.addEventListener('dblclick', fit);

  function destroy() {
    ro.disconnect(); controls.dispose(); disposeGroup(); faceMaterial.dispose(); edgeMaterial.dispose();
    if (labelTexture) labelTexture.dispose();
    if (woodTexture) woodTexture.dispose();
    if (edgeTexture) edgeTexture.dispose();
    renderer.dispose(); renderer.domElement.remove();
  }
  // inspect(): the Wood state, the top mesh's first vertex with its uv, and the edge plies (read by the tests)
  const inspect = () => {
    const t = group && group.children.find((o) => o.name === 'top');
    const p = t && t.geometry.getAttribute('position'), u = t && t.geometry.getAttribute('uv');
    return { wood: woodOn, mapLoaded: !!woodTexture, mapOn: !!faceMaterial.map, edgeMapOn: !!edgeMaterial.map, edgeLoaded: !!edgeTexture, top: p && u ? { x: p.getX(0), z: p.getZ(0), u: u.getX(0), v: u.getY(0) } : null };
  };
  return { refresh, reset, top, fit, setWood, inspect, destroy, get wood() { return woodOn; }, get lastBuild() { return lastBuild; } };
}

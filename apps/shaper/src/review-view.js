// apps/shaper/src/review-view.js — TASK 459: the Review tab's 3D view of the FINISHED workpiece.
// All geometry comes from #core/relief-model (pure; built ONLY from the cut footprints + depths); this module only wraps the
// typed arrays in three.js BufferGeometry, lights it, and runs the orbit camera. three is imported DYNAMICALLY here, so it
// downloads only when the Review tab first opens (it is vendored under packages/ui/vendor/three, pinned 0.170.0).
// Render ON DEMAND (controls 'change' / rebuild / resize): no idle animation loop.
import { buildRelief, createReliefCache } from '#core/relief-model.js';
import { POCKET_CLEARING } from '#core/pocket-clearing.js'; // TASK 778: pocket start mark circle ratio (declared once)
import SettingsManager, { docUnit } from '#core/settings-manager.js';
import { reviewGridSpec, designCanvasColors, gridMaterialSource, GRID_FADE } from './review-grid.js';
import { mountDisclosure, isPhone, CARET_SVG } from './disclosure.js'; // TASK 757: the info folds on a phone (the Operations sheet's fold)

export const TILE_MM = 400;        // one repeat of the birch image covers 400 x 400 mm of board (a plausible plywood grain scale)
export const WOOD_URL = new URL('../assets/birch-plywood.jpg', import.meta.url).href;
const FACE_MESHES = new Set(['top', 'floor', 'bottom']); // show the look's FACE (birch face grain); side / wall show its EDGE (the plywood edge image)
export const PLY_PER_MM = 13 / 19.05; // 3/4 inch Baltic birch has 13 plies in 19.05 mm; the same density at any thickness
export const IMAGE_PLY_COUNT = 26;    // light/dark layers in one vertical repeat of birch-plywood-edge.jpg (luminance profile of the middle column, stable at smoothing windows 5 and 7)
export const EDGE_TILE_MM = IMAGE_PLY_COUNT / PLY_PER_MM; // 38.1 mm per image repeat
export const EDGE_URL = new URL('../assets/birch-plywood-edge.jpg', import.meta.url).href;

// TASK 729: the board LOOKS, declared ONCE as data and read by the one material builder (lookSpec -> applyLook in mountReviewView).
// A row: id, label; face (top / floor / bottom) and edge (side / wall): { image } = a photo (the plywood's two assets), { paint } = a texture
// generated in code (PAINTERS below; tileMm = the board length one repeat covers; along = the grain direction in the texture: 'v' on a face
// follows the board's long side (planarUVs), 'u' on an edge runs horizontally along the wall), { glow } = an emissive edge highlight, or none
// = the flat colour; color = the flat colour (shown while a photo loads), or none when the user picks it from `colors` (presets: label, hex,
// optional opacity) and, with custom: true, any colour; roughness / metalness; opacity < 1 = see-through. A new look is a new row here.
// The vertex colours stay the grey DEPTH multiplier whatever the look, so pockets read darker on every look.
export const BOARD_HEX = '#eddabc'; // the warm board colour (linear 0.85 / 0.70 / 0.50, the old Wood-off look) as the sRGB hex a colour input shows
export const LOOKS = [
  { id: 'plywood', label: 'Plywood', face: { image: WOOD_URL }, edge: { image: EDGE_URL }, color: BOARD_HEX, roughness: 0.85, metalness: 0 },
  { id: 'solid', label: 'Solid colour', custom: true, roughness: 0.85, metalness: 0,
    colors: [{ label: 'Natural wood', hex: BOARD_HEX }, { label: 'White', hex: '#f2f2ef' }, { label: 'Light grey', hex: '#c3c6cb' }, { label: 'Black', hex: '#2a2c30' }, { label: 'Red', hex: '#c0392b' }, { label: 'Blue', hex: '#2f6fc4' }] },
  { id: 'mdf', label: 'MDF', color: '#b48e66', roughness: 0.92, metalness: 0, // a fine speckle on a warm brown; the edge solid and uniform (no plies), a little darker and coarser
    face: { paint: 'speckle', base: '#b48e66', tileMm: 60, amount: 0.07, flecks: 0.05, seed: 11 },
    edge: { paint: 'speckle', base: '#a07a54', tileMm: 30, amount: 0.10, flecks: 0.08, seed: 12 } },
  { id: 'walnut', label: 'Walnut', color: '#553624', roughness: 0.7, metalness: 0, // a fine straight grain along the board; the edge is the same wood, its grain along the wall
    face: { paint: 'grain', dark: '#3a2418', light: '#6e4a33', tileMm: 240, along: 'v', seed: 21 },
    edge: { paint: 'grain', dark: '#342015', light: '#634130', tileMm: 120, along: 'u', seed: 22 } },
  { id: 'acrylic', label: 'Acrylic', roughness: 0.08, metalness: 0, edge: { glow: 0.35 },
    colors: [{ label: 'Clear', hex: '#d8eef2', opacity: 0.38 }, { label: 'White', hex: '#f4f4f2', opacity: 0.88 }, { label: 'Black', hex: '#1b1c1f', opacity: 0.92 }] },
];
export const DEFAULT_LOOK_ID = 'plywood';
const HEX = /^#[0-9a-f]{6}$/;

// the one valid look state { id, colors: { <look id>: hex } } (each colour-taking look keeps its own pick) from any stored / passed value
export function normaliseLook(v) {
  const id = v && LOOKS.some((l) => l.id === v.id) ? v.id : DEFAULT_LOOK_ID;
  const colors = {};
  for (const l of LOOKS) {
    if (!l.colors) continue;
    const c = v && v.colors && typeof v.colors[l.id] === 'string' ? v.colors[l.id].toLowerCase() : null;
    colors[l.id] = c && (l.colors.some((p) => p.hex === c) || (l.custom && HEX.test(c))) ? c : l.colors[0].hex;
  }
  return { id, colors };
}

// lookSpec(state) -> what the two materials (face, edge) are for that look: pure data, read by applyLook and the node test
export function lookSpec(state) {
  const s = normaliseLook(state);
  const row = LOOKS.find((l) => l.id === s.id);
  const pick = row.colors ? (row.colors.find((p) => p.hex === s.colors[row.id]) || { hex: s.colors[row.id] }) : null;
  const opacity = pick && pick.opacity !== undefined ? pick.opacity : 1;
  const part = (name) => {
    const p = row[name] || {};
    return { image: p.image || null, paint: p.paint ? p : null, key: `${row.id}.${name}`, glow: p.glow || 0 }; // key: the painted texture's cache key
  };
  return { id: row.id, color: row.color || pick.hex, roughness: row.roughness, metalness: row.metalness, opacity, transparent: opacity < 1, face: part('face'), edge: part('edge') };
}

// Procedural textures (no image files): each painter fills a size x size RGBA buffer that TILES seamlessly (integer frequencies, per-pixel
// noise), from a seeded generator so the same look draws the same pixels every time.
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const PAINTERS = {
  // MDF: the base colour, each pixel lighter / darker by up to `amount`, plus sparse darker fibre flecks
  speckle(p, size) {
    const px = new Uint8ClampedArray(size * size * 4), base = rgbOf(p.base), rnd = seeded(p.seed);
    for (let i = 0; i < size * size; i++) {
      let k = 1 + (rnd() * 2 - 1) * p.amount;
      if (rnd() < p.flecks) k *= 0.82;
      for (let c = 0; c < 3; c++) px[i * 4 + c] = base[c] * k;
      px[i * 4 + 3] = 255;
    }
    return px;
  },
  // solid wood: fine straight grain lines (a few wavy sines across the grain, mixed between dark and light), streaks along `along`
  grain(p, size) {
    const px = new Uint8ClampedArray(size * size * 4), dark = rgbOf(p.dark), light = rgbOf(p.light), rnd = seeded(p.seed), TAU = Math.PI * 2;
    const ph = [rnd(), rnd(), rnd(), rnd()].map((r) => r * TAU);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [a, b] = p.along === 'u' ? [y / size, x / size] : [x / size, y / size]; // a = across the grain, b = along it
      let t = 0.5 + 0.22 * Math.sin(TAU * 5 * a + 0.9 * Math.sin(TAU * b + ph[0]) + ph[1])
        + 0.14 * Math.sin(TAU * 23 * a + 0.5 * Math.sin(TAU * 2 * b + ph[2]))
        + 0.08 * Math.sin(TAU * 71 * a + ph[3]) + (rnd() - 0.5) * 0.12;
      t = Math.min(1, Math.max(0, t));
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = dark[c] + (light[c] - dark[c]) * t;
      px[i + 3] = 255;
    }
    return px;
  },
};
export const PAINT_SIZE = 256;

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

// TASK 754: the settings the 3D grid reads (review-grid.js): a change to one of them redraws it at once
const GRID_SETTING_KEYS = new Set(['GRID_MODE', 'GRID_SIZE', 'GRID_MAJOR_STEP', 'INCH_GRID_DIVISIONS', 'INCH_GRID_MAJOR', 'DOC_UNIT', 'STYLE_TEMPLATE', 'STYLE_PRESETS']);

/**
 * mountReviewView({ host, info, getInputs, look, designCanvas, emptyText }) -> Promise<{ refresh, reset, top, fit, setLook, inspect, screenOf, destroy, lastBuild, look }>
 *   host       the element the canvas is appended to
 *   info       element receiving the one-line build summary (and the "not shown" notes)
 *   getInputs  () => { stock, items, bounds, notes? }  (see buildRelief; notes = extra info lines, TASK 714: the stepped cuts' steps / undercuts)
 *   look       the initial look state { id, colors } (TASK 729, normaliseLook; default Plywood); setLook(state) swaps the MATERIALS only (no geometry rebuild)
 *   designCanvas  the Design canvas element (TASK 754): the background and the grid colours are read from its own tokens (review-grid.js)
 *   emptyText  TASK 757: the info's text when there is nothing to build (an empty design: buildRelief's board 'none'); no mesh is shown then
 */
export async function mountReviewView({ host, info, getInputs, look: initialLook, designCanvas, emptyText }) {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(); // TASK 754: the Design canvas's paper (applyGridLook)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6b6258, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  scene.add(sun, sun.target);
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 100000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; // on-demand rendering: no animation loop to drive damping
  // TASK 729: Fusion-like navigation, declared here once: left drag = orbit (Shift / Ctrl + left = pan, OrbitControls' own modifier rule),
  // MIDDLE drag = pan (Fusion), right drag = pan; the wheel zooms toward the cursor; touch: one finger orbits, two fingers pan + pinch-zoom.
  // OrbitControls already cancels the canvas context menu, so a right drag pans.
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  controls.zoomToCursor = true;

  // vertex colours are the grey DEPTH multiplier; material.color is the tint (the flat colour, white under a texture). TASK 729: the two
  // materials are made once and only their parameters change with the look (applyLook), so a switch never touches the geometry.
  const WHITE = new THREE.Color(0xffffff);
  const edgeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true });
  const faceMaterial = new THREE.MeshStandardMaterial({ vertexColors: true });
  let look = normaliseLook(initialLook);
  // the textures, each made ONCE per view and cached: a photo loads lazily + async (the board shows the look's flat colour until it
  // arrives, then picks it up: same geometry, no layout change); a painted one is generated on first use (PAINTERS)
  const textures = new Map(); // key -> THREE.Texture, or null while a photo loads
  const prepTexture = (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return tex;
  };
  function textureOf(part, partName) {
    if (part.image) {
      if (!textures.has(part.image)) {
        textures.set(part.image, null);
        new THREE.TextureLoader().load(part.image, (tex) => { textures.set(part.image, prepTexture(tex)); applyLook(); render(); });
      }
      return textures.get(part.image);
    }
    const p = part.paint;
    if (!p) return null;
    if (!textures.has(part.key)) {
      const tex = prepTexture(new THREE.DataTexture(PAINTERS[p.paint](p, PAINT_SIZE), PAINT_SIZE, PAINT_SIZE));
      tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
      // the geometry's UVs are in plywood repeats (TILE_MM on a face, EDGE_TILE_MM on an edge): scale to this texture's own repeat
      const uvTile = partName === 'face' ? TILE_MM : EDGE_TILE_MM;
      tex.repeat.set(uvTile / p.tileMm, uvTile / p.tileMm);
      tex.needsUpdate = true;
      textures.set(part.key, tex);
    }
    return textures.get(part.key);
  }
  // the ONE material builder: the look's spec (lookSpec) onto the face and edge materials
  function applyLook() {
    const spec = lookSpec(look);
    for (const [mat, name] of [[faceMaterial, 'face'], [edgeMaterial, 'edge']]) {
      const part = spec[name];
      const map = textureOf(part, name);
      mat.map = map;
      mat.color.set(map ? 0xffffff : spec.color);
      mat.roughness = spec.roughness; mat.metalness = spec.metalness;
      mat.transparent = spec.transparent; mat.opacity = spec.opacity;
      mat.emissive.set(spec.color).lerp(WHITE, 0.5).multiplyScalar(part.glow); // an edge highlight (acrylic's lit cut edge, light even on black); 0 = none
      mat.needsUpdate = true;
    }
  }
  function setLook(next) { look = normaliseLook(next); applyLook(); render(); return look; }
  applyLook();
  let group = null, box = null, lastBuild = null, lastSig = null;
  const reliefCache = createReliefCache();

  // TASK 754: the drafting grid = ONE plane at the board's underside (the plane the workpiece sits on), drawn by one shader
  // (review-grid.js gridMaterialSource); its spec comes from the Design canvas's own declarations (reviewGridSpec), re-read when the Export
  // step is entered and when a grid / unit / style setting changes; the level follows the zoom on every render.
  const gridUniforms = {
    uMinorColor: { value: new THREE.Color() }, uMajorColor: { value: new THREE.Color() },
    uMinor: { value: 1 }, uMajor: { value: 1 }, uMinorFade: { value: 1 }, uPoints: { value: 0 }, uPxRatio: { value: 1 },
    uMarkMinor: { value: 1 }, uMarkMajor: { value: 1 }, uFadeFrom: { value: 1 }, uFadeTo: { value: 2 }, uCentre: { value: new THREE.Vector2() },
  };
  const gridMaterial = new THREE.ShaderMaterial({ ...gridMaterialSource, uniforms: gridUniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, // seen from below too
    polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
  const gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), gridMaterial);
  gridMesh.name = 'grid'; gridMesh.renderOrder = -1; gridMesh.visible = false; // drawn before a see-through board, which blends over it
  scene.add(gridMesh);
  let gridColors = null, gridSpec = null;
  function applyGridLook() {
    gridColors = designCanvasColors(getComputedStyle(designCanvas));
    scene.background.setStyle(gridColors.background);
    gridUniforms.uMinorColor.value.setStyle(gridColors.minor);
    gridUniforms.uMajorColor.value.setStyle(gridColors.major);
  }
  // where the camera looks at the grid: CSS px per mm there (the Design grid picks its level from its zoom the same way)
  const lookPoint = new THREE.Vector3();
  function placeGrid() {
    if (!box) { gridMesh.visible = false; return; }
    lookPoint.set(controls.target.x, -box.thickness, controls.target.z);
    const d = Math.max(1e-6, camera.position.distanceTo(lookPoint));
    const pxPerMm = Math.max(1, host.clientHeight) / (2 * d * Math.tan((camera.fov * Math.PI) / 360));
    gridSpec = reviewGridSpec({ settings: SettingsManager, unit: docUnit(), colors: gridColors, pxPerMm });
    gridMesh.visible = gridSpec.visible;
    const u = gridUniforms;
    u.uMinor.value = gridSpec.minor; u.uMajor.value = gridSpec.major; u.uMinorFade.value = gridSpec.fade;
    u.uPoints.value = gridSpec.mode === 'points' ? 1 : 0; u.uPxRatio.value = renderer.getPixelRatio();
    u.uMarkMinor.value = gridSpec.markPx.minor; u.uMarkMajor.value = gridSpec.markPx.major;
  }
  const render = () => { placeGrid(); renderer.render(scene, camera); };
  controls.addEventListener('change', render);
  applyGridLook();
  const unsubscribeSettings = SettingsManager.subscribe((key) => { if (key === null || GRID_SETTING_KEYS.has(key)) { applyGridLook(); render(); } });

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

  // TASK 778: a programmed pocket's start mark target (circle + cross, same derivation as SVG / Prepare / Export 2D) drawn in blue at top surface y = 0.05
  function startMarkObject(mark) {
    const arm = (Number(mark.dia) || 6) / 2, cr = arm * POCKET_CLEARING.startMarkCircleRatio, y = 0.05;
    const [cx, cz] = mark.point;
    const segs = 32, pos = [];
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      pos.push(cx + cr * Math.cos(a0), y, cz + cr * Math.sin(a0), cx + cr * Math.cos(a1), y, cz + cr * Math.sin(a1));
    }
    pos.push(cx - arm, y, cz, cx + arm, y, cz, cx, y, cz - arm, cx, y, cz + arm);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0x0068ff, depthTest: false });
    const lines = new THREE.LineSegments(geo, mat);
    lines.renderOrder = 10; lines.userData.mark = mark.kind; lines.userData.point = mark.point;
    return lines;
  }

  function disposeGroup() {
    if (!group) return;
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isSprite || o.isLine || o.isLineSegments) o.material.dispose(); });
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
    applyGridLook(); // the Design canvas's tokens may have changed since the last visit (a style template)
    if (sig !== undefined && sig === lastSig) { size(); render(); return lastBuild; }
    const t0 = performance.now();
    const inputs = getInputs();
    const rel = buildRelief({ ...inputs, cache: reliefCache }); // the cache reuses the work of unchanged cuts / levels
    disposeGroup();
    if (rel.stats.board === 'none') { // TASK 757: an empty design: no board, no grid, the Export step's empty-state message (the 2D view's) in the info
      box = null; lastSig = sig;
      lastBuild = { ms: performance.now() - t0, stages: rel.stats.ms, triangles: 0, levels: 0, skipped: rel.stats.skipped, unsetThrough: [], marks: 0, outsideStock: [], partlyOutside: [], board: 'none' };
      size(); render();
      showInfo([emptyText]);
      return lastBuild;
    }
    const T = rel.stockBox.thickness;
    group = new THREE.Group();
    const grainAlongX = rel.stockBox.maxX - rel.stockBox.minX >= rel.stockBox.maxY - rel.stockBox.minY;
    for (const [name, m] of Object.entries(rel.meshes)) {
      if (!m.indices.length) continue;
      const mesh = new THREE.Mesh(geometryOf(m, T, name, grainAlongX), FACE_MESHES.has(name) ? faceMaterial : edgeMaterial);
      mesh.name = name;
      group.add(mesh);
    }
    for (const mk of rel.marks) group.add(mk.kind === 'pocket-start' ? startMarkObject(mk) : markSprite(mk));
    scene.add(group);
    const firstBuild = !box;
    box = rel.stockBox;
    { // the grid plane under the board, centred on it, as wide as its fade-out (review-grid.js GRID_FADE)
      const R = Math.hypot(box.maxX - box.minX, box.maxY - box.minY) / 2;
      const cx = (box.minX + box.maxX) / 2, cz = (box.minY + box.maxY) / 2;
      gridMesh.position.set(cx, -box.thickness, cz);
      gridMesh.scale.set(2 * GRID_FADE.to * R, 1, 2 * GRID_FADE.to * R);
      gridUniforms.uCentre.value.set(cx, cz); gridUniforms.uFadeFrom.value = GRID_FADE.from * R; gridUniforms.uFadeTo.value = GRID_FADE.to * R;
    }
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
    if (Array.isArray(inputs.notes)) lines.push(...inputs.notes);
    showInfo(lines);
    return lastBuild;
  }
  // The info's lines, as text (never markup: a note carries a Fusion label). TASK 757: on a PHONE, more than one line FOLDS (disclosure.js, the Operations sheet's
  // fold): the first line is the header button (one line, with the caret), the others its body, folded by default so the notes never hide the part; a tap
  // unfolds them (the full text, unchanged) and the choice is kept across rebuilds. A wide screen shows every line as before.
  let infoOpen = false;
  function showInfo(lines) {
    const line = (t) => { const d = document.createElement('div'); d.textContent = t; return d; };
    if (!isPhone(window) || lines.length < 2) { delete info.dataset.open; info.replaceChildren(...lines.map(line)); return; }
    const head = document.createElement('button'); head.type = 'button'; head.className = 'review-info-head';
    const sum = document.createElement('span'); sum.textContent = lines[0];
    head.append(sum); head.insertAdjacentHTML('beforeend', CARET_SVG);
    const body = document.createElement('div'); body.className = 'review-info-body';
    body.append(...lines.slice(1).map(line));
    info.replaceChildren(head, body);
    mountDisclosure({ host: info, head, body, open: infoOpen, onToggle: (open) => { infoOpen = open; } });
  }

  const ro = new ResizeObserver(() => { size(); render(); });
  ro.observe(host);
  renderer.domElement.addEventListener('dblclick', fit);

  function destroy() {
    ro.disconnect(); unsubscribeSettings(); controls.dispose(); disposeGroup(); faceMaterial.dispose(); edgeMaterial.dispose();
    gridMesh.geometry.dispose(); gridMaterial.dispose();
    if (labelTexture) labelTexture.dispose();
    for (const tex of textures.values()) if (tex) tex.dispose();
    renderer.dispose(); renderer.domElement.remove();
  }
  // inspect(): the look and both materials as applied, the meshes (name, geometry id, which material) and the top mesh's first vertex with
  // its uv, the camera target / position (read by the tests)
  const inspect = () => {
    const t = group && group.children.find((o) => o.name === 'top');
    const p = t && t.geometry.getAttribute('position'), u = t && t.geometry.getAttribute('uv');
    const mat = (m) => ({ uuid: m.uuid, map: m.map ? (m.map.isDataTexture ? 'painted' : 'image') : null, color: m.color.getHexString(), roughness: m.roughness, metalness: m.metalness, transparent: m.transparent, opacity: m.opacity, emissive: m.emissive.getHexString() });
    return {
      look, face: mat(faceMaterial), edge: mat(edgeMaterial),
      mapLoaded: !!textures.get(WOOD_URL), edgeLoaded: !!textures.get(EDGE_URL), textures: textures.size,
      meshes: group ? group.children.filter((o) => o.isMesh).map((o) => ({ name: o.name, geometry: o.geometry.uuid, material: o.material === faceMaterial ? 'face' : o.material === edgeMaterial ? 'edge' : 'other' })) : [],
      marks: group ? group.children.filter((o) => o.userData && o.userData.mark).map((o) => ({ kind: o.userData.mark, point: o.userData.point || null })) : [],
      top: p && u ? { x: p.getX(0), z: p.getZ(0), u: u.getX(0), v: u.getY(0) } : null,
      target: controls.target.toArray(), camera: camera.position.toArray(),
      background: '#' + scene.background.getHexString(),
      box: box && { minX: box.minX, maxX: box.maxX, minZ: box.minY, maxZ: box.maxY, y: -box.thickness }, // the board in scene axes (y = its underside)
      grid: gridSpec && { ...gridSpec, shown: gridMesh.visible, y: gridMesh.position.y, minorColor: '#' + gridUniforms.uMinorColor.value.getHexString(), majorColor: '#' + gridUniforms.uMajorColor.value.getHexString() },
    };
  };
  // screenOf([x, y, z]) -> { x, y } CSS px inside the canvas, where that world point is drawn (read by the tests)
  const screenOf = ([x, y, z]) => {
    const v = new THREE.Vector3(x, y, z).project(camera);
    return { x: ((v.x + 1) / 2) * host.clientWidth, y: ((1 - v.y) / 2) * host.clientHeight };
  };
  return { refresh, reset, top, fit, setLook, inspect, screenOf, destroy, get look() { return look; }, get lastBuild() { return lastBuild; } };
}

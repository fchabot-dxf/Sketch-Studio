// tests/orbit-pivot-823-node.test.js — TASK 823: the orbit turns around the point under the pointer (orbit-stage.js attachPivotOrbit / turnAbout), with the
// vendored three r170 and its REAL OrbitControls on a stub canvas (no WebGL, no browser).
//  1. turnAbout: the pivot keeps its distances (so its screen position) under any turn; the identity turn changes nothing.
//  2. A press on a drawn mesh then orbit steps (OrbitControls' own rotate): the pressed point's screen position moves < 0.01 px over 3 drag steps, while a far
//     point moves (the scene does turn); the press itself changes neither the camera nor the target.
//  3. A press on empty background: the target is kept and the orbit turns round it.
//  4. Shift + left (pan), the middle button, a translucent overlay (depthWrite false) and a second touch finger do not pick a pivot.
import assert from 'node:assert';
import { register } from 'node:module';

// the page maps the bare 'three' with an import map; node gets the same mapping from a resolve hook (the vendored copy, r170)
const vendor = new URL('../packages/ui/vendor/three/three.module.js', import.meta.url).href;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) { return s === 'three' ? { url: ${JSON.stringify(vendor)}, shortCircuit: true } : next(s, c); }`));
const THREE = await import('three');
const { OrbitControls } = await import('../packages/ui/vendor/three/addons/controls/OrbitControls.js');
const { turnAbout, attachPivotOrbit } = await import('../apps/shaper/src/orbit-stage.js');

let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };
const near = (a, b, tol, m) => { assert.ok(Math.abs(a - b) <= tol, `${m}: ${a} vs ${b} (tol ${tol})`); checks++; };
assert.strictEqual(THREE.REVISION, '170'); checks++;

// 1. turnAbout
{
  const P = new THREE.Vector3(3, -2, 5), pos = new THREE.Vector3(10, 20, 30), tgt = new THREE.Vector3(1, 2, 3);
  const dq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0.3, 1, -0.2).normalize(), 0.7);
  const out = turnAbout(THREE, P, pos, tgt, dq);
  near(out.position.distanceTo(P), pos.distanceTo(P), 1e-12, 'distance camera-pivot kept');
  near(out.target.distanceTo(P), tgt.distanceTo(P), 1e-12, 'distance target-pivot kept');
  const id = turnAbout(THREE, P, pos, tgt, new THREE.Quaternion());
  near(id.position.distanceTo(pos), 0, 1e-12, 'identity: position'); near(id.target.distanceTo(tgt), 0, 1e-12, 'identity: target');
}

// the stage without WebGL: a stub canvas, a board (depth-writing mesh) and an overlay plane (depthWrite false) under it
globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => (n === '--sk-selection' ? ' #017AFD' : '') });
const W = 800, H = 600;
const element = Object.assign(new EventTarget(), { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: W, height: H }), setPointerCapture() {}, releasePointerCapture() {}, getRootNode: () => ({ addEventListener() {}, removeEventListener() {} }) });
const scene = new THREE.Scene();
const board = new THREE.Mesh(new THREE.BoxGeometry(200, 20, 120), new THREE.MeshBasicMaterial());
board.position.set(0, -10, 0);
const overlay = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
overlay.position.y = -20;
scene.add(board, overlay);
const camera = new THREE.PerspectiveCamera(35, W / H, 1, 100000);
camera.position.set(260, 300, 330); camera.lookAt(0, -10, 0);
const controls = new OrbitControls(camera, element); controls.enableDamping = false; controls.target.set(0, -10, 0); controls.update();
const stage = attachPivotOrbit(THREE, { scene, camera, controls, element, pixelRatio: 1 });
let renders = 0; // registered AFTER attachPivotOrbit, like the callers' render
controls.addEventListener('change', () => renders++);
const screenOf = (v) => { const p = v.clone().project(camera); return { x: ((p.x + 1) / 2) * W, y: ((1 - p.y) / 2) * H }; };
const ptr = (type, o) => element.dispatchEvent(Object.assign(new Event(type), { pointerType: 'mouse', pointerId: 1, button: 0, shiftKey: false, ctrlKey: false, metaKey: false, clientX: 0, clientY: 0 }, o));
const orbit = (dTheta, dPhi) => { controls._rotateLeft(dTheta); controls._rotateUp(dPhi); controls.update(); }; // what a drag does (OrbitControls' own handlers)
const px = (v) => { const s = screenOf(v); return [s.x, s.y]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// 2. press on a corner of the board's top face, orbit three steps
{
  camera.updateMatrixWorld();
  const corner = new THREE.Vector3(100, 0, 60);
  const s = screenOf(corner);
  const posBefore = camera.position.clone(), quatBefore = camera.quaternion.clone(), tgtBefore = controls.target.clone();
  const far = new THREE.Vector3(-100, -20, -60), farBefore = px(far);
  ptr('pointerdown', { clientX: s.x - 3, clientY: s.y + 3 }); // a few px inside the corner: still on the top face
  ok(stage.pivot(), 'the press hit the board');
  ok(stage.dot.visible, 'the dot shows while the orbit lasts');
  near(stage.dot.position.distanceTo(corner), 0, 6, 'the pivot is the pressed surface point');
  near(camera.position.distanceTo(posBefore), 0, 1e-12, 'the press does not move the camera'); near(camera.quaternion.angleTo(quatBefore), 0, 1e-12, 'the press does not turn the camera');
  near(controls.target.distanceTo(tgtBefore), 0, 1e-12, 'the press does not move the target');
  const pivot = stage.pivot().clone(), start = px(pivot);
  for (const [a, b] of [[0.2, 0.1], [0.25, -0.05], [-0.4, 0.12]]) { orbit(a, b); near(dist(px(pivot), start), 0, 0.01, 'the pivot stays put on screen'); }
  ok(dist(px(far), farBefore) > 40, 'the rest of the scene turned round it: the far point moved ' + dist(px(far), farBefore).toFixed(0) + ' px');
  ptr('pointerup', {});
  ok(!stage.dot.visible && !stage.pivot(), 'release: no pivot, no dot');
  ok(renders > 3, 'the callers were told to render');
}
// 3. empty background: the top edge of the picture looks past the board
{
  controls.target.set(0, -10, 0); camera.position.set(260, 300, 330); camera.lookAt(0, -10, 0); controls.update(); camera.updateMatrixWorld();
  const tgtBefore = controls.target.clone(), radius = camera.position.distanceTo(tgtBefore);
  ptr('pointerdown', { clientX: W / 2, clientY: 2 });
  ok(!stage.pivot(), 'no hit: no pivot'); ok(!stage.dot.visible, 'no hit: no dot');
  orbit(0.3, 0);
  near(controls.target.distanceTo(tgtBefore), 0, 1e-9, 'no hit: the target is kept');
  near(camera.position.distanceTo(controls.target), radius, 1e-6, 'no hit: the orbit is round the target');
  ptr('pointerup', {});
}
// 4. no pivot for a pan press, the overlay alone, or a second finger
{
  camera.updateMatrixWorld();
  const s = screenOf(new THREE.Vector3(100, 0, 60));
  ptr('pointerdown', { clientX: s.x - 3, clientY: s.y + 3, shiftKey: true }); ok(!stage.pivot(), 'Shift + left pans: no pivot'); ptr('pointerup', {});
  ptr('pointerdown', { clientX: s.x - 3, clientY: s.y + 3, button: 1 }); ok(!stage.pivot(), 'the middle button pans: no pivot'); ptr('pointerup', { button: 1 });
  board.visible = false;
  ptr('pointerdown', { clientX: s.x - 3, clientY: s.y + 3 }); ok(!stage.pivot(), 'a translucent overlay (depthWrite false) is not a surface'); ptr('pointerup', {});
  board.visible = true;
  ptr('pointerdown', { pointerType: 'touch', pointerId: 7, clientX: s.x - 3, clientY: s.y + 3 }); ok(stage.pivot(), 'touch: the first finger orbits round its point');
  ptr('pointerdown', { pointerType: 'touch', pointerId: 8, clientX: s.x, clientY: s.y }); ok(!stage.pivot() && !stage.dot.visible, 'the second finger (pan + pinch): no pivot');
  ptr('pointerup', { pointerType: 'touch', pointerId: 8 }); ptr('pointerup', { pointerType: 'touch', pointerId: 7 });
}
stage.dispose(); controls.dispose();
console.log(`orbit-pivot-823 node: ${checks} checks passed`);

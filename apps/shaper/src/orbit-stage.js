// apps/shaper/src/orbit-stage.js — TASK 808: the ONE three.js stage Shaper's 3D views share (the 3D Review, review-view.js, and the STL Orient view,
// orient-view.js): the renderer in `host`, a scene with the two lights, a perspective camera and the Fusion-like orbit navigation, declared once.
// three itself is imported by the caller (dynamically: it downloads only when a 3D view first opens; vendored under packages/ui/vendor/three, 0.170.0).
//   createOrbitStage(THREE, OrbitControls, host) -> { renderer, scene, sun, camera, controls, size() }
export function createOrbitStage(THREE, OrbitControls, host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
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
  function size() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  return { renderer, scene, sun, camera, controls, size };
}

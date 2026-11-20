// apps/shaper/src/orbit-stage.js — TASK 808: the ONE three.js stage Shaper's 3D views share (the 3D Review, review-view.js, and the STL Orient view,
// orient-view.js): the renderer in `host`, a scene with the two lights, a perspective camera and the Fusion-like orbit navigation, declared once.
// three itself is imported by the caller (dynamically: it downloads only when a 3D view first opens; vendored under packages/ui/vendor/three, 0.170.0).
//   createOrbitStage(THREE, OrbitControls, host) -> { renderer, scene, sun, camera, controls, size(), pivot() }   pivot() = the world point an orbit in progress turns round, or null
// TASK 823: an ORBIT turns around the point of the drawing under the pointer (attachPivotOrbit below); the wheel / pinch zoom toward the pointer is
// OrbitControls' own zoomToCursor (three r170 supports it: packages/ui/vendor/three, REVISION '170').

// The camera pose after turning by `dq` (a THREE.Quaternion, the rotation the camera's orientation took) about the world point `pivot`: a rigid
// turn of the camera position AND of the orbit target, so `pivot` keeps its camera-space coordinates, hence its screen position (PURE).
//   -> { position, target } (new THREE.Vector3s)
export function turnAbout(THREE, pivot, position, target, dq) {
  const turn = (p) => p.clone().sub(pivot).applyQuaternion(dq).add(pivot);
  return { position: turn(position), target: turn(target) };
}

// Orbit around the pointer's point. OrbitControls orbits the camera round controls.target and re-aims it there (lookAt), so moving the target to the
// pressed point would TURN the camera (the picture jumps on the press). Instead the press changes nothing: it only remembers the point P under the
// pointer; OrbitControls runs unchanged, and on each of its 'change' events the turn it made (the camera's quaternion delta) is applied again about P
// (turnAbout) to the camera position and the target. A turn about P of the whole pose = the orbit round P, and P stays exactly where it was drawn.
// A press on empty background (no hit) orbits round the current target. Only the drawn surfaces are hit: meshes that write depth (the board, the
// relief, the part), not the translucent overlays (the grid plane, the Orient floor plate: depthWrite false). A dot in the selection colour
// (--sk-selection, read at the press) marks P while the orbit lasts. `element` = the canvas; `pixelRatio` sizes the dot in screen px.
export function attachPivotOrbit(THREE, { scene, camera, controls, element, pixelRatio = 1 }) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const dotMaterial = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color() }, uSize: { value: 12 } },
    vertexShader: 'uniform float uSize; void main() { gl_PointSize = uSize; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: ['uniform vec3 uColor;', 'void main() {', '  float r = length(gl_PointCoord - 0.5); if (r > 0.5) discard;', '  gl_FragColor = vec4(r > 0.36 ? vec3(1.0) : uColor, 1.0);', '#include <colorspace_fragment>', '}'].join('\n'),
    depthTest: false, depthWrite: false, transparent: true,
  });
  const dotGeometry = new THREE.BufferGeometry();
  dotGeometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
  const dot = new THREE.Points(dotGeometry, dotMaterial);
  dot.name = 'orbit-pivot'; dot.renderOrder = 999; dot.frustumCulled = false; dot.visible = false;
  scene.add(dot);
  const touches = new Set();
  let pivot = null, notifying = false;
  const prev = { position: camera.position.clone(), target: controls.target.clone(), quaternion: camera.quaternion.clone() }; // the pose before OrbitControls' last step
  const remember = () => { prev.position.copy(camera.position); prev.target.copy(controls.target); prev.quaternion.copy(camera.quaternion); };
  const changed = () => { notifying = true; controls.dispatchEvent({ type: 'change' }); notifying = false; }; // the callers render on 'change'

  function surfaceAt(e) {
    const r = element.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    camera.updateMatrixWorld();
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.isMesh && h.object.material.depthWrite !== false && h.object.visible);
    return hit ? hit.point.clone() : null;
  }
  function onDown(e) {
    const first = touches.size === 0;
    if (e.pointerType === 'touch') touches.add(e.pointerId);
    const orbits = e.pointerType === 'touch' ? first : e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey; // OrbitControls' own rule: Shift / Ctrl + left pans
    pivot = orbits ? surfaceAt(e) : null;
    remember();
    if (!pivot) { if (dot.visible) { dot.visible = false; changed(); } return; }
    const colour = getComputedStyle(element).getPropertyValue('--sk-selection').trim();
    if (!colour) throw new Error('orbit-stage: the selection colour token --sk-selection resolves to nothing');
    dotMaterial.uniforms.uColor.value.set(colour);
    dotMaterial.uniforms.uSize.value = 12 * pixelRatio;
    dot.position.copy(pivot); dot.visible = true;
    changed();
  }
  function onUp(e) {
    touches.delete(e.pointerId);
    if (e.pointerType === 'touch' && touches.size) return;
    pivot = null;
    if (dot.visible) { dot.visible = false; changed(); }
  }
  controls.addEventListener('change', () => {
    if (notifying) return;
    if (pivot) {
      const dq = camera.quaternion.clone().multiply(prev.quaternion.clone().invert()); // the turn OrbitControls just made
      const next = turnAbout(THREE, pivot, prev.position, prev.target, dq);               // the same turn, about the pivot, from the pose before it
      camera.position.copy(next.position); controls.target.copy(next.target);
      camera.updateMatrixWorld();
    }
    remember();
  });
  element.addEventListener('pointerdown', onDown, true); // capture: before OrbitControls' own pointerdown
  element.addEventListener('pointerup', onUp); element.addEventListener('pointercancel', onUp);
  return { dot, pivot: () => pivot, dispose() { element.removeEventListener('pointerdown', onDown, true); element.removeEventListener('pointerup', onUp); element.removeEventListener('pointercancel', onUp); scene.remove(dot); dotGeometry.dispose(); dotMaterial.dispose(); } };
}

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
  const orbitPivot = attachPivotOrbit(THREE, { scene, camera, controls, element: renderer.domElement, pixelRatio: renderer.getPixelRatio() }); // its listeners live on the canvas, which the callers remove
  function size() {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  return { renderer, scene, sun, camera, controls, size, pivot: orbitPivot.pivot };
}

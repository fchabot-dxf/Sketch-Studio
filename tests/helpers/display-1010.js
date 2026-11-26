// tests/helpers/display-1010.js -- the shared node-app fixture for the task 1010 display / snap tests (BUG-130..139).
// (node-app is imported inside openDoc: it installs a fake DOM, which would break a browser test that only needs docOf)

/** a v3 design document: joints {id: [x, y, fixed?]} (a joint may carry a 4th extra object), shapes, constraints */
export function docOf(joints, shapes, constraints = [], parameters = []) {
  return {
    version: 3, hosts: {},
    geometry: {
      joints: [['j_origin', { x: 0, y: 0, fixed: true, sketchId: 'sketch-1' }],
        ...Object.entries(joints).map(([id, [x, y, fixed, extra]]) => [id, { x, y, fixed: !!fixed, sketchId: 'sketch-1', ...(extra || {}) }])],
      shapes: shapes.map((s) => ({ sketchId: 'sketch-1', isConstruction: false, ...s })),
      constraints, parameters,
      sketches: [{ id: 'sketch-1', name: 'Sketch 1', visible: true }],
      activeSketchId: 'sketch-1', groups: [], profiles: [],
    },
  };
}

/** open `doc` in a fresh node app; returns the app (the caller closes it) */
export async function openDoc(doc, opts = {}) {
  const { open, createProfile, createNamedDesign } = await import('./node-app.js');
  const profile = await createProfile();
  await createNamedDesign(profile, opts.host || 'sketchstudio', 'Display 1010', doc);
  return open({ host: opts.host || 'sketchstudio', profile, ...(opts.open || {}) });
}

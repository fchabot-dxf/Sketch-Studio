// Interaction helper: converts UI drag events into temporary "mouse-spring" constraints
// The InteractionSolver attaches a soft, high-weight constraint pulling a single joint towards a target

import { SolverConfig } from '../solver-config.js';

export class InteractionSolver {
  constructor(solver) {
    this.solver = solver;
    this._tempConstraints = null;
  }

  // Attach a temporary spring that will be present only during the solve() call
  // dragTarget: { jointId, x, y, stiffness } (a JOINT drag) or { body: { shape, param }, x, y, stiffness } (a BODY drag, task 538:
  // the grabbed point of the shape, declared per shape kind in definitions.js BODY_POINTS) or { springs: [{ jointId, x, y }], stiffness }
  // (a GROUP drag, task 588: the select tool moving a selection; one JOINT-form spring per member, each toward its own target)
  attachMouseSpring(dragTarget) {
    if (!dragTarget || (!dragTarget.jointId && !dragTarget.body && !(dragTarget.springs && dragTarget.springs.length))) return null;
    const cid = '_mouse_spring_temp';
    const defaultStrength = (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4;
    const strength = (dragTarget.stiffness != null) ? dragTarget.stiffness : defaultStrength;

    // We'll emulate a very stiff distance constraint to the desired mouse position.
    // Represent as a pseudo-constraint object used by NewtonSolver during assembly.
    const spring = (jointId, x, y) => ({ id: cid, type: 'mouse_spring', joints: jointId ? [ jointId ] : [], value: [ x, y ], stiffness: strength });
    const temps = dragTarget.springs ? dragTarget.springs.map(s => spring(s.jointId, s.x, s.y)) : [ spring(dragTarget.body ? null : dragTarget.jointId, dragTarget.x, dragTarget.y) ];
    if (dragTarget.body) temps[0].body = { shape: dragTarget.body.shape, param: dragTarget.body.param, hold: dragTarget.body.hold || [] };

    // Register temporarily in solver.constraints for the duration of the solve.
    this.solver.constraints.push(...temps);
    this._tempConstraints = temps;

    // return cleanup function
    return () => this.cleanup();
  }

  // Public cleanup: remove any attached temporary spring immediately
  cleanup() {
    if (!this._tempConstraints) return;
    for (const t of this._tempConstraints) {
      const i = this.solver.constraints.indexOf(t);
      if (i >= 0) this.solver.constraints.splice(i, 1);
    }
    this._tempConstraints = null;
  }
}

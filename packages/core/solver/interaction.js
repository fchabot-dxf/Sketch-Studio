// Interaction helper: converts UI drag events into temporary "mouse-spring" constraints
// The InteractionSolver attaches soft, high-weight constraints pulling joints (or a shape's grabbed point) towards their targets

import { SolverConfig } from '../solver-config.js';

export class InteractionSolver {
  constructor(solver) {
    this.solver = solver;
    this._temp = [];
  }

  // Attach the temporary springs of a drag, present only during the solve() call.
  // dragTargets: one spring or a list (TASK 584: a drag that CARRIES several joints, e.g. an arc grabbed by its centre with both rims,
  // pulls each toward its own target, engine._jointDragSprings). A spring is { jointId, x, y, stiffness } (a JOINT drag) or
  // { body: { shape, param }, x, y, stiffness } (a BODY drag, task 538: the grabbed point of the shape, declared per shape kind in
  // definitions.js BODY_POINTS)
  attachMouseSpring(dragTargets) {
    const list = (Array.isArray(dragTargets) ? dragTargets : [dragTargets]).filter(t => t && (t.jointId || t.body));
    if (!list.length) return null;
    const defaultStrength = (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4;
    for (const dragTarget of list) {
      // We'll emulate a very stiff distance constraint to the desired mouse position.
      // Represent as a pseudo-constraint object used by NewtonSolver during assembly.
      const temp = {
        id: '_mouse_spring_temp',
        type: 'mouse_spring',
        joints: dragTarget.body ? [] : [ dragTarget.jointId ],
        value: [ dragTarget.x, dragTarget.y ],
        stiffness: (dragTarget.stiffness != null) ? dragTarget.stiffness : defaultStrength
      };
      if (dragTarget.body) temp.body = { shape: dragTarget.body.shape, param: dragTarget.body.param, hold: dragTarget.body.hold || [] };
      // Register temporarily in solver.constraints for the duration of the solve.
      this.solver.constraints.push(temp);
      this._temp.push(temp);
    }

    // return cleanup function
    return () => this.cleanup();
  }

  // Public cleanup: remove every attached temporary spring immediately
  cleanup() {
    for (const temp of this._temp) {
      const i = this.solver.constraints.indexOf(temp);
      if (i >= 0) this.solver.constraints.splice(i, 1);
    }
    this._temp = [];
  }
}

// Interaction helper: converts UI drag events into temporary "mouse-spring" constraints
// The InteractionSolver attaches a soft, high-weight constraint pulling a single joint towards a target

import { SolverConfig } from '../solver-config.js';

export class InteractionSolver {
  constructor(solver) {
    this.solver = solver;
    this._tempConstraint = null;
  }

  // Attach a temporary spring that will be present only during the solve() call
  // dragTarget: { jointId, x, y, stiffness }
  attachMouseSpring(dragTarget) {
    if (!dragTarget || !dragTarget.jointId) return null;
    const cid = '_mouse_spring_temp';
    const jointId = dragTarget.jointId;
    const defaultStrength = (SolverConfig.DRAG_STRENGTH || 1.0) * 1e4;
    const strength = (dragTarget.stiffness != null) ? dragTarget.stiffness : defaultStrength;

    // We'll emulate a very stiff distance constraint to the desired mouse position.
    // Represent as a pseudo-constraint object used by NewtonSolver during assembly.
    const temp = {
      id: cid,
      type: 'mouse_spring',
      joints: [ jointId ],
      value: [ dragTarget.x, dragTarget.y ],
      stiffness: strength
    };

    // Register temporarily in solver.constraints for the duration of the solve.
    this.solver.constraints.push(temp);
    this._tempConstraint = temp;

    // return cleanup function
    return () => this.cleanup();
  }

  // Public cleanup: remove any attached temporary spring immediately
  cleanup() {
    if (!this._tempConstraint) return;
    const i = this.solver.constraints.indexOf(this._tempConstraint);
    if (i >= 0) this.solver.constraints.splice(i, 1);
    this._tempConstraint = null;
  }
}

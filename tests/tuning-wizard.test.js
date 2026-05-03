(async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };
  const { setupTuningWizard } = await import('../src/ui/tuning-wizard.js');
  const { SolverConfig } = await import('../src/core/solver-config.js');

  // Minimal fake state for initialization
  const state = { engine: { solve: () => {} } };

  // Ensure panel is created and contains the expected knobs
  setupTuningWizard(state);
  const panel = document.getElementById('tuning-wizard-panel');
  assert(panel, 'Tuning wizard panel should be present');

  // Visual style assertion: unified white background + shared font + unified width/border
  assert(panel.style.cssText.indexOf('background: #ffffff') !== -1, 'Tuning Wizard must use white background');
  assert(panel.style.cssText.indexOf("'SF Mono'") !== -1, 'Tuning Wizard must use the unified monospace font');
  assert(panel.style.cssText.indexOf('width: 320px') !== -1, 'Tuning Wizard width must be unified to 320px');
  assert(panel.style.cssText.indexOf('border: 1px solid #e6eef8') !== -1, 'Tuning Wizard must use unified border style');

  // Exposed (must exist)
  assert(document.getElementById('val-ITERATIONS'), 'ITERATIONS slider should be present');
  assert(document.getElementById('val-LM_LAMBDA_INIT'), 'LM_LAMBDA_INIT slider should be present');
  assert(document.getElementById('val-LM_LAMBDA_UP'), 'LM_LAMBDA_UP slider should be present');
  assert(document.getElementById('val-LM_LAMBDA_DOWN'), 'LM_LAMBDA_DOWN slider should be present');
  assert(document.getElementById('val-LM_TOL'), 'LM_TOL slider should be present');

  // Interaction / magnetism preserved
  assert(document.getElementById('val-DRAG_STRENGTH'), 'DRAG_STRENGTH should be present');
  assert(document.getElementById('val-SNAP_MAGNETISM'), 'SNAP_MAGNETISM should be present');
  assert(document.getElementById('val-GRID_MAGNETISM'), 'GRID_MAGNETISM should be present');
  // Whisker stroke slider moved to Debug Panel — no longer present in Tuning Wizard

  // Removed legacy sliders — these must NOT be present
  assert(!document.getElementById('val-CONSTRAINT_RATE'), 'CONSTRAINT_RATE slider must be removed');
  assert(!document.getElementById('val-RELAXATION'), 'RELAXATION slider must be removed');
  assert(!document.getElementById('val-SANDBOX_ITERATIONS'), 'SANDBOX_ITERATIONS slider must be removed');

  // Cleanup: remove panel from DOM so other tests aren't affected
  try { const p = document.getElementById('tuning-wizard-panel'); if (p && p.parentNode) p.parentNode.removeChild(p); } catch(_){}

  console.log('tuning-wizard UI tests passed ✅');
})().catch(e => { console.error('tuning-wizard UI tests failed ❌', e); process.exit(1); });
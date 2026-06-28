import assert from 'assert';
import SettingsManager from '../src/core/settings-manager.js';
import { computeBaseJointRadiusFor } from '../apps/sketchstudio/svg-renderer.js';

// Ensure small JOINT_RADIUS values produce a visible base radius (clamped at 0.4)
{
  SettingsManager.set('JOINT_RADIUS', 0.1, { persist: 'local' });
  const base = computeBaseJointRadiusFor(0.1);
  assert.strictEqual(base, 0.4, 'Base radius should be clamped to 0.4 for JOINT_RADIUS=0.1');
}

// Larger values scale linearly
{
  SettingsManager.set('JOINT_RADIUS', 2.0, { persist: 'local' });
  const base = computeBaseJointRadiusFor(2.0);
  assert.strictEqual(base, 8.0, 'Base radius should be JOINT_RADIUS*4 for JOINT_RADIUS=2.0');
}

console.log('Joint radius tests passed ✅');

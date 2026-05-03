import SettingsManager from '../src/core/settings-manager.js';
import fs from 'fs';
import path from 'path';

(async function(){
  const TEST_P = path.resolve(process.cwd(), 'sketch-studio.config.json');
  try { if (fs.existsSync(TEST_P)) fs.unlinkSync(TEST_P); } catch(_){}

  // Ensure defaults present
  const all = SettingsManager.getAll();
  if (typeof all.SNAP_MAGNETISM !== 'number') throw new Error('SNAP_MAGNETISM default missing');
  // Verify tightened debug-label defaults
  if (SettingsManager.get('DEBUG_LABEL_INTRA_LINE_SPACING') !== 0.90) throw new Error('DEBUG_LABEL_INTRA_LINE_SPACING default incorrect');
  if (SettingsManager.get('DEBUG_LABEL_LINE_SPACING') !== 1.1) throw new Error('DEBUG_LABEL_LINE_SPACING default incorrect');
  if (SettingsManager.get('DEBUG_LABEL_FONT_SIZE') !== 9) throw new Error('DEBUG_LABEL_FONT_SIZE default incorrect');

  // Set a project-level value and verify it persists
  SettingsManager.set('SNAP_MAGNETISM', 77, { persist: 'project' });
  // Reload manager to reflect file reading on disk (create a fresh instance by re-import)
  const mod = await import('../src/core/settings-manager.js');
  const fresh = mod.default;
  if (fresh.get('SNAP_MAGNETISM') !== 77) throw new Error('Project persisted SNAP_MAGNETISM not found');

  // Cleanup
  try { fs.unlinkSync(TEST_P); } catch(_){}

  console.log('settings-manager tests passed ✅');
})().catch(e=>{ console.error('settings-manager tests failed ❌', e); process.exit(1); });
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

(async function main() {
  const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'Assertion failed'); };

  const TEST_P = path.resolve(process.cwd(), 'sketch-studio.config.json');

  // Ensure no leftover file
  try { if (fs.existsSync(TEST_P)) fs.unlinkSync(TEST_P); } catch(_){}

  // Write a project config that overrides snap magnetism and grid magnetism
  const cfg = { SNAP_MAGNETISM: 42, GRID_MAGNETISM: 15, SNAP_RADIUS: 99 };
  fs.writeFileSync(TEST_P, JSON.stringify(cfg), 'utf8');

  // Spawn a node process to import solver-config fresh (ESM import) and print values
  const solverPath = path.resolve(process.cwd(), 'packages', 'core', 'solver-config.js').replace(/\\/g, '/');
  const script = `import('file://${solverPath}').then(m => console.log(JSON.stringify(m.SolverConfig))).catch(e => { console.error('IMPORT_ERR', e); process.exit(2); });`;

  const cmd = `"${process.execPath}" -e "${script.replace(/"/g, '\\"')}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  const json = JSON.parse(out.trim());

  try {
    assert(json.SNAP_MAGNETISM === 42, 'SNAP_MAGNETISM should be overridden by project config');
    assert(json.GRID_MAGNETISM === 15, 'GRID_MAGNETISM should be overridden by project config');
    assert(json.SNAP_RADIUS === 99, 'SNAP_RADIUS should be overridden by project config');
    console.log('settings-project-config tests passed ✅');
  } finally {
    // Cleanup
    try { fs.unlinkSync(TEST_P); } catch(_){}
  }

})().catch(e => { console.error('settings-project-config tests failed ❌', e); process.exit(1); });
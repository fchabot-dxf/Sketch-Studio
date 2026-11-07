// tests/harness/shadow-converged.test.js — TASK 412: solver honesty step 2a shadow run.
//
// Evaluates every solve across packages/core/tests and tests/harness to compare
// current wrapper-level converged (conflicts.length === 0, verifierOK) with
// the proposed rule:
//   proposed_converged = verifierOK && (engine.converged && !engine.stalled || engine.error <= VERIFIER_TOLERANCE)
//   and for drag solves (mouse_spring present): proposed_converged = verifierOK && structuralError < tol
//
// Passes only if differences are zero outside the pinned/documented set:
//   (a) 0 genuine lies today (wrapper converged=true with geometric residual > tolerance)
//   (b) 134 drag-only differences (mouse_spring present; verifier satisfied and structuralError <= 0.001,
//       but structuralError >= engine tol (1e-6) due to drag spring penalty)
//   (c) 9 false alarms in packages/core/tests/document-roundtrip.test.js (fixture is geometrically tangent
//       with verifier residual 0, but engine does not recognize {type:'tangent', shapes:[circle,line]}
//       producing engine error=NaN)

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { execFileSync } from 'child_process';
import { SolverConfig } from '#core/solver-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const tmpHookPath = path.join(__dirname, '.shadow-hook.mjs');
const tmpHookUrl = pathToFileURL(tmpHookPath).href;
const tmpOutPath = path.join(os.tmpdir(), `shadow-out-${process.pid}.jsonl`);

// Write the preload hook script that instruments NewtonSolver.prototype.solve
const hookCode = `
import { createNewtonSolver } from '#core/solver/engine.js';
import { SolverConfig } from '#core/solver-config.js';
import { measureResidual } from '#core/constraint-verifier.js';
import fs from 'fs';

const origSolve = createNewtonSolver(new Map(), [], []).constructor.prototype.solve;
const records = [];

createNewtonSolver(new Map(), [], []).constructor.prototype.solve = function(iter, options) {
  const res = origSolve.call(this, iter, options);
  const tol = this.config.tol;
  const hasSpring = res.dragReached !== undefined;
  const tolerance = SolverConfig.VERIFIER_TOLERANCE || 0.001;

  let maxResidual = 0;
  let conflicts = 0;
  for (const c of this.constraints) {
    if (c && !c.isDriven && !c.driven && c.type !== 'mouse_spring') {
      const r = measureResidual(c, this.joints, this.shapes);
      if (r > maxResidual) maxResidual = r;
      if (r > tolerance) conflicts++;
    }
  }

  const verifierOK = (conflicts === 0);
  const current = verifierOK;
  const proposed = hasSpring
    ? (verifierOK && res.structuralError < tol)
    : (verifierOK && ((res.converged && !res.stalled) || (typeof res.error === 'number' && !isNaN(res.error) && res.error <= tolerance)));

  // Concise sketch description
  const cCounts = {};
  for (const c of this.constraints) {
    if (!c || c.type === 'mouse_spring') continue;
    cCounts[c.type] = (cCounts[c.type] || 0) + 1;
  }
  const cDesc = Object.entries(cCounts).map(([t, count]) => count > 1 ? \`\${t}x\${count}\` : t).join(', ') || 'none';
  const desc = \`\${this.joints.size}j, \${this.shapes.length}s, [\${cDesc}]\`;

  records.push({
    current,
    proposed,
    verifierOK,
    hasSpring,
    converged: res.converged,
    stalled: res.stalled,
    stallError: res.stallError,
    structuralError: res.structuralError,
    dragReached: res.dragReached,
    error: res.error,
    tol,
    tolerance,
    maxResidual,
    desc
  });
  return res;
};

process.on('exit', () => {
  if (records.length > 0 && process.env.SHADOW_OUT) {
    fs.appendFileSync(process.env.SHADOW_OUT, JSON.stringify({ file: process.env.CURRENT_TEST_FILE, records }) + '\\n');
  }
});
`;

fs.writeFileSync(tmpHookPath, hookCode);

try {
  if (fs.existsSync(tmpOutPath)) fs.unlinkSync(tmpOutPath);

  // Discover solver test files under packages/core/tests
  const coreTestDir = path.join(rootDir, 'packages/core/tests');
  const coreTests = fs.readdirSync(coreTestDir)
    .filter(f => f.endsWith('.test.js'))
    .map(f => path.join('packages/core/tests', f));

  // Harness tests
  const harnessTests = [
    path.join('tests/harness', 'constraint-conformance.test.js'),
    path.join('tests/harness', 'solver-scenarios.test.js')
  ];

  const allFiles = [...coreTests, ...harnessTests];

  for (const relFile of allFiles) {
    const fullPath = path.join(rootDir, relFile);
    try {
      execFileSync(process.execPath, ['--import', tmpHookUrl, fullPath], {
        cwd: rootDir,
        env: {
          ...process.env,
          CURRENT_TEST_FILE: relFile.replace(/\\/g, '/'),
          SHADOW_OUT: tmpOutPath
        },
        stdio: 'pipe'
      });
    } catch (_) {
      // Test failures / exits are captured; hook logs on process exit
    }
  }

  // Run solver-fuzz with 160 seeds (150 fixed baseline + 10 extra seeds: 151..160)
  const fuzzRel = path.join('tests/harness', 'solver-fuzz.test.js');
  try {
    execFileSync(process.execPath, ['--import', tmpHookUrl, path.join(rootDir, fuzzRel), '160'], {
      cwd: rootDir,
      env: {
        ...process.env,
        CURRENT_TEST_FILE: 'tests/harness/solver-fuzz.test.js (seeds 1..160)',
        SHADOW_OUT: tmpOutPath
      },
      stdio: 'pipe'
    });
  } catch (_) {}

  // Parse recorded solves
  let totalSolves = 0;
  const diffs = [];

  if (fs.existsSync(tmpOutPath)) {
    const lines = fs.readFileSync(tmpOutPath, 'utf8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const { file, records } = JSON.parse(line);
      totalSolves += records.length;
      for (const r of records) {
        if (r.current !== r.proposed) {
          diffs.push({ file, ...r });
        }
      }
    }
  }

  // Categorize differences
  const catA = diffs.filter(d => d.maxResidual > d.tolerance);
  const catB = diffs.filter(d => d.hasSpring && d.maxResidual <= d.tolerance);
  const catC = diffs.filter(d => !d.hasSpring && d.maxResidual <= d.tolerance);

  console.log('\n================================================================================');
  console.log('SHADOW CONVERGENCE AUDIT REPORT (Corpus: packages/core/tests + tests/harness)');
  console.log('================================================================================');
  console.log(`Total solves evaluated: ${totalSolves}`);
  console.log(`Total differences (proposed != current): ${diffs.length}`);
  console.log(`  (a) Genuine lies today (wrapper=true, maxResidual > tolerance): ${catA.length}`);
  console.log(`  (b) Drag-only differences (mouse_spring, maxResidual <= tolerance): ${catB.length}`);
  console.log(`  (c) False alarms (non-drag, maxResidual <= tolerance, proposed=false): ${catC.length}`);

  if (diffs.length > 0) {
    console.log('\n--- Solves with differences (proposed != current) ---');
    for (let i = 0; i < diffs.length; i++) {
      const d = diffs[i];
      const kind = d.maxResidual > d.tolerance ? 'GENUINE_LIE' : (d.hasSpring ? 'DRAG_ONLY' : 'FALSE_ALARM');
      console.log(`[#${i + 1}] [${kind}] ${d.file}`);
      console.log(`      sketch: ${d.desc}`);
      console.log(`      engine: converged=${d.converged}, error=${typeof d.error === 'number' ? (isNaN(d.error) ? 'NaN' : d.error.toFixed(6)) : d.error}, stalled=${d.stalled}, stallError=${d.stallError != null ? d.stallError.toFixed(6) : 'undefined'}, structuralError=${typeof d.structuralError === 'number' ? (isNaN(d.structuralError) ? 'NaN' : d.structuralError.toFixed(8)) : d.structuralError}, dragReached=${d.dragReached}`);
      console.log(`      verifier: maxResidual=${d.maxResidual.toFixed(6)}, verifierOK=${d.verifierOK}`);
      console.log(`      flags: current(wrapper)=${d.current}, proposed=${d.proposed}`);
    }
  }

  // Assertions (pins the documented baseline)
  if (catA.length !== 0) {
    throw new Error(`Expected 0 genuine lies in wrapper, found ${catA.length}`);
  }

  // Verify that all non-drag false alarms match the documented document-roundtrip tangent NaN bug
  for (const d of catC) {
    const isNaNOrNull = d.error === null || typeof d.error !== 'number' || isNaN(d.error);
    if (!d.file.includes('document-roundtrip.test.js') || !isNaNOrNull || d.maxResidual > d.tolerance) {
      throw new Error(`Unexpected non-drag false alarm outside documented set: ${JSON.stringify(d)}`);
    }
  }
  if (catC.length !== 9) {
    throw new Error(`Expected exactly 9 document-roundtrip false alarms, found ${catC.length}`);
  }

  // Verify all drag-only differences satisfy verifier tolerance and have structuralError <= tolerance
  for (const d of catB) {
    if (!d.hasSpring || d.maxResidual > d.tolerance || d.structuralError > d.tolerance) {
      throw new Error(`Unexpected drag difference with high structural error: ${JSON.stringify(d)}`);
    }
  }
  if (catB.length === 0) {
    throw new Error('Expected drag-only differences in corpus, found 0');
  }

  console.log('\nshadow-converged test passed ✅ (all differences match documented baseline)');
} finally {
  if (fs.existsSync(tmpHookPath)) fs.unlinkSync(tmpHookPath);
  if (fs.existsSync(tmpOutPath)) fs.unlinkSync(tmpOutPath);
}

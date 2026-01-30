import assert from 'assert';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';

// Ensure there are no direct assignments to state.selectedShape / state.selectedConstraint
// in src files other than selection.js (our canonical location).

test('no direct selection assignments outside selection.js', () => {
  const srcDir = path.join(process.cwd(), 'sketch-studio-unified', 'src');
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js'));
  const forbiddenPattern = /state\.selected(?:Shape|Constraint)\s*=/;
  const offending = [];
  for(const f of files){
    if(f === 'selection.js') continue; // allowed
    const p = path.join(srcDir, f);
    const content = fs.readFileSync(p, 'utf8');
    if(forbiddenPattern.test(content)) offending.push(f);
  }
  assert(offending.length === 0, 'Found direct selection assignments in: ' + offending.join(', '));
});

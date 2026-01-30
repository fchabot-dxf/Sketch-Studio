import assert from 'assert';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';

test('6-input.js delegates Delete to deleteSelected(state)', () => {
  const p = path.join(process.cwd(), 'sketch-studio-unified', 'src', '6-input.js');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes('deleteSelected(state)'), 'Expected src/6-input.js to call deleteSelected(state)');
});

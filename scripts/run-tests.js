import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

(async function runAll() {
  try {
    const testsDir = path.join(process.cwd(), 'tests');
    const files = await fs.readdir(testsDir);
    const tests = files.filter(f => f.endsWith('.test.js'));

    if (tests.length === 0) {
      console.log('No test files found.');
      return;
    }

    for (const f of tests) {
      console.log('Running:', f);
      const fullPath = path.join(testsDir, f);
      // Import via file:// URL so dynamic import works reliably
      await import(pathToFileURL(fullPath).href);
      console.log('Passed:', f);
    }

    console.log('\nAll tests completed successfully ✅');
  } catch (err) {
    console.error('\nTest run failed ❌', err);
    process.exit(1);
  }
})();
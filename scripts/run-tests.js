import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';

(async function runAll() {
  try {
    // Discover .test.js across BOTH suites: the shell/integration tests (tests/)
    // and the co-located core-package oracle (packages/core/tests/).
    const dirs = [
      path.join(process.cwd(), 'tests'),
      path.join(process.cwd(), 'packages', 'core', 'tests'),
    ];
    const tests = [];
    for (const dir of dirs) {
      let files = [];
      try { files = await fs.readdir(dir); } catch { continue; } // dir may not exist
      for (const f of files.filter(n => n.endsWith('.test.js'))) {
        tests.push(path.join(dir, f));
      }
    }

    if (tests.length === 0) {
      console.log('No test files found.');
      return;
    }

    for (const fullPath of tests) {
      const f = path.relative(process.cwd(), fullPath);
      console.log('Running:', f);
      // Import via file:// URL so dynamic import works reliably
      await import(pathToFileURL(fullPath).href);
      console.log('Passed:', f);
    }

    console.log(`\nAll ${tests.length} tests completed successfully ✅`);
  } catch (err) {
    console.error('\nTest run failed ❌', err);
    process.exit(1);
  }
})();

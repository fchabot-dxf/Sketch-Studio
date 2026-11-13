// tests/gate-url-closure.test.js (TASK 574): the merge tier's reachability closure follows repo paths written inside URLs and
// template literals. A live test that loads an app with `http://127.0.0.1:${port}/apps/sketchstudio/index.html` must be picked when
// a file that page loads changes (task 571 missed tests/mobile-touch-live.test.js this way).
// Runs the REAL scripts/gate.cjs (--tier merge --plan) in a throwaway git repo, so no browser is started.
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// the fixture tests import the launcher; spelled in pieces so THIS file is not itself read as a live test
const LAUNCH = ['import { launchBrowser } fr', "om './helpers/cdp-browser.js';\nawait launchBrowser();\n"].join('');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-574-'));
const put = (rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const git = (...args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`); return r.stdout.trim(); };

try {
  put('scripts/gate.cjs', fs.readFileSync(path.join(REPO_ROOT, 'scripts/gate.cjs'), 'utf8'));
  put('tests/helpers/cdp-browser.js', 'export function launchBrowser() {}\n'); // the launcher: a test importing it is live
  put('apps/sketchstudio/index.html', '<html><body><script type="module" src="src/main.js"></script></body></html>\n');
  put('apps/sketchstudio/src/main.js', "import { go } from '#ui/input-manager.js';\ngo();\n");
  put('apps/shaper/index.html', '<html><body></body></html>\n');
  put('packages/ui/input-manager.js', 'export const go = () => 1;\n');
  put('packages/ui/other.js', 'export const x = 1;\n');
  put('tests/fx-template-live.test.js', LAUNCH + "const url = `http://127.0.0.1:${port}/apps/sketchstudio/index.html`;\n");
  put('tests/fx-variable-live.test.js', LAUNCH + "for (const app of ['shaper']) go(`http://127.0.0.1:${port}/apps/${app}/index.html`);\n");
  put('tests/fx-unrelated-live.test.js', LAUNCH + "const url = `http://127.0.0.1:${port}/about:blank`;\n");
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't');
  git('add', '-A'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');

  const picked = (changedFile) => {
    fs.appendFileSync(path.join(root, changedFile), '// changed\n');
    git('commit', '-qam', `change ${changedFile}`);
    const r = spawnSync(process.execPath, ['scripts/gate.cjs', '--tier', 'merge', '--plan', '--base', base, '--head', 'HEAD'], { cwd: root, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    git('reset', '-q', '--hard', base);
    return r.stdout.split(/\r?\n/).filter(l => l.includes('PICKED')).map(l => l.trim().split(/\s+/)[1]).sort();
  };

  assert.deepStrictEqual(picked('packages/ui/input-manager.js'), ['tests/fx-template-live.test.js', 'tests/fx-variable-live.test.js'],
    'input-manager.js is loaded by the sketchstudio page: the template-literal test is picked, and so is the /apps/${app}/ test (placeholder = every app)');
  assert.deepStrictEqual(picked('apps/shaper/index.html'), ['tests/fx-variable-live.test.js'],
    '/apps/${app}/index.html reaches every app page that exists');
  assert.deepStrictEqual(picked('packages/ui/other.js'), [], 'a file no loaded page reaches picks nothing');
  console.log('gate-url-closure: ok (template-literal URL, ${placeholder} URL, unrelated file)');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

// tests/review-wiring.test.js — TASK 459: three.js loads ONLY when the Review tab opens, the importmap pins the vendored copy,
// the old Simulate/Export tab is gone (renamed Review, export panel kept inside it), and no other host sees three.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('apps/shaper/index.html');
const main = read('apps/shaper/src/main.js');
const view = read('apps/shaper/src/review-view.js');

// importmap pins three to the vendored 0.170.0 files, and those files exist
assert.match(html, /"three": "\.\.\/\.\.\/packages\/ui\/vendor\/three\/three\.module\.js"/);
assert.match(html, /"three\/addons\/": "\.\.\/\.\.\/packages\/ui\/vendor\/three\/addons\/"/);
assert.ok(fs.existsSync(path.join(root, 'packages/ui/vendor/three/three.module.js')));
assert.ok(fs.existsSync(path.join(root, 'packages/ui/vendor/three/addons/controls/OrbitControls.js')));
assert.match(read('packages/ui/vendor/three/three.module.js'), /REVISION = '170'/, 'vendored three is r170');

// loaded on demand: only review-view.js imports it, and only DYNAMICALLY
assert.doesNotMatch(html, /<script[^>]+src=[^>]*three/i, 'no script tag loads three');
assert.match(view, /await import\('three'\)/);
assert.doesNotMatch(view, /^import .* from 'three/m, 'review-view has no static three import');
for (const rel of ['apps/shaper/src', 'packages/core', 'apps/penplotter/src', 'apps/sketchstudio', 'apps/trace']) {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) continue;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'vendor' || e.name === 'node_modules' ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
  for (const f of walk(dir).filter((x) => x.endsWith('.js'))) {
    if (f.endsWith('review-view.js')) continue;
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /from 'three|import\('three/, path.relative(root, f) + ' must not import three');
  }
}

// the tab: Simulate/Export is renamed Review; its export panel stays; a stored 'simexport' maps to 'review'
assert.match(html, /data-mode="review">Review</);
assert.doesNotMatch(html, /data-mode="simexport"/);
assert.doesNotMatch(html, /Simulate\/Export/);
assert.match(html, /id="view-review"[\s\S]*id="btn-generate-svg"/, 'the export panel lives inside the Review view');
assert.match(main, /initMode === 'simexport'\) initMode = 'review'/);
assert.match(main, /review:\s+document\.getElementById\('view-review'\)/);
console.log('review-wiring: ok');

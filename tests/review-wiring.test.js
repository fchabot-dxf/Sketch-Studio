// tests/review-wiring.test.js — TASK 459: three.js loads ONLY when the Review tab opens, the importmap pins the vendored copy,
// the old Simulate/Export tab is gone (renamed Review, export panel kept inside it), and no other host sees three.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('apps/shaper/index.html');
const main = read('apps/shaper/src/main.js') + read('apps/shaper/src/shaper-app.js'); // TASK 881: the page's wiring is shaper-app.js (shared by the website and the Fusion panel) + main.js (the website's own parts)
const modes = read('apps/shaper/src/modes.js'); // TASK 583: the mode router and its views are declared in modes.js (main.js and the node test kit both use it)
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
    if (f.endsWith('review-view.js') || f.endsWith('orient-view.js')) continue; // TASK 808: the STL Orient view loads three the same way, when it opens
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /from 'three|import\('three/, path.relative(root, f) + ' must not import three');
  }
}

// the tab: Simulate/Export is renamed Review; its export panel stays; a stored 'simexport' maps to 'review'
assert.match(modes, /commonStage\('export', 'review'\)/); // TASK 707: the stage id stays 'review', its label is the common "Export"
assert.doesNotMatch(modes, /id:\s*'simexport'/);
assert.doesNotMatch(html, /Simulate\/Export/);
// TASK 880: no export panel: the actions are the Export stage's header actions, its settings the footer's (declared in main.js, the markup in the page)
assert.match(main, /s\.id === 'review' \? \{ \.\.\.s, actions: EXPORT_ACTIONS \}/, 'the Export stage declares its header actions');
assert.match(main, /id: 'btn-generate-svg'[\s\S]*id: 'btn-sync-shaper'[\s\S]*id: 'link-shaper-hub'/, 'Generate, Sync, Open ShaperHub');
assert.match(main, /controls: \[\{ el: document\.getElementById\('review-settings'\), stage: 'review'/, 'the Export settings are the footer settings, on the Export stage');
assert.doesNotMatch(html, /id="review-side"/, 'no side panel');
assert.strictEqual((await import('../apps/shaper/src/modes.js')).resolveInitialMode('simexport'), 'review', 'a stored simexport opens Review'); // TASK 706: the page's own copy of this mapping went; modes.js resolveInitialMode is the one
assert.match(main, /resolveInitialMode\(initMode/, 'the page resolves its stored stage through modes.js');
assert.match(modes, /review:\s+doc\.getElementById\('view-review'\)/);
console.log('review-wiring: ok');

// import-resolution.test.js — STATIC guard against stale / broken `#`-alias imports after a file move.
//
// Every carve-out slice relocates a module and repoints its importers (coords had 18; svg-renderer had 20).
// A single missed importer = a broken app that the Node solver oracle can't see. This test reads the alias
// maps from all THREE sources (package.json + both index.html importmaps), walks the source tree, and asserts
// every `#core/` / `#ui/` / `#app/` import resolves to a file that EXISTS — and that `#core/`/`#ui/` mean the
// same directory in all three. Gating: exit 1 on any unresolved spec or any cross-source inconsistency.
//
// No deps (fs + regex only). Limitation: only string-literal specs are checked — a dynamic import built from
// a template literal (`import(`#core/${x}`)`) can't be resolved statically and is skipped.

import { readFileSync, readdirSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => path.relative(REPO, p).split(path.sep).join('/'); // forward-slash, repo-relative

// ── 1. Read the three alias sources, normalized to { '#prefix/': targetDir } + a base dir ────────────
// package.json "imports" uses glob form (`#core/*` -> `./packages/core/*`); normalize to trailing-slash dirs.
function readPackageJsonMap() {
  const pj = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(pj.imports || {})) {
    if (!k.startsWith('#')) continue;
    const key = k.replace(/\*$/, '');                 // '#core/*' -> '#core/'
    const target = String(v).replace(/^\.\//, '').replace(/\*$/, ''); // './packages/core/*' -> 'packages/core/'
    out[key] = target;
  }
  return { map: out, base: REPO, label: 'package.json' };
}

// index.html: extract the <script type="importmap"> JSON; targets are relative to that index.html's dir.
function readImportmap(indexRelPath) {
  const abs = path.join(REPO, indexRelPath);
  const html = readFileSync(abs, 'utf8');
  const m = html.match(/<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) throw new Error(`no <script type="importmap"> found in ${indexRelPath}`);
  const json = JSON.parse(m[1]);
  const out = {};
  for (const [k, v] of Object.entries(json.imports || {})) {
    if (k.startsWith('#')) out[k] = String(v);
  }
  return { map: out, base: path.dirname(abs), label: indexRelPath };
}

const pkg = readPackageJsonMap();
const sketch = readImportmap('apps/sketchstudio/index.html');
const shaper = readImportmap('apps/shaper/index.html');

// ── 2. Walk all .js under the four source roots ──────────────────────────────────────────────────────
const ROOTS = ['apps/sketchstudio', 'apps/shaper', 'packages/core', 'packages/ui'];
function walk(dir) {
  const out = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const files = ROOTS.flatMap((r) => { const d = path.join(REPO, r); return existsSync(d) ? walk(d) : []; });

// ── 3. Extract `#`-specs from each file (comment-stripped, deduped) ───────────────────────────────────
function specsIn(src) {
  // strip block + line comments so commented-out imports don't produce false stale refs (avoid `://`)
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const specs = new Set();
  const add = (re) => { let m; while ((m = re.exec(code))) if (m[1].startsWith('#')) specs.add(m[1]); };
  add(/\bfrom\s*['"]([^'"]+)['"]/g);            // import X from '...'  /  export ... from '...'
  add(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g); // dynamic import('...')
  add(/\bimport\s*['"]([^'"]+)['"]/g);           // bare side-effect import '...'
  return [...specs];
}

// ── 4. Resolve a spec against the owning alias map ────────────────────────────────────────────────────
function resolveSpec(spec, src) {
  const { map, base } = src;
  let best = null;
  for (const key of Object.keys(map)) if (spec.startsWith(key) && (!best || key.length > best.length)) best = key;
  if (!best) return { ok: false, attempted: '(no matching alias)', reason: 'no alias for spec' };
  const attempted = path.resolve(base, map[best] + spec.slice(best.length));
  return { ok: existsSync(attempted), attempted, reason: 'file not found' };
}

const unresolved = [];
let specCount = 0;
for (const file of files) {
  const underShaper = rel(file).startsWith('apps/shaper/');
  const underSketch = rel(file).startsWith('apps/sketchstudio/');
  const underPkg = rel(file).startsWith('packages/');
  const owner = underShaper ? shaper : underSketch ? sketch : pkg; // packages/ files resolve via package.json
  for (const spec of specsIn(readFileSync(file, 'utf8'))) {
    specCount++;
    // A shared module under packages/ must NOT depend on the per-app #app/ alias.
    if (underPkg && spec.startsWith('#app/')) {
      unresolved.push({ file: rel(file), spec, attempted: '(forbidden #app/ in packages/)', reason: 'shared module depends on #app/' });
      continue;
    }
    const r = resolveSpec(spec, owner);
    if (!r.ok) unresolved.push({ file: rel(file), spec, attempted: rel(r.attempted) || r.attempted, reason: r.reason });
  }
}

// ── 5. Cross-source consistency: #core/ and #ui/ must be the same dir in all three sources ────────────
const absOf = (src, key) => (src.map[key] != null ? path.resolve(src.base, src.map[key]) : null);
const inconsistent = [];
for (const prefix of ['#core/', '#ui/']) {
  const trip = [pkg, sketch, shaper].map((s) => ({ label: s.label, abs: absOf(s, prefix) }));
  const missing = trip.filter((t) => t.abs == null);
  if (missing.length) { inconsistent.push(`${prefix} missing in: ${missing.map((m) => m.label).join(', ')}`); continue; }
  const uniq = new Set(trip.map((t) => t.abs));
  if (uniq.size !== 1) inconsistent.push(`${prefix} differs: ${trip.map((t) => `${t.label}->${rel(t.abs)}`).join(' | ')}`);
}

// ── Report ────────────────────────────────────────────────────────────────────────────────────────────
console.log(`import-resolution: scanned ${files.length} .js files · checked ${specCount} #-specs across 3 alias sources`);
console.log(`  #core/ -> ${rel(absOf(pkg, '#core/'))}   #ui/ -> ${rel(absOf(pkg, '#ui/'))}   #app/(sketchstudio) -> ${rel(absOf(sketch, '#app/'))}`);

if (unresolved.length) {
  console.error(`\n❌ ${unresolved.length} unresolved/forbidden #-import(s):`);
  for (const u of unresolved) console.error(`   ${u.file}: ${u.spec}  ->  ${u.attempted}  (${u.reason})`);
}
if (inconsistent.length) {
  console.error(`\n❌ alias inconsistency:`);
  for (const i of inconsistent) console.error(`   ${i}`);
}
if (unresolved.length || inconsistent.length) process.exit(1);

console.log('✅ all #-imports resolve to existing files; #core/ + #ui/ consistent across package.json + both importmaps.');
process.exit(0);

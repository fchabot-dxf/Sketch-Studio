// tests/readme-848-node.test.js — TASK 848: the READMEs name only what exists. Every backticked file or folder path in a README is a real
// path (from the repo root, or from the README's own folder), every markdown link to a local file points at one, and every `npm run X` it
// shows is a script of package.json. FAIL-FIRST: the pre-848 README.md named src/main.js, config.json, apply-config.ps1 and `npm run build:css`.
// Not a path: a URL, a route (starts with '/'), a placeholder (<app>), a glob (*), or a generated folder (GENERATED below).
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const READMES = ['README.md', 'apps/shaper/README.md', 'docs/README.md', 'scripts/README.md', 'analytics/README.md'];
const GENERATED = new Set(['dist/']); // written by the site build, not in the repo
const EXT = /\.(js|cjs|mjs|md|html|json|toml|css|svg|sql|txt|py|ps1)$/;
const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;

function isPathToken(t) {
  if (/[<>*]|:\/\/|^\//.test(t) || t.includes(' -') || /[(){}=]/.test(t)) return false;
  if (/^node |^npm |^npx /.test(t)) return false;
  return (t.includes('/') && !/\s/.test(t.replace(EXT, '')) ) || EXT.test(t);
}

const problems = [];
for (const rel of READMES) {
  const dir = path.dirname(path.join(root, rel));
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const exists = (p) => fs.existsSync(path.join(root, p)) || fs.existsSync(path.join(dir, p));
  for (const m of text.matchAll(/`([^`\n]+)`/g)) {
    const t = m[1].trim();
    if (GENERATED.has(t) || !isPathToken(t)) continue;
    if (!exists(t.replace(/\/$/, ''))) problems.push(`${rel}: \`${t}\` does not exist`);
  }
  for (const m of text.matchAll(/\]\(([^)\s#]+)(?:#[^)]*)?\)/g)) {
    const t = decodeURIComponent(m[1]);
    if (/^[a-z]+:/i.test(t)) continue;
    if (!fs.existsSync(path.resolve(dir, t))) problems.push(`${rel}: link (${t}) does not exist`);
  }
  for (const m of text.matchAll(/npm run ([\w:<>-]+)/g)) {
    const name = m[1];
    if (name.includes('<')) { // npm run site:<app>: every app's script must exist
      const prefix = name.slice(0, name.indexOf('<'));
      if (!Object.keys(scripts).some((s) => s.startsWith(prefix))) problems.push(`${rel}: npm run ${name} matches no script`);
    } else if (!scripts[name]) problems.push(`${rel}: npm run ${name} is not in package.json`);
  }
}
assert.deepStrictEqual(problems, [], 'a README names something that does not exist:\n' + problems.join('\n'));
console.log(`readme-848: ${READMES.length} READMEs name only paths and npm scripts that exist`);

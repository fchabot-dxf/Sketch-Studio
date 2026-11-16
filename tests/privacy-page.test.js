import fs from 'fs';
import path from 'path';
import assert from 'assert';
import { createRequire } from 'module';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'privacy.html'), 'utf8');
assert.ok(html.includes('drive.file'), 'privacy.html mentions drive.file');
assert.ok(html.includes('dansemur@gmail.com'), 'privacy.html lists the contact');
assert.ok(/lang="fr"/.test(html), 'privacy.html has a French section');
assert.ok(!fs.existsSync(path.join(root, 'terms.html')), 'no /terms page');

// Cloudflare Pages serves privacy.html at /privacy; no rule may redirect it.
// TASK 708: every site serves the _redirects that scripts/build-site.cjs writes (siteRedirects), not a repo-root file.
const req = createRequire(import.meta.url);
const { siteRedirects } = req('../scripts/build-site.cjs');
const { APPS } = req('../scripts/site-closure.cjs');
const rules = APPS.map((app) => siteRedirects(app)).join('\n')
  .split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  .map(l => { const [from, to, status] = l.split(/\s+/); return { from, to, status }; });
for (const r of rules) {
  const pattern = new RegExp('^' + r.from.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/:\w+/g, '[^/]+') + '$');
  assert.ok(!pattern.test('/privacy'), `_redirects rule "${r.from}" must not match /privacy`);
}
console.log('privacy page OK');

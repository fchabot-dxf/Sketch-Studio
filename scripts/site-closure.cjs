// scripts/site-closure.cjs — TASK 696: what ONE app's website needs. Starting at apps/<app>/index.html inside a site root (the repo, or a
// built dist/), it follows every reference the browser would load, with the browser's own URL rules:
//   html  <script src>, <link href>, <img src>, every other local src= / href= (an <a href> to another app counts: it must not exist),
//         the import map (<script type="importmap">), inline <script type="module"> and inline <style>
//   js    static import / export ... from, import('x'), require('./x') (SketchStudio's node fallback names the same files), new URL('x', import.meta.url)
//         (images, the Trace worker), importScripts(), the string literals that name a site file ('/assets/...', './x.json': fetch / img.src / a glyph
//         sheet; resolved against the PAGE, as fetch() is), src= / href= inside template literals; bare specifiers through the page's import map
//         (#core/, #ui/, #app/, three)
//   css   @import and url()
// Comments are skipped (a JS tokenizer that knows strings, template literals and regex literals), external URLs (http:, https:, data:, blob:, mailto:)
// are not followed. A /api/... or /auth/... URL is a Pages Function route: it must have its file under <functionsRoot>/functions (wrangler compiles
// ./functions from the directory it runs in, not from dist/).
// siteClosure({ root, app, functionsRoot, entry }) -> { files: Set<rel path>, refs: [{ from, spec, to, base }], missing: [{ from, spec, to }],
//                                                       crossApp: [{ from, spec, to }], functions: [{ from, spec, file }] }
// `entry` = the page, relative to root: apps/<app>/index.html (the repo), or index.html (a built site: TASK 763, the app at the top of its site).
// One resolver for build-site.cjs (which copies the root files it lists, e.g. assets/constraint-glyphs.svg) and tests/site-closure.test.js.
'use strict';
const fs = require('fs');
const path = require('path');

const APPS = ['sketchstudio', 'shaper', 'penplotter', 'trace'];
const ORIGIN = 'https://site.invalid';
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i; // http:, https:, data:, blob:, mailto:, javascript:, protocol-relative
const FUNCTION_PREFIXES = ['/api/', '/auth/'];
const FILE_EXT = '(?:js|mjs|cjs|css|json|svg|png|jpe?g|gif|webp|ico|html|wasm|xml|txt|woff2?|ttf)';
const SITE_PATH_LITERAL_RE = new RegExp(`^(?:\\.{1,2}\\/|\\/)[A-Za-z0-9_@#./ -]*\\.${FILE_EXT}$`);

// ---------------------------------------------------------------- JS: one tokenizer pass
// Returns { code, strings }: the source with every comment replaced by spaces (offsets and line breaks kept), so the scans below never read a
// commented-out import, and the [start, end) spans of every string / template literal piece, so a keyword INSIDE a string ('import ' + name) is not one.
function stripJsComments(src) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  const n = src.length;
  const strings = [];
  const braceStack = []; // template-literal ${ } nesting: each entry counts the open braces of that substitution
  let i = 0;
  let lastSignificant = ''; // the last non-space character outside comments: decides whether a '/' starts a regex literal
  const regexCanStart = () => lastSignificant === '' || /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSignificant)
    || /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|void|yield|await)$/.test(src.slice(Math.max(0, i - 7), i).trimEnd());
  function skipString(q) { const a = i; i++; while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; } i++; strings.push([a, i]); }
  function skipTemplate() { // from the opening backtick (or the '}' closing a substitution) to the next '${' (pushes a level) or the closing backtick
    const a = i; i++;
    while (i < n) {
      if (src[i] === '\\') { i += 2; continue; }
      if (src[i] === '`') { i++; strings.push([a, i]); return; }
      if (src[i] === '$' && src[i + 1] === '{') { i += 2; strings.push([a, i]); braceStack.push(0); return; }
      i++;
    }
    strings.push([a, i]);
  }
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '\'' || c === '"') { skipString(c); lastSignificant = c; continue; }
    if (c === '`') { skipTemplate(); lastSignificant = '`'; continue; }
    if (c === '/' && regexCanStart()) { // a regex literal: to its closing '/'; a '/' inside [...] does not close it
      i++; let inClass = false;
      while (i < n && src[i] !== '\n') { if (src[i] === '\\') { i += 2; continue; } if (src[i] === '[') inClass = true; else if (src[i] === ']') inClass = false; else if (src[i] === '/' && !inClass) break; i++; }
      i++; lastSignificant = '/'; continue;
    }
    if (braceStack.length && c === '{') braceStack[braceStack.length - 1]++;
    if (braceStack.length && c === '}') {
      if (braceStack[braceStack.length - 1] === 0) { braceStack.pop(); skipTemplate(); lastSignificant = '`'; continue; } // back inside the template
      braceStack[braceStack.length - 1]--;
    }
    if (!/\s/.test(c)) lastSignificant = c;
    i++;
  }
  return { code: out.join(''), strings };
}

// ---------------------------------------------------------------- the references of one file
// Each ref: { spec, base: 'module' | 'page', as: 'specifier' | 'url' }. `base` is what a relative spec resolves against (the file itself, or the
// page: fetch / img.src / markup use the document URL). A specifier is an import's (a bare one goes through the import map); a url is relative unless
// absolute ('styles/main.css' in an attribute is a file next to its base).
function jsRefs(src) {
  const { code, strings } = stripJsComments(src);
  const inString = (at) => strings.some(([a, b]) => at > a && at < b);
  const refs = [];
  const taken = new Set(); // the literals a keyword pattern took (not read again as a page path)
  const take = (re, base, as, keep = () => true) => {
    for (const m of code.matchAll(re)) {
      if (inString(m.index) || !keep(m[2])) continue;
      taken.add(m.index + m[0].lastIndexOf(m[1] + m[2]));
      refs.push({ spec: m[2], base, as });
    }
  };
  take(/\b(?:import|export)\b[^'"`;()]*?\bfrom\s*(['"])([^'"\n]+)\1/g, 'module', 'specifier');
  take(/\bimport\s*(['"])([^'"\n]+)\1/g, 'module', 'specifier');
  take(/\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, 'module', 'specifier');
  take(/\brequire\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g, 'module', 'specifier', (s) => s.startsWith('.')); // require('fs') is node's (a `typeof require` branch), not a site file
  take(/\bnew\s+URL\s*\(\s*(['"])([^'"\n]+)\1\s*,\s*import\.meta\.url\s*\)/g, 'module', 'url');
  take(/\bimportScripts\s*\(\s*(['"])([^'"\n]+)\1/g, 'module', 'url');
  for (const [a, b] of strings) {
    const q = src[a];
    if (q === '\'' || q === '"') { // a plain string naming a site file: fetched / assigned against the page
      const s = src.slice(a + 1, b - 1);
      if (taken.has(a)) continue;
      if (SITE_PATH_LITERAL_RE.test(s) || FUNCTION_PREFIXES.some((p) => s.startsWith(p))) refs.push({ spec: s, base: 'page', as: 'url' });
    } else { // markup a module writes: <a href="..."> / <img src="..."> inside a template literal
      for (const h of src.slice(a, b).matchAll(/\b(?:src|href)\s*=\s*(["'])([^"'$]+)\1/g)) refs.push({ spec: h[2], base: 'page', as: 'url' });
    }
  }
  return refs;
}

function cssRefs(css) {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, (s) => s.replace(/[^\n]/g, ' '));
  const refs = [];
  for (const m of code.matchAll(/@import\s+(['"])([^'"]+)\1/g)) refs.push({ spec: m[2], base: 'module', as: 'url' });
  for (const m of code.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) refs.push({ spec: m[2].trim(), base: 'module', as: 'url' });
  return refs;
}

function htmlParts(html) {
  const code = html.replace(/<!--[\s\S]*?-->/g, (s) => s.replace(/[^\n]/g, ' '));
  const refs = [];
  let importMap = null;
  for (const m of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1];
    if (/type\s*=\s*["']importmap["']/i.test(attrs)) { importMap = JSON.parse(m[2]); continue; }
    if (/\bsrc\s*=/.test(attrs)) continue; // its src is read below with every other attribute
    refs.push(...jsRefs(m[2]).map((r) => ({ ...r, base: 'page' }))); // an inline script's base URL is the page
  }
  for (const m of code.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) refs.push(...cssRefs(m[1]).map((r) => ({ ...r, base: 'page' })));
  const markup = code.replace(/(<(script|style)\b[^>]*>)([\s\S]*?)(<\/\2>)/gi, (s, open, tag, body, close) => open + body.replace(/[^\n]/g, ' ') + close); // tags only: bodies are read above
  for (const m of markup.matchAll(/\s(?:src|href)\s*=\s*(["'])([^"']*)\1/gi)) refs.push({ spec: m[2], base: 'page', as: 'url' });
  return { refs, importMap };
}

// ---------------------------------------------------------------- URL resolution (the browser's rules, on a stand-in origin)
const urlOf = (rel) => new URL('/' + rel.split(path.sep).join('/'), ORIGIN);
const relOf = (u) => decodeURIComponent(u.pathname).replace(/^\//, '');

function resolveSpec(spec, as, baseUrl, pageUrl, importMap) {
  const s = spec.trim();
  if (!s || EXTERNAL_RE.test(s)) return null;
  if (as === 'url') return s.startsWith('#') ? null : new URL(s, baseUrl); // '#x' is a fragment of the same page
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return new URL(s, baseUrl);
  const map = (importMap && importMap.imports) || {};
  if (Object.hasOwn(map, s)) return new URL(map[s], pageUrl);
  const prefix = Object.keys(map).filter((k) => k.endsWith('/') && s.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  if (prefix) return new URL(map[prefix] + s.slice(prefix.length), pageUrl);
  return { bare: s };
}

// a Pages Function route -> its file under functions/ (an exact file, or a [param].js in the route's directory)
function functionFile(functionsRoot, pathname) {
  const segs = pathname.replace(/^\//, '').split('/');
  const dir = path.join(functionsRoot, 'functions', ...segs.slice(0, -1));
  const exact = path.join(dir, segs[segs.length - 1] + '.js');
  if (fs.existsSync(exact)) return path.relative(functionsRoot, exact).split(path.sep).join('/');
  if (fs.existsSync(dir)) { const p = fs.readdirSync(dir).find((e) => /^\[[^\]]+\]\.js$/.test(e)); if (p) return path.relative(functionsRoot, path.join(dir, p)).split(path.sep).join('/'); }
  return null;
}

function siteClosure({ root, app, functionsRoot = root, entry = `apps/${app}/index.html` }) {
  if (!APPS.includes(app)) throw new Error(`site-closure: unknown app "${app}" (one of ${APPS.join(', ')})`);
  const pageUrl = urlOf(entry);
  const files = new Set();
  const refs = [], missing = [], crossApp = [], functions = [];
  let importMap = null;
  const queue = [entry];
  const isFile = (rel) => { const abs = path.join(root, rel); return fs.existsSync(abs) && fs.statSync(abs).isFile(); };
  const isDir = (rel) => { const abs = path.join(root, rel); return fs.existsSync(abs) && fs.statSync(abs).isDirectory(); };
  if (!isFile(entry)) return { files, refs, missing: [{ from: '(site root)', spec: entry, to: entry }], crossApp, functions };
  while (queue.length) {
    const rel = queue.shift();
    if (files.has(rel)) continue;
    files.add(rel);
    const ext = path.extname(rel).toLowerCase();
    if (!['.html', '.js', '.mjs', '.css'].includes(ext)) continue; // an image, an SVG sheet, JSON: a leaf
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    let found;
    if (ext === '.html') { const p = htmlParts(src); found = p.refs; if (rel === entry) importMap = p.importMap; }
    else found = ext === '.css' ? cssRefs(src) : jsRefs(src);
    const baseUrl = urlOf(rel);
    for (const { spec, base, as } of found) {
      const u = resolveSpec(spec, as, base === 'page' ? pageUrl : baseUrl, pageUrl, importMap);
      if (!u) continue;
      if (u.bare) { missing.push({ from: rel, spec, to: `(bare specifier "${u.bare}" not in the import map)` }); continue; }
      if (FUNCTION_PREFIXES.some((p) => u.pathname.startsWith(p))) {
        const file = functionFile(functionsRoot, u.pathname);
        functions.push({ from: rel, spec, file });
        if (!file) missing.push({ from: rel, spec, to: `functions${u.pathname} (no Pages Function file)` });
        continue;
      }
      let to = relOf(u);
      if (to === '' || to.endsWith('/') || isDir(to)) to = to.replace(/\/?$/, '/').replace(/^\//, '') + 'index.html';
      refs.push({ from: rel, spec, to, base });
      if (APPS.some((a) => a !== app && (to === `apps/${a}` || to.startsWith(`apps/${a}/`)))) crossApp.push({ from: rel, spec, to });
      if (!isFile(to)) { missing.push({ from: rel, spec, to }); continue; }
      if (!files.has(to)) queue.push(to);
    }
  }
  return { files, refs, missing, crossApp, functions };
}

module.exports = { APPS, siteClosure, stripJsComments, jsRefs, cssRefs, htmlParts };

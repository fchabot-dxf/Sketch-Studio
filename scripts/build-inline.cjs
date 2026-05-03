const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(PROJECT_ROOT, 'src');
const INDEX_HTML = path.join(PROJECT_ROOT, 'index.html');
const OUT_DIR = path.join(PROJECT_ROOT, 'output');
const OUT_FILE = path.join(OUT_DIR, 'sketch-studio-unified-v1.0.html');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) files = files.concat(walk(full));
    else if (e.isFile() && full.endsWith('.js')) files.push(full);
  }
  return files;
}

function relId(filePath) {
  const rel = path.relative(SRC_DIR, filePath).split(path.sep).join('/');
  return './' + rel;
}

function transformModule(content) {
  let out = content;
  const exportNames = [];
  const exportMappings = [];
  out = out.replace(/export\s+default\s+/g, 'exports.default = ');
  out = out.replace(/export\s+function\s+([A-Za-z0-9_$]+)\s*\(/g, (m, name) => {
    exportNames.push(name);
    return `function ${name}(`;
  });
  out = out.replace(/export\s+class\s+([A-Za-z0-9_$]+)/g, (m, name) => {
    exportNames.push(name);
    return `class ${name}`;
  });
  out = out.replace(/export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g, (m, name) => {
    exportNames.push(name);
    return m.replace(/^export\s+/, '');
  });
  out = out.replace(/export\s*\*\s*from\s*['"]([^'"]+)['"]\s*;?/g, (m, spec) => `Object.assign(exports, require('${spec}'));`);
  out = out.replace(/export\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g, (m, list, spec) => {
    const parts = list.split(',').map(s => s.trim()).filter(Boolean);
    const assigns = [];
    for (const p of parts) {
      const m2 = p.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
      if (m2) {
        assigns.push(`exports.${m2[2]} = require('${spec}').${m2[1]};`);
      } else {
        assigns.push(`exports.${p} = require('${spec}').${p};`);
      }
    }
    return assigns.join('\n');
  });
  out = out.replace(/export\s*\{([^}]+)\};?/g, (m, list) => {
    const parts = list.split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const m2 = p.match(/^([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)$/);
      if (m2) {
        exportMappings.push({ local: m2[1], exported: m2[2] });
      } else {
        exportMappings.push({ local: p, exported: p });
      }
    }
    return '';
  });
  let importCounter = 0;
  out = out.replace(/(^|\n)\s*import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"];?/g, (m, pre, spec, specifier) => {
    spec = spec.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '').replace(/\n/g, ' ').trim();
    importCounter++;
    const varBase = `__import_${importCounter}`;
    if (/^\{[\s\S]*\}$/.test(spec)) {
      const inner = spec.replace(/^\{\s*|\s*\}$/g, '').trim();
      const parts = inner.split(',').map(p => p.trim()).filter(Boolean).map(p => p.replace(/\s+as\s+/g, ': '));
      return `${pre}const { ${parts.join(', ')} } = require('${specifier}');`;
    }
    if (/^\*\s+as\s+([A-Za-z0-9_$]+)$/.test(spec)) {
      const m2 = spec.match(/^\*\s+as\s+([A-Za-z0-9_$]+)$/);
      const name = m2[1];
      return `${pre}const ${name} = require('${specifier}');`;
    }
    if (/,\s*\{/.test(spec)) {
      const parts = spec.split(',');
      const defaultName = parts[0].trim();
      const rest = parts.slice(1).join(',').trim();
      return `${pre}const ${varBase} = require('${specifier}'); const ${defaultName} = (${varBase} && ${varBase}.default) || ${varBase}; const ${rest} = ${varBase};`;
    }
    const name = spec;
    return `${pre}const ${varBase} = require('${specifier}'); const ${name} = (${varBase} && ${varBase}.default) || ${varBase};`;
  });
  out = out.replace(/(^|\n)\s*import\s+['"]([^'"]+)['"];?/g, (m, pre, specifier) => `${pre}require('${specifier}');`);
  const extra = [];
  for (const n of exportNames) extra.push(`exports.${n} = ${n};`);
  for (const m of exportMappings) extra.push(`exports.${m.exported} = ${m.local};`);
  if (extra.length) out += '\n' + extra.join('\n');
  return out;
}

function build() {
  console.log('[build] Scanning source files...');
  const files = walk(SRC_DIR);
  const modules = {};
  for (const f of files) {
    const id = relId(f);
    let src = fs.readFileSync(f, 'utf8');
    // Skip dev-only source files (marked with @dev-only) unless INCLUDE_DEV env var is set
    if (src.includes('@dev-only') && !process.env.INCLUDE_DEV) {
      console.log('[build] Skipping dev-only file', id);
      continue;
    } else if (src.includes('@dev-only') && process.env.INCLUDE_DEV) {
      console.log('[build] Including dev-only file (INCLUDE_DEV=1):', id);
    }
    src = transformModule(src);
    modules[id] = src;
  }

  console.log('[build] Assembling bundle...');
  let bundle = `(function(){\n  const modules = {};\n`;
  for (const id of Object.keys(modules)) {
    const code = modules[id];
    bundle += `  modules['${id}'] = function(require, exports){\n${code}\n  };\n`;
  }
  bundle += `\n  const cache = {};\n  function resolve(parent, spec){\n    if(spec.startsWith('./') || spec.startsWith('../')){\n      const parentDir = parent.substring(0, parent.lastIndexOf('/') + 1);\n      const full = parentDir + spec;\n      const parts = full.split('/');\n      const out = [];\n      for (const p of parts) {\n        if (p === '.' || p === '') continue;\n        if (p === '..') { out.pop(); } else { out.push(p); }\n      }\n      return './' + out.join('/');\n    }\n    return spec;\n  }\n  function __require__(id, parent){\n    const key = id;\n    if(cache[key]) return cache[key];\n    const factory = modules[id];\n    if(!factory) throw new Error('Module not found: ' + id);\n    const exports = {};\n    cache[key] = exports;\n    factory(function(spec){ return __require__(resolve(id, spec), id); }, exports);\n    return cache[key];\n  }\n  function __reportError__(e){\n    try{ if(typeof document !== 'undefined'){ const pre = document.createElement('pre'); pre.style = 'position:fixed;left:10px;top:10px;z-index:99999;background:#fff;color:#900;padding:10px;border:2px solid #900;max-width:90%;max-height:50vh;overflow:auto;'; pre.textContent = (e && e.stack) ? e.stack : (String(e) || 'Unknown Error'); document.body.appendChild(pre);} }catch(_){ }\n    try{ console.error('[bundle] runtime error', e); }catch(_){ }\n  }\n  try{ if(typeof window !== 'undefined'){ window.addEventListener('error', (ev) => { __reportError__(ev.error || ev.message || ev); }); window.addEventListener('unhandledrejection', (ev) => { __reportError__(ev.reason || ev); }); } }catch(_){ }\n  try{ __require__('./main.js'); }catch(e){ __reportError__(e); }\n})();`;

  let html = fs.readFileSync(INDEX_HTML, 'utf8');
  const marker = '<script type="module" src="src/main.js"></script>';
  if (!html.includes(marker)) {
    console.warn('[build] expected module marker not found, searching for script tag');
    html = html.replace(/<script[^>]*type=["']module["'][^>]*><\/script>/g, '');
    html = html.replace('</body>', `<script>${bundle}</script>\n</body>`);
  } else {
    html = html.replace(marker, `<script>${bundle}</script>`);
  }

  // Inline compiled CSS only when INLINE_CSS=1 — otherwise preserve external Tailwind/CSS link in the output
  try {
    const cssPath = path.join(SRC_DIR, 'style.css');
    const shouldInline = process.env.INLINE_CSS === '1';
    if (shouldInline && fs.existsSync(cssPath)) {
      const css = fs.readFileSync(cssPath, 'utf8');
      html = html.replace('<link rel="stylesheet" href="src/style.css">', `<style id="inlined-style">${css}</style>`);
      console.log('[build] Inlined compiled CSS into HTML (INLINE_CSS=1)');
    } else {
      if (fs.existsSync(cssPath)) console.log('[build] Preserving external CSS link for src/style.css (INLINE_CSS!=1)');
      else console.log('[build] No compiled CSS found; leaving link unchanged');
    }
    // Inline overrides.css only when INLINE_CSS=1 (preserve external overrides.css otherwise)
    const overridesPath = path.join(SRC_DIR, 'overrides.css');
    if (shouldInline && fs.existsSync(overridesPath)) {
      const ocs = fs.readFileSync(overridesPath, 'utf8');
      html = html.replace('<link rel="stylesheet" href="src/overrides.css">', `<style id="inlined-overrides">${ocs}</style>`);
      console.log('[build] Inlined overrides CSS into HTML (INLINE_CSS=1)');
    }
  } catch (e) { /* ignore */ }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, html, 'utf8');
  console.log('[build] Wrote single-file build to', OUT_FILE);
}

try{ build(); } catch (e) { console.error('[build] failed', e); process.exit(1); }
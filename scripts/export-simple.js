/*
 Simple exporter script for Sketch Studio
 - Reads `src/` files in order (1-utils.js .. 8-main.js)
 - Injects concatenated JS into a template HTML placeholder: <!-- INJECT:JS -->
 - Writes output to `export/sketch-studio-unified-v{timestamp}.html`

 Usage: node scripts/export-simple.js
*/

const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const srcDir = path.join(workspace, 'sketch-studio-unified', 'src');
const exportDir = path.join(workspace, 'export');
const templatePath = path.join(workspace, 'sketch-studio-unified', 'index.html');

if(!fs.existsSync(srcDir)){
  console.error('src directory not found:', srcDir);
  process.exit(1);
}
if(!fs.existsSync(templatePath)){
  console.error('template index.html not found at', templatePath);
  process.exit(1);
}

const order = ['1-utils.js','2-solver.js','3-snap.js','4-render.js','5-engine.js','6-input.js','7-ui.js','8-main.js'];

let bundle = '';
for(const f of order){
  const p = path.join(srcDir, f);
  if(!fs.existsSync(p)){
    console.warn('Missing source file, skipping:', f);
    continue;
  }
  let src = fs.readFileSync(p, 'utf8');
  // remove `export`/`import` lines and convert exports to functions inlined
  src = src.replace(/^\s*import[\s\S]*?;\s*$/mg, '');
  // replace `export function` or `export const` with plain `function`/`const`
  src = src.replace(/export\s+function\s+/g, 'function ');
  src = src.replace(/export\s+(const|let|var)\s+/g, '$1 ');
  src = src.replace(/export\s+default\s+/g, '');
  // wrap in IIFE to avoid leaking temporary vars but allow attaching to window where needed
  bundle += `\n// ---- ${f} (inlined) ----\n` + src + '\n';
}

const template = fs.readFileSync(templatePath, 'utf8');
if(!template.includes('<!-- INJECT:JS -->')){
  console.error('Template missing injection marker: <!-- INJECT:JS -->');
  process.exit(1);
}

const outHtml = template.replace('<!-- INJECT:JS -->', `<script>\n${bundle}\n</script>`);

if(!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });
const outName = `sketch-studio-unified-v${Date.now()}.html`;
const outPath = path.join(exportDir, outName);
fs.writeFileSync(outPath, outHtml, 'utf8');
console.log('Export written to', outPath);

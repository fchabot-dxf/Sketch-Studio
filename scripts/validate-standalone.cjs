const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '..', 'output', 'sketch-studio-standalone.html');
const html = fs.readFileSync(file, 'utf8');
const key = 'const modules = {';
const idx = html.indexOf(key);
if(idx === -1){ console.error('bundle marker not found'); process.exit(2); }
// find opening <script tag before idx
const openTag = html.lastIndexOf('<script', idx);
if(openTag === -1){ console.error('opening <script not found before bundle marker'); process.exit(2); }
const startScript = html.indexOf('>', openTag) + 1;
const closeTag = html.indexOf('</script>', idx);
if(closeTag === -1){ console.error('closing </script> not found after bundle marker'); process.exit(2); }
const script = html.slice(startScript, closeTag);
console.log('--- script head (first 400 chars) ---\n', script.slice(0,400));
const firstLt = script.indexOf('<');
console.log('first < at index:', firstLt);
if(firstLt !== -1){
  console.log('context around first <:');
  console.log(script.slice(Math.max(0, firstLt-40), firstLt+40));
}
// Robust module extractor: find 'modules[' occurrences and match function body by brace counting
function extractModules(code){
  const modules = [];
  const re = /modules\['([^']+)'\]\s*=\s*function\([^)]*\)\s*\{/g;
  let m;
  while((m = re.exec(code)) !== null){
    const name = m[1];
    const bodyStart = re.lastIndex - 1; // position of the '{'
    // walk forward to find matching closing brace while ignoring braces inside
    // strings, template literals and comments (simple state machine)
    let depth = 0;
    let i = bodyStart;
    let inSingle = false, inDouble = false, inBacktick = false, inLineComment = false, inBlockComment = false;
    for(; i < code.length; i++){
      const ch = code[i];
      const prev = code[i-1];
      // comment handling
      if(inLineComment){ if(ch === '\n') inLineComment = false; continue; }
      if(inBlockComment){ if(prev === '*' && ch === '/') inBlockComment = false; continue; }
      if(!inSingle && !inDouble && !inBacktick){
        if(ch === '/' && code[i+1] === '/') { inLineComment = true; i++; continue; }
        if(ch === '/' && code[i+1] === '*') { inBlockComment = true; i++; continue; }
      }
      // string/template literal handling (respect escapes)
      if(!inDouble && !inBacktick && ch === '\'' && prev !== '\\') { inSingle = !inSingle; continue; }
      if(!inSingle && !inBacktick && ch === '"' && prev !== '\\') { inDouble = !inDouble; continue; }
      if(!inSingle && !inDouble && ch === '`' && prev !== '\\') { inBacktick = !inBacktick; continue; }
      if(inSingle || inDouble || inBacktick) continue;
      // brace counting (only when not inside strings/comments)
      if(ch === '{') depth++;
      else if(ch === '}'){
        depth--;
        if(depth === 0) break;
      }
    }
    const bodyEnd = i; // index of matching '}'
    modules.push({ name, start: bodyStart + 1, end: bodyEnd, code: code.slice(bodyStart + 1, bodyEnd) });
    re.lastIndex = bodyEnd + 1;
  }
  return modules;
}

// Special-case: extract tuning-wizard by next-module sentinel to avoid string-brace pitfalls
const tuningMarker = "modules['./ui/tuning-wizard.js']";
const nextMarker = "modules['./ui/input-handlers/base-tool.js']"; // known next module in this bundle
const tIdx = script.indexOf(tuningMarker);
if(tIdx !== -1){
  const nextIdx = script.indexOf(nextMarker, tIdx + 1);
  if(nextIdx !== -1){
    const tuningChunk = script.slice(tIdx, nextIdx);
    // strip the leading `modules['./ui/tuning-wizard.js'] = function(require, exports){`
    const bodyStart = tuningChunk.indexOf('{', tuningChunk.indexOf('function')) + 1;
    const bodyEnd = tuningChunk.lastIndexOf('}');
    const body = tuningChunk.slice(bodyStart, bodyEnd);
    console.log('TUNING MODULE (sentinel) length:', body.length, 'bodyStart', bodyStart, 'bodyEnd', bodyEnd);
    // Quick balance check for braces/parens/brackets (ignore strings/comments)
    function findMismatch(str){
      const stack = [];
      let inSingle=false,inDouble=false,inBack=false,inLine=false,inBlock=false;
      for(let i=0;i<str.length;i++){
        const ch = str[i];
        const prev = str[i-1];
        if(inLine){ if(ch==='\n') inLine=false; continue; }
        if(inBlock){ if(prev==='*' && ch==='/') inBlock=false; continue; }
        if(!inSingle && !inDouble && !inBack){ if(ch==='/' && str[i+1]==='/'){ inLine=true; i++; continue; } if(ch==='/' && str[i+1]==='*'){ inBlock=true; i++; continue; } }
        if(!inDouble && !inBack && ch==="'" && prev !=='\\') { inSingle = !inSingle; continue; }
        if(!inSingle && !inBack && ch==='"' && prev !=='\\') { inDouble = !inDouble; continue; }
        if(!inSingle && !inDouble && ch==='`' && prev !=='\\') { inBack = !inBack; continue; }
        if(inSingle || inDouble || inBack) continue;
        if(ch === '(' || ch === '{' || ch === '[') stack.push({ch, i});
        else if(ch === ')' || ch === '}' || ch === ']'){
          const last = stack.pop();
          if(!last) return { ok:false, pos:i, found:ch };
          const pair = {')':'(', '}':'{', ']':'['};
          if(last.ch !== pair[ch]) return { ok:false, pos:i, found:ch, expected:pair[ch], last: last.ch };
        }
      }
      if(stack.length>0) return { ok:false, pos: stack[stack.length-1].i, found: stack[stack.length-1].ch, message: 'unclosed' };
      return { ok:true };
    }
    const bal = findMismatch(body);
    console.log('balance check:', bal);
    if(!bal.ok){
      const pos = bal.pos;
      const lineNo = body.slice(0,pos).split('\n').length;
      const lines = body.split('\n');
      const startLine = Math.max(1, lineNo-6);
      const excerpt = lines.slice(startLine-1, startLine+6).map((ln,i)=>`${startLine+i}: ${ln}`).join('\n');
      console.error(`Unbalanced brace near line ${lineNo} (body char ${pos}) — context:\n${excerpt}`);
    }
    try{ new Function(body); console.log('Tuning module parsed OK (sentinel)'); }catch(e){ console.error('Tuning module parse error (sentinel):', e.message); const lines = body.split('\n'); console.error('Tuning module head:\n' + lines.slice(0,20).join('\n')); console.error('Tuning module tail:\n' + lines.slice(-20).join('\n')); }
  }
}

const mods = extractModules(script);
let bad = null;
for(const mod of mods){
  try{
    new Function(mod.code);
  }catch(err){
    console.error('Module parse error in', mod.name, '-', err.message);
    const lines = mod.code.split('\n');
    console.error('--- module tail (last 40 lines) ---\n' + lines.slice(-40).join('\n'));
    bad = mod.name;
    break;
  }
}
if(!bad){
  console.log('All', mods.length, 'modules parsed OK (brace-checked)');
  process.exit(0);
}
process.exit(1);
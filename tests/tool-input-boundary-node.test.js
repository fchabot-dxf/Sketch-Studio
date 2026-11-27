// tests/tool-input-boundary-node.test.js — TASK 1034 (plan docs/INPUT-UNIFY-PLAN-1031.md 5.4): the grep gate of the input unification.
// A migrated tool file is a description (defineTool) plus its ONE build: it never listens to a pointer, a key or a touch, and never reads one.
// The list only grows (one tool per migration merge); at the close-out it is every file under ui/input-handlers/.
import assert from 'node:assert';
import fs from 'node:fs';
import { defineTool, PICK } from '#ui/tool-session.js';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');   // comments are not code

// the migrated tool files, and the export that holds each one's description
const MIGRATED = [
  { file: 'packages/ui/input-handlers/circle-tool.js', spec: '#ui/input-handlers/circle-tool.js', description: 'CIRCLE' },
];

// what a tool file never contains (an input event, a DOM listener, a raw device field, a key test, a window box event, a branch on `via`)
const FORBIDDEN = [
  /addEventListener/, /\b(pointerdown|pointermove|pointerup|pointercancel|keydown|contextmenu|touchstart)\b/, /setPointerCapture/,
  /\.button\b/, /\.pointerType\b/, /\.isPrimary\b/, /\.client[XY]\b/, /\.shiftKey\b/, /matchesShortcut/, /\be\.key\b/,
  /liveDimension(Applied|Preview|Cancelled)/, /\bvia\s*[!=]==?/,
];

let n = 0;
for (const m of MIGRATED) {
  const src = code(read(m.file));
  for (const re of FORBIDDEN) { assert.ok(!re.test(src), `${m.file} must not contain ${re}`); n++; }
  const mod = await import(m.spec);
  const desc = mod[m.description];
  assert.ok(desc && Object.isFrozen(desc), `${m.file} exports its description ${m.description}, made by defineTool`);
  assert.strictEqual(defineTool(desc), desc, `${m.file}: ${m.description} passes defineTool`);
  // input-manager imports none of its old pointer / key / finalize handlers (and nothing else of the file but its description)
  const im = read('packages/ui/input-manager.js');
  const base = m.file.split('/').pop();
  const imports = [...im.matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'[^']*${base.replace('.', '\\.')}'`, 'g'))].map((x) => x[1]).join(',');
  assert.ok(!/handle\w*Pointer\w*|handle\w*KeyDown|finalize\w*/.test(imports), `input-manager imports no pointer / key / finalize handler of ${base} (${imports})`);
  for (const f of ['packages/ui/input-handlers/drawing-tools.js', 'packages/ui/input-manager.js']) {
    assert.ok(!/handle\w*Pointer\w*|handle\w*KeyDown/.test([...read(f).matchAll(new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'[^']*${base.replace('.', '\\.')}'`, 'g'))].map((x) => x[1]).join(',')), `${f} imports no handler of ${base}`);
  }
  n += 3;
}

// the engine runs the build in ONE place, and neither it nor a translator branches on `via` (it is written in the step log only)
const session = code(read('packages/ui/tool-session.js'));
assert.strictEqual((session.match(/\bbuild\s*\(/g) || []).length, 1, 'ui/tool-session.js has exactly one build( call site');
for (const f of ['packages/ui/tool-session.js', 'packages/ui/input-translate-desktop.js', 'packages/ui/input-translate-touch.js', 'packages/ui/input-translate-box.js']) {
  assert.ok(!/\bvia\s*[!=]==?/.test(code(read(f))), `${f} does not branch on via`);
}
n += 5;

// defineTool refuses a description that is not one
const step = { id: 's', pick: PICK.point, fires: 'press' };
const ok = { tool: 't', variants: { v: { steps: [step] } }, build: () => {}, after: 'stay' };
assert.ok(defineTool({ ...ok }), 'a well-formed description passes');
for (const [why, bad] of [
  ['no build', { ...ok, build: undefined }],
  ['no steps', { ...ok, variants: { v: { steps: [] } } }],
  ['a step fires on neither press nor release', { ...ok, variants: { v: { steps: [{ ...step, fires: 'hover' }] } } }],
  ['a pick that is not declared', { ...ok, variants: { v: { steps: [{ ...step, pick: { kind: 'point' } }] } } }],
  ['a box with no live value', { ...ok, variants: { v: { steps: [{ ...step, boxes: [{ id: 'd', quantity: 'length', positions: true }] }] } } }],
  ['two steps with one id', { ...ok, variants: { v: { steps: [step, { ...step }] } } }],
  ['an unknown after', { ...ok, after: 'leave' }],
]) { assert.throws(() => defineTool(bad), /defineTool/, `defineTool refuses ${why}`); n++; }

console.log(`PASS tool-input-boundary-node (${n} checks, ${MIGRATED.length} migrated file(s))`);

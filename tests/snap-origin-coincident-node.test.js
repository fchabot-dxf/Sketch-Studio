// tests/snap-origin-coincident-node.test.js — TASK 569 (node port of tests/snap-origin-coincident.test.js, TASK 484): a point snapped onto
// the ORIGIN must leave a COINCIDENT constraint with j_origin. SketchStudio through tests/helpers/node-app.js: the ribbon's tool buttons,
// the canvas's own pointer listeners at the same screen offsets from the origin, Esc on the keyboard; the result is read from the stored
// design (the autosave buffer's write to the project store). Each kind runs on a fresh, empty, named design.

import assert from 'node:assert';
import { open, createProfile, createNamedDesign } from './helpers/node-app.js';

const refersOrigin = (c) => String(c.type).toLowerCase() === 'coincident' && (c.joints || []).includes('j_origin');
const TOOL = { l: 'line', r: 'rect', c: 'circle', a: 'arc', s: 'select' };

// a fresh, empty, NAMED design for each scenario (TASK 558: only a named design autosaves, and this test reads the autosave), restored by the
// page load (open). The browser test makes a new named design current in the same store; here each scenario also gets a new profile.
const fresh = async () => { const profile = await createProfile(); await createNamedDesign(profile, 'sketchstudio'); return open({ host: 'sketchstudio', profile }); };

const scenarios = {
  'line end': (app, o) => { app.tool(TOOL.l); app.click(o.x + 160, o.y - 90); app.click(o.x, o.y); app.esc(); },
  'line end (12px off)': (app, o) => { app.tool(TOOL.l); app.click(o.x + 160, o.y - 90); app.click(o.x + 12, o.y); app.esc(); },
  'line end (15px off)': (app, o) => { app.tool(TOOL.l); app.click(o.x + 160, o.y - 90); app.click(o.x + 15, o.y); app.esc(); },
  'line end (24px off)': (app, o) => { app.tool(TOOL.l); app.click(o.x + 160, o.y - 90); app.click(o.x + 24, o.y); app.esc(); },
  'line start': (app, o) => { app.tool(TOOL.l); app.click(o.x, o.y); app.click(o.x + 160, o.y - 90); app.esc(); },
  'circle centre': (app, o) => { app.tool(TOOL.c); app.click(o.x, o.y); app.click(o.x + 120, o.y); app.esc(); },
};

const results = {};
for (const [name, run] of Object.entries(scenarios)) {
  const app = await fresh();
  try {
    const o = app.toScreen(0, 0);
    app.click(o.x + 300, o.y + 200); app.esc();
    run(app, o);
    const d = await app.storedDoc();
    const g = d && d.geometry;
    const hit = g ? g.constraints.filter(refersOrigin) : [];
    const jo = g && g.joints; const near = jo ? (Array.isArray(jo) ? jo : Object.entries(jo)).filter((e) => { const v = Array.isArray(e) ? e[1] : e; return v && Math.hypot(v.x, v.y) < 0.2; }).length : null;
    results[name] = { nearOrigin: near, shapes: g && g.shapes.length, constraints: g && g.constraints.map((c) => c.type + ':' + (c.joints || []).join('+')), originCoincident: hit.length };
    console.log(name.padEnd(20), JSON.stringify(results[name]));
  } finally { await app.close(); }
}
for (const [name, r] of Object.entries(results)) {
  assert(r.shapes >= 1, name + ': a shape was drawn');
  if (name === 'line start') continue;
  if (name === 'line end (24px off)') { assert(r.originCoincident === 0, name + ': outside the joint marker nothing is locked'); continue; } // the line's start joint IS j_origin (checked below)
  assert(r.originCoincident >= 1, name + ': a COINCIDENT constraint with j_origin exists; got ' + JSON.stringify(r.constraints));
}

// a line STARTED on the origin reuses j_origin itself as its start joint (nothing can drift: it is the origin)
{
  const app = await fresh();
  try {
    const o = app.toScreen(0, 0);
    app.click(o.x + 300, o.y + 200); app.esc();
    app.tool(TOOL.l); app.click(o.x, o.y); app.click(o.x + 160, o.y - 90); app.esc();
    const g = (await app.storedDoc()).geometry;
    assert(g.shapes.length === 1 && g.shapes[0].joints.includes('j_origin'), 'a line started on the origin uses j_origin as its start joint: ' + JSON.stringify(g.shapes[0] && g.shapes[0].joints));
  } finally { await app.close(); }
}

console.log('snap-origin-coincident-node: ok');

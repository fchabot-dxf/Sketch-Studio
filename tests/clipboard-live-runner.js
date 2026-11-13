// tests/clipboard-live-runner.js -- TASK 559 live scenarios (headless browser through tests/helpers/cdp-browser.js; REAL pointer events and REAL
// Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+Z keys; the browser's clipboard permission granted over CDP). NOT a test file: the gate runs every *.test.js under a
// 90 s limit, so clipboard-live-*.test.js each set HOST (and CROSS) and import this runner.
//   HOST=sketchstudio | shaper : draw a rectangle, marquee-select it, Ctrl+C, Ctrl+V twice, Ctrl+Z, Ctrl+Y, Ctrl+X, Ctrl+Z, text fields keep copy / paste.
//   CROSS=1 (HOST = the SOURCE app, the destination is the other one): copy in the source, RELOAD into the other app, Ctrl+V there.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, sleep, sendRealKey } from './helpers/cdp-browser.js';
import { CREATE_NAMED_DESIGN } from './helpers/named-design.js';

const SOURCE = process.env.HOST || 'sketchstudio';
const CROSS = process.env.CROSS === '1';
const sleepMs = sleep;

const h = await launchBrowser({ tag: 'clip-' + SOURCE + (CROSS ? '-x' : ''), width: 1600, height: 900 });
if (!h) { console.log('skipped: no headless Edge/Chrome binary installed'); } else {
  let failed = null;
  let bws = null;
  try {
    const { send, evalJs, navigate, port } = h;
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    const origin = `http://127.0.0.1:${port}`;
    // Browser.grantPermissions is a BROWSER-target command: its own short-lived connection (read the port the profile dir recorded)
    const dbgPort = parseInt(fs.readFileSync(path.join(h.userDir, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0], 10);
    const version = await (await fetch(`http://127.0.0.1:${dbgPort}/json/version`)).json();
    bws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { bws.addEventListener('open', res); bws.addEventListener('error', rej); });
    const granted = await new Promise((res, rej) => { bws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id === 1) res(m); }); bws.send(JSON.stringify({ id: 1, method: 'Browser.grantPermissions', params: { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin } })); setTimeout(() => rej(new Error('grantPermissions timed out')), 5000); });
    // (the grant lives as long as this connection: it is closed in the finally block)
    assert.ok(!granted.error, 'clipboard permissions granted: ' + JSON.stringify(granted.error));
    // no nativeVirtualKeyCode on a Ctrl+C / X / V: with it the browser runs its own native copy command and the CDP call never returns (measured)
    const keyCtrl = async (k, code, vk) => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: 2 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: 2 }); await sleepMs(250); };
    const copyKey = () => keyCtrl('c', 'KeyC', 67), pasteKey = () => keyCtrl('v', 'KeyV', 86), cutKey = () => keyCtrl('x', 'KeyX', 88), undoKey = () => keyCtrl('z', 'KeyZ', 90), redoKey = () => keyCtrl('y', 'KeyY', 89);
    const key = async (k, code, vk) => { await sendRealKey(send, k, code, vk, 0); await sleepMs(150); };
    const mouse = (type, x, y, buttons = 0) => send('Input.dispatchMouseEvent', { type, x, y, button: (buttons || type === 'mouseReleased') ? 'left' : 'none', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const move = async (x, y) => { await mouse('mouseMoved', x, y); await sleepMs(40); };

    const hostOf = (name) => ({ canvas: name === 'shaper' ? 'design-canvas' : 'svgCanvas', url: `${origin}/apps/${name}/index.html` });
    const open = async (name) => {
      const H = hostOf(name);
      await navigate(H.url); await sleepMs(2500);
      if (name === 'shaper') {
        for (let i = 0; i < 5; i++) { await evalJs(`document.querySelector('[data-mode="design"]').click()`); await sleepMs(500); if (await evalJs(`!!window.__designController`)) break; }
        await sleepMs(1500);
      } else {
        await evalJs(`new Promise((res) => { const r = indexedDB.deleteDatabase('sketch-studio-projects'); r.onsuccess = r.onerror = r.onblocked = () => res(1); setTimeout(() => res(1), 1500); })`);
        await navigate(H.url); await sleepMs(2500);
        await evalJs(CREATE_NAMED_DESIGN('sketchstudio')); // TASK 558: only a NAMED design autosaves (SketchStudio is read from its autosave); the next load restores it
        await navigate(H.url); await sleepMs(2500);
      }
      return H;
    };
    // the live document: Shaper exposes its state (test hook); SketchStudio is read from its autosaved store (the buffer polls every 1500 ms)
    const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
    const norm = (d) => ({ shapes: sortKeys(d.shapes.map(({ sketchId, ...r }) => r)), joints: sortKeys((Array.isArray(d.joints) ? d.joints : Object.entries(d.joints)).map(([k, v]) => { const { sketchId, ...r } = v; return [k, r]; })), constraints: d.constraints.map((c) => { const { __visible, glyphPos, __pos, ...r } = c; return sortKeys(r); }) });
    const storedDoc = () => evalJs(`new Promise((res) => {
      const open = indexedDB.open('sketch-studio-projects', 1);
      open.onerror = () => res(null);
      open.onsuccess = () => { const db = open.result; const m = db.transaction('meta').objectStore('meta').get('currentDesign');
        m.onsuccess = () => { if (!m.result) { res(null); return; } const g = db.transaction('designs').objectStore('designs').get(m.result); g.onsuccess = () => { const d = g.result && g.result.document; res(d ? JSON.stringify({ shapes: d.geometry.shapes, constraints: d.geometry.constraints, joints: d.geometry.joints }) : null); }; }; };
    })`).then((s) => s && JSON.parse(s));
    const waitSaved = async () => { await sleepMs(300); for (let i = 0; i < 40; i++) { if (await evalJs(`document.getElementById('save-status').textContent === 'Saved'`)) { await sleepMs(200); return; } await sleepMs(200); } };
    const readDoc = async (name) => {
      if (name === 'shaper') return norm(JSON.parse(await evalJs(`(() => { const s = window.__designController.state; return JSON.stringify({ shapes: s.shapes, constraints: s.constraints, joints: [...s.joints.entries()] }); })()`)));
      await sleepMs(1800); await waitSaved(); return norm(await storedDoc());
    };
    const jmap = (d) => Object.fromEntries(d.joints);
    const canon = (d) => JSON.stringify({ j: Object.entries(jmap(d)).sort((a, b) => (a[0] < b[0] ? -1 : 1)), s: d.shapes, c: d.constraints.map((c) => JSON.stringify(c)).sort() });
    const sysClipboard = () => evalJs(`navigator.clipboard.readText()`);
    const setSysClipboard = (t) => evalJs(`navigator.clipboard.writeText(${JSON.stringify(t)}).then(() => 1)`);

    let H = await open(SOURCE);
    const toScreen = (wx, wy) => evalJs(`(() => { const s = document.getElementById('${H.canvas}'); const p = s.createSVGPoint(); p.x = ${wx}; p.y = ${wy}; const q = p.matrixTransform(s.getScreenCTM()); return { x: Math.round(q.x), y: Math.round(q.y) }; })()`);
    const onCanvas = (x, y) => evalJs(`(() => { const e = document.elementFromPoint(${x}, ${y}); return !!(e && e.closest && e.closest('#${H.canvas}')); })()`);
    const click = async (x, y) => { assert(await onCanvas(x, y), `the click at ${x},${y} is not on the canvas`); await move(x, y); await mouse('mousePressed', x, y, 1); await sleepMs(40); await mouse('mouseReleased', x, y, 0); await sleepMs(150); };
    const tool = async (name) => { await evalJs(`document.getElementById('tool-${name}').click()`); await sleepMs(200); };
    const marquee = async (a, b) => { assert(await onCanvas(a.x, a.y), 'marquee start on the canvas'); await move(a.x, a.y); await mouse('mousePressed', a.x, a.y, 1); await sleepMs(60); for (let i = 1; i <= 6; i++) { await mouse('mouseMoved', a.x + (b.x - a.x) * i / 6, a.y + (b.y - a.y) * i / 6, 1); await sleepMs(30); } await mouse('mouseReleased', b.x, b.y, 0); await sleepMs(250); };
    const defaultPrevented = (fn) => evalJs(`window.__clipProbe = []; document.addEventListener('keydown', window.__clipProbeFn = (e) => window.__clipProbe.push(e.defaultPrevented), false); 1`).then(async () => { await fn(); const r = await evalJs(`document.removeEventListener('keydown', window.__clipProbeFn); window.__clipProbe`); return r; });
    // (the probe above lives only in the test page: a bubble-phase listener AFTER the app's, recording whether the app consumed the key)

    // ---- draw a rectangle (H/V + 4 corners joined), select it with a marquee
    const o = await toScreen(0, 0);
    const P = (dx, dy) => ({ x: o.x + dx, y: o.y + dy });
    const d0 = await readDoc(SOURCE);
    await tool('rect');
    await click(P(-250, -150).x, P(-250, -150).y); await click(P(-100, -70).x, P(-100, -70).y); await key('Escape', 'Escape', 27);
    const drawn = await readDoc(SOURCE);
    const nShapes = drawn.shapes.length - d0.shapes.length, nCons = drawn.constraints.length - d0.constraints.length, nJoints = drawn.joints.length - d0.joints.length;
    assert.strictEqual(nShapes, 4, 'a rectangle is 4 shapes');
    await tool('select');
    await marquee(P(-290, -190), P(-50, -20));

    // ---- Ctrl+C: the SYSTEM clipboard now holds our JSON payload
    await copyKey();
    const text = await sysClipboard();
    const payload = JSON.parse(text);
    assert.strictEqual(payload.format, 'sketch-studio/geometry'); assert.strictEqual(payload.version, 1);
    assert.strictEqual(payload.document.geometry.shapes.length, 4, 'the four sides were copied');
    assert.strictEqual(payload.document.geometry.constraints.length, nCons, 'every constraint of the rectangle is inside the copy');
    console.log('LIVE copy: system clipboard holds', JSON.stringify({ format: payload.format, version: payload.version, shapes: payload.document.geometry.shapes.length, constraints: payload.document.geometry.constraints.length, bytes: text.length }));

    if (!CROSS) {
      // ---- Ctrl+X on the selected rectangle = copy + delete (the Delete key's step); Ctrl+Z brings it back exactly
      await cutKey();
      const c1 = await readDoc(SOURCE);
      assert.strictEqual(c1.shapes.length, d0.shapes.length, 'Ctrl+X removed the selected rectangle');
      assert.strictEqual(c1.constraints.length, d0.constraints.length, 'with its constraints');
      assert.strictEqual(JSON.parse(await sysClipboard()).document.geometry.shapes.length, 4, 'and put it on the clipboard');
      await undoKey(); const cu = await readDoc(SOURCE);
      assert.strictEqual(canon(cu), canon(drawn), 'Ctrl+Z after the cut restores the geometry exactly (one step)');
      console.log('LIVE cut/undo ok');
      // ---- Ctrl+V twice (each one more step), then Ctrl+Z, Ctrl+Y: ONE undo step each, exact
      await pasteKey();
      const p1 = await readDoc(SOURCE);
      assert.strictEqual(p1.shapes.length, drawn.shapes.length + 4, 'Ctrl+V pasted 4 shapes');
      assert.strictEqual(p1.constraints.length, drawn.constraints.length + nCons, 'and every constraint');
      assert.strictEqual(p1.joints.length, drawn.joints.length + nJoints, 'and every joint');
      const o1 = Object.values(jmap(drawn)).find((j) => j.x !== 0 || j.y !== 0), ids0 = new Set(Object.keys(jmap(drawn)));
      const fresh = Object.entries(jmap(p1)).filter(([k]) => !ids0.has(k));
      assert.strictEqual(fresh.length, nJoints, 'new joint ids');
      const dx = (a, b) => Math.round((b - a) * 1e3) / 1e3;
      const shift = new Set(Object.values(jmap(drawn)).filter((j) => true).flatMap((j) => fresh.filter(([, f]) => Math.abs(f.x - j.x - 10) < 1e-3 && Math.abs(f.y - j.y - 10) < 1e-3).map(() => 1)));
      assert.ok(shift.size > 0, 'the copy is the original moved by (+10, +10) (right and down)');
      await pasteKey();
      const p2 = await readDoc(SOURCE);
      assert.strictEqual(p2.shapes.length, drawn.shapes.length + 8, 'a second Ctrl+V pastes again');
      const fresh2 = Object.entries(jmap(p2)).filter(([k]) => !ids0.has(k) && !(k in jmap(p1)));
      assert.ok(fresh2.some(([, f]) => Object.values(jmap(drawn)).some((j) => Math.abs(f.x - j.x - 20) < 1e-3 && Math.abs(f.y - j.y - 20) < 1e-3)), 'the second paste is one more step (+20, +20)');
      await undoKey(); const u1 = await readDoc(SOURCE);
      assert.strictEqual(canon(u1), canon(p1), 'ONE Ctrl+Z removes exactly the last paste');
      await undoKey(); const u2 = await readDoc(SOURCE);
      assert.strictEqual(canon(u2), canon(drawn), 'the second Ctrl+Z removes the first paste: back to the drawn rectangle');
      await redoKey(); const r1 = await readDoc(SOURCE);
      assert.strictEqual(canon(r1), canon(p1), 'Ctrl+Y brings the first paste back exactly');
      console.log('LIVE paste/undo/redo ok: 4 shapes +', nCons, 'constraints per paste, offset (+10,+10) then (+20,+20), one undo step each');


      // ---- text fields keep the browser's own copy / paste: the key is not consumed, the clipboard and the document are untouched
      await setSysClipboard(text);
      await evalJs(`(() => { for (const tag of ['input', 'textarea']) { const e = document.createElement(tag); e.id = 'probe-' + tag; if (tag === 'input') e.type = 'text'; e.value = 'abc'; e.style.cssText = 'position:fixed;left:4px;top:4px;z-index:99999;width:160px'; document.body.appendChild(e); } const d = document.createElement('div'); d.id = 'probe-ce'; d.contentEditable = 'true'; d.textContent = 'abc'; d.style.cssText = 'position:fixed;left:4px;top:40px;z-index:99999;width:160px;background:#fff'; document.body.appendChild(d); })()`);
      const before = await readDoc(SOURCE);
      for (const id of ['probe-input', 'probe-textarea', 'probe-ce']) {
        await evalJs(`(() => { const e = document.getElementById('${id}'); e.focus(); if (e.select) e.select(); })()`);
        const prevented = await defaultPrevented(async () => { await copyKey(); await pasteKey(); await cutKey(); });
        assert.deepStrictEqual(prevented, [false, false, false], `${id}: Ctrl+C / V / X are left to the browser (defaultPrevented ${JSON.stringify(prevented)})`);
      }
      assert.strictEqual(await sysClipboard(), 'abc', 'the browser did its own copy: the clipboard holds the field text, not geometry');
      assert.strictEqual(canon(await readDoc(SOURCE)), canon(before), 'and nothing was pasted into the sketch from a text field');
      // the canvas (not a text field) still consumes them
      await evalJs(`document.activeElement && document.activeElement.blur(); 1`);
      const canvasPrevented = await defaultPrevented(async () => { await copyKey(); });
      assert.deepStrictEqual(canvasPrevented, [true], 'on the canvas Ctrl+C is the app\'s');
      console.log('LIVE text fields keep copy/paste ok');

      // ---- text that is not ours: nothing happens
      await setSysClipboard('hello, not a sketch');
      const h0 = await readDoc(SOURCE);
      await pasteKey();
      assert.strictEqual(canon(await readDoc(SOURCE)), canon(h0), 'foreign clipboard text: Ctrl+V does nothing');
      console.log('LIVE foreign text ignored ok');
    } else {
      // ---- the system clipboard survives a RELOAD into the OTHER app (shared Design tab): Ctrl+V there
      const dest = SOURCE === 'shaper' ? 'sketchstudio' : 'shaper';
      H = await open(dest);
      // the permission and the clipboard persist across the navigation (same origin); the destination has its own document
      const base = await readDoc(dest);
      const o2 = await toScreen(0, 0);
      await tool('select');
      await click(o2.x + 300, o2.y - 100); // an empty spot: focus on the canvas
      await pasteKey();
      const after = await readDoc(dest);
      assert.strictEqual(after.shapes.length, base.shapes.length + 4, `Ctrl+V in ${dest} pasted the ${SOURCE} rectangle (4 shapes)`);
      assert.strictEqual(after.constraints.length, base.constraints.length + nCons, 'with its constraints');
      const srcJoints = Object.values(jmap(drawn)).filter((j) => j.x !== 0 || j.y !== 0);
      const newJ = Object.entries(jmap(after)).filter(([k]) => !(k in jmap(base))).map(([, v]) => v);
      assert.ok(srcJoints.every((s) => newJ.some((f) => Math.abs(f.x - s.x - 10) < 1e-3 && Math.abs(f.y - s.y - 10) < 1e-3)), 'at the same place plus the paste offset');
      console.log(`LIVE ${SOURCE} -> ${dest} ok: 4 shapes +`, nCons, 'constraints');
    }
    console.log('clipboard-live ' + SOURCE + (CROSS ? ' (cross)' : '') + ': ok');
  } catch (e) { failed = e; } finally {
    if (bws) bws.close();
    await h.close();
  }
  if (failed) { console.error(failed.message || failed); process.exitCode = 1; }
}

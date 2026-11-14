// tests/arc-snap-constraint-live.test.js -- TASK 632 (live headless, REAL mouse via CDP, Pen Plotter = the shared Design tab): an arc begun on ANOTHER
// arc's centre snaps there and adds one COINCIDENT (the Arc tool used to start a joint drag of that arc instead and draw nothing).
// The node twin with every click and target kind: tests/arc-snap-constraint-node.test.js.
import assert from 'node:assert';
import { launchBrowser } from './helpers/cdp-browser.js';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await (async () => {
  const cdp = await launchBrowser({ tag: '632', width: 1600, height: 900 });
  if (!cdp) { console.log('skipped: no headless Edge/Chrome binary installed'); return; }
  const { port, send, once, evalJs, waitFor, waitForApp } = cdp;
  try {
    const mouse = (type, x, y, buttons) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !buttons ? 'none' : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
    const click = async (x, y) => { await mouse('mouseMoved', x, y, 0); await sleep(60); await mouse('mousePressed', x, y, 1); await sleep(40); await mouse('mouseReleased', x, y, 0); await sleep(200); };
    const centerOf = (sel) => evalJs(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    const STATE = 'window.__sketch.controller.state';
    const loaded = once('Page.loadEventFired');
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/apps/penplotter/index.html` });
    await Promise.race([loaded, sleep(8000)]);
    await waitFor(`!!document.querySelector('.stage-btn[data-stage="design"]')`, 'the stage button');
    const sb = await centerOf('.stage-btn[data-stage="design"]'); await click(sb.x, sb.y);
    await waitForApp('design-canvas');
    await waitFor(`document.querySelector('#design-canvas').getBoundingClientRect().width > 0 && !!${STATE}`, 'the design canvas');
    const ab = await centerOf('#tool-arc'); await click(ab.x, ab.y);

    const c = await centerOf('#design-canvas');
    const arcs = () => evalJs(`${STATE}.shapes.filter((s) => s.type === 'arc').length`);
    // arc 1: centre, start, end
    await click(c.x, c.y); await click(c.x + 90, c.y + 1); await click(c.x + 1, c.y + 90);
    assert.strictEqual(await arcs(), 1, 'the first arc is drawn');
    await evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    const ab2 = await centerOf('#tool-arc'); await click(ab2.x, ab2.y);
    const before = await evalJs(`${STATE}.constraints.length`);
    // arc 2 begins ON arc 1's centre
    await click(c.x, c.y); await click(c.x - 120, c.y + 1); await click(c.x - 1, c.y - 120);
    assert.strictEqual(await arcs(), 2, 'an arc begun on another arc\'s centre is drawn');
    const info = await evalJs(`(() => { const s = ${STATE}; const a = s.shapes.filter((x) => x.type === 'arc'); const k = s.constraints.slice(${before}).map((x) => x.type); return JSON.stringify({ k, same: a[0].joints[0] === a[1].joints[0] || s.constraints.some((x) => /coinc/i.test(x.type) && x.joints.includes(a[0].joints[0]) && x.joints.includes(a[1].joints[0])) }); })()`).then(JSON.parse);
    assert.ok(info.same, 'the new centre is the old centre (coincident): ' + JSON.stringify(info));
    assert.strictEqual(info.k.filter((t) => /coinc/i.test(t)).length, 1, 'one COINCIDENT added: ' + JSON.stringify(info.k));
    console.log('arc-snap-constraint-live.test.js: ok', JSON.stringify(info.k));
  } finally { await cdp.close(); }
})();

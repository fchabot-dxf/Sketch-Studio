// Two-point rectangle: the first click waits for the second, the second places it. TASK 596: the first click also opens the W x H boxes on the
// canvas (the shared numeric box needs the DOM), so this runs in the node kit on the real SketchStudio page with real pointer events.
import assert from 'node:assert';
import { open } from './helpers/node-app.js';

const app = await open({ host: 'sketchstudio' });
let failed = null;
try {
    const st = app.state, O = app.toScreen(0, 0);
    app.tool('rect');
    const a = { x: O.x + 300, y: O.y + 150 }, b = { x: O.x + 380, y: O.y + 210 };
    app.click(a.x, a.y);   // First click should set corner and enter waitingForSecondClick
    assert(st.active && st.active.waitingForSecondClick === true, 'First click should set waitingForSecondClick for two-point mode');
    const before = st.shapes.length;
    app.click(b.x, b.y);   // Second click should finalize the rectangle (create shapes)
    assert(st.active === null, 'After second click two-point rect should finalize and active should be cleared');
    assert(st.shapes.length > before, 'Rectangle shapes should be created on second click');
    console.log('rect-two-point-click tests passed');
} catch (e) { failed = e; } finally { await app.close(); }
if (failed) { console.error('rect-two-point-click tests failed', failed.stack || failed); process.exitCode = 1; }

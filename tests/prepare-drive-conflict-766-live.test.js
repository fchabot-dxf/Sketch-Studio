// tests/prepare-drive-conflict-766-live.test.js — TASK 766 (owner turns 2307+), in a real browser with the FAKE Drive: ANOTHER DEVICE really changes the Drive
// design the user is editing in Prepare (the test writes the fake Drive file directly: a different depth on the pocket's record, as the owner's phone would).
// The store keeps this tab's edit as a conflicted copy (it never writes over the other device's version) and says so; since 766 the running design is NOT
// replaced under his hands: the view, the selection, the open card and every cut setting stay as they are. The menu's status line offers "Load the Drive
// version"; chosen, the tab shows Drive's version: the other device's setting, and the SAME view and the same (still valid) selection with its card open.
import assert from 'node:assert';
import { sleep } from './helpers/cdp-browser.js';
import { openBromont, CARD_EDITS, sameView } from './helpers/prepare-drive-live.js';

const t0 = Date.now();
const t = await openBromont({ tag: '766b' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { evalJs, drive, clickEl, look, menu, closeMenu, status, saved, flushDrive, waitFor, shot } = t;
try {
  const start = await look();
  const key = JSON.parse(start.plan)[0][0];
  // another device writes a different depth on the pocket (25.4 mm = 1 in)
  drive.write((doc) => { const r = doc.hosts.shaper.cutPlan.find(([k]) => k === key); r[1].cutDepth = 25.4; });
  // this tab edits the card: its autosave meets the other device's version
  await clickEl(CARD_EDITS[1][1]); // stepover +
  const mine = await look();
  await sleep(1700); await flushDrive(); await sleep(300);
  assert.strictEqual(drive.copies().length, 1, 'this tab\'s edit is kept as ONE conflicted copy: ' + JSON.stringify(drive.files()));
  assert.strictEqual(drive.doc().document.hosts.shaper.cutPlan.find(([k]) => k === key)[1].cutDepth, 25.4, 'the other device\'s version is not overwritten');
  const kept = await look();
  assert.strictEqual(kept.plan, mine.plan, 'the running cut plan is NOT replaced (this tab\'s settings stay)');
  assert.ok(sameView(kept.view, start.view), 'the view is unchanged: ' + JSON.stringify(kept.view));
  assert.deepStrictEqual([kept.sel, kept.card, kept.mounts], [[key], true, start.mounts], 'the pocket stays selected with its card open, Prepare not re-mounted');
  // the menu says so and offers Drive's version
  await menu();
  await waitFor(`/Another device changed this design/.test((document.querySelector('.sk-sidebar [data-section="status"]') || {}).textContent || '') && !!document.querySelector('[data-action="load-drive-version"]')`, 'the notice with "Load the Drive version"');
  console.log('status: ' + await status());
  await shot('conflict-notice.png');
  await clickEl('[data-action="load-drive-version"]');
  await waitFor(`!document.querySelector('.sk-sidebar').classList.contains('open')`, 'the menu closed');
  await waitFor(`import('/apps/shaper/src/cut-plan.js').then((C) => C.CUT_PLAN.get(${JSON.stringify(key)}).cutDepth === 25.4)`, 'the tab now shows the Drive version');
  await sleep(300);
  const loaded = await look();
  assert.ok(sameView(loaded.view, start.view), 'Drive\'s version loaded: the view is kept: ' + JSON.stringify(loaded.view));
  assert.deepStrictEqual([loaded.sel, loaded.card], [[key], true], 'Drive\'s version loaded: the pocket still selected, its card open');
  assert.strictEqual(await evalJs(`document.querySelector('.cut-depth').value`), '1', 'the card shows the other device\'s depth');
  await saved();
  await sleep(1700); await flushDrive();
  assert.strictEqual(drive.copies().length, 1, 'loading Drive\'s version made no further copy');
  await shot('conflict-loaded.png');
  void closeMenu;
  console.log(`BLOCKED non-local requests: ${t.net.blocked().length}`);
  console.log(`prepare-drive-conflict-766-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  await t.close();
}

// tests/prepare-drive-own-write-766-live.test.js — TASK 766 (owner turn 2307), in a real browser with the FAKE Drive: ONE tab edits a Drive design's cut card in
// Prepare (zoomed on a small pocket, the pocket selected) and NOTHING is replaced under the user's hands. Before 766 a write that stopped half way (the content
// landed, the metadata request failed: a 5xx / 429 / expired token / lost answer on the real Drive) made the retry call our own write "another device's": a
// conflicted copy, the red notice, and the design re-loaded over the running one: the view back to the whole design, the selection dropped, the card gone, the
// cut settings of the last seconds lost (helpers/prepare-drive-live.js injects exactly that failure). Asserted after every card edit and after its autosave
// reached Drive: the view is unchanged (within 1e-6), the same pocket is selected with its card open, the Prepare view was not re-mounted, every record keeps
// every setting the edit did not touch, no conflicted copy exists. Then: Ctrl+S; Drive's version moves with the SAME content (another tab's write of what we
// have): nothing changes; a stage switch away and back and a reload keep the cut plan exactly.
import assert from 'node:assert';
import { sleep } from './helpers/cdp-browser.js';
import { openBromont, CARD_EDITS, planWithout, sameView } from './helpers/prepare-drive-live.js';

const t0 = Date.now();
const t = await openBromont({ tag: '766a' });
if (!t) { console.log('skipped: no headless Edge/Chrome binary installed'); process.exit(0); }
const { evalJs, drive, failNextMetaPatch, clickEl, look, openStage, saved, flushDrive, ctrlS, waitFor, load, shot } = t;
try {
  let prev = await look();
  const key = JSON.parse(prev.plan)[0][0];
  assert.deepStrictEqual([prev.sel, prev.card, JSON.parse(prev.plan).length], [[key], true, 1], 'the pocket is selected, its card open, its record the plan');
  const zoomed = prev.view;
  console.log('zoomed view ' + JSON.stringify(zoomed) + ' on ' + key);
  let i = 0;
  for (const [label, sel, field] of CARD_EDITS) {
    if (i++ === 0) failNextMetaPatch(); // the first edit's write stops half way (its content lands, its metadata request fails once)
    await clickEl(sel);
    const now = await look();
    assert.notStrictEqual(now.plan, prev.plan, `${label}: the edit changed the record`);
    assert.strictEqual(planWithout(now.plan, key, field), planWithout(prev.plan, key, field), `${label}: no other setting of any record changed`);
    await sleep(1700); await flushDrive(); await saved(); // its autosave reached Drive
    const after = await look();
    assert.strictEqual(after.plan, now.plan, `${label}: the autosave changed no setting`);
    assert.ok(sameView(after.view, zoomed), `${label}: the view is unchanged: ${JSON.stringify(after.view)}`);
    assert.deepStrictEqual([after.sel, after.card, after.mounts], [[key], true, prev.mounts], `${label}: the same pocket selected, its card open, Prepare not re-mounted`);
    assert.deepStrictEqual(drive.copies(), [], `${label}: no conflicted copy on Drive`);
    console.log(`${label}: ok (Drive v${drive.version()})`);
    prev = after;
  }
  assert.strictEqual(JSON.stringify(drive.doc().document.hosts.shaper.cutPlan.sort((a, b) => a[0] < b[0] ? -1 : 1)), prev.plan, 'Drive holds exactly the running cut plan');
  assert.ok(!/Another device/.test(await evalJs(`(document.querySelector('.sk-sidebar [data-section="status"]') || {}).textContent || ''`)), 'no conflict notice');
  // Ctrl+S, then Drive's version moves with the SAME content (another tab writing what we have): nothing changes
  await ctrlS(); await saved();
  drive.bump(2);
  await clickEl(CARD_EDITS[0][1]); await sleep(1700); await flushDrive(); await saved();
  const bumped = await look();
  assert.ok(sameView(bumped.view, zoomed) && bumped.sel[0] === key && bumped.card && bumped.mounts === prev.mounts, 'a same-content version bump: the view, the selection, the card, no re-mount');
  assert.deepStrictEqual(drive.copies(), [], 'a same-content version bump: no conflicted copy');
  await shot('own-write-after-edits.png');
  // a stage switch away and back, and a reload: the cut plan is exactly the same
  const plan = bumped.plan;
  await openStage('design'); await openStage('prepare');
  assert.strictEqual((await look()).plan, plan, 'Design and back: the cut plan unchanged');
  await openStage('review'); await openStage('prepare');
  assert.strictEqual((await look()).plan, plan, 'Export and back: the cut plan unchanged');
  await evalJs(`window.dispatchEvent(new Event('pagehide'))`); await sleep(500);
  await load();
  await waitFor(`!!window.__prepareView || document.querySelector('.sk-header-tab.active').dataset.tab !== 'prepare'`, 'the page back');
  if (await evalJs(`document.querySelector('.sk-header-tab.active').dataset.tab`) !== 'prepare') await openStage('prepare');
  assert.strictEqual((await look()).plan, plan, 'a reload: the cut plan unchanged');
  assert.deepStrictEqual(drive.copies(), [], 'and still no conflicted copy');
  console.log(`BLOCKED non-local requests: ${t.net.blocked().length}`);
  console.log(`prepare-drive-own-write-766-live: ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  await t.close();
}

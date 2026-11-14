// tests/sidebar-projects-node.test.js — TASK 601 (node port of tests/sidebar-projects.test.js, TASK 479), Shaper's Design tab with the shared sidebar mounted
// (tests/helpers/node-app.js open({ sidebar: true })): the sidebar wired to the project store. New design keeps the old one; inline rename updates the title +
// recent; Open recent switches the canvas; Projects browse / drill / back / move / pin; a non-empty project refuses delete (the store reason shows in the
// drawer); a refused (newer-version) file changes nothing. Same asserts, same steps; the clicks are the kit's `press`, the typing the kit's `type`, the file
// chooser the kit's (override 15). The autosave the browser test waited 3.2 s for is the kit's page-hide flush (storedDoc). Dropped: the screenshots
// (EVIDENCE_DIR evidence, no asserts). What stays in the browser (tests/sidebar-open-refused-live.test.js): the refused file through the REAL file chooser,
// with a garbage collection while the picker is open (the open input must stay referenced).
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';

const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
try {
  const doc = app.document, st = app.state;
  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  const key = (k, o) => app.key(k, o);
  const typeText = (s) => app.type(s);
  const ctrlA = () => key('a', { ctrl: true });
  const settle = (ms = 80) => app.pause(ms);
  const recent = async () => (await app.store.listRecent({})).map((d) => [d.name, d.projectName]);
  const shapes = () => st.shapes.length;
  const title = () => doc.title;
  const openSb = async () => { pressEl('.sk-sidebar-btn'); await settle(); };
  const seed = async (n) => { for (const k of [...st.joints.keys()]) st.joints.delete(k); st.shapes.length = 0; for (let i = 0; i < n; i++) { st.joints.set('p' + i, { x: i * 10, y: 0 }); st.joints.set('q' + i, { x: i * 10 + 5, y: 5 }); st.shapes.push({ id: 's' + i, type: 'line', joints: ['p' + i, 'q' + i] }); } app.frames(2); await app.storedDoc(); };

  await seed(4); // TASK 558 save rule: an unsaved Untitled -- the autosave stores NOTHING until the first named save
  await openSb();
  assert.strictEqual(q('.sk-sidebar-doc').textContent, 'Untitled', 'the drawer shows the unsaved Untitled');
  assert.strictEqual(title(), 'Shaper · Sketch Studio', 'an unsaved design has no design name in the tab title');
  assert.deepStrictEqual(await recent(), [], 'an unsaved Untitled is not stored, so not listed');

  // ── the FIRST NAMED SAVE: Save as… names and stores the Untitled (one design, not a copy); then it autosaves ──
  pressEl('[data-action="save-as"]'); await settle();
  ctrlA(); typeText('Door'); typeText(' '); typeText('X'); app.enter(); await settle(300);
  assert.deepStrictEqual((await recent()).map((r) => r[0]), ['Door X'], 'Save as stored the Untitled under its name');
  assert.strictEqual(title(), 'Door X — Shaper', 'the title follows the design name through the registry');

  // ── rename inline: click the name, type, Enter -> title + recent update ──
  await openSb();
  pressEl('.sk-sidebar-doc'); await settle();
  ctrlA(); typeText('Door'); typeText(' '); typeText('A'); app.enter(); await settle(300);
  assert.strictEqual(q('.sk-sidebar-doc').textContent, 'Door A');
  assert.strictEqual(title(), 'Door A — Shaper', 'rename updates the title');
  assert.deepStrictEqual((await recent()).map((r) => r[0]), ['Door A'], 'and the recent list');

  // ── New design KEEPS the old one, and stores nothing until it is named ──
  pressEl('[data-action="new-design"]'); await settle(300);
  assert.strictEqual(shapes(), 0, 'New design starts empty');
  await openSb(); // the drawer closed after the action: reopen to read the refreshed name
  assert.strictEqual(q('.sk-sidebar-doc').textContent, 'Untitled');
  assert.deepStrictEqual((await recent()).map((r) => r[0]), ['Door A'], 'the previous design is kept; the new Untitled is not stored');
  pressEl('[data-action="save-as"]'); await settle();
  ctrlA(); typeText('DoorB'); app.enter(); await settle(300);
  await seed(2); // some content for B (autosaved: B is named)
  app.esc(); await settle();

  // ── Open recent switches the canvas ──
  await openSb();
  pressEl('[data-action="open-recent"]'); await settle(300);
  const rows = qa('.sk-pm .sk-pm-tile').map((r) => r.querySelector('[data-name]').textContent + '|' + r.querySelector('.sk-pm-sub').textContent);
  assert.ok(rows[0].startsWith('DoorB|'), 'newest first, with the relative time: ' + rows[0]);
  assert.ok(/just now|min ago/.test(rows[0]), 'relative time shown');
  assert.ok(rows[1].startsWith('Door A|'), 'then the older one');
  pressEl('.sk-pm .sk-pm-tile:nth-of-type(2)'); await settle(400);
  assert.strictEqual(shapes(), 4, 'opening Door A switches the canvas content');
  assert.strictEqual(title(), 'Door A — Shaper', 'and the title follows');
  assert.strictEqual(q('.sk-sidebar').classList.contains('open'), false, 'the drawer closes after an open');

  // ── Projects (the project manager modal, TASK 547): new project, pin, browse, move, delete refusal ──
  await openSb(); pressEl('[data-action="projects"]'); await settle(300);
  pressEl('[data-pm="new-project"]'); await settle();
  ctrlA(); typeText('Kitchen'); app.enter(); await settle(300);
  const names = () => qa('.sk-pm-side [data-project]').map((n) => n.textContent);
  assert.ok(names().includes('Kitchen') && names().includes('My Designs'), 'the new project is listed');
  const rowOf = (name) => qa('.sk-pm-side .sk-pm-prow').find((w) => w.textContent.includes(name));
  // pin Kitchen via its row menu: pinned goes first
  app.press(rowOf('Kitchen').querySelector('.sk-pm-more')); await settle();
  pressEl('.sk-pm-menu [data-menu="pin"]'); await settle(300);
  assert.strictEqual(names()[0], 'Kitchen', 'a pinned project is listed first');
  // My Designs -> its designs; open the menu of DoorB and move it to Kitchen
  app.press(rowOf('My Designs').querySelector('.sk-pm-rowbtn')); await settle(300);
  const designNames = () => qa('.sk-pm-tile [data-name]').map((n) => n.textContent);
  assert.deepStrictEqual(designNames().sort(), ['Door A', 'DoorB'], 'a project shows its designs');
  app.press(qa('.sk-pm-tile').find((x) => x.textContent.includes('DoorB')).querySelector('.sk-pm-more')); await settle();
  pressEl('.sk-pm-menu [data-menu="move"]'); await settle();
  app.press(qa('.sk-pm-ask [data-choice]').find((x) => x.textContent === 'Kitchen')); await settle(400);
  assert.deepStrictEqual(designNames(), ['Door A'], 'DoorB left My Designs');
  app.press(rowOf('Kitchen').querySelector('.sk-pm-rowbtn')); await settle(300);
  assert.deepStrictEqual(designNames(), ['DoorB'], 'and is in Kitchen');
  // delete refusal: Kitchen still holds a design -> the store's reason shows in the manager, the project stays
  app.press(rowOf('Kitchen').querySelector('.sk-pm-more')); await settle();
  pressEl('.sk-pm-menu [data-menu="delete"]'); await settle();
  pressEl('.sk-pm-ask .ok'); await settle(300);
  const msg = (q('.sk-pm-msg.error') || {}).textContent || '';
  assert.ok(/still holds 1 design/.test(msg), 'delete of a non-empty project shows the store reason: ' + msg);
  assert.ok(names().includes('Kitchen'), 'and the project is still there');

  // ── a refused file (newer version) shows its message and changes nothing ──
  app.esc(); await settle();
  const before = JSON.stringify({ r: await recent(), s: shapes(), t: title() });
  const fileInputs = () => doc.querySelectorAll('input[type=file]').length;
  const inputsBefore = fileInputs(); // the page owns some file inputs of its own: compare, don't expect zero
  if (!q('.sk-sidebar').classList.contains('open')) await openSb(); // (the drawer's state after the Projects modal closes: the sidebar button would toggle it shut)
  pressEl('[data-action="open-file"]');
  await app.waitFor(() => app.hasFileChooser(), 'the file chooser to open', 4000); // the click comes after the app's own async steps
  assert.ok(app.hasFileChooser(), 'the file chooser opened');
  app.chooseFile({ name: 'newer.sketch.json', text: JSON.stringify({ format: 'sketch-studio-project', version: 1, app: 'shaper', name: 'Future', document: { version: 99, geometry: { joints: [], shapes: [], constraints: [] }, hosts: {} } }) });
  await app.waitFor(() => !!(q('.sk-sidebar-msg.error') || {}).textContent, 'the refusal message in the drawer', 10000);
  assert.strictEqual(fileInputs(), inputsBefore, 'no stray file input is left in the DOM once the open settled');
  assert.strictEqual(q('.sk-sidebar').classList.contains('open'), true, 'the drawer stays open on a refusal');
  const refused = (q('.sk-sidebar-msg.error') || {}).textContent || '';
  assert.ok(/newer version/i.test(refused), 'the refusal message is shown in the drawer: ' + refused);
  assert.strictEqual(JSON.stringify({ r: await recent(), s: shapes(), t: title() }), before, 'nothing changed (no new design, canvas and title untouched)');
  console.log('sidebar-projects-node: ok');
} finally { await app.close(); }

// tests/fixes-774-node.test.js — TASK 774 (review of the owner's merges at main 5e79336 + owner turn 2356), the parts a node test can assert:
//   3. THE REPLACE RULE (packages/core/shaper-cloud.js): a Replace always carries the login; a token-only Replace is refused before any call; a session that
//      ends between the DELETE and the create is renewed with that login; a create that still fails after the DELETE says "The old X was removed but the
//      new one could not be added ... Send again to add it." (never a bare "Session expired"), keeping the failure's kind.
//   4b/4c. Save as's overwrite check (packages/ui/project-actions.js findExisting): a Drive listing that fails THROWS (shown, nothing saved), never "no such
//      name"; the folder's design list throws too (never "empty"); `openInOtherTab` says another open tab shows the design the overwrite replaces.
//   5. STOCK FIRST (packages/core/shaper-export.js + Shaper's CUT_TYPES `exportFirst`): the Stock's element is written first; every other element keeps its
//      bytes and its relative order.
//   6a. shaperFileName transliterates accented letters and ligatures; 6b. selectionDesignName names a Fusion design after the DOCUMENT.
// FAKE ShaperHub API at the fetch level (tests/shaperhub-fake-api.js) and a fake store: no request leaves this machine (blocked ones are counted: 0).
import assert from 'node:assert';
import { createFakeShaperApi, FAKE_LOGIN, FAKE_TOKEN } from './shaperhub-fake-api.js';
import { uploadToShaperHub, handleShaperUpload, shaperFileName, UPLOAD_MODES } from '../packages/core/shaper-cloud.js';
import { exportShaperSVG } from '#core/shaper-export.js';
import { findLoops } from '#core/loop-finder.js';
import { exportEncoding } from '../apps/shaper/src/shaper.js';
import { exportFileName } from '../apps/shaper/src/export-payload.js';
import { selectionDesignName } from '../apps/shaper/src/fusion-import.js';
import { createProjectActions } from '../packages/ui/project-actions.js';

let checks = 0;
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); checks++; };
const ok = (c, m) => { assert.ok(c, m); checks++; };
const realFetch = globalThis.fetch;
const blocked = [];
let api = null;
const install = (opts, wrap = null) => { api = createFakeShaperApi(opts); globalThis.fetch = wrap ? wrap(api) : api.fetch; return api; };
const done = () => { blocked.push(...api.blocked); };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';

try {
  // ── 3. THE REPLACE RULE ──
  install({ files: ['bromont.svg'] });
  const tokenOnly = await handleShaperUpload(JSON.stringify({ token: FAKE_TOKEN, filename: 'bromont', svg: SVG, mode: UPLOAD_MODES.REPLACE }));
  eq([tokenOnly.status, tokenOnly.body.kind], [400, 'login'], '3: a token-only Replace is refused (kind login)');
  eq(api.steps(), [], '3: ... before ANY call (nothing deleted)');
  ok(!JSON.stringify(tokenOnly.body).includes(FAKE_TOKEN), '3: the refusal does not carry the token');
  done();

  // the session ends between the DELETE and the create: the login renews it, the new file is added
  install({ files: ['bromont.svg'] }, (a) => async (url, init = {}) => {
    const res = await a.fetch(url, init);
    if ((init.method || 'GET').toUpperCase() === 'DELETE') a.rotateToken('rotated-jwt-774');
    return res;
  });
  const renewed = await uploadToShaperHub({ token: FAKE_TOKEN, ...FAKE_LOGIN, filename: 'bromont', svg: SVG, mode: UPLOAD_MODES.REPLACE, session: true });
  eq([renewed.status, renewed.token], ['replaced', 'rotated-jwt-774'], '3: expired between DELETE and create -> renewed with the login, replaced');
  eq(api.steps(), ['search', 'blob', 'delete', 'create', 'token', 'create'], '3: search > blob > delete > create (401) > sign in > create');
  eq(api.names('/'), ['bromont.svg'], '3: the new file is in My Files');
  done();

  // the renewal itself fails after the DELETE (the password was changed meanwhile): the removed-but-not-added message, kind login
  install({ files: ['bromont.svg'], fail: { create: { status: 401, message: 'Unauthorized' }, token: { status: 401, message: 'Username and password could not be verified' } } });
  const lost = await handleShaperUpload(JSON.stringify({ token: FAKE_TOKEN, ...FAKE_LOGIN, filename: 'bromont', svg: SVG, mode: UPLOAD_MODES.REPLACE }));
  eq(lost.body.kind, 'login', '3: a login failure after the DELETE keeps its kind (the dialog asks to sign in)');
  ok(/^The old bromont\.svg was removed but the new one could not be added \(Authentication failed \(401\): Username and password could not be verified\)\. Send again to add it\.$/.test(lost.body.error), '3: never a bare "Session expired": ' + lost.body.error);
  eq(api.steps(), ['search', 'blob', 'delete', 'create', 'token'], '3: ... the failure came after the DELETE');
  ok(!lost.body.error.includes(FAKE_LOGIN.password) && !lost.body.error.includes(FAKE_LOGIN.email), '3: the message carries no login');
  done();

  // no answer at all after the DELETE (network): the same message, kind network
  install({ files: ['bromont.svg'], fail: { create: 'network' } });
  const net = await handleShaperUpload(JSON.stringify({ ...FAKE_LOGIN, filename: 'bromont', svg: SVG, mode: UPLOAD_MODES.REPLACE }));
  eq(net.body.kind, 'network', '3: a network failure after the DELETE keeps its kind');
  ok(/^The old bromont\.svg was removed but the new one could not be added \(Could not reach ShaperHub \(adding the file to My Files\): fetch failed\)\. Send again to add it\.$/.test(net.body.error), '3: ' + net.body.error);
  done();

  // Keep both / Send stay token-only (they never delete)
  install({ files: ['bromont.svg'] });
  const kb = await uploadToShaperHub({ token: FAKE_TOKEN, filename: 'bromont', svg: SVG, mode: UPLOAD_MODES.KEEP_BOTH, session: true });
  eq([kb.status, kb.filename], ['sent', 'bromont (2).svg'], '3: Keep both with a token alone still works');
  done();
} finally {
  globalThis.fetch = realFetch;
}

// ── 6a. the name rule transliterates ──
eq(shaperFileName('Étagère'), 'Etagere.svg', '6a: "Étagère" -> "Etagere.svg"');
eq(shaperFileName('façade'), 'facade.svg', '6a: ç -> c');
eq(shaperFileName('cœur'), 'coeur.svg', '6a: œ -> oe');
eq(shaperFileName('Œuvre Æther straße'), 'OEuvre AEther strasse.svg', '6a: Œ Æ ß from the declared ligature table');
eq(shaperFileName('Ñandú über'), 'Nandu uber.svg', '6a: ñ ú ü');
eq(shaperFileName('a/b:c*d'), 'a_b_c_d.svg', '6a: any other character still becomes _');
eq(shaperFileName('家具 €'), '__ _.svg', '6a: a character with no plain letter is ONE _ (not one per decomposed part)');
eq(shaperFileName('한'), '_.svg', '6a: a Hangul syllable stays one character (recomposed after the accents go)');
eq(exportFileName('Étagère murale'), 'Etagere murale.svg', '6a: the Export step\'s names go through the same rule');

// ── 6b. Fusion mode: the design (and so the file) is named after the Fusion DOCUMENT ──
eq(selectionDesignName({ kind: 'body', name: 'Body1', documentName: '06-countersink v3' }), '06-countersink', '6b: the document\'s name, without Fusion\'s " v<n>"');
eq(selectionDesignName({ kind: 'body', name: 'Body1', documentName: '06-countersink' }), '06-countersink', '6b: a document name without a version');
eq(selectionDesignName({ kind: 'body', name: 'Body1', documentName: '  ' }), 'Body1', '6b: no document name -> the body\'s');
eq(selectionDesignName({ kind: 'body', name: 'Body1' }), 'Body1', '6b: a payload without documentName -> the body\'s');
eq(selectionDesignName(null), 'selection', '6b: nothing -> "selection" (as before)');
eq(exportFileName(selectionDesignName({ name: 'Body1', documentName: 'Étagère v2' })), 'Etagere.svg', '6b + 6a: the file name');

// ── 5. STOCK FIRST ──
{
  const st = { joints: new Map(), shapes: [], constraints: [], profiles: [] };
  const rect = (name, x0, y0, x1, y1) => {
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach(([x, y], i) => st.joints.set(`${name}${i}`, { x, y }));
    for (let i = 0; i < 4; i++) st.shapes.push({ id: `${name}s${i}`, type: 'line', joints: [`${name}${i}`, `${name}${(i + 1) % 4}`] });
  };
  rect('S', -20, -20, 220, 140); // the board
  rect('A', 0, 0, 90, 60); rect('B', 110, 0, 200, 60); // two plates
  rect('P', 10, 10, 40, 40); // a pocket in plate A
  const loops = findLoops(st);
  const L = (edge) => ({ kind: 'loop', id: loops.find((l) => l.edges.includes(edge)).id });
  const entries = [
    { target: L('As0'), rec: { cutType: 'exterior', cutDepth: 19, cutOffset: 0, toolDia: 6.35 } },
    { target: L('Ps0'), rec: { cutType: 'pocket', cutDepth: 6, cutOffset: 0, toolDia: 6.35 } },
    { target: L('Ss0'), rec: { cutType: 'stock', cutDepth: 19.05 } },
    { target: L('Bs0'), rec: { cutType: 'exterior', cutDepth: 19, cutOffset: 0, toolDia: 6.35 } },
  ];
  const enc = exportEncoding();
  ok(enc.find((t) => t.id === 'stock').exportFirst === true && enc.filter((t) => t.exportFirst).length === 1, '5: only the Stock declares exportFirst');
  const planOrder = enc.map(({ exportFirst, ...t }) => t); // the same encoding without the declaration = the plan's order (the file before 774)
  for (const options of [{}]) {
    const now = exportShaperSVG({ state: st, entries, encoding: enc, docUnit: 'in', options }).split('\n');
    const before = exportShaperSVG({ state: st, entries, encoding: planOrder, docUnit: 'in', options }).split('\n');
    const isStock = (line) => /M -20 -20/.test(line);
    const stockLines = before.filter(isStock);
    eq(stockLines.length, 1, `5 ${JSON.stringify(options)}: one Stock element`);
    ok(/fill="#0068FF" stroke="#0068FF" shaper:cutType="guide"/.test(stockLines[0]), '5: the Stock is a filled #0068FF guide (encoding unchanged)');
    eq(now[0], before[0], '5: the header is unchanged');
    eq(now[1], stockLines[0], `5 ${JSON.stringify(options)}: the Stock is the FIRST element, byte for byte the same`);
    eq(now.slice(2), before.slice(1).filter((l) => !isStock(l)), `5 ${JSON.stringify(options)}: every other line keeps its bytes and its order`);
    ok(before.indexOf(stockLines[0]) > 1, '5: (before: the Stock came after cuts, in plan order)');
  }
}

// ── 4b / 4c. Save as's overwrite check over a FAKE store ──
{
  const folder = { id: 'drive:F', name: 'Furniture', location: 'drive' };
  let driveError = null;
  let designs = [{ id: 'drive:D1', projectId: 'drive:F', name: 'Chair', app: 'shaper', updatedAt: 1 }];
  const store = {
    cloud: { lastError: () => driveError },
    isRemote: (id) => String(id).startsWith('drive:'),
    async listProjects() { return driveError ? [] : [folder]; },
    async listDesigns(pid) { return driveError ? [] : designs.filter((d) => d.projectId === pid); },
    async overwrite() { throw new Error('not in this test'); },
    async createProject() { throw new Error('not in this test'); },
    async current() { return null; },
  };
  const tabs = [{ key: 'a', designId: null, active: true }, { key: 'b', designId: 'drive:D1', active: false }];
  const buffer = { tabs: () => tabs, isStored: () => false, designName: () => 'Untitled' };
  let opts = null;
  const actions = createProjectActions({ store, getBuffer: () => buffer, account: { state: () => ({ signedIn: true }), subscribe: () => () => {} }, fileDialog: async (o) => { opts = o; return null; } });
  await actions.saveAsDialog();
  const browse = opts.browseDrive;
  eq(await browse.findExisting('Chair', 'drive:F'), { id: 'drive:D1', name: 'Chair', folderName: 'Furniture', openInOtherTab: true }, '4b: the design is open in another tab: said');
  tabs[1].designId = null; tabs[0].designId = 'drive:D1';
  eq((await browse.findExisting('Chair', 'drive:F')).openInOtherTab, false, '4b: open in THIS tab only: not another tab');
  driveError = new Error('Drive 503');
  await assert.rejects(browse.findExisting('Chair', 'drive:F'), /Google Drive answered HTTP 503/, '4c: a failed listing throws (shown in the dialog), never "no such name"'); checks++;
  await assert.rejects(browse.listFolderDesigns('drive:F'), /Google Drive answered HTTP 503/, '4c: the folder list throws too, never "empty"'); checks++;
  driveError = null;
  eq((await browse.listFolderDesigns('drive:F')).map((r) => [r.id, r.name]), [['drive:D1', 'Chair']], '4c: a good read lists the folder');
  designs = [];
  eq(await browse.findExisting('Chair', 'drive:F'), null, '4c: a good read without the name: null');
}

eq(blocked, [], 'no request left this machine (0 blocked)');
console.log(`fixes-774-node: ${checks} checks passed, ${blocked.length} non-local requests blocked`);

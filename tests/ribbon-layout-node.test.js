// tests/ribbon-layout-node.test.js — TASK 647: the saved tool-ribbon layout (#ui/ribbon-layout.js), read against a section's declared tools:
// the declared defaults (declared order, the first defaultInBar in the bar), a saved order / checkboxes kept, an id no longer declared dropped,
// a newly declared id appended in declared order (in the bar unless past defaultInBar), the versioned shape, one entry per app and section.
import assert from 'node:assert';
import { defaultSection, resolveSection, appSections, withSection, RIBBON_LAYOUT_VERSION } from '#ui/ribbon-layout.js';
import { MIN_PER_SECTION_PREFERRED, MIN_PER_SECTION } from '#ui/tool-ribbon.js';

const plain = (s) => ({ order: s.order, off: [...s.off].sort() });

// defaults
assert.deepStrictEqual(plain(defaultSection(['a', 'b', 'c'])), { order: ['a', 'b', 'c'], off: [] }, 'default: declared order, all in the bar');
assert.deepStrictEqual(plain(defaultSection(['t', 'b', 'f', 'm'], 1)), { order: ['t', 'b', 'f', 'm'], off: ['b', 'f', 'm'] }, 'defaultInBar 1: only the first in the bar');
assert.deepStrictEqual(plain(resolveSection(null, ['a', 'b'], 1)), { order: ['a', 'b'], off: ['b'] }, 'nothing saved = the defaults');
assert.deepStrictEqual(plain(resolveSection({ nonsense: 1 }, ['a', 'b'])), { order: ['a', 'b'], off: [] }, 'an entry without an order = the defaults');

// a saved entry: order and checkboxes kept; removed ids dropped; new ids appended in declared order
assert.deepStrictEqual(plain(resolveSection({ order: ['c', 'a', 'b'], off: ['a'] }, ['a', 'b', 'c'])), { order: ['c', 'a', 'b'], off: ['a'] }, 'saved order and checkbox kept');
assert.deepStrictEqual(plain(resolveSection({ order: ['c', 'gone', 'a'], off: ['gone'] }, ['a', 'b', 'c', 'd'])), { order: ['c', 'a', 'b', 'd'], off: [] }, 'removed id dropped, new ids b and d appended in declared order, in the bar');
assert.deepStrictEqual(plain(resolveSection({ order: ['b', 'a'], off: [] }, ['a', 'b', 'x'], 1)), { order: ['b', 'a', 'x'], off: ['x'] }, 'a new id past defaultInBar is appended out of the bar');
assert.deepStrictEqual(plain(resolveSection({ order: ['a', 'a', 'b'], off: [] }, ['a', 'b'])), { order: ['a', 'b'], off: [] }, 'a duplicated id is kept once');

// the stored shape: versioned, per app, per section; Reset (null) removes the section's entry
let raw = withSection(null, 'shaper', 'create', { order: ['b', 'a'], off: new Set(['a']) });
assert.deepStrictEqual(raw, { v: RIBBON_LAYOUT_VERSION, apps: { shaper: { create: { order: ['b', 'a'], off: ['a'] } } } }, 'one app, one section');
raw = withSection(raw, 'trace', 'create', { order: ['a', 'b'], off: new Set() });
assert.deepStrictEqual(Object.keys(raw.apps), ['shaper', 'trace'], 'apps kept apart');
assert.deepStrictEqual(appSections(raw, 'shaper').create.order, ['b', 'a'], 'read back per app');
assert.deepStrictEqual(appSections(raw, 'penplotter'), {}, 'an app with nothing saved');
raw = withSection(raw, 'shaper', 'create', null);
assert.deepStrictEqual(raw.apps.shaper, {}, 'Reset removes the entry: the declared defaults');
assert.deepStrictEqual(appSections({ v: 99, apps: { shaper: { create: { order: ['x'] } } } }, 'shaper'), {}, 'an unknown version is not read');
assert.deepStrictEqual(appSections('junk', 'shaper'), {}, 'a non-object is not read');
assert.deepStrictEqual(withSection({ v: 99, apps: { old: {} } }, 'shaper', 'create', null), { v: RIBBON_LAYOUT_VERSION, apps: { shaper: {} } }, 'writing over an unknown version starts a fresh v1 value');

// the fit's two declared constants
assert.deepStrictEqual([MIN_PER_SECTION_PREFERRED, MIN_PER_SECTION], [2, 1], 'aim for 2 tools per section, at least 1');
console.log('ribbon-layout-node: ok');

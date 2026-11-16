// tests/fav-templates-692-node.test.js -- TASK 692: favourite templates (order rule, SettingsManager local persistence,
// unknown ids dropped on read, star toggle does not open design or rebuild lazy previews, keyboard focus retained).
import assert from 'node:assert';
import { open, createProfile } from './helpers/node-app.js';
import { TEMPLATES } from '#core/templates.js';
import SettingsManager from '#core/settings-manager.js';
import {
  TEMPLATE_FAVOURITES_KEY,
  TEMPLATE_FAVOURITES_VERSION,
  normalizeFavouriteIds,
  loadFavouriteIds,
  saveFavouriteIds,
  toggleFavouriteId,
  orderTemplatesByFavourites,
} from '#ui/template-picker.js';

// 1. Pure order + unknown-id + persistence unit checks
const bankIds = TEMPLATES.map((t) => t.id);
assert.deepStrictEqual(
  normalizeFavouriteIds({ v: TEMPLATE_FAVOURITES_VERSION, ids: ['star', 'removed-template', 'hexagon', 'star'] }, bankIds),
  ['star', 'hexagon'],
  'unknown ids and duplicates are dropped on read while keeping starred order',
);
assert.deepStrictEqual(normalizeFavouriteIds({ v: 99, ids: ['star'] }, bankIds), [], 'unknown settings version is ignored');
assert.deepStrictEqual(normalizeFavouriteIds('bad', bankIds), [], 'non-object settings value is ignored');

const ordered = orderTemplatesByFavourites(TEMPLATES, ['star', 'slot', 'missing']);
assert.strictEqual(ordered.favs.map((t) => t.id).join(','), 'star,slot', 'starred templates come in starred order');
const expectedRest = bankIds.filter((id) => id !== 'star' && id !== 'slot');
assert.deepStrictEqual(ordered.rest.map((t) => t.id), expectedRest, 'unstarred templates keep bank order');
assert.deepStrictEqual(
  orderTemplatesByFavourites(TEMPLATES, ['star']).rest.map((t) => t.id),
  bankIds.filter((id) => id !== 'star'),
  'unstarring slot returns it to its bank position',
);

// 2. DOM + SettingsManager round-trip via node-app (shaper host with shared sidebar)
const profile = await createProfile();
const app = await open({ host: 'shaper', profile, sidebar: true });
try {
  const doc = app.document, st = app.state;
  const q = (sel) => doc.querySelector(sel);
  const qa = (sel) => [...doc.querySelectorAll(sel)];
  const pressEl = (sel) => { const e = q(sel); assert(e, sel + ' not found'); app.press(e); };
  const settle = (ms = 80) => app.pause(ms);
  const waitPreviews = async () => {
    for (let i = 0; i < 200 && !q('.sk-tp-grid[data-previews="ready"]'); i++) await app.pause(50);
    assert.ok(q('.sk-tp-grid[data-previews="ready"]'), 'every card preview drawn');
  };

  // Initial state: 0 favourites -> no Favourites heading, no divider, Blank has no star, every template has aria-label + aria-pressed="false"
  pressEl('.sk-sidebar-btn'); await settle();
  pressEl('[data-action="templates"]'); await settle();
  await waitPreviews();
  assert.strictEqual(q('.sk-tp-fav-head'), null, 'no Favourites heading with 0 favourites');
  assert.strictEqual(q('.sk-tp-fav-sep'), null, 'no Favourites divider with 0 favourites');
  assert.strictEqual(q('.sk-tp-item[data-template="blank"]'), null, 'Blank card has no star wrapper');
  assert.strictEqual(q('.sk-tp-star[data-template="blank"]'), null, 'Blank card has no star button');
  assert.deepStrictEqual(qa('.sk-tp-card').map((c) => c.dataset.template), ['blank', ...bankIds]);
  for (const t of TEMPLATES) {
    const s = q(`.sk-tp-star[data-template="${t.id}"]`);
    assert(s, `star button missing for ${t.id}`);
    assert.strictEqual(s.getAttribute('aria-pressed'), 'false', `${t.id}: aria-pressed starts false`);
    assert.strictEqual(s.getAttribute('aria-label'), `Favourite ${t.name}`, `${t.id}: accessible name`);
  }

  // Record exact SVG nodes before reordering to prove lazy previews are NOT rebuilt on reorder
  const starSvgBefore = q('.sk-tp-card[data-template="star"] .sk-tp-prev svg');
  const hexSvgBefore = q('.sk-tp-card[data-template="hexagon"] .sk-tp-prev svg');
  assert(starSvgBefore && hexSvgBefore, 'preview SVGs present before starring');

  // Star `star`, then `hexagon` -> star does not open template, moves right under Blank in starred order, heading appears
  q('.sk-tp-star[data-template="star"]').focus();
  pressEl('.sk-tp-star[data-template="star"]'); await settle();
  assert.strictEqual(q('.sk-tp-start'), null, 'clicking star must NOT open start view');
  assert.strictEqual(st.shapes.length, 0, 'clicking star must NOT start a design');
  assert(q('.sk-tp-panel'), 'clicking star keeps the modal open');
  assert.strictEqual(q('.sk-tp-star[data-template="star"]').getAttribute('aria-pressed'), 'true');
  assert(q('.sk-tp-fav-head') && q('.sk-tp-fav-head').textContent === 'Favourites', 'Favourites heading shown when >= 1 favourite');
  assert.deepStrictEqual(
    qa('.sk-tp-card').map((c) => c.dataset.template),
    ['blank', 'star', ...bankIds.filter((id) => id !== 'star')],
    'star moves right after Blank',
  );

  q('.sk-tp-star[data-template="hexagon"]').focus();
  pressEl('.sk-tp-star[data-template="hexagon"]'); await settle();
  assert.deepStrictEqual(
    qa('.sk-tp-card').map((c) => c.dataset.template),
    ['blank', 'star', 'hexagon', ...bankIds.filter((id) => id !== 'star' && id !== 'hexagon')],
    'second favourite appends to favourites group in starred order',
  );
  assert.strictEqual(
    q('.sk-tp-card[data-template="star"] .sk-tp-prev svg'),
    starSvgBefore,
    're-ordering does NOT rebuild star preview SVG',
  );
  assert.strictEqual(
    q('.sk-tp-card[data-template="hexagon"] .sk-tp-prev svg'),
    hexSvgBefore,
    're-ordering does NOT rebuild hexagon preview SVG',
  );

  // Settings persisted locally with declared key & versioned shape; unknown ids dropped on load
  const storedRaw = JSON.parse(app.window.localStorage.getItem('sketch-studio-settings') || '{}');
  assert.deepStrictEqual(
    storedRaw[TEMPLATE_FAVOURITES_KEY],
    { v: TEMPLATE_FAVOURITES_VERSION, ids: ['star', 'hexagon'] },
    'TEMPLATE_FAVOURITES saved to localStorage via SettingsManager',
  );
  saveFavouriteIds(['star', 'deleted-template-99', 'hexagon'], [...TEMPLATES, { id: 'deleted-template-99' }]);
  assert.deepStrictEqual(loadFavouriteIds(TEMPLATES), ['star', 'hexagon'], 'unknown template id dropped on read');
  SettingsManager.set(TEMPLATE_FAVOURITES_KEY, { v: TEMPLATE_FAVOURITES_VERSION, ids: ['star', 'deleted-template-99', 'hexagon'] }, { persist: 'local' });
  SettingsManager.load();
  assert.deepStrictEqual(loadFavouriteIds(TEMPLATES), ['star', 'hexagon'], 'reload from localStorage keeps valid favourites and drops unknown');

  // Unstar `star` -> returns to its bank spot; `hexagon` stays first; focus remains on star when focused
  const starBtn = q('.sk-tp-star[data-template="star"]');
  starBtn.focus();
  pressEl('.sk-tp-star[data-template="star"]'); await settle();
  assert.strictEqual(doc.activeElement, starBtn, 'focus remains on the pressed star button');
  assert.deepStrictEqual(
    qa('.sk-tp-card').map((c) => c.dataset.template),
    ['blank', 'hexagon', ...bankIds.filter((id) => id !== 'hexagon')],
    'un-starring returns template to its bank position',
  );

  // Clean up via toggleFavouriteId back to 0 -> heading and divider vanish
  const hexBtn = q('.sk-tp-star[data-template="hexagon"]');
  pressEl('.sk-tp-star[data-template="hexagon"]'); await settle();
  assert.strictEqual(q('.sk-tp-fav-head'), null, 'heading disappears when 0 favourites remain');
  assert.strictEqual(q('.sk-tp-fav-sep'), null, 'divider disappears when 0 favourites remain');
  assert.deepStrictEqual(qa('.sk-tp-card').map((c) => c.dataset.template), ['blank', ...bankIds]);
  assert.strictEqual(hexBtn.getAttribute('aria-pressed'), 'false');
  toggleFavouriteId([], 'slot');
  assert.deepStrictEqual(SettingsManager.get(TEMPLATE_FAVOURITES_KEY), { v: 1, ids: ['slot'] });

  app.key('Escape'); await settle();
  console.log('fav-templates-692-node: ok');
} finally {
  await app.close();
}

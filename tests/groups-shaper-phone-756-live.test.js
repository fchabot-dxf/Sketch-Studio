// tests/groups-shaper-phone-756-live.test.js — TASK 756: user groups in shaper (phone), the shared scenario (tests/helpers/groups-live.js: desktop mouse + phone
// touch, one phase per file: the letters import lands grouped, hover / click / drag / double click / Esc, the right-click and touch-and-hold menus' Group /
// Ungroup / Enter group / Leave group). One file per app and phase so each stays short.
import { runGroupsLive } from './helpers/groups-live.js';

await runGroupsLive({ name: 'shaper', url: '/apps/shaper/index.html', canvas: '#design-canvas', canvasId: 'design-canvas', show: `document.querySelector('.sk-header-tab[data-tab="design"]').click()` }, 'phone');

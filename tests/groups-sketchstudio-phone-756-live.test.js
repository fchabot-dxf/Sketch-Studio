// tests/groups-sketchstudio-phone-756-live.test.js — TASK 756: user groups in sketchstudio (phone), the shared scenario (tests/helpers/groups-live.js: desktop mouse + phone
// touch, one phase per file: the letters import lands grouped, hover / click / drag / double click / Esc, the right-click and touch-and-hold menus' Group /
// Ungroup / Enter group / Leave group). One file per app and phase so each stays short.
import { runGroupsLive } from './helpers/groups-live.js';

await runGroupsLive({ name: 'sketchstudio', url: '/apps/sketchstudio/index.html', canvas: '#svgCanvas', canvasId: 'svgCanvas', show: null }, 'phone');

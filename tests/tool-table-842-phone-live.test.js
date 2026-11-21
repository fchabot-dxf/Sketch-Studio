// tests/tool-table-842-phone-live.test.js — TASK 842: the Tool table on a phone (390 x 844, touch, inches): add a bit in the window, pick it in an operation, its name in
// the card and the Operations list's tool change; the table persists across a reload (tests/helpers/tool-table-live.js). Screenshots to .evidence/842/.
import { toolTablePhase } from './helpers/tool-table-live.js';

await toolTablePhase({ phone: true });

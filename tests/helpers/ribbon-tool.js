// tests/helpers/ribbon-tool.js — TASK 647: run a ribbon tool the way a user does, with the test's own real press (mouse or touch).
// A tool that is in the bar is pressed there; one that is not (it did not fit, or its section shows only its first tool) is run from its
// section's dropdown: a press on the section's name, then on the tool's row.
import { sleep } from './cdp-browser.js';

const centreOf = (evalJs, sel) => evalJs(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);

/** press(point) is the test's real click / tap. id is the bar button's id (e.g. 'tool-fillet', 'btn-parameters'). */
export async function pressRibbonTool(evalJs, press, id) {
  const where = await evalJs(`(() => { const b = document.getElementById(${JSON.stringify(id)}); return b ? { hidden: b.hidden, section: b.closest('.sk-ribbon-group').dataset.section } : null; })()`);
  if (!where) throw new Error('pressRibbonTool: no ribbon button #' + id);
  if (!where.hidden) { await press(await centreOf(evalJs, '#' + id)); return; }
  await press(await centreOf(evalJs, `.sk-ribbon-group[data-section="${where.section}"] .sk-ribbon-group-label`));
  await sleep(150);
  const row = await centreOf(evalJs, `.sk-ribbon-sect-menu.show .sk-ribbon-sect-item[data-id="${id}"]`);
  if (!row) throw new Error('pressRibbonTool: the ' + where.section + ' dropdown did not open with #' + id);
  await press(row);
}

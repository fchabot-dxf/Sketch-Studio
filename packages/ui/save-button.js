// packages/ui/save-button.js — TASK 768 (owner turn 2314: "maybe add a save button in the header, and a spinning wheel for load state"): THE Save button of the
// shared app chrome, one component for the four hosts. It runs THE Save command (sidebar-projects.js saveNow, the same function as Ctrl+S and the menu's Save:
// to the design's home, document-home.js) and SHOWS the save state of the design shown, from save-state.js (the same source the document tab's dot reads).
// Mounted by sidebar-projects.js, so a host without the project layer (Shaper in Fusion mode, `projects: false`) has none.
//
// WHERE (placeIn, TASK 776, owner turn 2368): the right end of the shared app footer (footer-slot.js; app-footer.js sizes it: 32 px, 44 px high on touch), after
// the Settings gear and before the account avatar, in EVERY layout (desktop, phone, phone landscape): one place, never in the header or the tab strip.
// FIXED FOOTPRINT: every state has the same icon slot (16 px: the save glyph, or the spinner): a state change never shifts the stage buttons.
// States (save-state.js): saved = dimmed; new = plain; unsaved = accent outline + an accent dot on the glyph; saving / loading = the spinner (spinner.js) in the
// glyph's place, a press does nothing; failed = filled red, a press tries again; signin = filled amber (the menu's status text).
// Accessibility: aria-label "Save, <state text>"; the title adds the shortcut from the table (shortcuts.js titleWithShortcut 'file.save'); aria-disabled while
// a press would do nothing (saving / loading). The spinner is role="status" with its text (spinner.js).
import { SIDEBAR_ICONS } from './app-sidebar.js';
import { createSpinner } from './spinner.js';
import { titleWithShortcut, shortcutHint } from './shortcuts.js';
import { SAVE_STATES } from './save-state.js';
import { mountTooltip } from './hint.js';
import { CHROME_HINTS } from './design-hints.js';

let stylesInjected = false;
function injectStyles(doc) {
  if (stylesInjected || !doc || !doc.head) return;
  if (doc.getElementById('sk-save-styles')) { stylesInjected = true; return; }
  const s = doc.createElement('style'); s.id = 'sk-save-styles';
  s.textContent = `
.sk-save { position: relative; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: 0; box-sizing: border-box;
  width: 30px; height: 30px; padding: 0; border: 1px solid var(--sk-header-sep, rgba(127,127,127,0.35)); border-radius: 6px;
  background: transparent; color: inherit; cursor: pointer; white-space: nowrap; font: 600 13px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.sk-save-label { display: none; }
.sk-save:hover { background: var(--sk-header-hover, rgba(127,127,127,0.12)); }
.sk-save:focus-visible { outline: 2px solid var(--sk-selection, #3B82F6); outline-offset: 1px; }
.sk-save-ic { position: relative; flex: 0 0 auto; width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center; --sk-spinner-size: 14px; }
.sk-save-ic svg { width: 16px; height: 16px; display: block; }
.sk-save-badge { position: absolute; top: -3px; right: -4px; width: 7px; height: 7px; border-radius: 50%; background: var(--sk-selection, #3B82F6); display: none; }
.sk-save[data-state="saved"] .sk-save-ic, .sk-save[data-state="saved"] .sk-save-label { opacity: 0.55; }
.sk-save[data-state="unsaved"] { border-color: var(--sk-selection, #3B82F6); }
.sk-save[data-state="unsaved"] .sk-save-ic { color: var(--sk-selection, #3B82F6); }
.sk-save[data-state="unsaved"] .sk-save-badge { display: block; }
.sk-save[data-state="saving"], .sk-save[data-state="loading"] { cursor: progress; }
.sk-save[data-state="loading"] .sk-save-label { opacity: 0.55; }
.sk-save[data-state="failed"] { background: #dc2626; border-color: #dc2626; color: #fff; }
.sk-save[data-state="signin"] { background: #b45309; border-color: #b45309; color: #fff; }
/* in the footer's end (footer-slot.js): the footer's button size (app-footer.js), no frame unless a state asks for one */
.sk-footer-end > .sk-save:not([data-state="unsaved"]):not([data-state="failed"]):not([data-state="signin"]) { border-color: transparent; }
`;
  doc.head.appendChild(s);
  stylesInjected = true;
}

/** createSaveButton({ getState, onPress, doc }) -> { el, refresh, placeIn(slot), destroy }. getState() -> { state, text } (save-state.js); onPress() runs THE Save command. */
export function createSaveButton({ getState, onPress, doc = globalThis.document }) {
  injectStyles(doc);
  const el = doc.createElement('button');
  el.type = 'button'; el.className = 'sk-save';
  const ic = doc.createElement('span'); ic.className = 'sk-save-ic';
  const label = doc.createElement('span'); label.className = 'sk-save-label'; label.textContent = 'Save'; label.setAttribute('aria-hidden', 'true');
  el.append(ic, label);
  let shown = '';
  let current = { state: SAVE_STATES.NEW, text: '' };
  const busy = (st) => st === SAVE_STATES.SAVING || st === SAVE_STATES.LOADING;

  function render(st) {
    current = st;
    el.dataset.state = st.state;
    el.setAttribute('aria-label', `Save, ${st.text}`);
    el.title = `${titleWithShortcut('Save', 'file.save')} · ${st.text}${st.state === SAVE_STATES.FAILED ? '. Press to try again.' : ''}`;
    if (busy(st.state)) el.setAttribute('aria-disabled', 'true'); else el.removeAttribute('aria-disabled');
    ic.textContent = '';
    if (busy(st.state)) ic.appendChild(createSpinner({ label: st.text, doc }));
    else {
      ic.innerHTML = SIDEBAR_ICONS.save;
      const badge = doc.createElement('span'); badge.className = 'sk-save-badge'; badge.setAttribute('aria-hidden', 'true');
      ic.appendChild(badge);
    }
  }
  /** Redraw when the state (or the shortcut, which the user can change) changed. */
  function refresh() {
    const st = getState();
    const sig = [st.state, st.text, titleWithShortcut('Save', 'file.save')].join('|');
    if (sig !== shown) { shown = sig; render(st); }
  }
  el.addEventListener('click', () => {
    if (busy(current.state)) return; // saving / loading: a press does nothing (no double save)
    onPress();
  });

  // the footer's right end (footer-slot.js): ONE place in every layout; the account avatar goes in after it
  const placeIn = (slot) => { slot.appendChild(el); };

  const tip = mountTooltip({
    target: el,
    getContent: () => ({
      title: `Save — ${current.text}`,
      key: shortcutHint('file.save'),
      text: `${CHROME_HINTS.save}${current.state === SAVE_STATES.FAILED ? ' Press to retry saving.' : ''}`,
    }),
  });

  refresh();
  return { el, refresh, placeIn, destroy() { tip.destroy(); el.remove(); } };
}

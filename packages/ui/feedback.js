// packages/ui/feedback.js — TASK 830 (owner turns 2922-2925: "a rate the app and feedback modal"): THE "Rate & feedback" of every app, one module.
//   openFeedback({ stars })   THE window (the shared small modal, #ui/template-picker.js openSmallModal): 1-5 stars (arrow keys + touch, 44 px), an optional text
//                             ("What works, what doesn't?", at most TEXT_MAX characters), an OPTIONAL email ("only if you'd like a reply"), Send / Cancel. Sent
//                             through #ui/analytics.js postFeedback (the one module that talks to the Worker; it adds the app, build and host, nothing else).
//                             A failure is one plain line and the typed text stays (also after a Cancel / press outside: the draft is kept until sent).
//                             The About page (task 828) opens the same window through this function. Resolves { sent: true } or null.
//   feedbackMenuItem          the "Rate & feedback" entry every app's menu has (#ui/sidebar-projects.js puts it in the item list, always available).
//   startFeedback({ appId })  the ONE automatic ask, called once by #ui/app-chrome.js: it hears each export (feedback-rules.js EXPORT_FEATURES) and, after the
//                             2nd successful one, shows a small NON-BLOCKING card ("Enjoying <App>? ★★★★★ · Not now · Never") in the app's export area: the element
//                             marked data-feedback-slot (each app's page puts one at the end of its export area). A star opens the window with that rating.
//                             The rule is feedback-rules.js nextAskState; its state is one localStorage key per app. It asks ONLY where the analytics sends
//                             (analytics.js willSend: a public page, not opted out: so never on a developer's machine, in a test, or after ?analytics=off), and
//                             where this browser's storage works: when it does not, the app does not ask (the state could not be kept, so it would nag).
import { dbg } from '#core/debug.js';
import { appById } from './app-registry.js';
import { openSmallModal } from './template-picker.js';
import { onFeature, analyticsWillSend, postFeedback } from './analytics.js';
import { TEXT_MAX, STARS, EXPORT_FEATURES, STORAGE_PREFIX, freshAskState, parseAskState, askDue, nextAskState } from './feedback-rules.js';

export const FEEDBACK_LABEL = 'Rate & feedback';
const STAR_PATH = 'M12 2.8l2.85 5.9 6.45.9-4.7 4.5 1.15 6.4L12 17.4l-5.75 3.1 1.15-6.4-4.7-4.5 6.45-.9z';
const starSvg = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path class="sk-fb-star-path" d="${STAR_PATH}"/></svg>`;
/** The menu entry. `onClick` is the sidebar's (the drawer closes by itself). */
export const feedbackMenuItem = ({ icon, onClick }) => ({ id: 'feedback', label: FEEDBACK_LABEL, icon, tooltip: 'Tell us what you think of this app', onClick });
export const FEEDBACK_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected || typeof document === 'undefined' || !document.head) return;
  if (document.getElementById('sk-fb-styles')) { stylesInjected = true; return; }
  const s = document.createElement('style'); s.id = 'sk-fb-styles';
  s.textContent = `
.sk-fb-stars { display: flex; gap: 4px; }
.sk-fb-star { width: 44px; height: 44px; padding: 0; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: inherit; background: transparent;
  border: 0; border-radius: 8px; opacity: 0.55; touch-action: manipulation; }
.sk-fb-star:hover { opacity: 0.9; }
.sk-fb-star[data-on="1"] { opacity: 1; color: var(--sk-feedback-star, #f2b01e); }
.sk-fb-star[data-on="1"] .sk-fb-star-path { fill: currentColor; }
.sk-fb-star:focus-visible, .sk-fb-card button:focus-visible { outline: 2px solid var(--sk-sidebar-accent, var(--sk-selection, #2c65ff)); outline-offset: 1px; }
.sk-fb .sk-fb-form { display: flex; flex-direction: column; gap: 10px; }
.sk-fb .sk-fb-field { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
.sk-fb .sk-fb-field .sk-tp-input { width: 100%; box-sizing: border-box; }
.sk-fb .sk-fb-text { min-height: 110px; resize: vertical; }
.sk-fb .sk-fb-count { align-self: flex-end; font-size: 11.5px; opacity: 0.65; }
.sk-fb .sk-fb-note { margin: 0; font-size: 12.5px; opacity: 0.75; line-height: 1.35; }
.sk-fb .sk-fb-thanks { margin: 0; font-size: 15px; line-height: 1.4; }
/* the auto-ask card: inside the app's export area (its data-feedback-slot), never over the work */
.sk-fb-card { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; box-sizing: border-box; max-width: 100%; margin: 10px 0; padding: 6px 10px; border-radius: 8px;
  font: 13px/1.3 system-ui, sans-serif; color: inherit; background: rgba(127,127,127,0.10); border: 1px solid rgba(127,127,127,0.35); }
.sk-fb-card .sk-fb-ask { font-weight: 600; }
.sk-fb-card .sk-fb-stars { gap: 0; }
.sk-fb-card .sk-fb-star { width: 32px; height: 32px; }
.sk-fb-card .sk-fb-link { min-height: 32px; padding: 0 8px; font: inherit; color: inherit; background: transparent; border: 0; border-radius: 6px; cursor: pointer; text-decoration: underline; opacity: 0.8; }
.sk-fb-card .sk-fb-link:hover { opacity: 1; }
@media (pointer: coarse), (max-width: 640px) { .sk-fb-card .sk-fb-star { width: 44px; height: 44px; } .sk-fb-card .sk-fb-link { min-height: 44px; padding: 0 12px; } }
`;
  document.head.appendChild(s); stylesInjected = true;
}
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

/** A row of 1-5 star buttons (a radio group: arrows / Home / End move and pick; a press on the picked star clears it). `onChange(stars | null)`. */
function starRow({ value = null, size = 28, label = 'Rating', onChange }) {
  const row = el('div', 'sk-fb-stars'); row.setAttribute('role', 'radiogroup'); row.setAttribute('aria-label', label);
  let cur = value;
  const btns = STARS.map((n) => {
    const b = el('button', 'sk-fb-star'); b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.star = String(n); b.setAttribute('aria-label', n + (n === 1 ? ' star' : ' stars'));
    b.innerHTML = starSvg(size);
    b.addEventListener('click', () => set(cur === n ? null : n, true));
    b.addEventListener('keydown', (e) => {
      const k = e.key; let to = null;
      if (k === 'ArrowRight' || k === 'ArrowUp') to = Math.min(5, (cur || 0) + 1);
      else if (k === 'ArrowLeft' || k === 'ArrowDown') to = Math.max(1, (cur || 2) - 1);
      else if (k === 'Home') to = 1; else if (k === 'End') to = 5;
      if (to == null) return;
      e.preventDefault(); set(to, true); btns[to - 1].focus();
    });
    row.appendChild(b); return b;
  });
  function set(v, notify) {
    cur = v;
    btns.forEach((b, i) => { b.dataset.on = cur != null && i < cur ? '1' : '0'; b.setAttribute('aria-checked', String(cur === i + 1)); b.tabIndex = (cur == null ? i === 0 : cur === i + 1) ? 0 : -1; });
    if (notify && onChange) onChange(cur);
  }
  set(cur, false);
  return { el: row, set: (v) => set(v, false), focusEl: () => btns[cur == null ? 0 : cur - 1] };
}

// the draft survives a Cancel / a press outside / an error, until it is sent (then it is cleared)
let draft = { stars: null, text: '', email: '' };
let opened = false;

/** THE window. `stars` prefills the rating (the card's star). Resolves { sent: true } once sent, null when closed without sending. */
export function openFeedback({ stars = null } = {}) {
  if (opened) return Promise.resolve(null);
  opened = true;
  injectStyles();
  if (stars != null && STARS.includes(stars)) draft.stars = stars;
  return openSmallModal(FEEDBACK_LABEL, (body, mk, finish) => {
    const dlg = body.closest('[role="dialog"]'); dlg.dataset.feedback = '1'; dlg.classList.add('sk-fb');
    const form = el('div', 'sk-fb-form');
    const rate = starRow({ value: draft.stars, size: 28, label: 'Your rating', onChange: (v) => { draft.stars = v; } });
    const textLabel = el('label', 'sk-fb-field'); textLabel.append(el('span', '', "What works, what doesn't?"));
    const text = el('textarea', 'sk-tp-input sk-fb-text'); text.maxLength = TEXT_MAX; text.value = draft.text; text.dataset.fb = 'text';
    const count = el('span', 'sk-fb-count'); count.setAttribute('aria-hidden', 'true');
    const showCount = () => { count.textContent = text.value.length + ' / ' + TEXT_MAX; };
    text.addEventListener('input', () => { draft.text = text.value; showCount(); }); showCount();
    textLabel.append(text, count);
    const mailLabel = el('label', 'sk-fb-field'); mailLabel.append(el('span', '', "Email (only if you'd like a reply)"));
    const email = el('input', 'sk-tp-input'); email.type = 'email'; email.autocomplete = 'email'; email.value = draft.email; email.dataset.fb = 'email'; email.maxLength = 254;
    email.addEventListener('input', () => { draft.email = email.value.trim(); email.removeAttribute('aria-invalid'); });
    mailLabel.append(email);
    const note = el('p', 'sk-fb-note', 'Sent with the app name, version and where it runs, nothing else: no design, no file names.');
    const err = el('div', 'sk-tp-err'); err.setAttribute('role', 'status');
    form.append(rate.el, textLabel, mailLabel, note, err);
    body.insertBefore(form, body.firstChild);

    let busy = false, sent = false;
    const send = mk('sk-tp-open', 'Send', 'send', async () => {
      if (busy) return;
      busy = true; send.disabled = true; err.textContent = '';
      const r = await postFeedback({ stars: draft.stars, text: draft.text, email: draft.email });
      busy = false; send.disabled = false;
      if (!r.ok) { err.textContent = r.message; if (/email/i.test(r.message)) email.setAttribute('aria-invalid', 'true'); return; }
      draft = { stars: null, text: '', email: '' };
      sent = true;
      recordAsk('sent');
      form.remove(); send.remove();
      const thanks = el('p', 'sk-fb-thanks', 'Thank you. Your message was sent.'); thanks.setAttribute('role', 'status'); body.insertBefore(thanks, body.firstChild);
      cancel.textContent = 'Close'; cancel.focus();
    });
    const cancel = mk('sk-tp-cancel', 'Cancel', '__cancel', () => finish(sent ? { sent: true } : null));
    return rate.focusEl();
  }, { panelClass: 'sk-fb' }).then((r) => { opened = false; return r; });
}

// ── the auto-ask ──────────────────────────────────────────────────────────────────────────────────
let askApp = null;
let storageWarned = false;
const storageKey = () => STORAGE_PREFIX + askApp;
/** The ask state, or null when this browser's storage cannot be used (then the app does not ask: the state could not be kept, it would nag). */
function readAsk() {
  let t;
  try { t = localStorage.getItem(storageKey()); } catch (e) { return unavailable('read', e); }
  if (t == null) return freshAskState();
  const s = parseAskState(t);
  if (!s) dbg.warn('feedback', 'the stored ask state is not one this app wrote: not asking');
  return s;
}
function writeAsk(s) {
  try { localStorage.setItem(storageKey(), JSON.stringify(s)); return true; } catch (e) { unavailable('write', e); return false; }
}
function unavailable(what, e) {
  if (!storageWarned) { storageWarned = true; dbg.warn('feedback', `localStorage ${what} failed: the app does not ask for feedback on its own here`, e && e.message); }
  return null;
}
const removeCards = () => { for (const c of document.querySelectorAll('.sk-fb-card')) c.remove(); };
/** Apply an ask action ('not-now' | 'never' | 'sent') to the stored state; the card goes away. */
function recordAsk(action) {
  if (!askApp) return;
  const s = readAsk();
  if (s) writeAsk(nextAskState(s, action));
  removeCards();
}

function showCard() {
  const slot = document.querySelector('[data-feedback-slot]');
  if (!slot || slot.querySelector('.sk-fb-card')) return;
  injectStyles();
  const app = appById(askApp);
  const card = el('div', 'sk-fb-card'); card.setAttribute('role', 'group'); card.setAttribute('aria-label', FEEDBACK_LABEL);
  card.append(el('span', 'sk-fb-ask', `Enjoying ${app ? app.name : 'the app'}?`));
  const row = starRow({ size: 22, label: 'Rate this app', onChange: (n) => { row.set(null); openFeedback({ stars: n }); } });
  const notNow = el('button', 'sk-fb-link', 'Not now'); notNow.type = 'button'; notNow.dataset.fbAsk = 'not-now'; notNow.addEventListener('click', () => recordAsk('not-now'));
  const never = el('button', 'sk-fb-link', 'Never'); never.type = 'button'; never.dataset.fbAsk = 'never'; never.addEventListener('click', () => recordAsk('never'));
  card.append(row.el, notNow, never);
  slot.appendChild(card);
}

function onExport() {
  if (!analyticsWillSend()) return; // THE analytics rule: never in tests, locally or after an opt-out (and nothing is stored there)
  const s = readAsk();
  if (!s) return;
  const n = nextAskState(s, 'export');
  if (!writeAsk(n)) return;
  if (askDue(n)) showCard();
}

/** Called once by #ui/app-chrome.js: from now on, each export (feedback-rules.js EXPORT_FEATURES) counts toward the one automatic ask. */
export function startFeedback({ appId }) {
  if (askApp) return false;
  askApp = appId;
  onFeature((name) => { if (EXPORT_FEATURES.includes(name)) onExport(); });
  return true;
}

// packages/ui/feedback-rules.js — TASK 830: THE declared rules of "Rate & feedback", ONE copy shared by the client (#ui/feedback.js, #ui/analytics.js) and the
// Worker (analytics/src/index.js, which refuses anything else). No DOM, no storage, no network: plain data and pure functions.
//
// A feedback message is { stars, text, email, app, version, host }:
//   stars    1..5, or null (a message with text only)
//   text     what the person wrote, at most TEXT_MAX characters ('' when only stars were given)
//   email    OPTIONAL, only when the person typed one ("only if you'd like a reply"); '' otherwise; at most EMAIL_MAX, one address, format-checked
//   app      an app id of #ui/app-registry.js · version: the build stamp (analytics-events.js BUILD_STAMP) · host: one of HOSTS (web | fusion)
// Nothing else is sent: no design content, no file name, no IP (the Worker never stores or logs one), no anonymous id.
//
// THE AUTO-ASK (one small card per app, never a modal): EXPORT_FEATURES is the declared list of export events (the analytics FEATURES named export:*);
// nextAskState() is the whole rule, a pure function of the per-app state kept in localStorage (feedback.js):
//   - the Nth successful export (EXPORTS_BEFORE_ASK = 2) makes the card due;
//   - "Not now" puts the next ask EXPORTS_AFTER_NOT_NOW (10) exports later, ONCE: a second "Not now" ends the asking for good;
//   - "Never", and a message sent (or a star given and sent), end it for good.
import { FEATURES, HOSTS, BUILD_STAMP } from './analytics-events.js';
import { APPS } from './app-registry.js';

export const TEXT_MAX = 2000;
export const EMAIL_MAX = 254;
export const STARS = Object.freeze([1, 2, 3, 4, 5]);
// one address: no spaces, one @, a dot in the domain part (a deliberate, simple check: the person is trusted to type their own address)
export const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export const EXPORT_FEATURES = Object.freeze(FEATURES.filter((f) => f.startsWith('export:')));
export const EXPORTS_BEFORE_ASK = 2;
export const EXPORTS_AFTER_NOT_NOW = 10;
export const STORAGE_PREFIX = 'sketch-feedback-ask-'; // + the app id: one key per app (each app is its own site; this keeps the state per app anyway)

/** The ask state of a browser that has not been asked: { exports: successful exports counted, nextAt: the count at which the card is due, notNow, done }. */
export const freshAskState = () => ({ exports: 0, nextAt: EXPORTS_BEFORE_ASK, notNow: 0, done: false });

/** The ask state read back from storage text; null when it is not one this code wrote (the caller then does not ask). */
export function parseAskState(text) {
  let s;
  try { s = JSON.parse(text); } catch { return null; } // not JSON: not ours
  const n = (v) => Number.isInteger(v) && v >= 0 && v < 1e9;
  if (!s || typeof s !== 'object' || !n(s.exports) || !n(s.nextAt) || !(s.notNow === 0 || s.notNow === 1) || typeof s.done !== 'boolean') return null;
  return { exports: s.exports, nextAt: s.nextAt, notNow: s.notNow, done: s.done };
}

/** True when the card is due: not finished and the export count reached the next ask. */
export const askDue = (s) => !s.done && s.exports >= s.nextAt;

/** THE rule. `action`: 'export' (one successful export), 'not-now', 'never', 'sent'. Returns the new state (the argument is not changed). */
export function nextAskState(s, action) {
  const n = { ...s };
  if (action === 'export') n.exports += 1;
  else if (action === 'not-now') {
    if (n.notNow >= 1) n.done = true; // the one more ask was used
    else { n.notNow = 1; n.nextAt = n.exports + EXPORTS_AFTER_NOT_NOW; }
  } else if (action === 'never' || action === 'sent') n.done = true;
  else throw new Error('feedback ask: unknown action ' + action);
  return n;
}

/** The message of a form, or { error } (a plain sentence for the person) when it cannot be sent. `f`: { stars, text, email, app, version, host }. */
export function validateFeedback(f) {
  if (!f || typeof f !== 'object' || Array.isArray(f)) return { error: 'not an object' };
  const stars = f.stars == null ? null : f.stars;
  if (stars !== null && !STARS.includes(stars)) return { error: 'Pick 1 to 5 stars, or none.' };
  const text = f.text == null ? '' : f.text;
  if (typeof text !== 'string') return { error: 'The text is not text.' };
  if (text.length > TEXT_MAX) return { error: `Please keep it under ${TEXT_MAX} characters (it is ${text.length}).` };
  const email = f.email == null ? '' : f.email;
  if (typeof email !== 'string') return { error: 'The email is not text.' };
  if (email !== '' && (email.length > EMAIL_MAX || !EMAIL_RE.test(email))) return { error: 'That email address does not look right. Leave it empty if you do not want a reply.' };
  if (stars === null && text.trim() === '') return { error: 'Pick a star rating or write a few words first.' };
  if (!APPS.some((a) => a.id === f.app)) return { error: 'app' };
  if (typeof f.version !== 'string' || !BUILD_STAMP.test(f.version)) return { error: 'version' };
  if (!HOSTS.includes(f.host)) return { error: 'host' };
  return { stars, text, email, app: f.app, version: f.version, host: f.host };
}

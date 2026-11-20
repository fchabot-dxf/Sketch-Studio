// packages/ui/analytics.js — TASK 738: anonymous, cookieless usage analytics for the four apps. ONE module: every app's visit and every declared
// feature go through it; no app has its own copy of the send code.
//
// What is sent, and nothing else: { event, name, id, app, version, host, dev } (analytics-events.js declares each field, the Worker refuses anything
// else). The Worker (analytics/) adds the COUNTRY (+ region / city) from Cloudflare's edge; the IP address is never stored. No cookie: the anonymous id
// is a random number kept in this browser's localStorage.
//
// WHEN it sends: ONE rule, in willSend(): ENDPOINT is set, the page is a PUBLIC page (http / https on a host name that is not LOCAL_HOST), and the person
// has not opted out. So a developer's machine, every test and the gate's headless browsers (all served from 127.0.0.1 / localhost) never send, with the
// same code the sites run: there is no test switch.
//   visit    once per page load, when the app mounts its shared chrome (#ui/app-chrome.js calls startAnalytics: an ACTION the app takes, never on import)
//   feature  track(name) from the action points, `name` one of analytics-events.js FEATURES (an undeclared name is not sent)
// Opt out: open the app once with ?analytics=off (?analytics=on undoes it); a browser's Do Not Track or Global Privacy Control is honoured.
// The owner's own devices: ?dev=1 once tags this browser's events dev=1 (the dashboard leaves them out by default); ?dev=0 removes the tag.
// Both are kept in the site's localStorage: each app is its own site, so once per app and browser.
//
// TASK 830: this module is ALSO the one place that talks to the Worker for "Rate & feedback" (feedback.js has the window and the ask card, this has the
// network): postFeedback() sends one message { stars, text, email, app, version, host } (feedback-rules.js) to the Worker's /feedback, and ONLY because the
// person pressed Send. It works from any public page, opted out of the analytics or not (it is a message the person chose to send, not a count), and from no
// local page (a developer's machine never writes to the real Worker). The anonymous id is NOT part of it. onFeature(fn) lets feedback.js hear each declared
// feature (the exports) as it is tracked, so the one auto-ask counts the same export events the analytics counts.

import { dbg } from '#core/debug.js';
import { APPS } from './app-registry.js';
import { HOSTS, ANON_ID, LOCAL_HOST, isFeatureName } from './analytics-events.js';
import { validateFeedback } from './feedback-rules.js';

// The Worker's event URL (deployed 2026-11-16, analytics/README.md). '' = nothing is ever sent.
export const ENDPOINT = 'https://sketch-analytics.dansemur.workers.dev/e';
// The site's build stamp, sent as `version`: 'source' here; scripts/build-site.cjs writes the build time into the copy of this line in the site it builds.
export const BUILD = 'source';

// this module's localStorage keys
export const STORAGE = Object.freeze({ id: 'sketch-analytics-id', dev: 'sketch-analytics-dev', off: 'sketch-analytics-off' });

const APP_IDS = APPS.map((a) => a.id);

/** True for a page a visitor could have opened from the internet: http(s) on a host name that is not local. */
export function isPublicPage(loc) {
  return !!loc && (loc.protocol === 'https:' || loc.protocol === 'http:') && !LOCAL_HOST.test(loc.hostname);
}

/**
 * The analytics of one page. `env` is the page's global object (location, localStorage, navigator, crypto, fetch): the module's own instance below uses
 * globalThis; a node test passes a stand-in with the same members, and runs the same code.
 */
export function createAnalytics({ endpoint = ENDPOINT, build = BUILD, env = globalThis } = {}) {
  let session = null; // { app, host } once the app started: before that nothing is sent
  const listeners = new Set(); // TASK 830: onFeature

  function read(key) {
    try { return env.localStorage.getItem(key); } catch (e) { dbg.warn('analytics', `localStorage read of ${key} failed`, e && e.message); return null; }
  }
  function write(key, value) {
    try { if (value == null) env.localStorage.removeItem(key); else env.localStorage.setItem(key, value); } catch (e) { dbg.warn('analytics', `localStorage write of ${key} failed`, e && e.message); }
  }
  function anonId() {
    let id = read(STORAGE.id);
    if (!id || !ANON_ID.test(id)) {
      const bytes = new Uint8Array(16);
      env.crypto.getRandomValues(bytes); // (randomUUID needs a secure context; this works on every page)
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      write(STORAGE.id, id);
    }
    return id;
  }
  const optedOut = () => env.navigator.doNotTrack === '1' || env.navigator.globalPrivacyControl === true || read(STORAGE.off) === '1';
  // ?dev=1 / ?dev=0 and ?analytics=off / ?analytics=on: remembered on this device
  function applyUrlFlags() {
    const q = new URLSearchParams(env.location.search);
    if (q.get('dev') === '1') write(STORAGE.dev, '1');
    else if (q.get('dev') === '0') write(STORAGE.dev, null);
    if (q.get('analytics') === 'off') write(STORAGE.off, '1');
    else if (q.get('analytics') === 'on') write(STORAGE.off, null);
  }

  /** THE rule (see the top of the file). */
  const willSend = () => !!endpoint && isPublicPage(env.location) && !optedOut();

  /** The one payload shape; nothing else is ever put in it. */
  const payload = (event, name) => ({ event, name, id: anonId(), app: session.app, version: build, host: session.host, dev: read(STORAGE.dev) === '1' ? 1 : 0 });

  function send(event, name) {
    if (!willSend()) return false;
    // text/plain: a CORS "simple request" (no preflight); keepalive: it still goes when the page is closing
    env.fetch(endpoint, { method: 'POST', body: JSON.stringify(payload(event, name)), keepalive: true, headers: { 'content-type': 'text/plain' } })
      .catch((e) => dbg.warn('analytics', `${event} ${name} not sent`, e && e.message));
    return true;
  }

  /** The app's visit, once per page load. `app`: its registry id; `host`: where it runs ('web', or 'fusion' in Shaper's Fusion 360 palette). */
  function start({ app, host = 'web' }) {
    if (session) return false;
    if (!APP_IDS.includes(app) || !HOSTS.includes(host)) { dbg.warn('analytics', `start: unknown app ${app} or host ${host}, nothing sent`); return false; }
    session = { app, host };
    if (isPublicPage(env.location)) applyUrlFlags(); // a local page never sends: it keeps no flag either
    return send('visit', '');
  }

  /** A declared feature was used. Before the app started, or for an undeclared name, nothing is sent. */
  function track(name) {
    if (!session) return false;
    if (!isFeatureName(name)) { dbg.warn('analytics', `track: "${name}" is not a declared feature (analytics-events.js FEATURES), not sent`); return false; }
    for (const fn of listeners) fn(name);
    return send('feature', name);
  }

  /** TASK 830: `fn(name)` is called for every declared feature tracked (whether or not it is sent). Returns the unsubscribe. */
  function onFeature(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  // TASK 830: the Worker's /feedback is next to its /e
  const feedbackUrl = endpoint.replace(/\/e$/, '/feedback');
  /** A message can be sent from a public page with an ENDPOINT (see the top of the file). */
  const canSendFeedback = () => !!endpoint && isPublicPage(env.location);
  /**
   * Send one feedback message: { stars, text, email } of the form; the app, version and host are added here. Resolves { ok: true } or { ok: false, message }
   * (a plain sentence for the person; the form keeps what they typed). Nothing is sent when the message is not valid (validateFeedback) or this page may not send.
   */
  async function postFeedback({ stars = null, text = '', email = '' } = {}) {
    if (!session) return { ok: false, message: 'The app has not started yet.' };
    const msg = validateFeedback({ stars, text, email, app: session.app, version: build, host: session.host });
    if (msg.error) return { ok: false, message: msg.error };
    if (!canSendFeedback()) return { ok: false, message: 'Feedback can only be sent from the published app, not from this copy.' };
    let r;
    try {
      r = await env.fetch(feedbackUrl, { method: 'POST', body: JSON.stringify(msg), headers: { 'content-type': 'text/plain' } });
    } catch (e) {
      dbg.warn('analytics', 'feedback not sent', e && e.message);
      return { ok: false, message: 'Could not send it (are you offline?). Your message is still here: try again.' };
    }
    if (r.status === 429) return { ok: false, message: 'Too many messages just now. Please try again in a minute.' };
    if (!r.ok) return { ok: false, message: 'The message was not accepted (error ' + r.status + '). Your message is still here: try again later.' };
    return { ok: true };
  }

  return { start, track, willSend, onFeature, postFeedback, canSendFeedback };
}

const pageAnalytics = createAnalytics();
/** Called once by #ui/app-chrome.js when an app mounts its chrome: the visit. */
export const startAnalytics = (opts) => pageAnalytics.start(opts);
/** A declared feature (analytics-events.js FEATURES) was used. */
export const track = (name) => pageAnalytics.track(name);
/** TASK 830 (feedback.js): `fn(name)` for every declared feature tracked; the page's analytics rule (willSend: a public page, not opted out); a feedback message. */
export const onFeature = (fn) => pageAnalytics.onFeature(fn);
export const analyticsWillSend = () => pageAnalytics.willSend();
export const postFeedback = (form) => pageAnalytics.postFeedback(form);
export const canSendFeedback = () => pageAnalytics.canSendFeedback();

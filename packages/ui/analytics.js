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

import { dbg } from '#core/debug.js';
import { APPS } from './app-registry.js';
import { HOSTS, ANON_ID, LOCAL_HOST, isFeatureName } from './analytics-events.js';

// The Worker's event URL: 'https://sketch-analytics.<subdomain>.workers.dev/e' once it is deployed (analytics/README.md). '' = nothing is ever sent.
export const ENDPOINT = '';
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
    return send('feature', name);
  }

  return { start, track, willSend };
}

const pageAnalytics = createAnalytics();
/** Called once by #ui/app-chrome.js when an app mounts its chrome: the visit. */
export const startAnalytics = (opts) => pageAnalytics.start(opts);
/** A declared feature (analytics-events.js FEATURES) was used. */
export const track = (name) => pageAnalytics.track(name);

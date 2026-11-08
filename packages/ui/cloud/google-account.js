// packages/ui/cloud/google-account.js — the signed-in Google ACCOUNT of this browser (TASK 480). The ONE sign-in door: the sidebar
// (473/479) reads `state()` / `userInfo()` and calls `signIn()` / `signOut()`; nothing else signs in.
//
// RENEWABLE: where the Pages Functions exist (https, secrets set) the refresh token lives server-side in a sealed httpOnly cookie
// (server/googleAuth.js), so a fresh access token is one same-origin POST: no popup, no gesture, across days. Where they do not
// (localhost:8000, a deploy without secrets: the routes answer 404) the client falls back to the Google Identity Services token
// popup, re-minted inside the next user gesture (a popup outside a gesture is blocked). Ported from DDCS Studio's
// googleDrive.js / googleSession.js, with every browser dependency injectable so tests run it with Google faked.
//
// OWNER RULINGS honoured here:
//  - signing in signs in the ACCOUNT only. It never moves, copies or syncs a project (that is the router adapter's explicit,
//    per-project choice); this module does not even know the project store exists.
//  - the avatar comes from Drive's own about.get (photoLink): no userinfo scope. A missing photo falls back to initials.
import { GOOGLE } from '#ui/cloud/providers.js';
import { createAuthStore, REFRESH_LEAD_MS, initialsOf } from '#ui/cloud/auth-state.js';

const HDR = { 'X-SK-Auth': '1' };         // the custom header the server requires (a foreign page cannot send it unpreflighted)
const MESSAGE_TYPE = 'sk-google-session';
const ABOUT = 'https://www.googleapis.com/drive/v3/about?fields=user';

const transient = (msg) => { const e = new Error(msg); e.transient = true; return e; };

/** The real Google Identity Services token client (the GIS fallback). Injectable: tests pass a fake with the same two methods. */
export function browserGis(config = GOOGLE) {
  const loadGis = () => {
    const w = globalThis.window;
    if (w && w.google && w.google.accounts && w.google.accounts.oauth2) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
      s.onload = res; s.onerror = () => rej(new Error('Google Identity Services failed to load'));
      document.head.appendChild(s);
    });
  };
  return {
    load: loadGis,
    /** Resolves { access_token, expires_in }. prompt: 'consent' (sign-in) | '' (silent re-mint when already consented). */
    requestToken({ prompt }) {
      return new Promise((resolve, reject) => {
        const client = globalThis.window.google.accounts.oauth2.initTokenClient({
          client_id: config.clientId, scope: config.scope,
          callback: (r) => (r && r.access_token ? resolve({ access_token: r.access_token, expires_in: r.expires_in }) : reject(new Error((r && r.error) || 'no token'))),
          error_callback: (e) => reject(new Error((e && e.type) || 'sign-in cancelled')),
        });
        client.requestAccessToken({ prompt });
      });
    },
    revoke(token) { try { globalThis.window.google.accounts.oauth2.revoke(token, () => {}); } catch (_) { /* best effort */ } },
  };
}

export function createGoogleAccount({
  fetchImpl = (...a) => globalThis.fetch(...a),
  authStore = createAuthStore(),
  config = GOOGLE,
  gis = browserGis(config),
  openPopup = (url, name, features) => globalThis.window.open(url, name, features),
  win = globalThis.window,
  origin = (globalThis.location && globalThis.location.origin) || '',
  eligibleForServer = () => { try { return globalThis.location.protocol === 'https:'; } catch (_) { return false; } },
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (t) => clearTimeout(t),
} = {}) {
  const BASE = config.serverBase;
  const listeners = new Set();
  const notify = () => { for (const fn of [...listeners]) { try { fn(); } catch (_) { /* a listener must not break the account */ } } };
  let avail = null, probing = null, inflight = null, timer = 0, armed = false, info = null;

  // ---- the server session client ----
  async function fetchServerToken() {
    let r;
    try { r = await fetchImpl(BASE + 'token', { method: 'POST', headers: HDR, credentials: 'same-origin' }); }
    catch (_) { throw transient('network'); }
    if (r.status === 404) { avail = false; throw new Error('absent'); }
    avail = true;
    if (r.ok) { const t = await r.json(); if (t && t.access_token) return { access_token: t.access_token, expires_in: t.expires_in }; throw transient('empty'); }
    if (r.status === 401) throw new Error('lapsed');
    throw transient('server ' + r.status);
  }
  /** Probe ONCE per load: are the endpoints deployed, and is there already a session cookie (a cleared localStorage adopts it)? */
  function probe() {
    if (probing) return probing;
    if (!eligibleForServer()) { avail = false; return (probing = Promise.resolve({ available: false })); }
    probing = fetchServerToken().then(
      (t) => { authStore.save(t.access_token, t.expires_in, now()); authStore.markServerSession(true); notify(); return { available: true, signedIn: true }; },
      (e) => ({ available: avail === true, signedIn: false, transient: !!e.transient }),
    );
    return probing;
  }
  const serverAvailable = () => avail === true;

  // ---- minting ----
  async function mintFresh() {
    if (authStore.usesServerSession()) {
      try { const t = await fetchServerToken(); authStore.save(t.access_token, t.expires_in, now()); return; }
      catch (e) { if (e.message !== 'absent') throw e; authStore.markServerSession(false); } // endpoints gone: back to the GIS path below
    }
    await gis.load();
    const t = await gis.requestToken({ prompt: '' }); // '' = a silent grant when the user already consented
    authStore.save(t.access_token, t.expires_in, now());
  }
  const noGestureNeeded = () => authStore.usesServerSession();
  function silentRefresh() {
    if (!inflight) inflight = mintFresh().finally(() => { inflight = null; });
    return inflight;
  }
  const lapse = () => { authStore.markLapsed(); notify(); };
  function refreshNow() {
    return silentRefresh().then(() => { notify(); return true; }, (e) => {
      if (e && e.transient) { clearTimer(timer); timer = setTimer(() => scheduleTokenRefresh(), 60000); return false; } // an outage is never a lapse
      lapse(); return false;
    });
  }

  // ---- the keep-alive (GIS fallback: refresh inside the next gesture) ----
  const CAPTURE = { capture: true };
  const onGesture = () => { disarm(); refreshNow(); };
  function arm() {
    if (armed || !win) return;
    armed = true;
    gis.load().catch(() => { /* offline: the gesture's refresh fails and lapses, which is the truth */ });
    win.addEventListener('pointerdown', onGesture, CAPTURE);
    win.addEventListener('keydown', onGesture, CAPTURE);
  }
  function disarm() {
    if (!armed || !win) return;
    armed = false;
    win.removeEventListener('pointerdown', onGesture, CAPTURE);
    win.removeEventListener('keydown', onGesture, CAPTURE);
  }
  /** Look at the stored token and do the one right thing: nothing, arm the gesture, refresh (server session), or wake up when it falls due. */
  function scheduleTokenRefresh(at = now()) {
    clearTimer(timer);
    const s = authStore.read(at);
    if (!s.signedIn) { disarm(); return; }
    if (s.needsRefresh) { if (noGestureNeeded()) { if (!inflight) refreshNow(); } else arm(); return; }
    disarm();
    if (s.expiresAt != null) timer = setTimer(() => scheduleTokenRefresh(), Math.min(s.expiresAt - REFRESH_LEAD_MS - at + 1000, 0x7fffffff));
  }

  // ---- the public API ----
  const account = {
    state() { return { ...authStore.read(now()), serverSession: authStore.usesServerSession(), serverAvailable: serverAvailable() }; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    probe,
    /** Wire the keep-alive: probe the server session, schedule the next refresh, re-check when a hidden tab wakes. Idempotent. */
    init() {
      if (account._inited) return; account._inited = true;
      probe().then(() => scheduleTokenRefresh());
      if (win && win.document) win.document.addEventListener('visibilitychange', () => { if (!win.document.hidden) scheduleTokenRefresh(); });
      scheduleTokenRefresh();
    },
    /** Sign in. CALL IT SYNCHRONOUSLY FROM THE CLICK: the popup opens before any await. Signs in the ACCOUNT only: no project is touched. */
    signIn() {
      if (serverAvailable()) {
        const popup = openPopup(BASE + 'start', 'sk_google_signin', 'width=520,height=680');
        if (!popup) return Promise.reject(new Error('popup-blocked'));
        return new Promise((resolve, reject) => {
          let done = false, watch = 0;
          const finish = (fn, v) => { if (done) return; done = true; win.removeEventListener('message', onMsg); clearTimer(watch); fn(v); };
          const onMsg = (e) => {
            if (e.origin !== origin || !e.data || e.data.type !== MESSAGE_TYPE) return;
            if (e.data.ok) finish(resolve); else finish(reject, new Error(e.data.reason || 'sign-in failed'));
          };
          win.addEventListener('message', onMsg);
          const poll = () => { try { if (popup.closed) { finish(reject, new Error('sign-in cancelled')); return; } } catch (_) { /* */ } watch = setTimer(poll, 500); };
          watch = setTimer(poll, 500);
        }).then(async () => {
          const t = await fetchServerToken();
          authStore.save(t.access_token, t.expires_in, now()); authStore.markServerSession(true); info = null; scheduleTokenRefresh(); notify();
        });
      }
      return gis.requestToken({ prompt: 'consent' }).then((t) => {
        authStore.save(t.access_token, t.expires_in, now()); authStore.markServerSession(false); info = null; scheduleTokenRefresh(); notify();
      });
    },
    /** Sign out: revoke the server-held refresh token (or the GIS token), drop every stored key. */
    async signOut() {
      const wasServer = authStore.usesServerSession(), token = authStore.token();
      if (wasServer) { try { await fetchImpl(BASE + 'logout', { method: 'POST', headers: HDR, credentials: 'same-origin', keepalive: true }); } catch (_) { /* the keys go regardless */ } }
      else if (token) gis.revoke(token);
      authStore.clear(); info = null; disarm(); clearTimer(timer); notify();
    },
    /** A usable access token, re-minted first when it is due. Throws Error('cloud-auth') (not signed in / lapsed) or Error('cloud-unavailable'). */
    async getAccessToken() {
      let s = authStore.read(now());
      if (!s.signedIn) throw new Error('cloud-auth');
      if (s.needsRefresh) {
        try { await silentRefresh(); notify(); }
        catch (e) {
          if (e && e.transient) throw new Error('cloud-unavailable');
          if (noGestureNeeded()) lapse(); else arm();
          throw new Error('cloud-auth');
        }
      }
      return authStore.token();
    },
    /** fetch() with the bearer token; a 401 re-mints once and retries. Used by the Drive client. */
    async authedFetch(url, opts = {}, retried = false) {
      if (inflight) { try { await inflight; } catch (_) { /* a refused refresh: this call says so below */ } }
      const token = await account.getAccessToken();
      const r = await fetchImpl(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
      if (r.status === 401 && !retried) {
        try { await silentRefresh(); } catch (e) {
          if (e && e.transient) throw new Error('cloud-unavailable');
          if (noGestureNeeded()) lapse(); else arm();
          throw new Error('cloud-auth');
        }
        return account.authedFetch(url, opts, true);
      }
      return r;
    },
    /** The signed-in user for the avatar: { name, email, picture, initials }. photoLink comes from Drive's own about.get (no extra scope);
     *  initials are the fallback for a missing or broken photo. Best-effort: a failure yields initials only, never an error. */
    async userInfo() {
      if (info) return info;
      let u = {};
      try { const r = await account.authedFetch(ABOUT); if (r.ok) u = (await r.json()).user || {}; } catch (_) { /* signed out / offline */ }
      const name = u.displayName || '', email = u.emailAddress || '';
      return (info = { name, email, picture: u.photoLink || '', initials: initialsOf(name, email) });
    },
  };
  return account;
}

let shared = null;
/** The one account of this page. */
export function getGoogleAccount() { return shared || (shared = createGoogleAccount()); }

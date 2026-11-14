// tests/helpers/fake-drive-session.js — ONE declared test helper that starts a fake Google Drive + fake GIS session in headless Chrome/Edge (TASK 624).
// SECURITY: zero real Google URLs, OAuth, or credentials — every `https://www.googleapis.com/` request is routed in-memory over CDP to
// `tests/harness/fake-drive.js`, and Google Identity Services (`window.google.accounts.oauth2`) is stubbed cleanly in-page.
// Persists across `navigate()` and `location.reload()` via CDP `Page.addScriptToEvaluateOnNewDocument` + Node-side `drive` state.
import { createFakeDrive } from '../harness/fake-drive.js';

/** Attach a persistent fake Google Drive + GIS environment to a `cdp-browser.js` instance BEFORE `navigate()`.
 *  opts: `{ signedIn = true, drive = createFakeDrive(), user }` */
export async function installFakeDriveSession(cdp, opts = {}) {
  const drive = opts.drive || createFakeDrive(opts.user ? { user: opts.user } : undefined);
  const initialSignedIn = opts.signedIn !== false;
  const tok = drive.token;

  await cdp.send('Runtime.addBinding', { name: '__skFakeDriveRpc' });
  cdp.ws.addEventListener('message', async (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (msg.method !== 'Runtime.bindingCalled' || msg.params?.name !== '__skFakeDriveRpc') return;
    let req;
    try { req = JSON.parse(msg.params.payload); } catch (_) { return; }
    let reply;
    try {
      const res = await drive.fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
      const body = await res.text();
      const headers = {};
      res.headers.forEach((v, k) => { headers[k] = v; });
      reply = { id: req.id, ok: true, status: res.status, headers, body };
    } catch (e) {
      reply = { id: req.id, ok: false, error: (e && e.message) || 'network error' };
    }
    if (cdp.ws.readyState === 1) {
      cdp.send('Runtime.evaluate', { expression: `window.__skFakeDriveReply && window.__skFakeDriveReply(${JSON.stringify(reply)})` });
    }
  });

  const bootstrapSource = `(() => {
    if (window.__skFakeDriveInstalled) return;
    window.__skFakeDriveInstalled = true;
    const TOKEN = ${JSON.stringify(tok)};
    const INITIAL_SIGNED_IN = ${JSON.stringify(initialSignedIn)};
    if (INITIAL_SIGNED_IN && !localStorage.getItem('__skFakeDriveSignedOut') && !localStorage.getItem('sk_cloud_token')) {
      localStorage.setItem('sk_cloud_token', TOKEN);
      localStorage.setItem('sk_cloud_token_expiry', String(Date.now() + 3600 * 1000));
    }
    const pending = new Map();
    let seq = 0;
    window.__skFakeDriveReply = (msg) => {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      if (!msg.ok) { entry.reject(new TypeError(msg.error || 'network unreachable')); return; }
      entry.resolve(new Response(msg.body, { status: msg.status, headers: msg.headers }));
    };
    const origFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!url.startsWith('https://www.googleapis.com/')) return origFetch(input, init);
      const id = ++seq;
      const hdrs = {};
      if (init.headers instanceof Headers) init.headers.forEach((v, k) => { hdrs[k] = v; });
      else if (Array.isArray(init.headers)) { for (const [k, v] of init.headers) hdrs[k] = v; }
      else if (init.headers && typeof init.headers === 'object') Object.assign(hdrs, init.headers);
      if (hdrs.authorization && !hdrs.Authorization) hdrs.Authorization = hdrs.authorization;
      if (hdrs['content-type'] && !hdrs['Content-Type']) hdrs['Content-Type'] = hdrs['content-type'];
      const payload = { id, url, method: init.method || 'GET', headers: hdrs, body: init.body != null ? String(init.body) : undefined };
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.__skFakeDriveRpc(JSON.stringify(payload));
      });
    };
    window.google = {
      accounts: {
        oauth2: {
          initTokenClient({ callback, error_callback }) {
            return {
              requestAccessToken() {
                if (localStorage.getItem('__skFakeDriveCancelSignIn') === '1') {
                  error_callback && error_callback({ type: 'popup_closed' });
                  return;
                }
                localStorage.removeItem('__skFakeDriveSignedOut');
                callback({ access_token: TOKEN, expires_in: 3600 });
              },
            };
          },
          revoke(_token, cb) {
            localStorage.setItem('__skFakeDriveSignedOut', '1');
            cb && cb();
          },
        },
      },
    };
  })();`;

  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: bootstrapSource });
  return {
    drive,
    setOffline: (on) => { drive.offline = !!on; },
    setFailWrites: (n) => { drive.failWrites = n; },
    setCancelSignIn: (on) => cdp.evalJs(on ? `localStorage.setItem('__skFakeDriveCancelSignIn', '1')` : `localStorage.removeItem('__skFakeDriveCancelSignIn')`),
    resetLocalSession: () => cdp.evalJs(`localStorage.clear()`),
  };
}

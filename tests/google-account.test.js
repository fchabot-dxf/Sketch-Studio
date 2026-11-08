// tests/google-account.test.js — TASK 480: the signed-in Google ACCOUNT of a browser (packages/ui/cloud/google-account.js), every
// browser dependency faked (fetch, storage, popup, GIS, window, timers): NO real Google call. Server session (renewable, no popup),
// the GIS fallback, lapse vs outage, the keep-alive gesture, sign-out, and the avatar rules.
import assert from 'node:assert';
import { createGoogleAccount } from '../packages/ui/cloud/google-account.js';
import { createAuthStore, authState, initialsOf, REFRESH_LEAD_MS } from '../packages/ui/cloud/auth-state.js';
import { GOOGLE, KEYS } from '../packages/ui/cloud/providers.js';

const ORIGIN = 'https://sketch-studio.pages.dev';
const makeStorage = () => { const m = new Map(); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const makeWin = () => {
  const l = {};
  return { listeners: l, document: { addEventListener() {}, hidden: false },
    addEventListener: (t, f) => (l[t] = l[t] || []).push(f), removeEventListener: (t, f) => { l[t] = (l[t] || []).filter((x) => x !== f); },
    emit: (t, e) => [...(l[t] || [])].forEach((f) => f(e)) };
};
function harness({ server = 'absent', serverBody, now = 1_000_000, gisFails = false } = {}) {
  const h = { storage: makeStorage(), win: makeWin(), log: [], gisCalls: [], popups: [], timers: [], t: now, server, serverBody, gisFails, about: { user: { displayName: 'Ada Lovelace', emailAddress: 'ada@example.com', photoLink: 'https://photo.invalid/a.jpg' } } };
  const respond = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status });
  const fetchImpl = async (url, init = {}) => {
    h.log.push({ url: String(url), init });
    if (String(url).endsWith('/auth/google/token')) {
      if (h.server === 'absent') return respond(404);
      if (h.server === 'nosession') return respond(401, { error: 'no-session' });
      if (h.server === 'lapsed') return respond(401, { error: 'lapsed' });
      if (h.server === 'outage') return respond(502, { error: 'google-unavailable' });
      if (h.server === 'throws') throw new TypeError('network');
      return respond(200, h.serverBody || { access_token: 'SRV-' + (++h.n), expires_in: 3599 });
    }
    if (String(url).endsWith('/auth/google/logout')) return respond(204);
    if (String(url).startsWith('https://www.googleapis.com/drive/v3/about')) return h.aboutFails ? respond(500) : respond(200, h.about);
    return respond(404);
  };
  h.n = 0;
  const gis = { load: async () => {}, requestToken: async (o) => { h.gisCalls.push(o); if (h.gisFails) throw new Error('popup_blocked'); return { access_token: 'GIS-' + h.gisCalls.length, expires_in: 3599 }; }, revoke: (tok) => h.log.push({ url: 'gis.revoke', token: tok }) };
  h.popup = { closed: false };
  h.account = createGoogleAccount({
    fetchImpl, gis, win: h.win, origin: ORIGIN, now: () => h.t,
    authStore: createAuthStore(h.storage),
    eligibleForServer: () => h.server !== 'ineligible',
    openPopup: (url) => { h.popups.push(url); return h.popup; },
    setTimer: (fn, ms) => { h.timers.push({ fn, ms }); return h.timers.length; }, clearTimer: () => {},
  });
  return h;
}

// 1. the pure gate: an expired token is NOT a signed-out user
{
  const now = 10_000_000;
  assert.deepStrictEqual(authState({}, now), { signedIn: false, lapsed: false, expired: false, needsRefresh: false, expiresAt: null });
  const fresh = authState({ token: 't', expiry: String(now + 3600_000) }, now);
  assert(fresh.signedIn && !fresh.expired && !fresh.needsRefresh);
  const soon = authState({ token: 't', expiry: String(now + REFRESH_LEAD_MS - 1) }, now);
  assert(soon.signedIn && soon.needsRefresh && !soon.expired, 'under the lead time: refresh, still signed in');
  const expired = authState({ token: 't', expiry: String(now - 1) }, now);
  assert(expired.signedIn && expired.expired && expired.needsRefresh, 'EXPIRED is still signed in (it is re-minted, not "session expired")');
  assert.strictEqual(authState({ token: 't', expiry: String(now - 1), lapsed: '1' }, now).signedIn, false, 'only a REFUSED refresh signs out');
  assert.strictEqual(authState({ token: 't' }, now).needsRefresh, false, 'no stored expiry: trusted, never fabricated');
  assert.strictEqual(initialsOf('Ada Lovelace', ''), 'AL'); assert.strictEqual(initialsOf('', 'grace.hopper@x.org'), 'GH'); assert.strictEqual(initialsOf('Plato', ''), 'PL'); assert.strictEqual(initialsOf('', ''), '?');
  assert.strictEqual(GOOGLE.scope, 'https://www.googleapis.com/auth/drive.file'); assert(/^983232817866-b4pl67uuhfmqdrtah42vaf22ivimfh3j\.apps\.googleusercontent\.com$/.test(GOOGLE.clientId));
}

// 2. NO server session here (the routes 404: localhost:8000 / unconfigured): the GIS popup, called synchronously in the click
{
  const h = harness({ server: 'absent' });
  assert.deepStrictEqual(await h.account.probe(), { available: false, signedIn: false, transient: false });
  assert.strictEqual(h.account.state().serverAvailable, false);
  const p = h.account.signIn();
  assert.strictEqual(h.gisCalls.length, 1, 'the GIS token request is made SYNCHRONOUSLY inside the click (a popup after an await is blocked)');
  assert.strictEqual(h.gisCalls[0].prompt, 'consent');
  await p;
  const s = h.account.state();
  assert(s.signedIn && !s.serverSession, 'signed in through GIS: not a server session');
  assert.strictEqual(h.storage.m.get(KEYS.token), 'GIS-1');
  assert.strictEqual(h.popups.length, 0, 'no server popup');
}

// 3. a server session already exists (cookie): probe adopts it, no popup, no gesture
{
  const h = harness({ server: 'ok' });
  const r = await h.account.probe();
  assert.deepStrictEqual(r, { available: true, signedIn: true });
  const s = h.account.state();
  assert(s.signedIn && s.serverSession && s.serverAvailable, 'a cleared localStorage re-adopts the cookie session');
  const post = h.log.find((c) => c.url.endsWith('/auth/google/token')).init;
  assert.strictEqual(post.method, 'POST'); assert.strictEqual(post.headers['X-SK-Auth'], '1'); assert.strictEqual(post.credentials, 'same-origin');
}

// 4. server available, not signed in yet: the server popup; the opener message is origin-checked; cancelling is an error
{
  const h = harness({ server: 'nosession' });
  await h.account.probe();
  assert.strictEqual(h.account.state().signedIn, false); assert.strictEqual(h.account.state().serverAvailable, true);
  let p = h.account.signIn();
  assert.deepStrictEqual(h.popups, ['/auth/google/start'], 'the popup opens synchronously with the click');
  h.win.emit('message', { origin: 'https://evil.example', data: { type: 'sk-google-session', ok: true } });
  h.win.emit('message', { origin: ORIGIN, data: { type: 'something-else', ok: true } });
  assert.strictEqual(h.account.state().signedIn, false, 'a foreign / unrelated message signs nobody in');
  h.server = 'ok';
  h.win.emit('message', { origin: ORIGIN, data: { type: 'sk-google-session', ok: true } });
  await p;
  assert(h.account.state().signedIn && h.account.state().serverSession, 'signed in with the renewable session');
  // failure reported by the callback page
  const h2 = harness({ server: 'nosession' }); await h2.account.probe();
  p = h2.account.signIn(); h2.win.emit('message', { origin: ORIGIN, data: { type: 'sk-google-session', ok: false, reason: 'state' } });
  await assert.rejects(p, /state/);
  // the user closes the popup
  const h3 = harness({ server: 'nosession' }); await h3.account.probe();
  p = h3.account.signIn(); h3.popup.closed = true; h3.timers[h3.timers.length - 1].fn();
  await assert.rejects(p, /sign-in cancelled/);
  assert.strictEqual(h3.account.state().signedIn, false);
  // a blocked popup
  const h4 = harness({ server: 'nosession' }); await h4.account.probe(); h4.popup = null;
  await assert.rejects(h4.account.signIn(), /popup-blocked/);
}

// 5. RENEWABLE: an expired access token is re-minted from the server session with no popup and no gesture; lapse vs outage
{
  const h = harness({ server: 'ok' });
  await h.account.probe();
  h.t += 2 * 3600_000;                                       // two hours later: the access token is long expired
  assert(h.account.state().signedIn && h.account.state().expired, 'expired but still signed in');
  const tok = await h.account.getAccessToken();
  assert.strictEqual(tok, 'SRV-2', 'a fresh token minted from the cookie session');
  assert.strictEqual(h.popups.length, 0); assert.strictEqual(Object.keys(h.win.listeners).length, 0, 'no gesture listener needed');
  assert.strictEqual(h.gisCalls.length, 0);
  // the server says LAPSED (Google refused the refresh token): the one road to "sign in again"
  h.t += 2 * 3600_000; h.server = 'lapsed';
  await assert.rejects(() => h.account.getAccessToken(), /cloud-auth/);
  assert(h.account.state().lapsed && !h.account.state().signedIn, 'lapsed: reconnect shown');
  // an OUTAGE is not a lapse
  const o = harness({ server: 'ok' }); await o.account.probe(); o.t += 2 * 3600_000; o.server = 'outage';
  await assert.rejects(() => o.account.getAccessToken(), /cloud-unavailable/);
  assert(o.account.state().signedIn && !o.account.state().lapsed, 'a Google outage never signs anyone out');
  const n = harness({ server: 'ok' }); await n.account.probe(); n.t += 2 * 3600_000; n.server = 'throws';
  await assert.rejects(() => n.account.getAccessToken(), /cloud-unavailable/); assert(!n.account.state().lapsed, 'a network failure is not a lapse either');
  // endpoints removed (a deploy without them): back to the GIS path quietly
  const g = harness({ server: 'ok' }); await g.account.probe(); g.t += 2 * 3600_000; g.server = 'absent';
  assert.strictEqual(await g.account.getAccessToken(), 'GIS-1'); assert.strictEqual(g.account.state().serverSession, false);
}

// 6. the GIS fallback keep-alive: a refresh outside a gesture is blocked -> NOT a lapse, armed for the next gesture
{
  const h = harness({ server: 'absent' });
  await h.account.probe(); await h.account.signIn();
  h.t += 2 * 3600_000; h.gisFails = true;
  await assert.rejects(() => h.account.getAccessToken(), /cloud-auth/);
  assert(!h.account.state().lapsed && h.account.state().signedIn, 'a blocked popup says nothing about the account: no lapse');
  assert(h.win.listeners.pointerdown && h.win.listeners.pointerdown.length === 1 && h.win.listeners.keydown.length === 1, 'armed for the next user gesture');
  h.gisFails = false;
  h.win.emit('pointerdown', {}); await new Promise((r) => setTimeout(r, 0));
  assert.strictEqual(h.storage.m.get(KEYS.token), 'GIS-3', 'the gesture re-minted the token (silent grant, prompt "")');
  assert.strictEqual(h.gisCalls[h.gisCalls.length - 1].prompt, '');
  assert.strictEqual(h.win.listeners.pointerdown.length, 0, 'disarmed after the gesture');
  // a REFUSED gesture refresh IS a lapse
  h.t += 2 * 3600_000; h.gisFails = true;
  await assert.rejects(() => h.account.getAccessToken(), /cloud-auth/);
  h.win.emit('keydown', {}); await new Promise((r) => setTimeout(r, 0));
  assert(h.account.state().lapsed, 'the gesture\'s refresh failed: that is the real answer, now a lapse');
}

// 7. a Drive 401 mid-session re-mints once and retries
{
  const h = harness({ server: 'ok' }); await h.account.probe();
  let calls = 0;
  const account = createGoogleAccount({ // same stack, but the "Drive" answers 401 the first time
    fetchImpl: async (url, init = {}) => {
      if (String(url).endsWith('/auth/google/token')) return new Response(JSON.stringify({ access_token: 'FRESH', expires_in: 3599 }), { status: 200 });
      calls++; return new Response('', { status: calls === 1 ? 401 : 200 });
    },
    gis: { load: async () => {}, requestToken: async () => { throw new Error('no'); }, revoke() {} }, win: makeWin(), origin: ORIGIN, now: () => 1000, authStore: createAuthStore(h.storage), eligibleForServer: () => true, setTimer: () => 0, clearTimer: () => {},
  });
  const r = await account.authedFetch('https://www.googleapis.com/drive/v3/files');
  assert.strictEqual(r.status, 200); assert.strictEqual(calls, 2, 'one 401, one re-mint, one retry');
}

// 8. sign-out: server logout (revokes the refresh token) or GIS revoke; every key dropped
{
  const h = harness({ server: 'ok' }); await h.account.probe();
  await h.account.signOut();
  const out = h.log.find((c) => c.url.endsWith('/auth/google/logout'));
  assert(out && out.init.method === 'POST' && out.init.headers['X-SK-Auth'] === '1', 'server logout with the custom header');
  assert.strictEqual(h.storage.m.size, 0, 'no key left'); assert.strictEqual(h.account.state().signedIn, false);
  const g = harness({ server: 'absent' }); await g.account.probe(); await g.account.signIn(); await g.account.signOut();
  assert(g.log.some((c) => c.url === 'gis.revoke' && c.token === 'GIS-1'), 'the GIS token is revoked'); assert.strictEqual(g.storage.m.size, 0);
}

// 9. the avatar: Drive about.get photoLink (no userinfo scope), initials as the fallback, never an error
{
  const h = harness({ server: 'ok' }); await h.account.probe();
  const u = await h.account.userInfo();
  assert.deepStrictEqual(u, { name: 'Ada Lovelace', email: 'ada@example.com', picture: 'https://photo.invalid/a.jpg', initials: 'AL' });
  assert(h.log.some((c) => c.url.startsWith('https://www.googleapis.com/drive/v3/about?fields=user')), 'the picture comes from Drive about.get');
  assert(!h.log.some((c) => /userinfo|oauth2\/v\d\/|openid|profile/.test(c.url)), 'no userinfo / profile / openid scope or endpoint');
  const n = harness({ server: 'ok' }); await n.account.probe(); n.about = { user: { displayName: 'Grace Hopper', emailAddress: 'g@h.org' } };
  assert.deepStrictEqual(await n.account.userInfo(), { name: 'Grace Hopper', email: 'g@h.org', picture: '', initials: 'GH' }, 'no photoLink: initials');
  const f = harness({ server: 'ok' }); await f.account.probe(); f.aboutFails = true;
  assert.deepStrictEqual(await f.account.userInfo(), { name: '', email: '', picture: '', initials: '?' }, 'a failing about.get is initials-only, never a throw');
  const signedOut = harness({ server: 'absent' });
  assert.strictEqual((await signedOut.account.userInfo()).initials, '?', 'signed out: no throw');
}
console.log('google-account: ok');

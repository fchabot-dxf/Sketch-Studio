// tests/google-auth-functions.test.js — TASK 480: the Pages Functions behind /auth/google/* (server/googleAuth.js), Google FAKED
// (fetchImpl injected: no real Google call anywhere). start / callback / token / logout, refused origin / header, unconfigured =
// 404, sealed cookies tampered / replayed / expired = refused, a lapse vs an outage, and no secret ever in a response.
import assert from 'node:assert';
import { handleGoogleAuth, seal, unseal, readCookie, FLOW_COOKIE, SESSION_COOKIE, SCOPE, GOOGLE_AUTH, GOOGLE_TOKEN, GOOGLE_REVOKE, MESSAGE_TYPE } from '../server/googleAuth.js';

const ORIGIN = 'https://sketch-studio.pages.dev';
const ENV = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'TOP-SECRET-VALUE', SESSION_KEY: 'a'.repeat(48) };
const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---- a fake Google ----
function fakeGoogle() {
  const g = { calls: [], exchange: { ok: true, status: 200, body: { access_token: 'AT-1', refresh_token: 'RT-secret', expires_in: 3599 } }, refresh: { ok: true, status: 200, body: { access_token: 'AT-2', expires_in: 3599 } }, revokeFails: false };
  g.fetch = async (url, init) => {
    const params = Object.fromEntries(new URLSearchParams(init.body));
    g.calls.push({ url, params });
    const reply = (r) => new Response(JSON.stringify(r.body), { status: r.status });
    if (url === GOOGLE_TOKEN) return reply(params.grant_type === 'authorization_code' ? g.exchange : g.refresh);
    if (url === GOOGLE_REVOKE) { if (g.revokeFails) throw new Error('network'); return new Response('', { status: 200 }); }
    throw new Error('unexpected Google URL ' + url);
  };
  return g;
}
const req = (path, { method = 'GET', headers = {}, cookie } = {}) => new Request(ORIGIN + path, { method, headers: { ...(cookie ? { cookie } : {}), ...headers } });
const post = (action, extra = {}) => req('/auth/google/' + action, { method: 'POST', headers: { origin: ORIGIN, 'x-sk-auth': '1', ...(extra.headers || {}) }, cookie: extra.cookie });
const setCookies = (res) => res.headers.getSetCookie();
const cookieValue = (res, name) => { const c = setCookies(res).find((x) => x.startsWith(name + '=')); return c ? c.slice(name.length + 1).split(';')[0] : null; };

// 1. UNCONFIGURED: any of the three missing = every route is a 404 (the client then keeps the GIS popup)
for (const missing of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_KEY', null]) {
  const env = { ...ENV }; if (missing) delete env[missing]; else for (const k of Object.keys(env)) delete env[k];
  for (const [action, method] of [['start', 'GET'], ['callback', 'GET'], ['token', 'POST'], ['logout', 'POST'], ['nope', 'GET']]) {
    const res = await handleGoogleAuth(req('/auth/google/' + action, { method, headers: { origin: ORIGIN, 'x-sk-auth': '1' } }), env, action, fakeGoogle().fetch);
    assert.strictEqual(res.status, 404, `${action} must 404 without ${missing || 'any config'}`);
  }
}
assert.strictEqual((await handleGoogleAuth(req('/auth/google/nope'), ENV, 'nope', fakeGoogle().fetch)).status, 404, 'an unknown action is a 404');
assert.strictEqual((await handleGoogleAuth(req('/auth/google/start', { method: 'POST', headers: { origin: ORIGIN } }), ENV, 'start', fakeGoogle().fetch)).status, 404, 'start only answers GET');

// 2. START: PKCE + offline access + drive.file, the flow state sealed in a first-party cookie
const g = fakeGoogle();
const start = await handleGoogleAuth(req('/auth/google/start'), ENV, 'start', g.fetch);
assert.strictEqual(start.status, 302);
const loc = new URL(start.headers.get('location'));
assert.strictEqual(loc.origin + loc.pathname, GOOGLE_AUTH);
const q = Object.fromEntries(loc.searchParams);
assert.strictEqual(q.client_id, ENV.GOOGLE_CLIENT_ID);
assert.strictEqual(q.redirect_uri, ORIGIN + '/auth/google/callback', 'the redirect URI is this origin (the one the owner registered)');
assert.strictEqual(q.scope, SCOPE); assert.strictEqual(SCOPE, 'https://www.googleapis.com/auth/drive.file', 'drive.file only');
assert.strictEqual(q.access_type, 'offline'); assert.strictEqual(q.prompt, 'consent'); assert.strictEqual(q.response_type, 'code');
assert.strictEqual(q.code_challenge_method, 'S256');
const flowCookie = setCookies(start).find((c) => c.startsWith(FLOW_COOKIE + '='));
assert(flowCookie && /; Secure/.test(flowCookie) && /; HttpOnly/.test(flowCookie) && /SameSite=Lax/.test(flowCookie) && /Path=\//.test(flowCookie) && !/Domain=/i.test(flowCookie), '__Host- cookie rules: ' + flowCookie);
assert(/Max-Age=600/.test(flowCookie), 'the flow cookie lives 10 minutes');
const flowSealed = cookieValue(start, FLOW_COOKIE);
const flow = await unseal(ENV.SESSION_KEY, FLOW_COOKIE, flowSealed);
assert.strictEqual(flow.state, q.state, 'the state in the URL is the sealed one');
assert.strictEqual(b64url(await crypto.subtle.digest('SHA-256', enc.encode(flow.verifier))), q.code_challenge, 'the challenge is SHA-256(verifier): real PKCE');
assert(!start.headers.get('location').includes(ENV.GOOGLE_CLIENT_SECRET) && !flowSealed.includes(flow.verifier), 'no secret / verifier in the URL or the cookie in clear');
assert.strictEqual(start.headers.get('cache-control'), 'no-store');

// 3. CALLBACK: state checked, code exchanged with the secret + verifier, the refresh token sealed into the session cookie
{
  const cb = await handleGoogleAuth(req(`/auth/google/callback?code=CODE-1&state=${flow.state}`, { cookie: `${FLOW_COOKIE}=${flowSealed}` }), ENV, 'callback', g.fetch);
  assert.strictEqual(cb.status, 200);
  const ex = g.calls.find((c) => c.params.grant_type === 'authorization_code');
  assert.deepStrictEqual({ code: ex.params.code, v: ex.params.code_verifier, r: ex.params.redirect_uri, id: ex.params.client_id, s: ex.params.client_secret },
    { code: 'CODE-1', v: flow.verifier, r: ORIGIN + '/auth/google/callback', id: ENV.GOOGLE_CLIENT_ID, s: ENV.GOOGLE_CLIENT_SECRET }, 'the exchange carries the verifier and the secret (server side only)');
  const sessCookie = setCookies(cb).find((c) => c.startsWith(SESSION_COOKIE + '='));
  assert(sessCookie && /Max-Age=15552000/.test(sessCookie) && /HttpOnly/.test(sessCookie) && /Secure/.test(sessCookie), 'a 180-day httpOnly session cookie: ' + sessCookie);
  assert(setCookies(cb).some((c) => c.startsWith(FLOW_COOKIE + '=;') && /Max-Age=0/.test(c)), 'the flow cookie is cleared');
  const sess = await unseal(ENV.SESSION_KEY, SESSION_COOKIE, cookieValue(cb, SESSION_COOKIE));
  assert.strictEqual(sess.rt, 'RT-secret', 'the refresh token is inside the sealed cookie');
  const body = await cb.text();
  assert(body.includes(MESSAGE_TYPE) && body.includes('"ok":true') && body.includes(JSON.stringify(ORIGIN)), 'the page tells the opener, same origin only');
  for (const leak of ['RT-secret', 'AT-1', ENV.GOOGLE_CLIENT_SECRET]) assert(!body.includes(leak) && !JSON.stringify([...cb.headers]).includes(leak.replace('RT-secret', 'NEVER')), 'the page leaks no ' + leak);
  assert(!sessCookie.includes('RT-secret'), 'the refresh token is not readable in the cookie');
}
// callback refusals: nothing is stored
{
  const fail = async (path, cookie, why, reason) => {
    const gg = fakeGoogle();
    const res = await handleGoogleAuth(req(path, { cookie }), ENV, 'callback', gg.fetch);
    assert.strictEqual(res.status, 400, why);
    assert(!setCookies(res).some((c) => c.startsWith(SESSION_COOKIE + '=') && !/Max-Age=0/.test(c)), 'no session cookie after: ' + why);
    assert((await res.text()).includes(reason), why + ' reports ' + reason);
    return gg;
  };
  await fail(`/auth/google/callback?code=C&state=WRONG`, `${FLOW_COOKIE}=${flowSealed}`, 'a state that does not match the flow cookie', '"reason":"state"');
  const noExchange = await fail(`/auth/google/callback?code=C&state=${flow.state}`, '', 'no flow cookie', '"reason":"state"');
  assert.strictEqual(noExchange.calls.length, 0, 'Google is not even called without a valid flow');
  await fail(`/auth/google/callback?state=${flow.state}`, `${FLOW_COOKIE}=${flowSealed}`, 'no code', '"reason":"state"');
  await fail(`/auth/google/callback?error=access_denied&state=${flow.state}`, `${FLOW_COOKIE}=${flowSealed}`, 'the user denied consent', 'access_denied');
  const expiredFlow = await seal(ENV.SESSION_KEY, FLOW_COOKIE, { state: 'S', verifier: 'V', exp: Math.floor(Date.now() / 1000) - 5 });
  await fail('/auth/google/callback?code=C&state=S', `${FLOW_COOKIE}=${expiredFlow}`, 'an expired flow cookie', '"reason":"state"');
  const g2 = fakeGoogle(); g2.exchange = { ok: true, status: 200, body: { access_token: 'AT' } };   // Google omitted the refresh token
  const res = await handleGoogleAuth(req(`/auth/google/callback?code=C&state=${flow.state}`, { cookie: `${FLOW_COOKIE}=${flowSealed}` }), ENV, 'callback', g2.fetch);
  assert.strictEqual(res.status, 400); assert((await res.text()).includes('no-refresh-token'), 'no refresh token = not signed in');
  const g3 = fakeGoogle(); g3.exchange = { ok: false, status: 400, body: { error: 'invalid_grant' } };
  const res3 = await handleGoogleAuth(req(`/auth/google/callback?code=C&state=${flow.state}`, { cookie: `${FLOW_COOKIE}=${flowSealed}` }), ENV, 'callback', g3.fetch);
  assert.strictEqual(res3.status, 400); assert((await res3.text()).includes('"reason":"exchange"'));
}

// 4. TOKEN: only this origin's own script; a lapse and an outage are different answers
const session = await seal(ENV.SESSION_KEY, SESSION_COOKIE, { rt: 'RT-secret', iat: 1 });
{
  const gg = fakeGoogle();
  const t = async (r) => handleGoogleAuth(r, ENV, 'token', gg.fetch);
  assert.strictEqual((await t(req('/auth/google/token', { method: 'POST', cookie: `${SESSION_COOKIE}=${session}` }))).status, 403, 'no Origin / header');
  assert.strictEqual((await t(req('/auth/google/token', { method: 'POST', headers: { origin: 'https://evil.example', 'x-sk-auth': '1' }, cookie: `${SESSION_COOKIE}=${session}` }))).status, 403, 'a foreign Origin');
  assert.strictEqual((await t(req('/auth/google/token', { method: 'POST', headers: { origin: ORIGIN }, cookie: `${SESSION_COOKIE}=${session}` }))).status, 403, 'right Origin, no custom header');
  assert.strictEqual((await t(req('/auth/google/token', { method: 'POST', headers: { 'x-sk-auth': '1' }, cookie: `${SESSION_COOKIE}=${session}` }))).status, 403, 'custom header but no Origin');
  assert.strictEqual((await t(req('/auth/google/token', { method: 'GET', headers: { origin: ORIGIN, 'x-sk-auth': '1' }, cookie: `${SESSION_COOKIE}=${session}` }))).status, 403, 'GET is refused (a link cannot fetch a token)');
  assert.strictEqual(gg.calls.length, 0, 'Google is never called for a refused request');
  const none = await t(post('token'));
  assert.strictEqual(none.status, 401); assert.deepStrictEqual(await none.json(), { error: 'no-session' });
  const ok = await t(post('token', { cookie: `${SESSION_COOKIE}=${session}` }));
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(await ok.json(), { access_token: 'AT-2', expires_in: 3599 });
  assert.strictEqual(ok.headers.get('cache-control'), 'no-store');
  assert.deepStrictEqual({ g: gg.calls[0].params.grant_type, rt: gg.calls[0].params.refresh_token, s: gg.calls[0].params.client_secret }, { g: 'refresh_token', rt: 'RT-secret', s: ENV.GOOGLE_CLIENT_SECRET }, 'the refresh uses the sealed token + the server-side secret');
  assert.strictEqual(setCookies(ok).length, 0, 'a good refresh changes no cookie');
  // a LAPSE: Google refuses the refresh token -> 401 lapsed + the session cookie is dropped
  gg.refresh = { ok: false, status: 400, body: { error: 'invalid_grant' } };
  const lapsed = await t(post('token', { cookie: `${SESSION_COOKIE}=${session}` }));
  assert.strictEqual(lapsed.status, 401); assert.deepStrictEqual(await lapsed.json(), { error: 'lapsed' });
  assert(setCookies(lapsed).some((c) => c.startsWith(SESSION_COOKIE + '=;') && /Max-Age=0/.test(c)), 'the dead session cookie is cleared');
  // an OUTAGE: Google 500 -> 502, the session is KEPT (not a lapse)
  gg.refresh = { ok: false, status: 500, body: {} };
  const outage = await t(post('token', { cookie: `${SESSION_COOKIE}=${session}` }));
  assert.strictEqual(outage.status, 502); assert.strictEqual(setCookies(outage).length, 0, 'an outage never signs anyone out');
}

// 5. sealed cookies: tampered / wrong key / replayed under another name / expired = refused (= no session)
{
  const gg = fakeGoogle();
  const t = (sealed) => handleGoogleAuth(post('token', { cookie: `${SESSION_COOKIE}=${sealed}` }), ENV, 'token', gg.fetch);
  const flip = session.slice(0, 20) + (session[20] === 'A' ? 'B' : 'A') + session.slice(21);
  assert.strictEqual((await t(flip)).status, 401, 'a tampered cookie is refused');
  assert.strictEqual((await t(session.slice(0, -4))).status, 401, 'a truncated cookie is refused');
  assert.strictEqual((await t('garbage')).status, 401);
  assert.strictEqual((await t(await seal('b'.repeat(48), SESSION_COOKIE, { rt: 'RT' }))).status, 401, 'sealed under another SESSION_KEY (rotated) = signed out');
  assert.strictEqual((await t(flowSealed)).status, 401, 'the FLOW cookie replayed as a session cookie is refused (the name is bound as additional data)');
  assert.strictEqual((await t(await seal(ENV.SESSION_KEY, SESSION_COOKIE, { rt: 'RT', exp: Math.floor(Date.now() / 1000) - 1 }))).status, 401, 'an expired sealed value is refused');
  assert.strictEqual(gg.calls.length, 0, 'Google is never called with a cookie that does not open');
  assert.strictEqual(await unseal(ENV.SESSION_KEY, SESSION_COOKIE, session).then((v) => v.rt), 'RT-secret');
  assert.strictEqual(readCookie(req('/', { cookie: `a=1; ${SESSION_COOKIE}=xyz; b=2` }), SESSION_COOKIE), 'xyz');
}

// 6. LOGOUT: same guards; the refresh token is revoked at Google and the cookie dropped (even if the revoke fails)
{
  const gg = fakeGoogle();
  assert.strictEqual((await handleGoogleAuth(req('/auth/google/logout', { method: 'POST', cookie: `${SESSION_COOKIE}=${session}` }), ENV, 'logout', gg.fetch)).status, 403, 'logout needs the Origin + header too');
  const out = await handleGoogleAuth(post('logout', { cookie: `${SESSION_COOKIE}=${session}` }), ENV, 'logout', gg.fetch);
  assert.strictEqual(out.status, 204);
  assert.deepStrictEqual(gg.calls.map((c) => [c.url, c.params.token]), [[GOOGLE_REVOKE, 'RT-secret']], 'the refresh token is revoked at Google');
  assert(setCookies(out).some((c) => c.startsWith(SESSION_COOKIE + '=;') && /Max-Age=0/.test(c)), 'the cookie is cleared');
  gg.revokeFails = true;
  const out2 = await handleGoogleAuth(post('logout', { cookie: `${SESSION_COOKIE}=${session}` }), ENV, 'logout', gg.fetch);
  assert.strictEqual(out2.status, 204); assert(setCookies(out2).some((c) => /Max-Age=0/.test(c)), 'a failing revoke still signs the browser out');
  const out3 = await handleGoogleAuth(post('logout'), ENV, 'logout', gg.fetch);
  assert.strictEqual(out3.status, 204, 'logging out with no session is fine');
}
console.log('google-auth-functions: ok');

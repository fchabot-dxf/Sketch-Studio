/**
 * server/googleAuth.js — THE DURABLE GOOGLE SESSION, server-side, FIRST-PARTY to the app's origin (TASK 480).
 * Ported from DDCS Studio's solved design (server/googleAuth.js there; read-only reference), renamed for Sketch Studio.
 *
 * WHY. The browser-only GIS token model gives a ~1 h access token and no refresh token; re-minting it needs a popup in a
 * user gesture. This flow keeps a Google REFRESH token on the server side instead, sealed in an encrypted httpOnly
 * cookie that only this origin's Functions can read, so a fresh access token is one same-origin POST away: no popup, no
 * gesture, across days (owner: "allow to have renewable token").
 *
 * WHERE. Cloudflare Pages Functions (functions/auth/google/[action].js routes to this module): a Function runs on the
 * app's OWN host (sketch-studio.pages.dev), so the cookie is first-party. localhost:8000 has no Functions: the client
 * reads the 404 as "no server session here" and keeps the GIS token popup.
 *
 * ROUTES (all under /auth/google/):
 *   GET  start     -> PKCE + state sealed in a short-lived flow cookie -> 302 to Google's consent (offline access)
 *   GET  callback  -> state checked against the flow cookie -> code exchanged (client secret + verifier) -> the refresh
 *                     token sealed into the session cookie -> a page that tells the opener and closes
 *   POST token     -> Origin must be this origin AND X-SK-Auth: 1 (a custom header: a foreign page cannot send it without
 *                     a preflight, which nothing here answers) -> refresh -> { access_token, expires_in }
 *   POST logout    -> same checks -> revoke the refresh token at Google -> clear the cookie
 * UNCONFIGURED (any of GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / SESSION_KEY missing) -> every route is a 404. A preview
 * deploy without secrets is inert.
 *
 * COOKIES: `__Host-` (Secure, Path=/, no Domain -> this exact host only), HttpOnly, SameSite=Lax. Sealed with AES-GCM
 * under a key derived from SESSION_KEY; the cookie NAME is the additional data, so the flow cookie can never be replayed as
 * a session cookie. Never logged; tokens never appear in a URL or an error message.
 *
 * SCOPE: drive.file only (the app only ever sees files it created: non-sensitive, no Google verification review).
 * The client SECRET is never in the repo: the owner sets GOOGLE_CLIENT_SECRET as a Cloudflare Pages secret (see WORK-LOG
 * TURN 480 for the click path). `fetchImpl` is injectable so the tests fake Google (no real Google call in any test).
 */
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
export const FLOW_COOKIE = '__Host-sk_gflow', SESSION_COOKIE = '__Host-sk_gsess';
export const AUTH_HEADER = 'x-sk-auth';
export const MESSAGE_TYPE = 'sk-google-session';
const FLOW_TTL_S = 10 * 60, SESSION_TTL_S = 180 * 24 * 3600;
const enc = new TextEncoder(), dec = new TextDecoder();

// ── encoding + sealing ───────────────────────────────────────────────────────────────────────────────────────────────
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4)), (c) => c.charCodeAt(0));
const randomB64 = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));

async function keyFor(secret) {
    const raw = await crypto.subtle.digest('SHA-256', enc.encode('sketch-google-session:' + secret));
    return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
/** Seal a JSON value for cookie `name`: base64url(iv || AES-GCM ciphertext), the name bound as additional data. */
export async function seal(secret, name, value) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(name) }, await keyFor(secret), enc.encode(JSON.stringify(value)));
    const out = new Uint8Array(12 + ct.byteLength); out.set(iv); out.set(new Uint8Array(ct), 12);
    return b64url(out);
}
/** Open a sealed cookie value; null if it was tampered with, sealed under another key or name, or has expired. */
export async function unseal(secret, name, sealed) {
    try {
        const b = unb64url(sealed);
        if (b.length < 13) return null;
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(0, 12), additionalData: enc.encode(name) }, await keyFor(secret), b.slice(12));
        const v = JSON.parse(dec.decode(pt));
        if (v && v.exp && Date.now() / 1000 > v.exp) return null;
        return v;
    } catch (_) { return null; }
}

// ── cookies ──────────────────────────────────────────────────────────────────────────────────────────────────────────
export function readCookie(request, name) {
    const h = request.headers.get('cookie') || '';
    for (const part of h.split(/;\s*/)) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1); }
    return '';
}
const setCookie = (name, value, maxAge) => `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
const clearCookie = (name) => `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;

// ── responses ────────────────────────────────────────────────────────────────────────────────────────────────────────
const NO_STORE = { 'cache-control': 'no-store' };
const json = (status, body, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE, ...extra } });
const notFound = () => new Response('Not found', { status: 404, headers: NO_STORE });
function withCookies(res, cookies) { for (const c of cookies) res.headers.append('set-cookie', c); return res; }
/** The popup's last page: tell the opener (same origin only) and close; without an opener, go home. */
function finishPage(origin, ok, reason) {
    const msg = JSON.stringify({ type: MESSAGE_TYPE, ok, reason: ok ? '' : String(reason || 'failed') }).replace(/</g, '\\u003c');
    return new Response(`<!doctype html><meta charset="utf-8"><title>Sketch Studio</title>
<body style="font:15px system-ui;padding:3em;text-align:center">${ok ? 'Signed in — you can close this window.' : 'Sign-in did not complete — close this window and try again.'}
<script>
try { if (window.opener) { window.opener.postMessage(${msg}, ${JSON.stringify(origin)}); window.close(); } else { location.replace('/'); } } catch (e) { location.replace('/'); }
</script></body>`, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE } });
}

export const configured = (env) => !!(env && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.SESSION_KEY);
/** A state-changing / credential-returning request from THIS origin's own script: not a link, not a foreign page. */
function sameOriginScript(request, origin) {
    return request.method === 'POST' && request.headers.get('origin') === origin && request.headers.get(AUTH_HEADER) === '1';
}
async function googlePost(fetchImpl, url, params) {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    let body = {}; try { body = await r.json(); } catch (_) { /* revoke answers an empty body */ }
    return { ok: r.ok, status: r.status, body };
}

// ── the handler ──────────────────────────────────────────────────────────────────────────────────────────────────────
export async function handleGoogleAuth(request, env, action, fetchImpl = fetch) {
    if (!configured(env)) return notFound();
    const url = new URL(request.url);
    const origin = url.origin;
    const redirectUri = origin + '/auth/google/callback';

    if (action === 'start' && request.method === 'GET') {
        const state = randomB64(24), verifier = randomB64(48);
        const challenge = b64url(await crypto.subtle.digest('SHA-256', enc.encode(verifier)));
        const flow = await seal(env.SESSION_KEY, FLOW_COOKIE, { state, verifier, exp: Math.floor(Date.now() / 1000) + FLOW_TTL_S });
        const q = new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
            access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',   // offline + consent = Google returns a refresh token
            state, code_challenge: challenge, code_challenge_method: 'S256',
        });
        return withCookies(new Response(null, { status: 302, headers: { location: `${GOOGLE_AUTH}?${q}`, ...NO_STORE } }), [setCookie(FLOW_COOKIE, flow, FLOW_TTL_S)]);
    }

    if (action === 'callback' && request.method === 'GET') {
        const flow = await unseal(env.SESSION_KEY, FLOW_COOKIE, readCookie(request, FLOW_COOKIE));
        const clear = [clearCookie(FLOW_COOKIE)];
        const state = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
        if (url.searchParams.get('error')) return withCookies(finishPage(origin, false, url.searchParams.get('error')), clear);
        if (!flow || !state || flow.state !== state || !code) return withCookies(finishPage(origin, false, 'state'), clear);
        const t = await googlePost(fetchImpl, GOOGLE_TOKEN, {
            grant_type: 'authorization_code', code, code_verifier: flow.verifier, redirect_uri: redirectUri,
            client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        });
        if (!t.ok || !t.body.refresh_token) return withCookies(finishPage(origin, false, t.ok ? 'no-refresh-token' : 'exchange'), clear);
        const sess = await seal(env.SESSION_KEY, SESSION_COOKIE, { rt: t.body.refresh_token, iat: Math.floor(Date.now() / 1000) });
        return withCookies(finishPage(origin, true), [...clear, setCookie(SESSION_COOKIE, sess, SESSION_TTL_S)]);
    }

    if (action === 'token') {
        if (!sameOriginScript(request, origin)) return json(403, { error: 'forbidden' });
        const sess = await unseal(env.SESSION_KEY, SESSION_COOKIE, readCookie(request, SESSION_COOKIE));
        if (!sess || !sess.rt) return json(401, { error: 'no-session' });
        const t = await googlePost(fetchImpl, GOOGLE_TOKEN, { grant_type: 'refresh_token', refresh_token: sess.rt, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET });
        if (t.ok && t.body.access_token) return json(200, { access_token: t.body.access_token, expires_in: Number(t.body.expires_in) || 0 });
        // Google REFUSED the refresh token (revoked, expired, password change): the session is over: say so and drop it.
        if (t.status === 400 || t.status === 401) return withCookies(json(401, { error: 'lapsed' }), [clearCookie(SESSION_COOKIE)]);
        return json(502, { error: 'google-unavailable' });   // a Google outage is not a lapse: keep the session
    }

    if (action === 'logout') {
        if (!sameOriginScript(request, origin)) return json(403, { error: 'forbidden' });
        const sess = await unseal(env.SESSION_KEY, SESSION_COOKIE, readCookie(request, SESSION_COOKIE));
        if (sess && sess.rt) { try { await googlePost(fetchImpl, GOOGLE_REVOKE, { token: sess.rt }); } catch (_) { /* the cookie goes regardless */ } }
        return withCookies(new Response(null, { status: 204, headers: NO_STORE }), [clearCookie(SESSION_COOKIE)]);
    }

    return notFound();
}

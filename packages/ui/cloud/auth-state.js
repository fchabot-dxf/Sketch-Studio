// packages/ui/cloud/auth-state.js — WHAT THE STORED GOOGLE TOKEN MEANS, decided in one pure function (TASK 480; ported from
// DDCS Studio's authState.js, where the lesson was paid for).
//
// AN EXPIRED ACCESS TOKEN IS NOT A SIGNED-OUT USER. A token lives ~1 h; treating "expired" as "signed out" shows "session
// expired" every hour. Three states, not two:
//   signedIn      a token is held and no refresh has been REFUSED. The signed-in UI stays.
//   needsRefresh  signedIn, and the token has expired or has under REFRESH_LEAD_MS left: re-mint it.
//   lapsed        a refresh was tried and REFUSED. Only this shows "sign in again".
// A token with NO stored expiry is trusted as before: never fabricate an expiry the minter did not give.
import { KEYS } from '#ui/cloud/providers.js';

export const REFRESH_LEAD_MS = 5 * 60 * 1000;

/** THE PURE GATE. `token` / `expiry` / `lapsed` are the raw stored strings (or null); `now` is ms since epoch. */
export function authState({ token, expiry, lapsed } = {}, now = Date.now()) {
  const has = !!token;
  const exp = expiry == null || expiry === '' ? NaN : Number(expiry);
  const known = Number.isFinite(exp);
  const isLapsed = has && lapsed === '1';
  const signedIn = has && !isLapsed;
  return { signedIn, lapsed: isLapsed, expired: signedIn && known && now >= exp, needsRefresh: signedIn && known && now >= exp - REFRESH_LEAD_MS, expiresAt: known ? exp : null };
}

const defaultStorage = () => { try { return globalThis.localStorage || null; } catch (_) { return null; } };

/** The account's stored state, on an injectable storage (localStorage by default): read / save / lapse / clear. */
export function createAuthStore(storage = defaultStorage()) {
  const get = (k) => { try { return storage ? storage.getItem(k) : null; } catch (_) { return null; } };
  const set = (k, v) => { try { if (storage) storage.setItem(k, v); } catch (_) { /* storage blocked: the session simply will not persist */ } };
  const del = (k) => { try { if (storage) storage.removeItem(k); } catch (_) { /* */ } };
  return {
    read: (now = Date.now()) => authState({ token: get(KEYS.token), expiry: get(KEYS.expiry), lapsed: get(KEYS.lapsed) }, now),
    token: () => get(KEYS.token) || '',
    /** Every mint (sign-in, silent refresh) goes through here, so a new token always clears a previous lapse. */
    save(accessToken, expiresIn, now = Date.now()) {
      set(KEYS.token, accessToken);
      if (Number(expiresIn) > 0) set(KEYS.expiry, String(now + Number(expiresIn) * 1000)); else del(KEYS.expiry);
      del(KEYS.lapsed);
    },
    markLapsed() { set(KEYS.lapsed, '1'); },
    usesServerSession: () => get(KEYS.sessionKind) === 'server',
    markServerSession(on) { if (on) set(KEYS.sessionKind, 'server'); else del(KEYS.sessionKind); },
    clear() { for (const k of Object.values(KEYS)) del(k); },
  };
}

/** Initials for the avatar fallback (a missing / expired photo URL must never show a dead image). */
export function initialsOf(name, email) {
  const src = String(name || '').trim() || String(email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

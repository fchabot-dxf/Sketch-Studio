// TASK 480 — Cloudflare Pages Function: /auth/google/{start|callback|token|logout}. The Pages project root is the repo root, so
// this runs on the app's own host (first-party cookies). All logic lives in server/googleAuth.js; this only routes.
// Inert until GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and SESSION_KEY are set on the Pages project (every route 404s).
import { handleGoogleAuth } from '../../../server/googleAuth.js';

export const onRequest = ({ request, env, params }) => handleGoogleAuth(request, env, String(params.action || ''));

// functions/api/shaper-upload.js — Cloudflare Pages serverless edge function.
// Proxies upload requests to ShaperHub, attaching required Origin/Referer headers without browser CORS restrictions.
//
// THE CONTRACT of POST /api/shaper-upload (actions upload / list / mkdir, the session token, the upload modes, the 'exists' answer, the Replace rule,
// the error kinds) is declared ONCE, in the header of packages/core/shaper-cloud.js (above UPLOAD_MODES); its one implementation is handleShaperUpload
// there. This function and the local server.js only pass the request text through and send back its answer.

import { handleShaperUpload } from '../../packages/core/shaper-cloud.js';

export async function onRequestPost({ request }) {
  const { status, body } = await handleShaperUpload(await request.text());
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

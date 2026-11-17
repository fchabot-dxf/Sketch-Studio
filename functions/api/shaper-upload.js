// functions/api/shaper-upload.js — Cloudflare Pages serverless edge function.
// Proxies upload requests to ShaperHub, attaching required Origin/Referer headers without browser CORS restrictions.
//
// TASK 767, THE CONTRACT (one implementation: packages/core/shaper-cloud.js handleShaperUpload; this function and the local server.js only pass
// the request text through and send back its answer):
//   POST JSON { email, password, filename, svg, mode }   mode = 'new' (default) | 'replace' | 'keep-both'
//   200 { success: true,  status: 'sent' | 'replaced', filename, requested, blobId, file }   (keep-both: filename = the next free name, "bromont (2).svg")
//   200 { success: false, status: 'exists', filename }   mode 'new' and the name is already in My Files: nothing was uploaded; send again with
//                                                        mode 'replace' (the old entry is removed only after the new blob is uploaded) or 'keep-both'
//   400 { error, kind }   kind = 'input' | 'login' (Shaper refused the sign-in) | 'network' (ShaperHub not reached) | 'shaper' (another refusal);
//                         no error text holds the email or the password
// The calls behind each mode and their order: the comment above UPLOAD_MODES in packages/core/shaper-cloud.js.

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

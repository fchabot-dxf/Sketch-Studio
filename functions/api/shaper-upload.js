// functions/api/shaper-upload.js — Cloudflare Pages serverless edge function.
// Proxies upload requests to ShaperHub, attaching required Origin/Referer headers without browser CORS restrictions.

import { uploadToShaperHub } from '../../packages/core/shaper-cloud.js';

export async function onRequestPost({ request }) {
  try {
    const body = await request.json();
    const result = await uploadToShaperHub(body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}
